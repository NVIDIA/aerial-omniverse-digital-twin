/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Cesium from "cesium";
import type { Scatterer } from "../../store/types";
import { TIMELINE_CONFIG } from "../../constants/timeline";
import { useViewerStore } from "../../store/viewerStore";
import { scattererManager } from "../../managers/scattererManager";
import zip from "lodash/zip";

/**
 * High-performance layer class to manage animated scatterers (vehicles)
 * Features:
 * - Smooth interpolation between time indices
 * - Time-based animation using Cesium's SampledPositionProperty
 * - Orientation animation for realistic vehicle movement
 * - Auto-subscription to viewer and manager changes
 */
class ScattererLayer {
  private viewer: Cesium.Viewer | null = null;
  private entities: Map<number, Cesium.Entity> = new Map();

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
        if (this.viewer && scattererManager.getAll().size > 0) {
          this.visualize();
        }
      }
    });

    // Subscribe to scatterer manager changes
    scattererManager.subscribe(() => {
      if (this.viewer) {
        this.visualize();
      }
    });
  }

  /**
   * Clear all scatterer entities from the viewer
   */
  clear() {
    if (!this.viewer) return;

    for (const entity of this.entities.values()) {
      this.viewer.entities.remove(entity);
    }

    this.entities.clear();
  }

  /**
   * Create an animated entity for a scatterer
   */
  private createScattererEntity(
    scattererId: number,
    scatterer: Scatterer,
  ): void {
    if (!this.viewer) return;

    // Create a SampledPositionProperty for smooth interpolation
    const positionProperty = new Cesium.SampledPositionProperty();
    // TODO(ramiw): Disable interpolation
    positionProperty.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });

    // Create a SampledProperty for orientation (heading, pitch, roll)
    const orientationProperty = new Cesium.SampledProperty(Cesium.Quaternion);
    orientationProperty.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });

    // Add samples for each time index
    for (const [timedPos, timedOri] of zip(
      scatterer.positions,
      scatterer.orientations,
    )) {
      // Add position sample
      const position = Cesium.Cartesian3.fromRadians(
        timedPos.position.cartographic.longitude,
        timedPos.position.cartographic.latitude,
        timedPos.position.cartographic.height + timedPos.position.terrainHeight,
      );
      const startTime = Cesium.JulianDate.addSeconds(
        TIMELINE_CONFIG.baseTime,
        timedPos.timeIdx! * TIMELINE_CONFIG.timeStep,
        new Cesium.JulianDate(),
      );
      positionProperty.addSample(startTime, position);

      // Convert HeadingPitchRoll to quaternion
      const hpr = new Cesium.HeadingPitchRoll(
        timedOri.orientation.heading + Cesium.Math.toRadians(180),
        timedOri.orientation.pitch + Cesium.Math.toRadians(90),
        timedOri.orientation.roll + Cesium.Math.toRadians(90),
      );
      const quat = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
      orientationProperty.addSample(startTime, quat);
    }

    const entity = this.viewer.entities.getOrCreateEntity(
      `scatterer-${scattererId}`,
    );
    entity.position = positionProperty;
    entity.orientation = orientationProperty;
    this.entities.set(scattererId, entity);
    // Load GLB model for scatterer (vehicle)
    entity.model = new Cesium.ModelGraphics({
      uri: "glb/car.glb",
      scale: 1.0,
      color: Cesium.Color.YELLOW,
    });
  }

  /**
   * Load and visualize scatterers
   */
  async visualize() {
    if (!this.viewer) {
      console.error("[ScattererLayer] No viewer available");
      return;
    }

    const scatterers = scattererManager.getAll();

    if (scatterers.size === 0) {
      this.clear();
      return;
    }

    const currentIds = new Set(scatterers.keys());
    const existingIds = new Set(this.entities.keys());
    const idsEqual =
      currentIds.size === existingIds.size &&
      [...currentIds].every((id) => existingIds.has(id));
    if (idsEqual) return;

    this.clear();

    for (const [scattererId, scatterer] of scatterers.entries()) {
      this.createScattererEntity(scattererId, scatterer);
    }
  }

  /**
   * Get the position data for a specific scatterer
   */
  getPositionData(scattererId: number): Scatterer | undefined {
    return scattererManager.get(scattererId);
  }
}

// Export singleton instance
export const scattererLayer = new ScattererLayer();
