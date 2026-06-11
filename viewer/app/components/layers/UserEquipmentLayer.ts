/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Cesium from "cesium";
import type {
  TimeIndexedPosition,
  UserEquipment,
  Waypoint,
} from "../../store/types";
import { TIMELINE_CONFIG } from "../../constants/timeline";
import { useViewerStore } from "../../store/viewerStore";
import { userEquipmentManager } from "../../managers/userEquipmentManager";
import { getEntityIdByType, getHighlightManager } from "@/services/cesium";

/**
 * High-performance layer class to manage animated user equipments
 * Features:
 * - Smooth interpolation between time indices
 * - Time-based animation using Cesium's SampledPositionProperty
 * - White ellipsoid representation
 * - Auto-subscription to viewer and manager changes
 */
class UserEquipmentLayer {
  private viewer: Cesium.Viewer | null = null;
  private pathEntities: Map<number, Cesium.Entity> = new Map();
  private positionData: Map<number, UserEquipment[]> = new Map();
  private selectedUEId: number | null = null;

  constructor() {
    this.setupSubscriptions();
  }

  /**
   * Subscribe to viewer and manager changes
   */
  private setupSubscriptions() {
    // Initialise from current store state (handles HMR / late instantiation)
    this.viewer = useViewerStore.getState().cesiumViewer ?? null;

    // Subscribe to viewer changes from store
    let prevViewer = this.viewer;
    useViewerStore.subscribe((state) => {
      if (state.cesiumViewer !== prevViewer) {
        this.viewer = state.cesiumViewer ?? null;
        prevViewer = this.viewer;

        // If viewer just became available and manager already has data, visualize
        if (this.viewer && userEquipmentManager.getAll().size > 0) {
          this.visualize();
        }
      }
    });

    // Subscribe to user equipment manager changes
    userEquipmentManager.subscribe(() => {
      if (this.viewer) {
        this.visualize();
      }
    });

    // Subscribe to selection changes to show/hide waypoints
    let prevSelectedObject = useViewerStore.getState().selectedObject;
    useViewerStore.subscribe((state) => {
      if (state.selectedObject !== prevSelectedObject) {
        prevSelectedObject = state.selectedObject;
        const newSelectedUEId = getEntityIdByType(state.selectedObject, "ue");
        if (newSelectedUEId !== this.selectedUEId) {
          this.selectedUEId = newSelectedUEId;
          if (this.viewer) this.visualize();
        }
      }
    });

    // Re-apply UE selection highlight in the next frame so it sticks after
    // Cesium/layer updates (fixes highlight not showing when selected after placement)
    let prevUeSelectionId: string | null = null;
    useViewerStore.subscribe((state) => {
      const sel = state.selectedObject;
      const selectedId =
        sel != null && typeof sel === "object" && "id" in sel
          ? String((sel as Cesium.Entity).id)
          : null;
      const isUe =
        selectedId &&
        selectedId.startsWith("ue-") &&
        !selectedId.startsWith("ue-path-");
      if (!isUe) {
        prevUeSelectionId = null;
        return;
      }
      if (selectedId === prevUeSelectionId) return;
      prevUeSelectionId = selectedId;
      const viewer = this.viewer;
      if (!viewer) return;
      requestAnimationFrame(() => {
        const entity = viewer.entities.getById(selectedId!);
        if (entity) {
          getHighlightManager(viewer)?.highlightObject(entity as any, false);
        }
      });
    });
  }

  /**
   * Clear all user equipment entities from the viewer
   */
  clear() {
    if (!this.viewer) return;

    // Remove all UE entities (prefix: ue- and ue-path-) from the viewer
    const entitiesToRemove: Cesium.Entity[] = [];
    for (let i = 0; i < this.viewer.entities.values.length; i++) {
      const entity = this.viewer.entities.values[i];
      if (entity.id.startsWith("ue-")) {
        entitiesToRemove.push(entity);
      }
    }

    if (entitiesToRemove.length > 0) {
      for (const entity of entitiesToRemove) {
        this.viewer.entities.remove(entity);
      }
    }

    this.pathEntities.clear();
    this.positionData.clear();
  }

  /**
   * Create an animated entity for a user equipment
   */
  private createUserEquipmentEntity(ueId: number, ue: UserEquipment): void {
    if (!this.viewer) return;

    let entityPosition: Cesium.PositionProperty;

    if (ue.positions.length > 0) {
      // Database UE: animate along route positions
      const positionProperty = new Cesium.SampledPositionProperty();
      positionProperty.setInterpolationOptions({
        interpolationDegree: 1,
        interpolationAlgorithm: Cesium.LinearApproximation,
      });
      for (const posData of ue.positions) {
        const position = Cesium.Cartesian3.fromRadians(
          posData.position.cartographic.longitude,
          posData.position.cartographic.latitude,
          posData.position.cartographic.height +
            posData.position.terrainHeight +
            ue.height,
        );
        const startTime = Cesium.JulianDate.addSeconds(
          TIMELINE_CONFIG.baseTime,
          posData.timeIdx! * TIMELINE_CONFIG.timeStep,
          new Cesium.JulianDate(),
        );
        positionProperty.addSample(startTime, position);
      }
      entityPosition = positionProperty;
    } else if (ue.waypoints.length > 0) {
      // Manually created UE: place at first waypoint
      const wp = ue.waypoints[0];
      entityPosition = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromRadians(
          wp.position.cartographic.longitude,
          wp.position.cartographic.latitude,
          wp.position.cartographic.height +
            wp.position.terrainHeight +
            ue.height,
        ),
      );
    } else {
      return;
    }

    // Create the entity with a white ellipsoid
    const entity = this.viewer.entities.getOrCreateEntity(`ue-${ueId}`);
    entity.position = entityPosition;
    entity.ellipsoid = new Cesium.EllipsoidGraphics({
      radii: new Cesium.Cartesian3(0.8, 0.8, ue.height),
      material: Cesium.Color.fromCssColorString("#FF0087"),
    });
    entity.label = new Cesium.LabelGraphics({
      text: `UE ${ueId}`,
      font: "16px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 100.0),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }

  /**
   * Create a polyline entity showing the full path of a user equipment.
   * Only creates a path when there are at least 2 positions (Cesium polylines
   * need at least 2 points; a single point causes extractHeights to throw).
   */
  private createUserEquipmentPathEntity(
    ueId: number,
    positions: TimeIndexedPosition[],
  ): void {
    if (!this.viewer) return;

    const pathId = `ue-path-${ueId}`;
    if (positions.length < 2) {
      const pathEntity = this.viewer.entities.getById(pathId);
      if (pathEntity) {
        pathEntity.polyline = undefined;
      }
      return;
    }

    const pathPositions: Cesium.Cartesian3[] = positions.map((posData) => {
      const pos = posData.position;
      const carto = pos?.cartographic;
      const terrainH = pos?.terrainHeight ?? 0;
      if (!carto) {
        return new Cesium.Cartesian3(0, 0, 0);
      }
      return Cesium.Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        carto.height + terrainH,
      );
    });

    const pathEntity = this.viewer.entities.getOrCreateEntity(pathId);
    pathEntity.polyline = new Cesium.PolylineGraphics({
      positions: pathPositions,
      width: new Cesium.ConstantProperty(1.0),
      material: Cesium.Color.fromCssColorString("#FF0087").withAlpha(0.6),
    });
    (pathEntity as any).isPickable = false;
  }

  /**
   * Create waypoint entities for a user equipment
   */
  private createUserEquipmentWaypointEntities(
    ueId: number,
    waypoints: Waypoint[] | undefined,
  ): void {
    if (!this.viewer || !waypoints?.length || ueId !== this.selectedUEId)
      return;

    for (const waypoint of waypoints.slice(1)) {
      const waypointEntity = this.viewer.entities.getOrCreateEntity(
        `ue-waypoint-${ueId}-${waypoint.id}`,
      );
      waypointEntity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromRadians(
          waypoint.position.cartographic.longitude,
          waypoint.position.cartographic.latitude,
          waypoint.position.terrainHeight +
            waypoint.position.cartographic.height,
        ),
      );
      waypointEntity.point = new Cesium.PointGraphics({
        pixelSize: 16,
        color: Cesium.Color.ORANGE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.NONE,
      });
      if (waypoints[0].id !== waypoint.id) {
        waypointEntity.label = new Cesium.LabelGraphics({
          text: `WP ${waypoint.id}`,
          font: "16px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
            0.0,
            100.0,
          ),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Load and visualize user equipments.
   * Updates existing entities in place so the store's selectedObject reference
   * stays valid (avoids "can't move again after first drag").
   */
  async visualize() {
    if (!this.viewer) {
      console.error("[UserEquipmentLayer] No viewer available");
      return;
    }

    const userEquipments = userEquipmentManager.getAll();
    const currentIds = new Set(userEquipments.keys());

    if (userEquipments.size === 0) {
      this.clear();
      return;
    }

    const existingIds = new Set<number>();
    for (let i = 0; i < this.viewer.entities.values.length; i++) {
      const id = this.viewer.entities.values[i].id;
      if (
        typeof id === "string" &&
        id.startsWith("ue-") &&
        !id.startsWith("ue-path-")
      ) {
        const ueId = parseInt(id.replace("ue-", ""), 10);
        if (Number.isFinite(ueId)) existingIds.add(ueId);
      }
    }

    // Remove all non selected UE waypoint entities
    const waypointEntitiesToRemove: Cesium.Entity[] = [];
    for (let i = 0; i < this.viewer.entities.values.length; i++) {
      const entity = this.viewer.entities.values[i];
      if (entity.id.startsWith("ue-waypoint-")) {
        waypointEntitiesToRemove.push(entity);
      }
    }
    for (const entity of waypointEntitiesToRemove) {
      this.viewer.entities.remove(entity);
    }

    // Remove only entities no longer in the manager (keeps references valid for the rest)
    for (const ueId of existingIds) {
      if (!currentIds.has(ueId)) {
        const entity = this.viewer.entities.getById(`ue-${ueId}`);
        if (entity) this.viewer.entities.remove(entity);
        const pathEntity = this.viewer.entities.getById(`ue-path-${ueId}`);
        if (pathEntity) this.viewer.entities.remove(pathEntity);
      }
    }

    // Add or update each UE (update in place so selectedObject is not invalidated)
    for (const [ueId, ue] of userEquipments.entries()) {
      this.createUserEquipmentEntity(ueId, ue);
      this.createUserEquipmentPathEntity(ueId, ue.positions);
      this.createUserEquipmentWaypointEntities(ueId, ue.waypoints);
    }

    // Re-apply selection highlight for the selected UE (in case it was just set or we overwrote graphics)
    const selected = useViewerStore.getState().selectedObject;
    const selectedId =
      selected != null && typeof selected === "object" && "id" in selected
        ? String((selected as Cesium.Entity).id)
        : typeof selected === "string"
          ? selected
          : null;
    if (
      selectedId &&
      selectedId.startsWith("ue-") &&
      !selectedId.startsWith("ue-path-") &&
      this.viewer
    ) {
      const entity = this.viewer.entities.getById(selectedId);
      if (entity) {
        const highlightManager = getHighlightManager(this.viewer);
        highlightManager?.highlightObject(entity as any, false);
      }
    }
  }

  /**
   * Get the position data for a specific user equipment
   */
  getPositionData(ueId: number): UserEquipment | undefined {
    return userEquipmentManager.get(ueId);
  }
}

// Export singleton instance
export const userEquipmentLayer = new UserEquipmentLayer();
