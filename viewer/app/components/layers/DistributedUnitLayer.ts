/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Cesium from "cesium";
import type { DistributedUnit } from "../../store/types";
import { useViewerStore } from "~/store/viewerStore";
import { distributedUnitManager } from "~/managers/distributedUnitManager";

/**
 * Layer class to manage distributed unit visualization
 * Features:
 * - Point and label visualization
 * - Dynamic position properties for dragging support
 * - Auto-subscription to viewer and manager changes
 */
class DistributedUnitLayer {
  private viewer: Cesium.Viewer | null = null;

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
        if (this.viewer && distributedUnitManager.getAll().size > 0) {
          this.visualize();
        }
      }
    });

    // Subscribe to distributed unit manager changes
    distributedUnitManager.subscribe(() => {
      if (this.viewer) {
        this.visualize();
      }
    });
  }

  /**
   * Clear all distributed unit entities from the viewer
   */
  clear() {
    if (!this.viewer) {
      console.warn("[DistributedUnitLayer] Cannot clear: viewer not available");
      return;
    }

    // Remove all distributed unit entities (prefix: du-)
    const entitiesToRemove: Cesium.Entity[] = [];
    for (let i = 0; i < this.viewer.entities.values.length; i++) {
      const entity = this.viewer.entities.values[i];
      if (entity.id.startsWith("du-")) {
        entitiesToRemove.push(entity);
      }
    }

    if (entitiesToRemove.length > 0) {
      for (const entity of entitiesToRemove) {
        this.viewer.entities.remove(entity);
      }
    }
  }

  /**
   * Create a distributed unit entity
   */
  private createDistributedUnitEntity(du: DistributedUnit): void {
    if (!this.viewer) return;

    // Create dynamic position property for drag support
    const positionProperty = new Cesium.CallbackProperty(
      (_time: Cesium.JulianDate | undefined, result: Cesium.Cartesian3) => {
        const position = distributedUnitManager.get(du.id)?.position;
        if (position) {
          return Cesium.Cartesian3.fromRadians(
            position.cartographic.longitude,
            position.cartographic.latitude,
            position.cartographic.height,
          );
        }
        return result;
      },
      false,
    ) as any as Cesium.PositionProperty;

    const entity = this.viewer.entities.getOrCreateEntity(`du-${du.id}`);
    entity.position = positionProperty;

    // Use a point to visualize the DU
    entity.point = new Cesium.PointGraphics({
      pixelSize: 12,
      color: Cesium.Color.CYAN.withAlpha(0.9),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });

    entity.label = new Cesium.LabelGraphics({
      text: `DU ${du.id}`,
      font: "16px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 500.0),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }

  /**
   * Visualize distributed units
   */
  async visualize(): Promise<void> {
    if (!this.viewer) {
      console.error("[DistributedUnitLayer] No viewer available");
      return;
    }

    const distributedUnits = distributedUnitManager.getAll();

    if (distributedUnits.size === 0) {
      this.clear();
      return;
    }

    const currentIds = new Set(distributedUnits.keys());
    const existingIds = new Set<number>();
    for (let i = 0; i < this.viewer.entities.values.length; i++) {
      const id = this.viewer.entities.values[i].id;
      if (typeof id === "string" && id.startsWith("du-")) {
        const duId = parseInt(id.replace("du-", ""), 10);
        if (Number.isFinite(duId)) existingIds.add(duId);
      }
    }
    const idsEqual =
      currentIds.size === existingIds.size &&
      [...currentIds].every((id) => existingIds.has(id));
    if (idsEqual) return;

    this.clear();

    for (const [, du] of distributedUnits.entries()) {
      this.createDistributedUnitEntity(du);
    }
  }
}

// Export singleton instance
export const distributedUnitLayer = new DistributedUnitLayer();
