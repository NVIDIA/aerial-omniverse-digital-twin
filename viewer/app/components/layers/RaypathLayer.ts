/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Cesium from "cesium";
import { localToCartographicBatched } from "@/services/cesium";
import { getViridisColor } from "@/services/visualization";
import { TIMELINE_CONFIG } from "@/constants";
import { useViewerStore } from "@/store/viewerStore";
import { raypathManager } from "~/managers/raypathManager";
import type { Raypath } from "@/types";

let fallbackRaypathIdCounter = 0;

function createRaypathEntityId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;

  if (typeof randomUUID === "function") {
    return `raypath-${randomUUID.call(globalThis.crypto)}`;
  }

  fallbackRaypathIdCounter += 1;
  return `raypath-${Date.now().toString(36)}-${fallbackRaypathIdCounter.toString(36)}`;
}

/**
 * High-performance layer class to manage raypath visualization
 * Auto-subscribes to viewer from store and raypathManager for data
 */
class RaypathLayer {
  private viewer: Cesium.Viewer | null = null;
  private isVisible: boolean = true; // Track visibility state

  // Cache for expensive computations
  private colorCache: Map<number, Cesium.Color> = new Map();

  // Track entities by their RU and UE IDs for filtering
  private entityRuUeMap: Map<string, { ruId: number; ueId: number }> =
    new Map();

  // Max power (dB) across current raypaths; used for min_visible_power = maxPowerDb - maxDynamicRangeDB
  private maxPowerDb: number = -Infinity;

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
    let prevRayPathsVisible = useViewerStore.getState().rayPathsVisible;
    let prevMaxDynamicRangeDB =
      useViewerStore.getState().scenarioParams.maxDynamicRangeDB;
    this.isVisible = prevRayPathsVisible;

    useViewerStore.subscribe((state) => {
      if (state.cesiumViewer !== prevViewer) {
        this.viewer = state.cesiumViewer ?? null;
        prevViewer = this.viewer;

        // If viewer just became available and manager already has data, visualize
        if (this.viewer && raypathManager.getAll().length > 0) {
          this.visualize();
        }
      }

      // React to rayPathsVisible toggle
      if (state.rayPathsVisible !== prevRayPathsVisible) {
        prevRayPathsVisible = state.rayPathsVisible;
        this.setVisibility(state.rayPathsVisible);
        this.updateEntityVisibility();
      }

      // React to max dynamic range (power visibility threshold)
      if (state.scenarioParams.maxDynamicRangeDB !== prevMaxDynamicRangeDB) {
        prevMaxDynamicRangeDB = state.scenarioParams.maxDynamicRangeDB;
        this.updateEntityVisibility();
      }
    });

    // Subscribe to raypath manager changes (when raypaths are loaded)
    raypathManager.subscribe(() => {
      if (this.viewer) {
        this.visualize();
      }
    });

    // Subscribe to filter changes (update entity visibility without re-rendering)
    raypathManager.subscribeToFilters(() => {
      this.updateEntityVisibility();
    });
  }

  /**
   * Clear all raypath entities from the viewer
   */
  clear() {
    if (!this.viewer) return;

    // Remove all raypath entities
    for (const entityId of this.entityRuUeMap.keys()) {
      const entity = this.viewer.entities.getById(entityId);
      if (entity) {
        this.viewer.entities.remove(entity);
      }
    }

    this.entityRuUeMap.clear();
    this.colorCache.clear();
  }

  /**
   * Request scene render when filter state changes
   * The CallbackProperty on each entity's show property dynamically checks filter state
   */
  private updateEntityVisibility() {
    if (!this.viewer) return;
    // Request a scene render to reflect the updated visibility
    this.viewer.scene.requestRender();
  }

  /**
   * Set visibility of all raypath entities
   */
  setVisibility(visible: boolean) {
    this.isVisible = visible;
    if (!this.viewer) return;

    for (const entityId of this.entityRuUeMap.keys()) {
      const entity = this.viewer.entities.getById(entityId);
      if (entity) {
        entity.show = visible;
      }
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Get cached color for power value
   */
  private getColorForPower(powerDb: number): Cesium.Color {
    // Handle invalid power values
    if (powerDb === undefined || powerDb === null || isNaN(powerDb)) {
      console.warn(
        "[RaypathLayer] Invalid power_dB value:",
        powerDb,
        "using default -100",
      );
      powerDb = -100; // Default fallback value
    }

    // Round to reduce cache misses while maintaining visual quality
    const key = Math.round(powerDb);

    if (!this.colorCache.has(key)) {
      const [r, g, b] = getViridisColor(powerDb);
      this.colorCache.set(
        key,
        new Cesium.Color(r / 255, g / 255, b / 255, 1.0),
      );
    }

    return this.colorCache.get(key)!;
  }

  /**
   * Batch convert raypath points.
   */
  private batchSamplePoints(
    raypaths: Raypath[],
  ): Map<Raypath, Cesium.Cartographic[]> {
    if (!this.viewer) {
      return new Map<Raypath, Cesium.Cartographic[]>();
    }

    // Collect ALL unique points from ALL raypaths
    const allPoints: number[][] = [];
    const raypathPointRanges: Array<{
      start: number;
      end: number;
      raypath: Raypath;
    }> = [];

    let currentIndex = 0;
    for (const raypath of raypaths) {
      const start = currentIndex;
      const end = currentIndex + raypath.points.length;
      raypathPointRanges.push({ start, end, raypath });
      allPoints.push(...raypath.points);
      currentIndex = end;
    }

    // Use cached transform matrix for conversion
    const cartographicBatch = localToCartographicBatched(allPoints);

    // Map converted positions back to each raypath
    const cartographicPositionsMap = new Map<Raypath, Cesium.Cartographic[]>();
    for (const { start, end, raypath } of raypathPointRanges) {
      cartographicPositionsMap.set(
        raypath,
        cartographicBatch.slice(start, end),
      );
    }

    return cartographicPositionsMap;
  }

  /**
   * Visualize raypaths.
   */
  async visualize() {
    if (!this.viewer) {
      console.error("[RaypathLayer] No viewer available");
      return;
    }

    const raypaths = raypathManager.getAll();

    if (raypaths.length === 0) {
      this.clear();
      return;
    }

    // For power-based visibility: min_visible_power = max(power_dB) - max_dynamic_range
    // Avoid spreading large ray arrays into Math.max; it can exceed the JS call stack.
    this.maxPowerDb = raypaths.reduce(
      (max, r) =>
        Math.max(max, Number.isFinite(r.power_dB) ? r.power_dB : -Infinity),
      -Infinity,
    );

    // Clear existing raypaths
    this.clear();

    // Batch convert all raypath points at once
    const cartographicPositionsMap = this.batchSamplePoints(raypaths);

    // Create entities synchronously now that positions are converted
    let createdCount = 0;
    let skippedNoPositions = 0;

    for (const raypath of raypaths) {
      const cartographicPositions = cartographicPositionsMap.get(raypath);

      if (!cartographicPositions) {
        skippedNoPositions++;
        continue;
      }

      this.createRaypathEntity(raypath, cartographicPositions);
      createdCount++;
    }
  }

  /**
   * Create a single raypath entity synchronously.
   */
  private createRaypathEntity(
    raypath: Raypath,
    cartographicPositions: Cesium.Cartographic[],
  ): void {
    if (!this.viewer) return;
    if (cartographicPositions.length < 2) {
      console.warn("[RaypathLayer] Raypath has less than 2 points, skipping");
      return;
    }

    const cartesianPositions = cartographicPositions.map((position) =>
      Cesium.Cartesian3.fromRadians(
        position.longitude,
        position.latitude,
        position.height,
      ),
    );

    // Use cached color
    const color = this.getColorForPower(raypath.power_dB);

    // Calculate time availability for this raypath based on time_idx
    const startTime = Cesium.JulianDate.addSeconds(
      TIMELINE_CONFIG.baseTime,
      raypath.time_idx * TIMELINE_CONFIG.timeStep,
      new Cesium.JulianDate(),
    );
    const stopTime = Cesium.JulianDate.addSeconds(
      startTime,
      TIMELINE_CONFIG.timeStep,
      new Cesium.JulianDate(),
    );

    // Create polyline entity with time-based availability
    // Use half-open interval [start, stop) to prevent overlapping at boundaries
    const id = createRaypathEntityId();

    // Store the entity's RU and UE IDs for filtering
    const ruId = raypath.ru_id;
    const ueId = raypath.ue_id;
    this.entityRuUeMap.set(id, { ruId, ueId });

    const entity = this.viewer.entities.getOrCreateEntity(id);
    entity.show = this.isVisible;
    entity.availability = new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({
        start: startTime,
        stop: stopTime,
        isStartIncluded: true,
        isStopIncluded: false, // Exclusive stop to prevent overlap
      }),
    ]);
    entity.polyline = new Cesium.PolylineGraphics({
      positions: new Cesium.ConstantProperty(cartesianPositions),
      width: new Cesium.ConstantProperty(1),
      material: new Cesium.ColorMaterialProperty(
        new Cesium.ConstantProperty(color),
      ),
      clampToGround: new Cesium.ConstantProperty(false),
      arcType: new Cesium.ConstantProperty(Cesium.ArcType.NONE),
      // Dynamically check filter state: RU/UE and power >= min_visible_power
      show: new Cesium.CallbackProperty(() => {
        const ruUeOk =
          raypathManager.isRuEnabled(ruId) && raypathManager.isUeEnabled(ueId);
        const maxDynamicRangeDB =
          useViewerStore.getState().scenarioParams.maxDynamicRangeDB;
        const minVisiblePower = this.maxPowerDb - maxDynamicRangeDB;
        const powerOk = raypath.power_dB >= minVisiblePower;
        return ruUeOk && powerOk;
      }, false),
    });
  }
}

// Export singleton instance
export const raypathLayer = new RaypathLayer();
