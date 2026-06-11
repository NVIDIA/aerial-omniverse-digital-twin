/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from "react";
import { useViewerStore } from "@/store/viewerStore";
import { BaseLayerPicker } from "./BaseLayerPicker";

export const LeftSidebar: React.FC = () => {
  const {
    leftSidebarCollapsed,
    tilesets,
    cesiumViewer,
    toggleLeftSidebar,
    toggleTileset,
    loadSavedState,
    vizBaseUrl,
    refreshTilesets,
  } = useViewerStore();

  // Load saved layer visibility state after component mounts (client-side only)
  useEffect(() => {
    loadSavedState();
  }, [loadSavedState]);

  const handleZoomToTileset = (tileset: any) => {
    if (!cesiumViewer) return;

    const urlParts = tileset.url?.split("/") ?? [];
    const urlIdentifier = urlParts.slice(-2).join("/");
    const loadedTileset = cesiumViewer.scene.primitives._primitives.find(
      (primitive: any) =>
        primitive instanceof window.Cesium?.Cesium3DTileset &&
        primitive.resource?.url?.includes(urlIdentifier),
    );
    if (loadedTileset) {
      cesiumViewer.flyTo(loadedTileset, { duration: 2.0 });
    }
  };

  if (leftSidebarCollapsed) {
    return (
      <div className="absolute left-0 top-16 z-30 bg-gray-900 bg-opacity-95 rounded-r-lg shadow-lg border border-gray-800">
        <button
          onClick={toggleLeftSidebar}
          className="p-3 text-gray-300 hover:text-white transition-colors"
          title="Expand sidebar"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="absolute left-0 top-16 bottom-0 w-80 bg-gray-900 bg-opacity-95 shadow-lg z-30 overflow-y-auto border-r border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between py-2 px-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white">Layers</h2>
        <button
          onClick={toggleLeftSidebar}
          className="p-1 text-gray-400 hover:text-white transition-colors"
          title="Collapse sidebar"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      {/* Base Layer Picker */}
      <BaseLayerPicker />

      {/* 3D Tiles */}
      <div className="p-4 border-b border-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-white">3D Tiles</span>
          {vizBaseUrl !== null && (
            <button
              onClick={refreshTilesets}
              className="text-gray-500 hover:text-white transition-colors p-0.5 rounded hover:bg-gray-700"
              title="Reload all tilesets"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
        </div>

        {vizBaseUrl === null ? (
          <div className="text-xs text-gray-400">
            No scene loaded. Upload a YML to configure layers.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            <div
              className="text-xs text-gray-500 mb-2 truncate"
              title={vizBaseUrl}
            >
              from{" "}
              {(() => {
                try {
                  return new URL(vizBaseUrl).pathname.replace(/\/viz\/$/, "");
                } catch {
                  return vizBaseUrl;
                }
              })()}
            </div>
            <div className="text-xs text-gray-400 mb-2">
              {tilesets.filter((t) => t.enabled).length} of {tilesets.length}{" "}
              layers enabled
            </div>

            {[...tilesets]
              .sort((a, b) => b.priority - a.priority)
              .map((tileset) => (
                <div
                  key={tileset.id}
                  className="flex items-center justify-between py-1 px-2 hover:bg-gray-700 rounded"
                >
                  <div className="flex items-center gap-2 flex-1">
                    <button
                      onClick={() => toggleTileset(tileset.id)}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                        tileset.enabled
                          ? "bg-green-500 border-green-500"
                          : "border-gray-500 hover:border-gray-400"
                      }`}
                    >
                      {tileset.enabled && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          ></path>
                        </svg>
                      )}
                    </button>

                    <div className="flex-1">
                      <div className="text-white text-xs">{tileset.name}</div>
                    </div>

                    <button
                      onClick={() => handleZoomToTileset(tileset)}
                      disabled={!tileset.url}
                      className={`p-1 rounded transition-colors ${
                        tileset.url
                          ? "text-gray-400 hover:text-blue-400 hover:bg-gray-600"
                          : "text-gray-600 cursor-not-allowed opacity-50"
                      }`}
                      title={`Zoom to ${tileset.name}`}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
