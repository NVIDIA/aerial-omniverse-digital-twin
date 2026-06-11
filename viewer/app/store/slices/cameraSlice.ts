/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Camera slice
 * Manages: camera position, target, and cesium viewer reference
 */
import * as Cesium from "cesium";

export interface CameraSlice {
  // State
  cesiumViewer: any | null;

  // Actions
  setCesiumViewer: (viewer: any | null) => void;
  zoomTo: (entityId: string, offset?: number) => void;
}

export const createCameraSlice = (
  set: any,
  get: any,
  _store: any,
): CameraSlice => ({
  // Initial state
  cesiumViewer: null,

  // Actions
  setCesiumViewer: (viewer: any | null) => set({ cesiumViewer: viewer }),

  zoomTo: (entityId: string, offset = 100) => {
    const state = get();
    const viewer = state.cesiumViewer;

    if (!viewer) return;

    // Get the entity from the viewer
    const entity = viewer.entities.getById(entityId);

    if (!entity) {
      console.warn(`Object ${entityId} not found`);
      return;
    }

    // Get the entity's position
    let entityPosition;
    if (entity.position) {
      // If position is a Property, get its value at current time
      if (typeof entity.position.getValue === "function") {
        const currentTime = viewer.clock.currentTime.toString();
        entityPosition = entity.position.getValue(currentTime);
      } else {
        entityPosition = entity.position;
      }
    }

    if (!entityPosition) {
      console.warn(`Object ${entityId} has no position`);
      return;
    }

    // Convert Cartesian3 to Cartographic to get lon/lat/height
    const cartographic = Cesium.Cartographic.fromCartesian(entityPosition);
    const longitude = Cesium.Math.toDegrees(cartographic.longitude);
    const latitude = Cesium.Math.toDegrees(cartographic.latitude);
    const height = cartographic.height;

    // Calculate camera position with offset
    const heightOffset = offset * 0.5;
    const cameraPosition = Cesium.Cartesian3.fromDegrees(
      longitude,
      latitude,
      height + heightOffset,
    );

    // Check if camera is already closer than the desired offset
    const currentDistance = Cesium.Cartesian3.distance(
      viewer.camera.position,
      entityPosition,
    );

    // Fly to the entity
    viewer.camera.flyTo({
      destination: cameraPosition,
      orientation: {
        direction: Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.subtract(
            entityPosition,
            cameraPosition,
            new Cesium.Cartesian3(),
          ),
          new Cesium.Cartesian3(),
        ),
        up: Cesium.Cartesian3.UNIT_Z,
      },
      duration: currentDistance < offset * 0.5 ? 0.5 : 1.5,
      complete: () => {
        // Apply highlight effect after zoom completes using the highlight manager
        const highlightManager = viewer._highlightManager;
        if (highlightManager) {
          // Apply selection highlight (green)
          // isHover = false means it's a selection highlight
          highlightManager.highlightObject(entityId, false);
        }
      },
    });
  },
});
