/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Cesium from "cesium";
import type { RadioUnit } from "../../store/types";
import { useViewerStore } from "~/store/viewerStore";
import { radioUnitManager } from "~/managers/radioUnitManager";

/**
 * Layer class to manage radio unit visualization
 * Features:
 * - GLB model visualization with orientation based on azimuth and tilt
 * - Point and label visualization
 * - Dynamic position properties for dragging support
 * - Auto-subscription to viewer and manager changes
 */
class RadioUnitLayer {
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
        if (this.viewer && radioUnitManager.getAll().size > 0) {
          this.visualize();
        }
      }
    });

    // Subscribe to radio unit manager changes
    radioUnitManager.subscribe(() => {
      if (this.viewer) {
        this.visualize();
      }
    });
  }

  /**
   * Clear all radio unit entities from the viewer
   */
  clear() {
    if (!this.viewer) {
      console.warn("[RadioUnitLayer] Cannot clear: viewer not available");
      return;
    }

    // Remove all radio unit entities (prefix: ru-)
    const entitiesToRemove: Cesium.Entity[] = [];
    for (let i = 0; i < this.viewer.entities.values.length; i++) {
      const entity = this.viewer.entities.values[i];
      if (entity.id.startsWith("ru-")) {
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
   * Create a radio unit entity
   */
  private createRadioUnitEntity(ru: RadioUnit): void {
    if (!this.viewer) return;

    // Create dynamic position property for drag support
    const positionProperty = new Cesium.CallbackProperty(
      (_time: Cesium.JulianDate | undefined, result?: Cesium.Cartesian3) => {
        const c = radioUnitManager.get(ru.id)?.position?.cartographic;
        const lon = c != null ? Number(c.longitude) : NaN;
        const lat = c != null ? Number(c.latitude) : NaN;
        const h =
          c != null
            ? Number.isFinite(Number(c.height))
              ? Number(c.height)
              : 0
            : NaN;
        let computed: Cesium.Cartesian3;
        if (
          Number.isFinite(lon) &&
          Number.isFinite(lat) &&
          Number.isFinite(h)
        ) {
          // Avoid passing a scratch `result` into fromRadians — some Cesium builds
          // hit multiplyComponents with undefined when the buffer + ellipsoid interact
          // on the first frames after load.
          computed = Cesium.Cartesian3.fromRadians(lon, lat, h);
        } else {
          computed = new Cesium.Cartesian3(0, 0, 0);
        }
        return result ? Cesium.Cartesian3.clone(computed, result) : computed;
      },
      false,
    ) as any as Cesium.PositionProperty;

    const entity = this.viewer.entities.getOrCreateEntity(`ru-${ru.id}`);
    entity.position = positionProperty;

    const orientationProperty = new Cesium.CallbackProperty(
      (time: Cesium.JulianDate | undefined, result?: Cesium.Quaternion) => {
        const ruData = radioUnitManager.get(ru.id);
        const t = time ?? this.viewer!.clock.currentTime;
        const pos = entity.position?.getValue(t);
        const out = result ?? new Cesium.Quaternion();
        if (ruData?.orientation && pos) {
          const o = ruData.orientation;
          const headingRad = Cesium.Math.toRadians(90) - o.heading;
          const qHeading = Cesium.Transforms.headingPitchRollQuaternion(
            pos,
            new Cesium.HeadingPitchRoll(headingRad, 0, 0),
          );
          const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
          const east = new Cesium.Cartesian3(enu[0], enu[1], enu[2]);
          const north = new Cesium.Cartesian3(enu[4], enu[5], enu[6]);
          const up = new Cesium.Cartesian3(enu[8], enu[9], enu[10]);
          const mechRad = o.heading;
          const forwardRing = Cesium.Cartesian3.add(
            Cesium.Cartesian3.multiplyByScalar(
              east,
              Math.cos(mechRad),
              new Cesium.Cartesian3(),
            ),
            Cesium.Cartesian3.multiplyByScalar(
              north,
              Math.sin(mechRad),
              new Cesium.Cartesian3(),
            ),
            new Cesium.Cartesian3(),
          );
          Cesium.Cartesian3.normalize(forwardRing, forwardRing);
          const rightRing = Cesium.Cartesian3.cross(
            forwardRing,
            up,
            new Cesium.Cartesian3(),
          );
          Cesium.Cartesian3.normalize(rightRing, rightRing);
          const qTilt = Cesium.Quaternion.fromAxisAngle(rightRing, -o.pitch);
          return Cesium.Quaternion.multiply(qTilt, qHeading, out);
        }
        return Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY, out);
      },
      false,
    );
    entity.orientation = orientationProperty;

    // Load GLB model for radio unit
    // Note: Cesium doesn't support dynamic non-uniform scaling via CallbackProperty
    // The model uses a fixed scale, but is positioned at the correct height
    entity.model = new Cesium.ModelGraphics({
      uri: "glb/radio_unit.glb",
      scale: 1.0,
      color: Cesium.Color.RED.withAlpha(0.9),
    });
    entity.label = new Cesium.LabelGraphics({
      text: `RU ${ru.id}`,
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
   * Visualize radio units
   */
  async visualize(): Promise<void> {
    if (!this.viewer) {
      console.error("[RadioUnitLayer] No viewer available");
      return;
    }

    const radioUnits = radioUnitManager.getAll();

    if (radioUnits.size === 0) {
      this.clear();
      return;
    }

    const currentRuIds = new Set(radioUnits.keys());
    const existingEntityIds = new Set<number>();
    for (let i = 0; i < this.viewer.entities.values.length; i++) {
      const id = this.viewer.entities.values[i].id;
      if (typeof id === "string" && id.startsWith("ru-")) {
        const ruId = parseInt(id.replace("ru-", ""), 10);
        if (Number.isFinite(ruId)) existingEntityIds.add(ruId);
      }
    }

    const idsEqual =
      currentRuIds.size === existingEntityIds.size &&
      [...currentRuIds].every((id) => existingEntityIds.has(id));

    if (idsEqual) {
      return;
    }

    this.clear();

    for (const [, ru] of radioUnits.entries()) {
      this.createRadioUnitEntity(ru);
    }
  }
}

// Export singleton instance
export const radioUnitLayer = new RadioUnitLayer();
