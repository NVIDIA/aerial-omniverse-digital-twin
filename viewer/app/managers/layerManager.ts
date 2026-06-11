/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { raypathLayer } from "@/components/layers/RaypathLayer";
import { radioUnitLayer } from "@/components/layers/RadioUnitLayer";
import { distributedUnitLayer } from "@/components/layers/DistributedUnitLayer";
import { scattererLayer } from "@/components/layers/ScattererLayer";
import { userEquipmentLayer } from "@/components/layers/UserEquipmentLayer";
import { spawnZoneLayer } from "@/components/layers/SpawnZoneLayer";
import { useViewerStore } from "@/store/viewerStore";

/**
 * Manager class for visualization layers
 * Each layer auto-subscribes to viewer and entity state from store
 */
export class LayerManager {
  // Layers (each layer auto-subscribes to viewer and entity state from store)
  public readonly raypathLayer = raypathLayer;
  public readonly radioUnitLayer = radioUnitLayer;
  public readonly distributedUnitLayer = distributedUnitLayer;
  public readonly scattererLayer = scattererLayer;
  public readonly userEquipmentLayer = userEquipmentLayer;
  public readonly spawnZoneLayer = spawnZoneLayer;

  /**
   * Clear all layer visualizations
   */
  clearAll() {
    const viewer = useViewerStore.getState().cesiumViewer;

    if (!viewer) {
      console.warn("[LayerManager] Cannot clear: viewer not available");
      return;
    }

    // Check if viewer is destroyed
    try {
      if (viewer.isDestroyed && viewer.isDestroyed()) {
        console.warn("[LayerManager] Cannot clear: viewer is destroyed");
        return;
      }
    } catch (e) {
      console.warn(
        "[LayerManager] Cannot clear: error checking viewer state",
        e,
      );
      return;
    }

    // Clear individual layers first (these remove specific entity types)
    this.raypathLayer.clear();
    this.radioUnitLayer.clear();
    this.distributedUnitLayer.clear();
    this.scattererLayer.clear();
    this.userEquipmentLayer.clear();
    this.spawnZoneLayer.clear();

    // Remove ALL remaining entities from viewer (catches anything we might have missed)
    const remainingCount = viewer.entities.values.length;
    if (remainingCount > 0) {
      viewer.entities.removeAll();
    }

    // Force Cesium to refresh the viewport to reflect the removed entities
    try {
      if (viewer.scene && typeof viewer.scene.requestRender === "function") {
        viewer.scene.requestRender();
      }
    } catch (e) {
      console.warn("[LayerManager] Failed to request scene render:", e);
    }
  }
}

// Export singleton instance
export const layerManager = new LayerManager();
