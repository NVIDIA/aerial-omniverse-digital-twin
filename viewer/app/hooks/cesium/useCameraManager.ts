/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";
import { loadCameraState, saveCameraState } from "@/store/viewerStore";

interface CameraManagerOptions {
  viewer: any | null;
  isClient: boolean;
}

/**
 * Manages camera state persistence and performance optimization during camera movement
 */
export const useCameraManager = ({
  viewer,
  isClient,
}: CameraManagerOptions) => {
  const cameraMoveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cameraSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savedTilesetSettingsRef = useRef<Map<any, any>>(new Map());
  const isRestoringCameraRef = useRef(true);
  const lastCameraPositionRef = useRef<any>(null);
  const lastCameraHeightRef = useRef<number>(0);
  const cameraMovingRef = useRef(false);
  const isZoomingRef = useRef(false);

  useEffect(() => {
    if (!viewer || !isClient || !window.Cesium) return;

    // Additional safety check
    try {
      if (!viewer.scene || !viewer.camera) return;
    } catch (e) {
      return;
    }

    const Cesium = window.Cesium;

    // Initialize refs
    lastCameraPositionRef.current = viewer.camera.position.clone();
    lastCameraHeightRef.current = viewer.camera.positionCartographic.height;

    const onCameraMove = () => {
      const currentPosition = viewer.camera.position;
      const currentHeight = viewer.camera.positionCartographic.height;
      const distance = Cesium.Cartesian3.distance(
        lastCameraPositionRef.current,
        currentPosition,
      );
      const heightDelta = Math.abs(currentHeight - lastCameraHeightRef.current);

      if (distance < 0.1 && heightDelta < 1) return;

      const isZoomOperation = heightDelta > distance * 0.5;

      lastCameraPositionRef.current = currentPosition.clone();
      lastCameraHeightRef.current = currentHeight;

      if (!cameraMovingRef.current) {
        cameraMovingRef.current = true;
        isZoomingRef.current = isZoomOperation;

        const primitives = viewer.scene.primitives;
        for (let i = 0; i < primitives.length; i++) {
          const primitive = primitives.get(i);
          if (primitive instanceof Cesium.Cesium3DTileset) {
            savedTilesetSettingsRef.current.set(primitive, {
              msse: primitive.maximumScreenSpaceError,
              dsseFactor: primitive.dynamicScreenSpaceErrorFactor,
              cullWhileMoving: primitive.cullRequestsWhileMoving,
              cullMultiplier: primitive.cullRequestsWhileMovingMultiplier,
            });

            if (isZoomOperation) {
              primitive.maximumScreenSpaceError = 128;
              primitive.dynamicScreenSpaceErrorFactor = 24.0;
              primitive.cullRequestsWhileMoving = true;
              primitive.cullRequestsWhileMovingMultiplier = 60.0;
            } else {
              primitive.maximumScreenSpaceError = 96;
              primitive.dynamicScreenSpaceErrorFactor = 18.0;
              primitive.cullRequestsWhileMoving = true;
              primitive.cullRequestsWhileMovingMultiplier = 45.0;
            }
          }
        }
      } else if (isZoomOperation && !isZoomingRef.current) {
        isZoomingRef.current = true;
        const primitives = viewer.scene.primitives;
        for (let i = 0; i < primitives.length; i++) {
          const primitive = primitives.get(i);
          if (primitive instanceof Cesium.Cesium3DTileset) {
            if (!savedTilesetSettingsRef.current.has(primitive)) {
              savedTilesetSettingsRef.current.set(primitive, {
                msse: primitive.maximumScreenSpaceError,
                dsseFactor: primitive.dynamicScreenSpaceErrorFactor,
                cullWhileMoving: primitive.cullRequestsWhileMoving,
                cullMultiplier: primitive.cullRequestsWhileMovingMultiplier,
              });
            }
            primitive.maximumScreenSpaceError = 128;
            primitive.dynamicScreenSpaceErrorFactor = 24.0;
            primitive.cullRequestsWhileMovingMultiplier = 60.0;
          }
        }
      }

      if (cameraMoveTimeoutRef.current) {
        clearTimeout(cameraMoveTimeoutRef.current);
      }

      const restoreDelay = isZoomOperation ? 250 : 150;
      cameraMoveTimeoutRef.current = setTimeout(() => {
        cameraMovingRef.current = false;
        isZoomingRef.current = false;

        const primitives = viewer.scene.primitives;
        for (let i = 0; i < primitives.length; i++) {
          const primitive = primitives.get(i);
          if (primitive instanceof Cesium.Cesium3DTileset) {
            const saved = savedTilesetSettingsRef.current.get(primitive);
            if (saved) {
              primitive.maximumScreenSpaceError = saved.msse;
              primitive.dynamicScreenSpaceErrorFactor = saved.dsseFactor;
              primitive.cullRequestsWhileMoving = saved.cullWhileMoving;
              primitive.cullRequestsWhileMovingMultiplier =
                saved.cullMultiplier;
            }
          }
        }
        savedTilesetSettingsRef.current.clear();
      }, restoreDelay);

      if (!isRestoringCameraRef.current) {
        if (cameraSaveTimeoutRef.current) {
          clearTimeout(cameraSaveTimeoutRef.current);
        }
        cameraSaveTimeoutRef.current = setTimeout(() => {
          saveCameraState(viewer);
        }, 500);
      }
    };

    viewer.scene.camera.changed.addEventListener(onCameraMove);

    // Restore camera position
    const savedCameraState = loadCameraState();
    const restoreCameraPosition = () => {
      try {
        if (savedCameraState) {
          const { position, orientation } = savedCameraState;
          const cameraPosition = Cesium.Cartesian3.fromDegrees(
            position.longitude,
            position.latitude,
            position.height,
          );

          viewer.camera.setView({
            destination: cameraPosition,
            orientation: {
              heading: orientation.heading,
              pitch: orientation.pitch,
              roll: orientation.roll,
            },
          });
        } else {
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(139.6917, 35.6895, 2000),
            orientation: {
              heading: 0.0,
              pitch: Cesium.Math.toRadians(-45.0),
              roll: 0.0,
            },
          });
        }
      } catch (error) {
        console.warn(
          "[CameraManager] Failed to restore saved camera position, using default view:",
          error,
        );
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(139.6917, 35.6895, 2000),
          orientation: {
            heading: 0.0,
            pitch: Cesium.Math.toRadians(-45.0),
            roll: 0.0,
          },
        });
      }
    };

    restoreCameraPosition();

    setTimeout(() => {
      isRestoringCameraRef.current = false;
    }, 1000);

    return () => {
      if (cameraMoveTimeoutRef.current) {
        clearTimeout(cameraMoveTimeoutRef.current);
      }
      if (cameraSaveTimeoutRef.current) {
        clearTimeout(cameraSaveTimeoutRef.current);
      }
      viewer.scene.camera.changed.removeEventListener(onCameraMove);
    };
  }, [viewer, isClient]);
};
