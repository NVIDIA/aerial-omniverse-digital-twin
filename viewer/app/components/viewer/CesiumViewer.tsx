/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { useViewerStore } from "@/store/viewerStore";
import { TileManager } from "../layers/TileManager";
import { GhostPreviewLayer } from "../layers/GhostPreviewLayer";
import { MoveGizmoLayer } from "../layers/MoveGizmoLayer";
import { RotateGizmoLayer } from "../layers/RotateGizmoLayer";
import { ObjectToolbar } from "../ui/tools/ObjectToolbar";
import { CursorPositionDisplay } from "../ui/CursorPositionDisplay";
import {
  useCesiumViewer,
  useCameraManager,
  usePickingHandlers,
} from "@/hooks/cesium";
import { getHighlightManager } from "@/services/cesium";

declare global {
  interface Window {
    Cesium: any;
  }
}

interface CesiumViewerProps {
  className?: string;
}

export const CesiumViewerComponent: React.FC<CesiumViewerProps> = ({
  className,
}) => {
  const cesiumContainer = useRef<HTMLDivElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{
    longitude: number;
    latitude: number;
    altitude: number;
  } | null>(null);

  const { setCesiumViewer, addingObject, draggingObject, creatingEntityType } =
    useViewerStore();

  // Initialize client-side rendering
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize Cesium viewer
  const viewer = useCesiumViewer({
    isClient,
    containerRef: cesiumContainer,
    onViewerReady: (viewer) => {
      setCesiumViewer(viewer);
      setIsLoaded(true);
      setError(null);
    },
    onError: (errorMessage) => {
      setError(errorMessage);
    },
  });

  // Set up camera management
  useCameraManager({ viewer, isClient });

  // Set up silhouette effects for building highlighting
  // The highlight manager is now attached directly to the viewer instance
  useEffect(() => {
    if (!viewer) return;

    // Initialize the highlight manager on the viewer
    getHighlightManager(viewer);

    return () => {
      // Cleanup is handled by viewer destruction
      if (viewer._highlightManager) {
        viewer._highlightManager.destroy();
        viewer._highlightManager = null;
      }
    };
  }, [viewer]);

  // Set up picking handlers (click and hover)
  usePickingHandlers({
    viewer,
    onCursorPositionChange: setCursorPosition,
  });

  // Update cursor style based on interaction mode
  useEffect(() => {
    if (cesiumContainer.current) {
      if (creatingEntityType) {
        cesiumContainer.current.style.cursor = "crosshair";
      } else if (addingObject) {
        cesiumContainer.current.style.cursor = "crosshair";
      } else if (draggingObject) {
        cesiumContainer.current.style.cursor = "move";
      } else {
        cesiumContainer.current.style.cursor = "default";
      }
    }
  }, [addingObject, draggingObject, creatingEntityType]);

  // Loading state
  if (!isClient) {
    return (
      <div className={`fullSize ${className}`}>
        <div
          id="loadingOverlay"
          className="flex items-center justify-center h-full"
        >
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-white">
              Loading NVIDIA Aerial Digital Twin...
            </h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fullSize ${className}`}>
      <div
        id="cesiumContainer"
        ref={cesiumContainer}
        className="relative"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Object Toolbar - Shows tools for any selected draggable object */}
      <ObjectToolbar />

      {/* Cursor position display */}
      <CursorPositionDisplay
        cursorPosition={cursorPosition}
        isLoaded={isLoaded}
      />

      {/* Error overlay */}
      {error && (
        <div
          id="errorOverlay"
          className="flex items-center justify-center h-full bg-red-900/20"
        >
          <div className="text-center max-w-2xl p-8 bg-gray-900/90 rounded-lg">
            <h1 className="text-2xl font-semibold text-red-400 mb-4">
              WebGL Initialization Error
            </h1>
            <p className="text-white mb-4">{error}</p>
            <div className="text-sm text-gray-300 space-y-2">
              <p>
                <strong>Troubleshooting steps:</strong>
              </p>
              <ul className="list-disc list-inside text-left">
                <li>Refresh the page (F5 or Cmd+R)</li>
                <li>Try a different browser (Chrome, Firefox, Edge)</li>
                <li>Update your graphics drivers</li>
                <li>
                  Check if hardware acceleration is enabled in browser settings
                </li>
                <li>
                  Verify WebGL support at{" "}
                  <a
                    href="https://get.webgl.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline"
                  >
                    get.webgl.org
                  </a>
                </li>
              </ul>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {!isLoaded && !error && (
        <div
          id="loadingOverlay"
          className="flex items-center justify-center h-full"
        >
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-white">
              Loading NVIDIA Aerial Digital Twin...
            </h1>
          </div>
        </div>
      )}

      {/* Layers */}
      {isLoaded && viewer && !error && (
        <>
          <TileManager />
          <GhostPreviewLayer viewer={viewer} />
          <MoveGizmoLayer viewer={viewer} />
          <RotateGizmoLayer viewer={viewer} />
        </>
      )}
    </div>
  );
};
