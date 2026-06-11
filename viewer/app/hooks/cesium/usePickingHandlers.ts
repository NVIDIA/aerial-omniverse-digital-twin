/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";
import { useViewerStore } from "@/store/viewerStore";
import type { ObjectType } from "@/types";
import {
  getHighlightManager,
  isEntity,
  is3DTileFeature,
  extractEntityId,
  isRadioUnit,
  isUserEquipment,
  isScatterer,
} from "@/services/cesium";
import {
  getGizmoAxisHitByRay,
  getGizmoAxisDirection,
  getGizmoArrowLengthWorld,
  GIZMO_PIXEL_LENGTH,
  GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX,
} from "@/utils/moveGizmo";
import {
  getRotateRingHitByRay,
  getAzimuthAngleFromScreen,
  getTiltAngleFromScreen,
} from "@/utils/rotateGizmo";
import * as Cesium from "cesium";
import { radioUnitManager } from "~/managers/radioUnitManager";
import { distributedUnitManager } from "~/managers/distributedUnitManager";
import { userEquipmentManager } from "~/managers/userEquipmentManager";
import { scattererManager } from "~/managers/scattererManager";
import { TIMELINE_CONFIG } from "@/constants/timeline";

// Helper to check if object is a Cesium Entity (not null and not 3D tile feature)
const isCesiumEntity = (obj: any): obj is Cesium.Entity => isEntity(obj);

// Helper to check if object is a 3D tile feature
const isCesium3DTileFeature = (obj: any): obj is Cesium.Cesium3DTileFeature =>
  is3DTileFeature(obj);

// Helper to check if object is draggable (radio units, distributed units, user equipment, and scatterers)
const isObjectDraggable = (obj: any): boolean => {
  if (!obj || !(obj instanceof window.Cesium.Entity)) {
    return false;
  }
  return (
    isRadioUnit(obj) ||
    isUserEquipment(obj) ||
    isScatterer(obj) ||
    obj.id.startsWith("du-")
  );
};

// Helper to check if object is rotatable (RU only – orientation / mech_azimuth / mech_tilt)
const isObjectRotatable = (obj: any): boolean => {
  if (!obj || !(obj instanceof window.Cesium.Entity)) return false;
  return isRadioUnit(obj);
};

// Helper to extract radio unit ID from entity ID
const extractRadioUnitId = (entityId: string): number | null =>
  extractEntityId(entityId, "ru");

// Helper to extract distributed unit ID from entity ID
const extractDistributedUnitId = (entityId: string): number | null =>
  extractEntityId(entityId, "du");

// Helper to extract user equipment ID from entity ID
const extractUserEquipmentId = (entityId: string): number | null =>
  extractEntityId(entityId, "ue");

// Helper to extract scatterer ID from entity ID
const extractScattererId = (entityId: string): number | null =>
  extractEntityId(entityId, "scatterer");

/** Derive the current time index from the Cesium clock. */
function getCurrentTimeIndex(viewer: any): number {
  const secondsFromBase = Cesium.JulianDate.secondsDifference(
    viewer.clock.currentTime,
    TIMELINE_CONFIG.baseTime,
  );
  return Math.round(secondsFromBase / TIMELINE_CONFIG.timeStep);
}

/**
 * Update a SampledPositionProperty on an entity at the current clock time.
 * Uses the module-level Cesium import (same one the layers use to create the SampledPositionProperty)
 * to avoid cross-module instanceof mismatches with window.Cesium.
 */
function updateSampledPositionAtTime(
  entity: Cesium.Entity,
  viewer: any,
  cartographic: Cesium.Cartographic,
) {
  const posProp = entity.position as any;
  if (!posProp || typeof posProp.addSample !== "function") {
    return;
  }
  const timeIdx = getCurrentTimeIndex(viewer);
  const julianTime = Cesium.JulianDate.addSeconds(
    TIMELINE_CONFIG.baseTime,
    timeIdx * TIMELINE_CONFIG.timeStep,
    new Cesium.JulianDate(),
  );
  const cartesian = Cesium.Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    cartographic.height,
  );
  posProp.addSample(julianTime, cartesian);
}

interface PickingHandlersOptions {
  viewer: any | null;
  onCursorPositionChange: (
    position: { longitude: number; latitude: number; altitude: number } | null,
  ) => void;
}

/**
 * Manages all picking interactions (click and hover) for buildings, entities, and terrain
 */
export const usePickingHandlers = ({
  viewer,
  onCursorPositionChange,
}: PickingHandlersOptions) => {
  const lastHoverTimeRef = useRef(0);
  const lastDragTimeRef = useRef(0);
  const isMouseDownRef = useRef(false);
  /** Fixed axis line for the duration of an axis drag (so motion stays on one line). */
  const axisDragLineRef = useRef<{
    origin: Cesium.Cartesian3;
    direction: Cesium.Cartesian3;
  } | null>(null);
  /** Axis we're constraining to during this drag (ref so first MOUSE_MOVE sees it before store updates). */
  const axisDragAxisRef = useRef<"x" | "y" | "z" | null>(null);
  /** Screen position when axis drag started; object stays put until mouse moves past this threshold. */
  const axisDragStartScreenRef = useRef<Cesium.Cartesian2 | null>(null);
  /** Screen position at left-down; used to avoid moving object on selection click. */
  const leftDownScreenRef = useRef<Cesium.Cartesian2 | null>(null);
  /** True when this pointer down selected an object; skip free-drag position update until mouse moves past threshold. */
  const didSelectOnThisDownRef = useRef(false);
  /** Screen-space unit direction of the axis at drag start (so delta-based drag never flips). */
  const axisScreenDirRef = useRef<Cesium.Cartesian2 | null>(null);
  /** Saved SampledPositionProperty during UE/Scatterer drag so we can set position directly for 1:1 cursor tracking. */
  const savedPositionPropertyRef = useRef<any>(null);
  /** Rotate drag: ring being dragged (azimuth | tilt). */
  const rotateDragRingRef = useRef<"azimuth" | "tilt" | null>(null);
  /** Rotate drag: screen angle at mouse down (for delta). */
  const rotateDragStartAngleRef = useRef<number>(0);
  /** Rotate drag: RU mechAzimuth at mouse down. */
  const rotateDragStartRuAzimuthRef = useRef<number>(0);
  /** Rotate drag: RU mechTilt at mouse down. */
  const rotateDragStartRuTiltRef = useRef<number>(0);

  const {
    setSelectedObject,
    setHoveredObject,
    setActiveRightTab,
    setDraggingObject,
    stopDraggingObject,
    setDraggingGizmoAxis,
    setHoveredGizmoAxis,
    setDraggingRotateRing,
    setHoveredRotateRing,
    creatingEntityType,
  } = useViewerStore();

  useEffect(() => {
    if (!viewer?.scene || !window.Cesium) return;

    const Cesium = window.Cesium;

    // Helper function to parse entity ID and extract type and unique ID
    function parseEntityType(
      entityIdString: string,
    ): "radioUnit" | "distributedUnit" | "userEquipment" | "scatterer" | null {
      if (!entityIdString) return null;

      // Pattern: {type}-{id} or {type}-{subtype}-{id}
      const parts = entityIdString.split("-");

      if (parts.length < 2) return null;

      // Map entity prefixes to their types
      const typeMap: {
        [key: string]:
          | "radioUnit"
          | "distributedUnit"
          | "userEquipment"
          | "scatterer";
      } = {
        ru: "radioUnit",
        du: "distributedUnit",
        ue: "userEquipment",
        scatterer: "scatterer",
      };

      const prefix = parts[0];
      const entityType = typeMap[prefix];

      if (!entityType) return null;

      return entityType;
    }

    // Gizmo axis IDs from MoveGizmoLayer – picking one starts axis-constrained move
    const GIZMO_IDS: Record<string, "x" | "y" | "z"> = {
      __move_gizmo_x__: "x",
      __move_gizmo_y__: "y",
      __move_gizmo_z__: "z",
    };

    // Rotate gizmo IDs from RotateGizmoLayer – picking one starts ring-constrained rotate
    const ROTATE_GIZMO_IDS: Record<string, "azimuth" | "tilt"> = {
      __rotate_gizmo_azimuth__: "azimuth",
      __rotate_gizmo_tilt__: "tilt",
    };

    // Max screen distance (px) from selected entity to allow starting axis drag. If the click is
    // farther, we treat it as "clicked another object" (e.g. viewport loading can make pick return the wrong entity).
    const MAX_SCREEN_DISTANCE_TO_START_AXIS_DRAG_PX = 80;

    // Min movement (px) from left-down position before we apply a free-drag position update. Avoids
    // moving the object when the user does a quick select (down/up) then clicks elsewhere; only an intentional drag moves.
    const FREE_DRAG_MOVE_THRESHOLD_PX = 12;

    // LEFT DOWN handler - Start dragging if object is selected
    const handleLeftDown = (event: any) => {
      // Skip if in creation mode - GhostPreviewLayer handles this
      const currentState = useViewerStore.getState();
      if (currentState.creatingEntityType) {
        return;
      }

      isMouseDownRef.current = true;
      leftDownScreenRef.current = Cesium.Cartesian2.clone(event.position);
      didSelectOnThisDownRef.current = false;

      const object = viewer.scene.pick(event.position);
      const selected = currentState.selectedObject;
      // For entities, scene.pick returns { id: Entity }; for 3D tiles it returns a Cesium3DTileFeature directly.
      // Extract the Entity reference and a string ID for comparisons.
      const pickedRef = Cesium.defined(object) ? object.id : undefined;
      const pickedStringId: string | undefined =
        typeof pickedRef === "string"
          ? pickedRef
          : pickedRef != null && typeof (pickedRef as any).id === "string"
            ? (pickedRef as any).id
            : undefined;
      const pickedIsEntity = isCesiumEntity(pickedRef);
      const selectedId =
        selected == null
          ? null
          : typeof selected === "string"
            ? selected
            : (selected as any)?.id;

      // When rotate tool is on and we have a selected RU: try to start rotate drag on a ring.
      if (currentState.rotateToolEnabled && isObjectRotatable(selected)) {
        const selectedEntity =
          typeof selected === "string"
            ? (viewer.entities.getById(selected) ?? null)
            : selected;
        const pos =
          selectedEntity && isCesiumEntity(selectedEntity)
            ? selectedEntity.position?.getValue(Cesium.JulianDate.now())
            : undefined;
        const ruId = pos
          ? extractRadioUnitId((selected as any)?.id ?? selected)
          : null;
        const ru = ruId != null ? radioUnitManager.get(ruId) : undefined;

        if (pos && ru) {
          let ring: "azimuth" | "tilt" | null = null;
          if (pickedStringId != null && ROTATE_GIZMO_IDS[pickedStringId]) {
            ring = ROTATE_GIZMO_IDS[pickedStringId];
          } else {
            ring = getRotateRingHitByRay(
              viewer,
              event.position,
              pos,
              ru.mechAzimuth ?? 0,
              ru.mechTilt ?? 0,
            );
          }

          if (ring) {
            viewer.scene.screenSpaceCameraController.enableInputs = false;
            setDraggingRotateRing(ring);
            setDraggingObject(selectedEntity ?? selected);
            rotateDragRingRef.current = ring;
            if (ring === "azimuth") {
              rotateDragStartAngleRef.current = getAzimuthAngleFromScreen(
                viewer,
                event.position,
                pos,
              );
              rotateDragStartRuAzimuthRef.current = ru.mechAzimuth ?? 0;
              rotateDragStartRuTiltRef.current = ru.mechTilt ?? 0;
            } else {
              rotateDragStartAngleRef.current = getTiltAngleFromScreen(
                viewer,
                event.position,
                pos,
                ru.mechAzimuth ?? 0,
              );
              rotateDragStartRuAzimuthRef.current = ru.mechAzimuth ?? 0;
              rotateDragStartRuTiltRef.current = ru.mechTilt ?? 0;
            }
            return;
          }
        }
      }

      // When move tool is on and we have a selected entity: try to start axis drag only if we
      // actually picked the selected entity or a gizmo. If pick returned nothing (e.g. viewport
      // still loading), do not start axis drag so we don't move the RU when the user clicked a UE.
      if (currentState.moveToolEnabled && isObjectDraggable(selected)) {
        // Preemptively block camera pan/rotate so the controller can't start
        // tracking on this LEFT_DOWN before we decide whether to drag.
        viewer.scene.screenSpaceCameraController.enableInputs = false;

        // Treat pick on UE path (ue-path-X) as pick on the UE (ue-X) so drag works when path is on top
        const effectivePickedId =
          pickedStringId != null && pickedStringId.startsWith("ue-path-")
            ? "ue-" + pickedStringId.replace("ue-path-", "")
            : (pickedStringId ?? null);

        const pickedIsSelected =
          Cesium.defined(object) &&
          effectivePickedId != null &&
          selectedId === effectivePickedId;
        const pickedIsGizmo =
          pickedStringId != null && !!GIZMO_IDS[pickedStringId];
        const mayStartAxisDrag = pickedIsSelected || pickedIsGizmo;

        if (!mayStartAxisDrag) {
          // Fall through so we can change selection or clear selection
        } else {
          // Always resolve entity from the viewer by ID so we never use a stale reference
          const selectedEntity =
            typeof selected === "string"
              ? (viewer.entities.getById(selected) ?? null)
              : isCesiumEntity(selected) && (selected as any).id != null
                ? (viewer.entities.getById(String((selected as any).id)) ??
                  selected)
                : selected;
          if (selectedEntity && selectedEntity !== selected) {
            useViewerStore.getState().setSelectedObject(selectedEntity as any);
          }
          const time = viewer.clock.currentTime;
          const pos =
            selectedEntity && isCesiumEntity(selectedEntity)
              ? selectedEntity.position?.getValue(time)
              : undefined;
          if (pos) {
            // Only start axis drag when the click is near the selected entity on screen.
            // When the viewport is still loading, pick can return the wrong entity (e.g. RU when user clicked UE);
            // requiring proximity avoids moving the RU when the user actually clicked elsewhere.
            const entityScreenPos =
              Cesium.SceneTransforms.worldToWindowCoordinates(
                viewer.scene,
                pos,
                new Cesium.Cartesian2(),
              );
            const clickDistPx =
              entityScreenPos &&
              Cesium.Cartesian2.distance(event.position, entityScreenPos);
            const clickNearEntity =
              typeof clickDistPx === "number" &&
              clickDistPx <= MAX_SCREEN_DISTANCE_TO_START_AXIS_DRAG_PX;

            if (!clickNearEntity) {
              // Fall through so we can change selection or clear
            } else {
              let axis: "x" | "y" | "z" | null = null;
              if (pickedIsGizmo && pickedStringId) {
                axis = GIZMO_IDS[pickedStringId] ?? null;
              } else {
                axis = getGizmoAxisHitByRay(viewer, event.position, pos);
              }
              if (axis) {
                axisDragAxisRef.current = axis;
                axisDragStartScreenRef.current = Cesium.Cartesian2.clone(
                  event.position,
                );
                setDraggingGizmoAxis(axis);
                setDraggingObject(selectedEntity ?? selected);
                const axisDir = getGizmoAxisDirection(pos, axis);
                axisDragLineRef.current = {
                  origin: Cesium.Cartesian3.clone(pos),
                  direction: axisDir,
                };
                const oScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
                  viewer.scene,
                  pos,
                  new Cesium.Cartesian2(),
                );
                const endWorld = Cesium.Cartesian3.add(
                  pos,
                  Cesium.Cartesian3.multiplyByScalar(
                    axisDir,
                    1,
                    new Cesium.Cartesian3(),
                  ),
                  new Cesium.Cartesian3(),
                );
                const eScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
                  viewer.scene,
                  endWorld,
                  new Cesium.Cartesian2(),
                );
                if (oScreen && eScreen) {
                  const d = Cesium.Cartesian2.subtract(
                    eScreen,
                    oScreen,
                    new Cesium.Cartesian2(),
                  );
                  const len = Cesium.Cartesian2.magnitude(d);
                  axisScreenDirRef.current =
                    len >= 1e-5
                      ? Cesium.Cartesian2.normalize(d, new Cesium.Cartesian2())
                      : null;
                } else {
                  axisScreenDirRef.current = null;
                }
                return;
              }
              // No axis hit – clicked on selected entity body (or gizmo
              // near origin) → start free drag instead of axis-constrained
              if (pickedIsSelected || pickedIsGizmo) {
                didSelectOnThisDownRef.current = true;
                setDraggingObject(selectedEntity ?? selected);
                return;
              }
            }
          }
        }

        // No drag started – re-enable camera for normal interaction
        viewer.scene.screenSpaceCameraController.enableInputs = true;
      }

      // Click on move gizmo entity (if it was pickable) – only when move tool is enabled
      if (
        pickedStringId != null &&
        GIZMO_IDS[pickedStringId] &&
        currentState.moveToolEnabled
      ) {
        if (isObjectDraggable(selected)) {
          const selectedEntityResolved =
            typeof selected === "string"
              ? (viewer.entities.getById(selected) ?? null)
              : isCesiumEntity(selected) && (selected as any).id != null
                ? (viewer.entities.getById(String((selected as any).id)) ??
                  selected)
                : selected;
          if (selectedEntityResolved && selectedEntityResolved !== selected) {
            useViewerStore
              .getState()
              .setSelectedObject(selectedEntityResolved as any);
          }
          const time = viewer.clock.currentTime;
          const pos = isCesiumEntity(selectedEntityResolved)
            ? selectedEntityResolved.position?.getValue(time)
            : undefined;

          // If click is in the origin exclusion zone, start free drag instead of axis drag
          if (pos) {
            const originScreen =
              Cesium.SceneTransforms.worldToWindowCoordinates(
                viewer.scene,
                pos,
                new Cesium.Cartesian2(),
              );
            if (originScreen) {
              const dist2 = Cesium.Cartesian2.distanceSquared(
                event.position,
                originScreen,
              );
              if (
                dist2 <
                GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX *
                  GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX
              ) {
                didSelectOnThisDownRef.current = true;
                setDraggingObject(selectedEntityResolved);
                viewer.scene.screenSpaceCameraController.enableInputs = false;
                return;
              }
            }
          }

          const axis = GIZMO_IDS[pickedStringId];
          axisDragAxisRef.current = axis;
          axisDragStartScreenRef.current = Cesium.Cartesian2.clone(
            event.position,
          );
          setDraggingGizmoAxis(axis);
          setDraggingObject(selectedEntityResolved);
          viewer.scene.screenSpaceCameraController.enableInputs = false;
          if (pos) {
            const axisDir = getGizmoAxisDirection(pos, axis);
            axisDragLineRef.current = {
              origin: Cesium.Cartesian3.clone(pos),
              direction: axisDir,
            };
            const oScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
              viewer.scene,
              pos,
              new Cesium.Cartesian2(),
            );
            const endWorld = Cesium.Cartesian3.add(
              pos,
              Cesium.Cartesian3.multiplyByScalar(
                axisDir,
                1,
                new Cesium.Cartesian3(),
              ),
              new Cesium.Cartesian3(),
            );
            const eScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
              viewer.scene,
              endWorld,
              new Cesium.Cartesian2(),
            );
            if (oScreen && eScreen) {
              const d = Cesium.Cartesian2.subtract(
                eScreen,
                oScreen,
                new Cesium.Cartesian2(),
              );
              const len = Cesium.Cartesian2.magnitude(d);
              axisScreenDirRef.current =
                len >= 1e-5
                  ? Cesium.Cartesian2.normalize(d, new Cesium.Cartesian2())
                  : null;
            } else {
              axisScreenDirRef.current = null;
            }
          } else {
            axisDragLineRef.current = null;
            axisScreenDirRef.current = null;
          }
        }
        return;
      }

      // Only the select tool gates new-object selection. The move tool's drag
      // interactions with the already-selected object are handled above.
      if (!currentState.selectToolEnabled) {
        return;
      }

      const isPickedGizmo =
        pickedStringId != null &&
        (GIZMO_IDS[pickedStringId] || ROTATE_GIZMO_IDS[pickedStringId]);

      const findNonGizmoFromDrill = (): ObjectType | null => {
        const drilled = viewer.scene.drillPick(event.position);
        const nonGizmo = drilled.find((item: any) => {
          const ref = item.id ?? item.primitive?.id ?? item;
          const id =
            typeof ref === "string"
              ? ref
              : ref != null && typeof (ref as any).id === "string"
                ? (ref as any).id
                : undefined;
          return id != null && !GIZMO_IDS[id] && !ROTATE_GIZMO_IDS[id];
        });
        if (!nonGizmo) return null;
        const ref = nonGizmo.id ?? nonGizmo.primitive?.id ?? nonGizmo;
        return isCesium3DTileFeature(ref) ? ref : (ref as ObjectType);
      };

      let objectToSelect: ObjectType | null = null;

      if (!Cesium.defined(object)) {
        if (currentState.rotateToolEnabled || currentState.moveToolEnabled) {
          objectToSelect = findNonGizmoFromDrill();
        }
        if (objectToSelect == null) {
          setSelectedObject(null);
          setHoveredObject(null);
          return;
        }
      } else if (isPickedGizmo) {
        objectToSelect = findNonGizmoFromDrill();
        if (objectToSelect == null) return;
      } else if (
        isCesium3DTileFeature(object) &&
        object.tileset?._selectable === false
      ) {
        return;
      } else {
        objectToSelect = isCesium3DTileFeature(object)
          ? object
          : (pickedRef as ObjectType);
      }

      setActiveRightTab("Entities");

      const highlightManager = getHighlightManager(viewer);
      if (!highlightManager) return;

      // Clear any hover highlight before selection
      highlightManager.unhighlightHoveredObject();

      didSelectOnThisDownRef.current = true;
      setSelectedObject(objectToSelect);
    };

    // LEFT UP handler - Finish dragging if in drag mode
    const handleLeftUp = () => {
      isMouseDownRef.current = false;
      const currentState = useViewerStore.getState();
      if (currentState.draggingObject) {
        didSelectOnThisDownRef.current = false;
      }
      // else leave didSelectOnThisDownRef so LEFT_CLICK can avoid clearing a just-selected RU

      if (currentState.draggingObject) {
        const draggingObject = currentState.draggingObject;

        // Restore SampledPositionProperty for UE/Scatterer and commit the final sample
        let finalPos: Cesium.Cartesian3 | undefined;
        if (
          savedPositionPropertyRef.current &&
          isCesiumEntity(draggingObject)
        ) {
          finalPos = draggingObject.position?.getValue(Cesium.JulianDate.now());
          draggingObject.position = savedPositionPropertyRef.current;
          if (finalPos) {
            const carto = Cesium.Cartographic.fromCartesian(finalPos);
            updateSampledPositionAtTime(draggingObject, viewer, carto);
          }
          savedPositionPropertyRef.current = null;
        }

        if (isCesiumEntity(draggingObject)) {
          viewer.scene.requestRender();

          const entityType = parseEntityType(draggingObject.id);
          if (entityType === "radioUnit") {
            const ruId = extractRadioUnitId(draggingObject.id);
            if (ruId != null) {
              const ru = radioUnitManager.get(ruId);
              if (ru != null) {
                radioUnitManager.update(ruId, {
                  position: {
                    cartographic: ru.position.cartographic,
                    terrainHeight: ru.position.terrainHeight,
                  },
                });
              }
            }
          } else if (entityType === "distributedUnit") {
            const duId = extractDistributedUnitId(draggingObject.id);
            if (duId != null) distributedUnitManager.update(duId, {});
          } else if (entityType === "userEquipment") {
            const ueId = extractUserEquipmentId(draggingObject.id);
            if (ueId != null) {
              if (finalPos) {
                const carto = Cesium.Cartographic.fromCartesian(finalPos);
                const ue = userEquipmentManager.get(ueId);
                if (ue && ue.positions.length > 0) {
                  const timeIdx = getCurrentTimeIndex(viewer);
                  let posEntry = ue.positions.find(
                    (p) => p.timeIdx === timeIdx,
                  );
                  if (!posEntry) {
                    posEntry = {
                      timeIdx,
                      position: {
                        cartographic: new Cesium.Cartographic(
                          carto.longitude,
                          carto.latitude,
                          carto.height,
                        ),
                        terrainHeight: 0,
                      },
                    };
                    ue.positions.push(posEntry);
                    ue.positions.sort((a, b) => a.timeIdx - b.timeIdx);
                  } else {
                    posEntry.position.cartographic = new Cesium.Cartographic(
                      carto.longitude,
                      carto.latitude,
                      carto.height,
                    );
                    posEntry.position.terrainHeight = 0;
                  }
                }
              }
              userEquipmentManager.update(ueId, {});
            }
          } else if (entityType === "scatterer") {
            scattererManager.setAll(scattererManager.getAll());
          }
        }

        axisDragAxisRef.current = null;
        axisDragStartScreenRef.current = null;
        axisScreenDirRef.current = null;
        setDraggingGizmoAxis(null);
        axisDragLineRef.current = null;
        rotateDragRingRef.current = null;
        setDraggingRotateRing(null);
        stopDraggingObject();

        // Re-enable camera movement after dragging
        viewer.scene.screenSpaceCameraController.enableInputs = true;
        return;
      }
    };

    // LEFT CLICK handler - For normal selections and adding
    const handleLeftClick = (event: any) => {
      // Skip if in creation mode - GhostPreviewLayer handles this
      if (useViewerStore.getState().creatingEntityType) {
        return;
      }

      // Skip click handling if we just finished dragging
      if (useViewerStore.getState().draggingObject) {
        return;
      }

      handleNormalClick(event);
    };

    // MOUSE MOVE handler
    const handleMouseMove = (event: any) => {
      const currentState = useViewerStore.getState();
      const now = Date.now();

      // Skip hover handling if in creation mode - GhostPreviewLayer handles this
      if (currentState.creatingEntityType) {
        // Still update cursor position
        if (now - lastHoverTimeRef.current >= 100) {
          lastHoverTimeRef.current = now;
          onCursorPositionChange(getCursorPositionDegrees(event));
        }
        return;
      }

      // Handle dragging only when we actually started an axis, ring, or free drag (LEFT_DOWN picked axis/ring/object/origin).
      const selectedObject = currentState.selectedObject;
      const isRotateDrag = !!(
        currentState.draggingRotateRing ?? rotateDragRingRef.current
      );
      const isAxisDrag = !!(
        currentState.draggingGizmoAxis ?? axisDragAxisRef.current
      );
      const isFreeDrag =
        isMouseDownRef.current &&
        currentState.draggingObject &&
        !isRotateDrag &&
        !isAxisDrag;
      if (
        isMouseDownRef.current &&
        (isRotateDrag || isAxisDrag || isFreeDrag)
      ) {
        setDraggingObject(selectedObject);
        viewer.scene.screenSpaceCameraController.enableInputs = false;

        if (isRotateDrag) {
          if (now - lastDragTimeRef.current >= 0) {
            lastDragTimeRef.current = now;
            handleRotateDragging(event);
          }
        } else if (isAxisDrag || isFreeDrag) {
          const throttleMs = 0;
          if (now - lastDragTimeRef.current >= throttleMs) {
            lastDragTimeRef.current = now;
            handleObjectDragging(event);
          }
        }
      } else {
        // Update gizmo hover highlight when move tool is on and not dragging
        if (
          currentState.moveToolEnabled &&
          !currentState.draggingObject &&
          isObjectDraggable(selectedObject)
        ) {
          const pos = isCesiumEntity(selectedObject)
            ? selectedObject.position?.getValue(Cesium.JulianDate.now())
            : undefined;
          if (pos) {
            const axis = getGizmoAxisHitByRay(viewer, event.endPosition, pos);
            setHoveredGizmoAxis(axis);
          } else {
            setHoveredGizmoAxis(null);
          }
        } else {
          setHoveredGizmoAxis(null);
        }
        // Update rotate ring hover when rotate tool is on and not dragging
        if (
          currentState.rotateToolEnabled &&
          !currentState.draggingObject &&
          isObjectRotatable(selectedObject)
        ) {
          const pos = isCesiumEntity(selectedObject)
            ? selectedObject.position?.getValue(Cesium.JulianDate.now())
            : undefined;
          const ruId = pos
            ? extractRadioUnitId((selectedObject as any)?.id)
            : null;
          const ru = ruId != null ? radioUnitManager.get(ruId) : undefined;
          if (pos && ru) {
            const ring = getRotateRingHitByRay(
              viewer,
              event.endPosition,
              pos,
              ru.mechAzimuth ?? 0,
              ru.mechTilt ?? 0,
            );
            setHoveredRotateRing(ring);
          } else {
            setHoveredRotateRing(null);
          }
        } else {
          setHoveredRotateRing(null);
        }
        if (currentState.selectToolEnabled && !isMouseDownRef.current) {
          handleHover(event);
        }
      }

      // Throttle hover handling
      if (now - lastHoverTimeRef.current < 100) return;
      lastHoverTimeRef.current = now;
      onCursorPositionChange(getCursorPositionDegrees(event));
    };

    viewer.cesiumWidget.screenSpaceEventHandler.setInputAction(
      handleLeftDown,
      Cesium.ScreenSpaceEventType.LEFT_DOWN,
    );

    viewer.cesiumWidget.screenSpaceEventHandler.setInputAction(
      handleLeftUp,
      Cesium.ScreenSpaceEventType.LEFT_UP,
    );

    viewer.cesiumWidget.screenSpaceEventHandler.setInputAction(
      handleLeftClick,
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );

    viewer.cesiumWidget.screenSpaceEventHandler.setInputAction(
      handleMouseMove,
      Cesium.ScreenSpaceEventType.MOUSE_MOVE,
    );

    function handleNormalClick(event: any) {
      const currentState = useViewerStore.getState();
      if (!currentState.selectToolEnabled) {
        return;
      }

      const pickedObject = viewer.scene.pick(event.position);

      if (!Cesium.defined(pickedObject)) {
        // Don't clear when we just selected (LEFT_DOWN set didSelectOnThisDownRef).
        if (didSelectOnThisDownRef.current) {
          didSelectOnThisDownRef.current = false;
          return;
        }
        // With rotate/move tool on, pick often returns nothing (gizmo/timing); don't clear an RU selection.
        if (
          (currentState.rotateToolEnabled || currentState.moveToolEnabled) &&
          isObjectRotatable(currentState.selectedObject)
        ) {
          return;
        }
        handleEmptySpaceClick();
      } else {
        didSelectOnThisDownRef.current = false;
      }
    }

    function handleEmptySpaceClick() {
      // Setting to null will automatically clear highlights via the store action
      setSelectedObject(null);
    }

    /** Rotate drag: update RU orientation from ring drag (azimuth or tilt). */
    function handleRotateDragging(event: any) {
      const draggingObject = useViewerStore.getState().draggingObject;
      const ring =
        useViewerStore.getState().draggingRotateRing ??
        rotateDragRingRef.current;
      if (!draggingObject || !isCesiumEntity(draggingObject) || !ring) return;

      const ruId = extractRadioUnitId(draggingObject.id);
      if (ruId == null) return;
      const ru = radioUnitManager.get(ruId);
      if (ru == null) return;

      const pos = draggingObject.position?.getValue(Cesium.JulianDate.now());
      if (!pos) return;

      const screenPos = event.endPosition ?? event.position;
      if (!screenPos) return;

      let newAzimuth = ru.mechAzimuth ?? 0;
      let newTilt = ru.mechTilt ?? 0;

      if (ring === "azimuth") {
        const currentAngle = getAzimuthAngleFromScreen(viewer, screenPos, pos);
        const delta = currentAngle - rotateDragStartAngleRef.current;
        newAzimuth = rotateDragStartRuAzimuthRef.current - delta;
        newAzimuth = ((newAzimuth % 360) + 360) % 360;
        newTilt = rotateDragStartRuTiltRef.current;
      } else {
        const currentAngle = getTiltAngleFromScreen(
          viewer,
          screenPos,
          pos,
          ru.mechAzimuth ?? 0,
        );
        let delta = currentAngle - rotateDragStartAngleRef.current;
        // getTiltAngleFromScreen returns -180..180; normalize delta so crossing ±180° is continuous
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        newTilt = rotateDragStartRuTiltRef.current - delta;
        newTilt = ((newTilt % 360) + 360) % 360;
        newAzimuth = rotateDragStartRuAzimuthRef.current;
      }

      const orientation = Cesium.HeadingPitchRoll.fromDegrees(
        newAzimuth,
        newTilt,
        0,
      );
      radioUnitManager.update(ruId, {
        orientation,
        mechAzimuth: newAzimuth,
        mechTilt: newTilt,
      });
      viewer.scene.requestRender();
    }

    /** Axis drag: use screen delta along axis direction so movement never flips (e.g. Z up no longer goes down at top of screen). */
    function getAxisConstrainedPosition(
      event: any,
      axisOrigin: Cesium.Cartesian3,
      axisDir: Cesium.Cartesian3,
    ): Cesium.Cartesian3 | null {
      const screenPos = event.endPosition ?? event.position;
      if (!screenPos) return null;
      const startScreen = axisDragStartScreenRef.current;
      const axisScreenDir = axisScreenDirRef.current;
      if (startScreen && axisScreenDir) {
        const deltaScreen = Cesium.Cartesian2.dot(
          Cesium.Cartesian2.subtract(
            screenPos,
            startScreen,
            new Cesium.Cartesian2(),
          ),
          axisScreenDir,
        );
        const metersPerPixel =
          getGizmoArrowLengthWorld(viewer, axisOrigin) / GIZMO_PIXEL_LENGTH;
        let tAxis = deltaScreen * metersPerPixel;
        const cameraDistance = Cesium.Cartesian3.distance(
          viewer.camera.positionWC,
          axisOrigin,
        );
        const maxDisplacement = Math.max(cameraDistance * 0.5, 1000);
        tAxis = Math.max(-maxDisplacement, Math.min(maxDisplacement, tAxis));
        return Cesium.Cartesian3.add(
          axisOrigin,
          Cesium.Cartesian3.multiplyByScalar(
            axisDir,
            tAxis,
            new Cesium.Cartesian3(),
          ),
          new Cesium.Cartesian3(),
        );
      }
      const ray = viewer.camera.getPickRay(screenPos);
      if (!ray) return null;
      const O = ray.origin;
      const D = ray.direction;
      const cameraDir = viewer.camera.direction;
      const N = Cesium.Cartesian3.cross(
        axisDir,
        cameraDir,
        new Cesium.Cartesian3(),
      );
      const denom = Cesium.Cartesian3.dot(D, N);
      if (Math.abs(denom) < 1e-6) return null;
      const t =
        Cesium.Cartesian3.dot(
          Cesium.Cartesian3.subtract(axisOrigin, O, new Cesium.Cartesian3()),
          N,
        ) / denom;
      if (t < 0) return null;
      if (t > 1e6) return null; // avoid huge jump when ray nearly parallel to plane
      const planeHit = Cesium.Cartesian3.add(
        O,
        Cesium.Cartesian3.multiplyByScalar(D, t, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      let tAxis = Cesium.Cartesian3.dot(
        Cesium.Cartesian3.subtract(
          planeHit,
          axisOrigin,
          new Cesium.Cartesian3(),
        ),
        axisDir,
      );
      // Clamp tAxis so the object doesn't shoot to infinity when axis is near-parallel to view (e.g. Z up)
      const cameraDistance = Cesium.Cartesian3.distance(
        viewer.camera.positionWC,
        axisOrigin,
      );
      const maxDisplacement = Math.max(cameraDistance * 0.5, 1000);
      tAxis = Math.max(-maxDisplacement, Math.min(maxDisplacement, tAxis));
      return Cesium.Cartesian3.add(
        axisOrigin,
        Cesium.Cartesian3.multiplyByScalar(
          axisDir,
          tAxis,
          new Cesium.Cartesian3(),
        ),
        new Cesium.Cartesian3(),
      );
    }

    function handleObjectDragging(event: any) {
      const currentState = useViewerStore.getState();
      const draggingObject = currentState.draggingObject;
      // Use ref so first MOUSE_MOVE after axis click sees axis before store updates
      const draggingGizmoAxis =
        currentState.draggingGizmoAxis ?? axisDragAxisRef.current;

      if (!draggingObject || !isCesiumEntity(draggingObject)) return;

      const parsedEntity = parseEntityType(draggingObject.id);
      if (!parsedEntity) return;

      let cartographic: Cesium.Cartographic;

      if (draggingGizmoAxis) {
        const line = axisDragLineRef.current;
        if (!line) {
          return;
        }

        const screenPos = event.endPosition ?? event.position;
        const startScreen = axisDragStartScreenRef.current;
        const dragThresholdPx = 4;
        const distPx =
          startScreen && screenPos
            ? Cesium.Cartesian2.distance(startScreen, screenPos)
            : 0;
        const hasMoved =
          !startScreen || !screenPos || distPx >= dragThresholdPx;

        if (!hasMoved) {
          cartographic = Cesium.Cartographic.fromCartesian(line.origin);
        } else {
          const closest = getAxisConstrainedPosition(
            event,
            line.origin,
            line.direction,
          );
          if (!closest) {
            return; // skip this frame (e.g. ray parallel to plane) to avoid jumping
          }
          cartographic = Cesium.Cartographic.fromCartesian(closest);
        }
      } else {
        // Don't apply free-drag position until the pointer has moved past the threshold from left-down.
        // This prevents moving the object when the user does a quick select (down/up) then clicks elsewhere.
        if (didSelectOnThisDownRef.current && leftDownScreenRef.current) {
          const screenPos = event.endPosition ?? event.position;
          if (
            screenPos &&
            Cesium.Cartesian2.distance(leftDownScreenRef.current, screenPos) <
              FREE_DRAG_MOVE_THRESHOLD_PX
          ) {
            return;
          }
          didSelectOnThisDownRef.current = false;
        }
        const c = getCursorPositionFastForDragging(event);
        if (!c) return;
        cartographic = c;
      }

      if (parsedEntity === "radioUnit") {
        const ruId = extractRadioUnitId(draggingObject.id);
        if (ruId == null) return;
        const ru = radioUnitManager.get(ruId);
        if (ru == null) return;
        ru.position.cartographic = cartographic;
        ru.position.terrainHeight = 0;
      } else if (parsedEntity === "distributedUnit") {
        const duId = extractDistributedUnitId(draggingObject.id);
        if (duId == null) return;
        const du = distributedUnitManager.get(duId);
        if (du == null) return;
        du.position.cartographic = cartographic;
        du.position.terrainHeight = 0;
      } else if (parsedEntity === "userEquipment") {
        const ueId = extractUserEquipmentId(draggingObject.id);
        if (ueId == null) return;
        const ue = userEquipmentManager.get(ueId);
        if (ue == null) return;
        if (ue.positions.length === 0) return;
        const UE_ELLIPSOID_VERTICAL_RADIUS = 3.0;
        const timeIdx = getCurrentTimeIndex(viewer);
        let posEntry = ue.positions.find((p) => p.timeIdx === timeIdx);
        if (!posEntry) {
          const ref = ue.positions[0];
          const refPos = ref?.position;
          posEntry = {
            timeIdx,
            position: {
              cartographic: refPos
                ? new Cesium.Cartographic(
                    refPos.cartographic.longitude,
                    refPos.cartographic.latitude,
                    refPos.cartographic.height + (refPos.terrainHeight ?? 0),
                  )
                : new Cesium.Cartographic(
                    cartographic.longitude,
                    cartographic.latitude,
                    cartographic.height + UE_ELLIPSOID_VERTICAL_RADIUS,
                  ),
              terrainHeight: refPos?.terrainHeight ?? 0,
            },
          };
          ue.positions.push(posEntry);
          ue.positions.sort((a, b) => a.timeIdx - b.timeIdx);
        }
        const terrainH =
          posEntry.position.terrainHeight ?? UE_ELLIPSOID_VERTICAL_RADIUS;
        const fullHeight = cartographic.height + terrainH;
        posEntry.position.cartographic = new Cesium.Cartographic(
          cartographic.longitude,
          cartographic.latitude,
          fullHeight,
        );
        posEntry.position.terrainHeight = 0;
        if (!savedPositionPropertyRef.current) {
          savedPositionPropertyRef.current = draggingObject.position;
        }
        const cartesian = Cesium.Cartesian3.fromRadians(
          cartographic.longitude,
          cartographic.latitude,
          fullHeight,
        );
        draggingObject.position = new Cesium.ConstantPositionProperty(
          cartesian,
        );
        getHighlightManager(viewer)?.highlightObject(
          draggingObject as any,
          false,
        );
        viewer.scene.requestRender();
      } else if (parsedEntity === "scatterer") {
        const scId = extractScattererId(draggingObject.id);
        if (scId == null) return;
        const sc = scattererManager.get(scId);
        if (sc == null) return;
        if (sc.positions.length === 0) return;
        const timeIdx = getCurrentTimeIndex(viewer);
        const posEntry = sc.positions.find((p) => p.timeIdx === timeIdx);
        if (posEntry) {
          posEntry.position.cartographic = cartographic;
          posEntry.position.terrainHeight = 0;
        }
        // Bypass SampledPositionProperty during drag for 1:1 cursor tracking
        if (!savedPositionPropertyRef.current) {
          savedPositionPropertyRef.current = draggingObject.position;
        }
        draggingObject.position = Cesium.Cartesian3.fromRadians(
          cartographic.longitude,
          cartographic.latitude,
          cartographic.height,
        );
      }
      viewer.scene.requestRender();
    }

    function handleHover(event: any) {
      const pickedObject = viewer.scene.pick(event.endPosition);

      if (Cesium.defined(pickedObject)) {
        if (
          isCesium3DTileFeature(pickedObject) &&
          pickedObject.tileset?._selectable === false
        ) {
          clearHover();
          return;
        }

        // Clear any previous hover highlights before highlighting the new object
        const highlightManager = getHighlightManager(viewer);
        if (highlightManager) {
          highlightManager.unhighlightHoveredObject();
        }

        handleObjectHover(
          isCesium3DTileFeature(pickedObject) ? pickedObject : pickedObject.id,
        );
      } else {
        clearHover();
      }
    }

    /**
     * Handle hover event on an object (either a 3D tile feature or an entity)
     * @param object The hovered object (3D tile feature or entity object)
     */
    function handleObjectHover(object: ObjectType) {
      if (!object) return;

      const highlightManager = getHighlightManager(viewer);
      if (!highlightManager) return;
      setHoveredObject(object);

      if (object instanceof window.Cesium.Cesium3DTileFeature) {
        // Handle 3D Tiles feature (building) hover
        const silhouetteGreen = highlightManager.getSilhouetteGreen();
        if (!silhouetteGreen || silhouetteGreen.selected[0] !== object) {
          highlightManager.highlightObject(object, true); // true = hover (blue)
        }
      } else {
        // Handle entity hover
        // The highlightManager handles checking if already selected/highlighted
        highlightManager.highlightObject(object, true);
      }
    }

    function clearHover() {
      // Clear hover state
      setHoveredObject(null);

      // Clear hover highlights
      const highlightManager = getHighlightManager(viewer);
      if (highlightManager) {
        highlightManager.unhighlightHoveredObject();
      }
    }

    function getCursorPositionCartographic(
      event: any,
    ): Cesium.Cartographic | null {
      const pickedPosition = viewer.scene.pickPosition(event.endPosition);

      if (!Cesium.defined(pickedPosition)) {
        return null;
      }

      return Cesium.Cartographic.fromCartesian(pickedPosition);
    }

    function getCursorPositionDegrees(
      event: any,
    ): { longitude: number; latitude: number; altitude: number } | null {
      const cartographic = getCursorPositionCartographic(event);
      if (!cartographic) return null;

      return {
        longitude: Cesium.Math.toDegrees(cartographic.longitude),
        latitude: Cesium.Math.toDegrees(cartographic.latitude),
        altitude: cartographic.height,
      };
    }

    /**
     * Fast cursor position for dragging - uses globe ray picking instead of scene pickPosition
     * This is much faster as it's a mathematical projection instead of GPU depth buffer read
     */
    function getCursorPositionFastForDragging(
      event: any,
    ): Cesium.Cartographic | null {
      const screenPos = event.endPosition ?? event.position;
      if (!screenPos) return null;
      const ray = viewer.camera.getPickRay(screenPos);
      if (!ray) return null;

      const position = viewer.scene.globe.pick(ray, viewer.scene);
      if (!position) return null;

      return Cesium.Cartographic.fromCartesian(position);
    }

    // Cleanup not needed as handlers are removed when viewer is destroyed
  }, [
    viewer,
    setSelectedObject,
    setHoveredObject,
    setActiveRightTab,
    onCursorPositionChange,
    setDraggingObject,
    stopDraggingObject,
    setDraggingGizmoAxis,
    setHoveredGizmoAxis,
    setDraggingRotateRing,
    setHoveredRotateRing,
    creatingEntityType,
  ]);
};
