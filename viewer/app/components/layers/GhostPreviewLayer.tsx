/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useCallback } from "react";
import * as Cesium from "cesium";
import { useViewerStore } from "../../store/viewerStore";
import type { CreatableEntityType } from "../../store/slices/objectSlice";
import { radioUnitManager } from "../../managers/radioUnitManager";
import { distributedUnitManager } from "../../managers/distributedUnitManager";
import { userEquipmentManager } from "../../managers/userEquipmentManager";
import { panelManager } from "../../managers/panelManager";
import {
  DEFAULT_RADIO_UNIT_PROPERTIES,
  DEFAULT_DISTRIBUTED_UNIT_PROPERTIES,
  DEFAULT_USER_EQUIPMENT_PROPERTIES,
} from "../../constants/entityDefaults";
import { getTimeIndicesForNewUE } from "../../utils/uePlacementTimeIndices";
import { pickPanelTypeForNewRu } from "../../utils/ruDuAutoAssign";

interface GhostPreviewLayerProps {
  viewer: Cesium.Viewer;
}

/**
 * Configuration for ghost preview visualization
 */
type GhostConfig =
  | { type: "model"; modelUri: string; color: Cesium.Color; scale: number }
  | { type: "ellipsoid"; radii: Cesium.Cartesian3; color: Cesium.Color };

const USER_EQUIPMENT_HEIGHT = 1.8; // meters

const GHOST_CONFIG: Partial<
  Record<Exclude<CreatableEntityType, null>, GhostConfig>
> = {
  radioUnit: {
    type: "model",
    modelUri: "glb/radio_unit.glb",
    color: Cesium.Color.CYAN.withAlpha(0.6),
    scale: 1.0,
  },
  distributedUnit: {
    type: "ellipsoid",
    radii: new Cesium.Cartesian3(1.5, 1.5, 1.5),
    color: Cesium.Color.CYAN.withAlpha(0.6),
  },
  userEquipment: {
    type: "ellipsoid",
    radii: new Cesium.Cartesian3(0.8, 0.8, USER_EQUIPMENT_HEIGHT),
    color: Cesium.Color.LIME.withAlpha(0.6),
  },
  // panel: no ghost preview - configured directly in UI
};

const SPAWN_POINT_GRAPHICS = {
  pixelSize: 10,
  color: Cesium.Color.YELLOW,
  outlineColor: Cesium.Color.WHITE,
  outlineWidth: 2,
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
};

/**
 * GhostPreviewLayer - Shows a semi-transparent preview of the object being placed
 *
 * Features:
 * - Ghost model follows the cursor
 * - Smart snapping to 3D tile surfaces (buildings, rooftops)
 */
export const GhostPreviewLayer: React.FC<GhostPreviewLayerProps> = ({
  viewer,
}) => {
  const ghostEntityRef = useRef<Cesium.Entity | null>(null);
  const lastPositionRef = useRef<Cesium.Cartesian3 | null>(null);
  const lastScreenPositionRef = useRef<Cesium.Cartesian2 | null>(null);
  const ghostPositionRef = useRef<Cesium.Cartesian3 | null>(null);
  const ghostShowRef = useRef<boolean>(false);
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const creatingEntityTypeRef = useRef<CreatableEntityType>(null);
  const spawnZonePointIdsRef = useRef<string[]>([]);
  const szDragIndexRef = useRef<number | null>(null);
  const waypointsIdsRef = useRef<string[]>([]);

  const {
    creatingEntityType,
    updateGhostPreview,
    cancelCreatingEntity,
    setSelectedObject,
    setActiveRightTab,
    addSpawnZoneCreationPoint,
    removeSpawnZoneCreationPoint,
    updateSpawnZoneCreationPoint,
    addWaypoint,
  } = useViewerStore();

  // Keep ref in sync with state to avoid stale closures
  creatingEntityTypeRef.current = creatingEntityType;

  /**
   * Create the ghost preview entity
   */
  const createGhostEntity = useCallback(
    (entityType: Exclude<CreatableEntityType, null>) => {
      if (ghostEntityRef.current) {
        viewer.entities.remove(ghostEntityRef.current);
      }

      const config = GHOST_CONFIG[entityType];

      // If no ghost config exists for this entity type, skip ghost creation
      if (!config) {
        ghostEntityRef.current = null;
        ghostPositionRef.current = null;
        ghostShowRef.current = false;
        return;
      }

      // Initialize refs
      ghostPositionRef.current = null;
      ghostShowRef.current = false;

      // Create dynamic position property for smooth ghost movement
      const positionProperty = new Cesium.CallbackProperty(() => {
        const pos = ghostPositionRef.current;
        if (!pos) return Cesium.Cartesian3.ZERO;

        if (config.type === "ellipsoid") {
          const cart = Cesium.Cartographic.fromCartesian(pos);
          return Cesium.Cartesian3.fromRadians(
            cart.longitude,
            cart.latitude,
            cart.height + USER_EQUIPMENT_HEIGHT,
          );
        }
        return ghostPositionRef.current ?? Cesium.Cartesian3.ZERO;
      }, false) as unknown as Cesium.PositionProperty;

      // Create dynamic show property
      const showProperty = new Cesium.CallbackProperty(
        () => ghostShowRef.current,
        false,
      );

      // Create ghost entity based on visualization type
      if (config.type === "model") {
        const modelGraphics = new Cesium.ModelGraphics({
          uri: config.modelUri,
          scale: 1.0,
          color: config.color,
          colorBlendMode: Cesium.ColorBlendMode.MIX,
          colorBlendAmount: 0.8,
        });

        const entity = viewer.entities.add({
          id: "__ghost_preview__",
          position: positionProperty,
          show: showProperty as unknown as boolean,
          model: modelGraphics,
        });

        // Make ghost always visible on top of buildings and terrain
        // @ts-ignore - disableDepthTestDistance exists but not in type definitions
        modelGraphics.disableDepthTestDistance = Number.POSITIVE_INFINITY;

        ghostEntityRef.current = entity;
      } else {
        // Ellipsoid for user equipment
        const ellipsoidGraphics = new Cesium.EllipsoidGraphics({
          radii: config.radii,
          material: config.color,
        });

        const entity = viewer.entities.add({
          id: "__ghost_preview__",
          position: positionProperty,
          show: showProperty as unknown as boolean,
          ellipsoid: ellipsoidGraphics,
        });

        // Make ghost always visible on top of buildings and terrain
        // @ts-ignore - disableDepthTestDistance exists but not in type definitions
        ellipsoidGraphics.disableDepthTestDistance = Number.POSITIVE_INFINITY;

        ghostEntityRef.current = entity;
      }
    },
    [viewer],
  );

  /**
   * Handle mouse movement to update ghost position
   */
  const handleMouseMove = useCallback(
    (movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!creatingEntityTypeRef.current) return;

      lastScreenPositionRef.current = movement.endPosition;

      // Handle spawn zone point dragging
      if (szDragIndexRef.current !== null) {
        viewer.scene.screenSpaceCameraController.enableInputs = false;
        const ray = viewer.camera.getPickRay(movement.endPosition);
        if (!ray) return;
        const terrainPos = viewer.scene.globe.pick(ray, viewer.scene);
        if (!terrainPos) return;
        const carto = Cesium.Cartographic.fromCartesian(terrainPos);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lon = Cesium.Math.toDegrees(carto.longitude);

        const pointId = `spawn-zone-point-${szDragIndexRef.current}`;
        const entity = viewer.entities.getById(pointId);
        if (entity) {
          (entity as any).position = Cesium.Cartesian3.fromDegrees(
            lon,
            lat,
            carto.height,
          );
        }
        updateSpawnZoneCreationPoint(szDragIndexRef.current, {
          lat,
          lon,
          height: carto.height,
        });
        viewer.scene.requestRender();
        return;
      }

      // Waypoints and UE snap to terrain/globe only; other entities use scene depth (3D tiles).
      let pickedPosition: Cesium.Cartesian3 | undefined;
      if (
        creatingEntityTypeRef.current === "waypoint" ||
        creatingEntityTypeRef.current === "userEquipment"
      ) {
        const ray = viewer.camera.getPickRay(movement.endPosition);
        pickedPosition = ray
          ? viewer.scene.globe.pick(ray, viewer.scene)
          : undefined;
      } else {
        pickedPosition = viewer.scene.pickPosition(movement.endPosition);
      }

      if (Cesium.defined(pickedPosition)) {
        lastPositionRef.current = pickedPosition;

        if (ghostEntityRef.current) {
          const cartographic =
            Cesium.Cartographic.fromCartesian(pickedPosition);

          // Raise UE ghost so it sits on the surface (ellipsoid vertical radius 1.8)
          const ghostHeightOffset =
            creatingEntityTypeRef.current === "userEquipment" ? 1.8 : 0;

          const finalPosition = Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            cartographic.height + ghostHeightOffset,
          );

          ghostPositionRef.current = finalPosition;
          ghostShowRef.current = true;

          viewer.scene.requestRender();

          updateGhostPreview({
            position: finalPosition,
            snappedToSurface: true,
            surfaceHeight: cartographic.height,
          });
        } else {
          viewer.scene.requestRender();
        }
      } else {
        ghostShowRef.current = false;
        viewer.scene.requestRender();
      }
    },
    [viewer, updateGhostPreview, updateSpawnZoneCreationPoint],
  );

  /**
   * Handle click to place the object
   */
  const handleClick = useCallback(async () => {
    // Use ref to avoid stale closure
    const entityType = creatingEntityTypeRef.current;
    if (!entityType || !lastPositionRef.current) return;

    const position = lastPositionRef.current;
    const cartographic = Cesium.Cartographic.fromCartesian(position);

    if (entityType === "spawnZone") {
      // Check if clicked on an existing point to remove it
      if (lastScreenPositionRef.current) {
        const picked = viewer.scene.pick(lastScreenPositionRef.current);
        if (Cesium.defined(picked)) {
          const pickedId = picked.id?.id;
          if (
            typeof pickedId === "string" &&
            pickedId.startsWith("spawn-zone-point-")
          ) {
            const index = parseInt(
              pickedId.replace("spawn-zone-point-", ""),
              10,
            );
            if (!isNaN(index)) {
              removeSpawnZoneCreationPoint(index);
              // Rebuild point entities from store
              for (const id of spawnZonePointIdsRef.current) {
                const e = viewer.entities.getById(id);
                if (e) viewer.entities.remove(e);
              }
              spawnZonePointIdsRef.current = [];
              const pts = useViewerStore.getState().spawnZoneCreationPoints;
              pts.forEach((p, i) => {
                const pid = `spawn-zone-point-${i}`;
                viewer.entities.add({
                  id: pid,
                  position: Cesium.Cartesian3.fromDegrees(
                    p.lon,
                    p.lat,
                    p.height,
                  ),
                  point: new Cesium.PointGraphics(SPAWN_POINT_GRAPHICS),
                });
                spawnZonePointIdsRef.current.push(pid);
              });
              viewer.scene.requestRender();
              return;
            }
          }
        }
      }

      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);

      addSpawnZoneCreationPoint({ lat, lon, height: cartographic.height });

      const pointId = `spawn-zone-point-${spawnZonePointIdsRef.current.length}`;
      viewer.entities.add({
        id: pointId,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, cartographic.height),
        point: new Cesium.PointGraphics(SPAWN_POINT_GRAPHICS),
      });
      spawnZonePointIdsRef.current.push(pointId);
      viewer.scene.requestRender();
    } else if (entityType === "radioUnit") {
      // Generate unique IDs incrementally
      const radioUnits = radioUnitManager.getAll();
      const panels = panelManager.getAll();
      const existingIds = Array.from(radioUnits.keys());
      const newId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0;
      const nextCellId =
        Math.max(...Array.from(radioUnits.values()).map((ru) => ru.cellId), 0) +
        1;
      const panelType = pickPanelTypeForNewRu(
        DEFAULT_RADIO_UNIT_PROPERTIES.panelType,
        panels,
        radioUnits.values(),
      );

      // Create the radio unit with default properties
      radioUnitManager.add({
        ...DEFAULT_RADIO_UNIT_PROPERTIES,
        panelType: panelType || DEFAULT_RADIO_UNIT_PROPERTIES.panelType,
        id: newId,
        cellId: nextCellId,
        position: {
          cartographic: cartographic,
          terrainHeight: 0,
        },
      });

      // Cancel creation mode
      cancelCreatingEntity();

      // Select the new entity and open properties panel
      setTimeout(() => {
        setSelectedObject(`ru-${newId}`);
        setActiveRightTab("Entities");
      }, 100);
    } else if (entityType === "distributedUnit") {
      // Generate unique ID incrementally
      const distributedUnits = distributedUnitManager.getAll();
      const existingIds = Array.from(distributedUnits.keys());
      const newId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0;

      // Create the distributed unit with default properties
      distributedUnitManager.add({
        ...DEFAULT_DISTRIBUTED_UNIT_PROPERTIES,
        id: newId,
        position: {
          cartographic: cartographic,
          terrainHeight: 0,
        },
      });

      // Cancel creation mode
      cancelCreatingEntity();

      // Select the new entity and open properties panel
      setTimeout(() => {
        setSelectedObject(`du-${newId}`);
        setActiveRightTab("Entities");
      }, 100);
    } else if (entityType === "userEquipment") {
      // Generate unique ID incrementally
      const userEquipments = userEquipmentManager.getAll();
      const panels = panelManager.getAll();
      const existingIds = Array.from(userEquipments.keys());
      const newId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0;
      const panelId =
        Array.from(panels.keys()).sort((a, b) => a - b)[0] ??
        DEFAULT_USER_EQUIPMENT_PROPERTIES.panel[0];

      // UE is rendered as an ellipsoid with vertical radius 3.0; offset so bottom sits on cursor altitude
      const UE_ELLIPSOID_VERTICAL_RADIUS = 3.0;

      const positionAtCursor = {
        cartographic,
        terrainHeight: UE_ELLIPSOID_VERTICAL_RADIUS,
      };

      const timeIndices = getTimeIndicesForNewUE();
      const positions = timeIndices.map((timeIdx) => ({
        timeIdx,
        position: { ...positionAtCursor },
      }));

      // Create the user equipment with the clicked point as the first waypoint
      userEquipmentManager.add({
        ...DEFAULT_USER_EQUIPMENT_PROPERTIES,
        panel: [panelId],
        id: newId,
        positions: [],
        waypoints: [
          {
            id: 0,
            position: {
              cartographic: Cesium.Cartographic.fromDegrees(
                Cesium.Math.toDegrees(cartographic.longitude),
                Cesium.Math.toDegrees(cartographic.latitude),
                0,
              ),
              terrainHeight: cartographic.height,
            },
            speed: 1.5,
            stop: 0.0,
            azimuth_offset: 0.0,
            arrival_time: -1,
          },
        ],
      });
      // Cancel creation mode
      cancelCreatingEntity();

      // Select the new entity and open properties panel
      setTimeout(() => {
        setSelectedObject(`ue-${newId}`);
        setActiveRightTab("Entities");
      }, 100);
    } else if (entityType === "waypoint") {
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);

      addWaypoint({
        lat,
        lon,
        terrainHeight: cartographic.height,
        offsetHeight: 0,
      });

      const pointId = `waypoint-${waypointsIdsRef.current.length}`;
      viewer.entities.add({
        id: pointId,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, cartographic.height),
        point: new Cesium.PointGraphics({
          pixelSize: 16,
          color: Cesium.Color.ORANGE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        }),
      });
      waypointsIdsRef.current.push(pointId);
      viewer.scene.requestRender();
    }
  }, [
    viewer,
    cancelCreatingEntity,
    setSelectedObject,
    setActiveRightTab,
    addSpawnZoneCreationPoint,
    removeSpawnZoneCreationPoint,
    addWaypoint,
  ]);

  /**
   * Set up event handlers
   */
  useEffect(() => {
    if (!viewer || !creatingEntityType) {
      if (ghostEntityRef.current) {
        viewer?.entities.remove(ghostEntityRef.current);
        ghostEntityRef.current = null;
        ghostPositionRef.current = null;
        ghostShowRef.current = false;
      }
      if (handlerRef.current) {
        handlerRef.current.destroy();
        handlerRef.current = null;
      }
      if (viewer) {
        for (const id of spawnZonePointIdsRef.current) {
          const entity = viewer.entities.getById(id);
          if (entity) viewer.entities.remove(entity);
        }
        spawnZonePointIdsRef.current = [];

        for (const id of waypointsIdsRef.current) {
          const entity = viewer.entities.getById(id);
          if (entity) viewer.entities.remove(entity);
        }
        waypointsIdsRef.current = [];
      }
      return;
    }

    // Create ghost entity
    createGhostEntity(creatingEntityType);

    // Set up event handler
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    handler.setInputAction(
      handleMouseMove,
      Cesium.ScreenSpaceEventType.MOUSE_MOVE,
    );
    handler.setInputAction(handleClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(
      (event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        if (creatingEntityTypeRef.current !== "spawnZone") return;
        const picked = viewer.scene.pick(event.position);
        if (!Cesium.defined(picked)) return;
        const entityId = picked.id?.id;
        if (
          typeof entityId === "string" &&
          entityId.startsWith("spawn-zone-point-")
        ) {
          const index = parseInt(entityId.replace("spawn-zone-point-", ""), 10);
          if (!isNaN(index)) szDragIndexRef.current = index;
        }
      },
      Cesium.ScreenSpaceEventType.LEFT_DOWN,
    );
    handler.setInputAction(() => {
      if (szDragIndexRef.current !== null) {
        viewer.scene.screenSpaceCameraController.enableInputs = true;
        szDragIndexRef.current = null;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // Restore existing points when editing a spawn zone
    if (
      creatingEntityType === "spawnZone" &&
      useViewerStore.getState().editingSpawnZone
    ) {
      const points = useViewerStore.getState().spawnZoneCreationPoints;
      points.forEach((p, i) => {
        const pointId = `spawn-zone-point-${i}`;
        viewer.entities.add({
          id: pointId,
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height),
          point: new Cesium.PointGraphics(SPAWN_POINT_GRAPHICS),
        });
        spawnZonePointIdsRef.current.push(pointId);
      });
      viewer.scene.requestRender();
    }

    return () => {
      if (ghostEntityRef.current) {
        viewer.entities.remove(ghostEntityRef.current);
        ghostEntityRef.current = null;
        ghostPositionRef.current = null;
        ghostShowRef.current = false;
      }
      if (handlerRef.current) {
        handlerRef.current.destroy();
        handlerRef.current = null;
      }
      for (const id of spawnZonePointIdsRef.current) {
        const entity = viewer.entities.getById(id);
        if (entity) viewer.entities.remove(entity);
      }
      spawnZonePointIdsRef.current = [];
    };
  }, [
    viewer,
    creatingEntityType,
    createGhostEntity,
    handleMouseMove,
    handleClick,
  ]);

  // This is a pure side-effect component, no visual output
  return null;
};
