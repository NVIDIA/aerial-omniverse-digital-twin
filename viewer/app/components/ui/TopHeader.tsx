/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { LocationSearch } from "./LocationSearch";
import { YmlEditor, hasStoredYmlFile, getStoredYmlContent } from "./YmlEditor";
import {
  applyYmlConfig,
  clearAllEntities,
  initEntitySync,
  prefetchSceneMetadataFromYmlConfig,
  YML_STORAGE_UPDATED_EVENT,
  ymlConfigUsesProjectedPositions,
} from "~/managers/ymlConfigLoader";
import { layerManager } from "~/managers/layerManager";
import { useViewerStore } from "~/store/viewerStore";

export const TopHeader: React.FC = () => {
  const [isYmlEditorOpen, setIsYmlEditorOpen] = useState(false);
  const [hasYmlFile, setHasYmlFile] = useState(false);
  const [isApplyingConfig, setIsApplyingConfig] = useState(false);
  const ymlSnapshotRef = useRef<string | null>(null);

  // On mount, ensure entity→YAML sync is active and apply any cached config
  useEffect(() => {
    // Guarantee sync subscriptions are live on the client (idempotent)
    initEntitySync();

    const hasFile = hasStoredYmlFile();
    setHasYmlFile(hasFile);

    if (hasFile) {
      const content = getStoredYmlContent();
      if (content) {
        // Resolve the scene's CRS before building entities so positions land
        // in the right place; then apply synchronously.
        (async () => {
          try {
            try {
              await prefetchSceneMetadataFromYmlConfig(content);
            } catch (prefetchError) {
              if (ymlConfigUsesProjectedPositions(content)) throw prefetchError;
              console.warn(
                "[TopHeader] Scene metadata prefetch failed; YAML has no projected positions, applying anyway:",
                prefetchError,
              );
            }
            // Do not overwrite minio_settings with YML db.* — keep the user's Iceberg fields.
            applyYmlConfig(content, { preferExistingMinioSettings: true });
          } catch (error) {
            console.error(
              "[TopHeader] Failed to apply cached YML config:",
              error,
            );
          }
        })();
      }
    }
  }, []);

  // Keep hasYmlFile in sync when other components (e.g. MinIOSettings)
  // write YAML to localStorage outside the editor flow.
  useEffect(() => {
    const handleStorageUpdate = () => setHasYmlFile(hasStoredYmlFile());
    window.addEventListener(YML_STORAGE_UPDATED_EVENT, handleStorageUpdate);
    return () =>
      window.removeEventListener(
        YML_STORAGE_UPDATED_EVENT,
        handleStorageUpdate,
      );
  }, []);

  const handleYmlFileChange = useCallback((hasFile: boolean) => {
    setHasYmlFile(hasFile);
  }, []);

  const handleConfigApply = useCallback((content: string) => {
    (async () => {
      try {
        try {
          await prefetchSceneMetadataFromYmlConfig(content);
        } catch (prefetchError) {
          if (ymlConfigUsesProjectedPositions(content)) throw prefetchError;
          console.warn(
            "[TopHeader] Scene metadata prefetch failed; YAML has no projected positions, applying anyway:",
            prefetchError,
          );
        }
        applyYmlConfig(content);
      } catch (error) {
        console.error("[TopHeader] Failed to apply YML config:", error);
      }
    })();
  }, []);

  const surfaceMaterialAssignments = useViewerStore(
    (s) => s.surfaceMaterialAssignments,
  );
  const hasMaterialAssignments =
    Object.keys(surfaceMaterialAssignments).length > 0;

  const handleDownloadMaterialAssignment = useCallback(() => {
    const map = useViewerStore.getState().surfaceMaterialAssignments;
    const sorted: Record<string, string> = {};
    for (const k of Object.keys(map).sort()) {
      sorted[k] = map[k];
    }
    const blob = new Blob([JSON.stringify(sorted, null, 4)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "assignment.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="absolute top-0 left-0 right-0 h-16 bg-black shadow-lg z-40 flex items-center justify-between px-6 border-b border-gray-900">
      {/* Logo and Brand */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {/* NVIDIA Logo */}
          <div className="flex items-center">
            <svg
              version="1.1"
              viewBox="0 0 974.7 179.7"
              xmlSpace="preserve"
              xmlns="http://www.w3.org/2000/svg"
              width="110"
              height="44"
            >
              <title>
                Artificial Intelligence Computing Leadership from NVIDIA
              </title>
              <path
                fill="#FFFFFF"
                d="m962.1 144.1v-2.7h1.7c0.9 0 2.2 0.1 2.2 1.2s-0.7 1.5-1.8 1.5h-2.1m0 1.9h1.2l2.7 4.7h2.9l-3-4.9c1.5 0.1 2.7-1 2.8-2.5v-0.4c0-2.6-1.8-3.4-4.8-3.4h-4.3v11.2h2.5v-4.7m12.6-0.9c0-6.6-5.1-10.4-10.8-10.4s-10.8 3.8-10.8 10.4 5.1 10.4 10.8 10.4 10.8-3.8 10.8-10.4m-3.2 0c0.2 4.2-3.1 7.8-7.3 8h-0.3c-4.4 0.2-8.1-3.3-8.3-7.7s3.3-8.1 7.7-8.3 8.1 3.3 8.3 7.7c-0.1 0.1-0.1 0.2-0.1 0.3z"
              ></path>
              <path
                fill="#FFFFFF"
                d="m578.2 34v118h33.3v-118h-33.3zm-262-0.2v118.1h33.6v-91.7l26.2 0.1c8.6 0 14.6 2.1 18.7 6.5 5.3 5.6 7.4 14.7 7.4 31.2v53.9h32.6v-65.2c0-46.6-29.7-52.9-58.7-52.9h-59.8zm315.7 0.2v118h54c28.8 0 38.2-4.8 48.3-15.5 7.2-7.5 11.8-24.1 11.8-42.2 0-16.6-3.9-31.4-10.8-40.6-12.2-16.5-30-19.7-56.6-19.7h-46.7zm33 25.6h14.3c20.8 0 34.2 9.3 34.2 33.5s-13.4 33.6-34.2 33.6h-14.3v-67.1zm-134.7-25.6l-27.8 93.5-26.6-93.5h-36l38 118h48l38.4-118h-34zm231.4 118h33.3v-118h-33.3v118zm93.4-118l-46.5 117.9h32.8l7.4-20.9h55l7 20.8h35.7l-46.9-117.8h-44.5zm21.6 21.5l20.2 55.2h-41l20.8-55.2z"
              ></path>
              <path
                fill="#76B900"
                d="m101.3 53.6v-16.2c1.6-0.1 3.2-0.2 4.8-0.2 44.4-1.4 73.5 38.2 73.5 38.2s-31.4 43.6-65.1 43.6c-4.5 0-8.9-0.7-13.1-2.1v-49.2c17.3 2.1 20.8 9.7 31.1 27l23.1-19.4s-16.9-22.1-45.3-22.1c-3-0.1-6 0.1-9 0.4m0-53.6v24.2l4.8-0.3c61.7-2.1 102 50.6 102 50.6s-46.2 56.2-94.3 56.2c-4.2 0-8.3-0.4-12.4-1.1v15c3.4 0.4 6.9 0.7 10.3 0.7 44.8 0 77.2-22.9 108.6-49.9 5.2 4.2 26.5 14.3 30.9 18.7-29.8 25-99.3 45.1-138.7 45.1-3.8 0-7.4-0.2-11-0.6v21.1h170.2v-179.7h-170.4zm0 116.9v12.8c-41.4-7.4-52.9-50.5-52.9-50.5s19.9-22 52.9-25.6v14h-0.1c-17.3-2.1-30.9 14.1-30.9 14.1s7.7 27.3 31 35.2m-73.5-39.5s24.5-36.2 73.6-40v-13.2c-54.4 4.4-101.4 50.4-101.4 50.4s26.6 77 101.3 84v-14c-54.8-6.8-73.5-67.2-73.5-67.2z"
              ></path>
            </svg>
            <div className="ml-4 border-l border-gray-700 pl-4">
              <div className="text-white font-semibold text-sm tracking-wide">
                Aerial Digital Twin
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Location Search */}
      <div className="flex-1 flex justify-center px-8">
        <LocationSearch />
      </div>

      {/* Upload YML */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            ymlSnapshotRef.current = getStoredYmlContent();
            setIsYmlEditorOpen(true);
          }}
          className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded font-medium transition-colors border border-gray-600 hover:border-gray-500 text-sm"
          title={
            hasYmlFile
              ? "Edit YML configuration file"
              : "Upload a YML configuration file"
          }
        >
          {hasYmlFile ? (
            /* Pencil/edit icon */
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
            </svg>
          ) : (
            /* Upload icon */
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
              <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
            </svg>
          )}
          {hasYmlFile ? "Edit YML" : "Upload YML"}
        </button>

        <button
          type="button"
          onClick={handleDownloadMaterialAssignment}
          disabled={!hasMaterialAssignments}
          title={
            hasMaterialAssignments
              ? "Download surface hash to material name map (assignment.json)"
              : "Assign materials from a building's GlobalSurfaceHash in the properties panel first"
          }
          className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded font-medium transition-colors border border-gray-600 hover:border-gray-500 text-sm disabled:opacity-40 disabled:pointer-events-none disabled:hover:bg-gray-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M10 3a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 111.06 1.06l-3.75 3.75a.75.75 0 01-1.06 0L5.47 10.28a.75.75 0 111.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3zm-7 10.5a.75.75 0 01.75.75v1A2.25 2.25 0 004.75 18h10.5A2.25 2.25 0 0017.5 15.25v-1a.75.75 0 00-1.5 0v1a.75.75 0 01-.75.75H4.75a.75.75 0 01-.75-.75v-1a.75.75 0 00-.75-.75z"
              clipRule="evenodd"
            />
          </svg>
          Material Assignment
        </button>
      </div>

      {/* Applying config overlay — rendered above the editor (z-[200] > z-[100]) */}
      {isApplyingConfig && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 cursor-wait">
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-lg px-6 py-4 shadow-2xl">
            <svg
              className="w-5 h-5 text-[#76B900] animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-gray-200 text-sm font-medium">
              Applying configuration...
            </span>
          </div>
        </div>
      )}

      {/* YML Editor Modal */}
      <YmlEditor
        isOpen={isYmlEditorOpen}
        onClose={() => {
          const content = getStoredYmlContent();
          const changed = content !== ymlSnapshotRef.current;
          ymlSnapshotRef.current = null;

          if (!changed) {
            setIsYmlEditorOpen(false);
            return;
          }

          setIsApplyingConfig(true);
          document.body.style.cursor = "wait";

          // Defer so the browser paints the overlay before the heavy work runs
          requestAnimationFrame(async () => {
            try {
              if (content) {
                // Pre-resolve scene CRS so positionFromLocal sees it.
                try {
                  await prefetchSceneMetadataFromYmlConfig(content);
                } catch (prefetchError) {
                  if (ymlConfigUsesProjectedPositions(content))
                    throw prefetchError;
                  console.warn(
                    "[TopHeader] Scene metadata prefetch failed; YAML has no projected positions, applying anyway:",
                    prefetchError,
                  );
                }
                applyYmlConfig(content);
              } else {
                clearAllEntities();
                layerManager.clearAll();
              }

              // Ask Cesium to repaint with the updated entities
              const viewer = useViewerStore.getState().cesiumViewer;
              if (viewer?.scene) {
                viewer.scene.requestRender();
              }
            } catch (error) {
              console.error(
                "[TopHeader] Failed to apply YML config on close:",
                error,
              );
            }

            // Wait for the viewport to actually repaint before closing
            requestAnimationFrame(() => {
              document.body.style.cursor = "";
              setIsApplyingConfig(false);
              setIsYmlEditorOpen(false);
            });
          });
        }}
        onFileChange={handleYmlFileChange}
        onConfigApply={handleConfigApply}
      />
    </div>
  );
};
