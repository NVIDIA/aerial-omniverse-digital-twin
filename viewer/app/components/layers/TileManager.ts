/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";
import { useViewerStore, loadCameraState } from "../../store/viewerStore";
import type { TilesetConfig } from "../../store/viewerStore";
import { VERTICAL_DATUM_OFFSET } from "../../constants/cesium";
import {
  createMinioProxyResource,
  readMinioProxySettingsFromStorage,
  shouldProxyTileUrlToMinio,
} from "@/utils/minioProxyResource";

declare global {
  interface Window {
    Cesium: any;
  }
}

// Shared across mounts so React StrictMode's double-mount doesn't cancel the first
// set of loads and leave only the second set to add tiles.
const loadedTilesets = new Map<string, any>();
/** Maps tileset ID → the loadGeneration that started it, so stale completions
 *  only remove their own entry and don't clobber a newer mount's entry. */
const loadingTilesets = new Map<string, number>();
const cancelledLoads = new Set<string>();
/** Tilesets that failed to load (404 etc.) -- won't be retried until vizBaseUrl changes. */
const failedTilesets = new Set<string>();
/** Incremented on unmount so in-flight loads from a previous mount skip adding to the scene. */
let loadGeneration = 0;

export const TileManager: React.FC = () => {
  const isProcessingRef = useRef(false);
  const hasZoomedToFirstTilesetRef = useRef(false);

  useEffect(() => {
    let prevCesiumViewer: any = undefined;
    let prevTilesets: TilesetConfig[] | undefined;
    let prevTilesetsVisible: boolean | undefined;
    let prevVizBaseUrl: string | null | undefined;
    let prevRefreshCounter: number =
      useViewerStore.getState().tileRefreshCounter;

    const unsubscribe = useViewerStore.subscribe((state) => {
      if (isProcessingRef.current) return;
      const {
        cesiumViewer,
        tilesets,
        tilesetsVisible,
        vizBaseUrl,
        tileRefreshCounter,
      } = state;

      const vizChanged = vizBaseUrl !== prevVizBaseUrl;
      const refreshRequested = tileRefreshCounter !== prevRefreshCounter;

      if ((vizChanged || refreshRequested) && cesiumViewer) {
        prevVizBaseUrl = vizBaseUrl;
        prevRefreshCounter = tileRefreshCounter;
        cleanupAllTilesets(cesiumViewer);
        failedTilesets.clear();
        if (vizChanged) {
          hasZoomedToFirstTilesetRef.current = false;
        }
        prevTilesets = undefined;
      }

      if (
        cesiumViewer === prevCesiumViewer &&
        tilesets === prevTilesets &&
        tilesetsVisible === prevTilesetsVisible
      ) {
        return;
      }
      prevCesiumViewer = cesiumViewer;
      prevTilesets = tilesets;
      prevTilesetsVisible = tilesetsVisible;

      handleTilesetChanges(cesiumViewer, tilesets, tilesetsVisible);
    });

    const initialState = useViewerStore.getState();
    prevVizBaseUrl = initialState.vizBaseUrl;
    if (initialState.cesiumViewer && !isProcessingRef.current) {
      prevCesiumViewer = initialState.cesiumViewer;
      prevTilesets = initialState.tilesets;
      prevTilesetsVisible = initialState.tilesetsVisible;
      handleTilesetChanges(
        initialState.cesiumViewer,
        initialState.tilesets,
        initialState.tilesetsVisible,
      );
    }

    return () => {
      unsubscribe();
      const state = useViewerStore.getState();
      if (state.cesiumViewer) {
        cleanupAllTilesets(state.cesiumViewer);
      }
    };
  }, []);

  const handleTilesetChanges = (
    cesiumViewer: any,
    tilesets: TilesetConfig[],
    tilesetsVisible: boolean,
  ) => {
    if (!cesiumViewer || !window.Cesium) {
      return;
    }

    if (!tilesetsVisible) {
      cleanupAllTilesets(cesiumViewer);
      return;
    }

    try {
      if (cesiumViewer.isDestroyed && cesiumViewer.isDestroyed()) {
        return;
      }
      if (!cesiumViewer.scene || !cesiumViewer.scene.primitives) {
        return;
      }
    } catch (e) {
      console.error("[TileManager] Early return: exception checking viewer", e);
      return;
    }

    isProcessingRef.current = true;

    try {
      const Cesium = window.Cesium;
      const enabledTilesets = tilesets.filter((t) => t.enabled);

      const currentEnabledIds = new Set(enabledTilesets.map((t) => t.id));
      const loadedIds = new Set(loadedTilesets.keys());
      const loadingIds = new Set(loadingTilesets.keys());

      const idsToLoad = enabledTilesets
        .filter(
          (t) =>
            !loadedIds.has(t.id) &&
            !loadingIds.has(t.id) &&
            !failedTilesets.has(t.id),
        )
        .map((t) => t.id);

      const idsToUnload = [
        ...Array.from(loadedIds),
        ...Array.from(loadingIds),
      ].filter((id) => !currentEnabledIds.has(id));

      if (idsToLoad.length === 0 && idsToUnload.length === 0) {
        return;
      }

      for (const id of idsToUnload) {
        unloadTileset(id, cesiumViewer);
      }

      for (const tilesetConfig of enabledTilesets.filter((t) =>
        idsToLoad.includes(t.id),
      )) {
        loadTileset(tilesetConfig, cesiumViewer, Cesium);
      }
    } finally {
      isProcessingRef.current = false;
    }
  };

  const cleanupAllTilesets = (cesiumViewer: any) => {
    loadGeneration += 1; // So in-flight loads from this mount skip adding after unmount
    const requestSceneRender = () => {
      try {
        if (
          cesiumViewer?.scene &&
          typeof cesiumViewer.scene.requestRender === "function"
        ) {
          cesiumViewer.scene.requestRender();
        }
      } catch (e) {
        console.warn("[TileManager] Failed to request scene render:", e);
      }
    };

    try {
      if (cesiumViewer.isDestroyed && cesiumViewer.isDestroyed()) {
        return;
      }

      const Cesium = window.Cesium;
      const primitives = cesiumViewer.scene.primitives;

      // Remove ALL Cesium3DTileset primitives from the scene, not just tracked ones
      for (let i = primitives.length - 1; i >= 0; i--) {
        const primitive = primitives.get(i);
        if (primitive instanceof Cesium.Cesium3DTileset) {
          try {
            primitive.show = false;
            primitives.remove(primitive);
            if (!primitive.isDestroyed()) {
              primitive.destroy();
            }
          } catch (e) {
            console.warn("[TileManager] Error removing tileset:", e);
          }
        }
      }
      requestSceneRender();

      // In-flight loads from this mount will skip adding (loadGeneration check). Do not add to
      // cancelledLoads here so the next mount's loads are not incorrectly skipped.
      loadedTilesets.clear();
      loadingTilesets.clear();
    } catch (e) {
      console.error("[TileManager] Error in cleanupAllTilesets:", e);
    }
  };

  const unloadTileset = (id: string, cesiumViewer: any) => {
    // Get the tileset from our tracking map
    const tileset = loadedTilesets.get(id);

    if (tileset) {
      // Hide the tileset first
      tileset.show = false;
      const primitives = cesiumViewer.scene.primitives;

      // Find and remove the tileset from primitives
      for (let i = primitives.length - 1; i >= 0; i--) {
        const primitive = primitives.get(i);
        if (primitive === tileset) {
          primitives.remove(primitive);
          break;
        }
      }

      // Force scene render to update
      cesiumViewer.scene.requestRender();

      // Remove from tracking map
      loadedTilesets.delete(id);
    } else {
      console.warn(
        `[TileManager] Tileset ${id} not found in loadedTilesets map`,
      );
    }

    // Cancel loading if it's in progress
    if (loadingTilesets.has(id)) {
      cancelledLoads.add(id);
    }
  };

  const loadTileset = async (
    tilesetConfig: TilesetConfig,
    cesiumViewer: any,
    Cesium: any,
  ) => {
    if (
      loadedTilesets.has(tilesetConfig.id) ||
      loadingTilesets.has(tilesetConfig.id)
    ) {
      return;
    }

    loadingTilesets.set(tilesetConfig.id, loadGeneration);
    const thisLoadGeneration = loadGeneration;

    try {
      let tilesetUrl: any;
      if (tilesetConfig.ionAssetId) {
        tilesetUrl = await Cesium.IonResource.fromAssetId(
          tilesetConfig.ionAssetId,
        );
      } else if (tilesetConfig.url) {
        const isRelative = !/^https?:\/\//i.test(tilesetConfig.url);
        if (isRelative) {
          const vizBaseUrl = useViewerStore.getState().vizBaseUrl;
          if (!vizBaseUrl) {
            loadingTilesets.delete(tilesetConfig.id);
            return;
          }
          tilesetUrl = vizBaseUrl + tilesetConfig.url;
        } else {
          tilesetUrl = tilesetConfig.url;
        }
      } else {
        throw new Error(
          `Tileset ${tilesetConfig.id} has neither url nor ionAssetId`,
        );
      }

      if (typeof tilesetUrl === "string") {
        const settings = readMinioProxySettingsFromStorage();
        if (settings && shouldProxyTileUrlToMinio(tilesetUrl, settings)) {
          tilesetUrl = createMinioProxyResource(
            Cesium,
            tilesetUrl,
            settings.accessKey,
            settings.secretKey,
            settings.s3Endpoint,
          );
        }
      }

      const tilesetOptions: any = {
        maximumScreenSpaceError: 8,
        cacheBytes: 2147483648,
        maximumCacheOverflowBytes: 1073741824,
        skipLevelOfDetail: true,
        immediatelyLoadDesiredLevelOfDetail: true,
        baseScreenSpaceError: 1024,
        skipScreenSpaceErrorFactor: 8,
        skipLevels: 0,
        loadSiblings: true,
        cullWithChildrenBounds: true,
        cullRequestsWhileMoving: false,
        preloadWhenHidden: true,
        preloadFlightDestinations: true,
        maximumConcurrentCacheFetches: 6,
      };

      const tileset = await Cesium.Cesium3DTileset.fromUrl(
        tilesetUrl,
        tilesetOptions,
      );

      // Skip if this load was from a previous mount (StrictMode remount or navigation)
      if (thisLoadGeneration !== loadGeneration) {
        tileset.destroy();
        // Only remove our entry; a newer mount may have re-added this ID
        if (loadingTilesets.get(tilesetConfig.id) === thisLoadGeneration) {
          loadingTilesets.delete(tilesetConfig.id);
        }
        return;
      }
      if (cancelledLoads.has(tilesetConfig.id)) {
        tileset.destroy();
        loadingTilesets.delete(tilesetConfig.id);
        cancelledLoads.delete(tilesetConfig.id);
        return;
      }

      // Guard against duplicate loads (e.g. React StrictMode double-mount)
      if (loadedTilesets.has(tilesetConfig.id)) {
        tileset.destroy();
        loadingTilesets.delete(tilesetConfig.id);
        return;
      }

      const state = useViewerStore.getState();
      const currentConfig = state.tilesets.find(
        (t) => t.id === tilesetConfig.id,
      );
      if (!currentConfig?.enabled || !state.tilesetsVisible) {
        tileset.destroy();
        loadingTilesets.delete(tilesetConfig.id);
        return;
      }

      // Apply height offset for vertical datum correction
      const boundingSphere = tileset.boundingSphere;
      const heightOffset = VERTICAL_DATUM_OFFSET.TOKYO_PEIL_CORRECTION;
      if (boundingSphere) {
        const center = boundingSphere.center;
        const centerMagnitude = Cesium.Cartesian3.magnitude(center);

        if (centerMagnitude > 1.0) {
          const surfaceNormal = Cesium.Cartesian3.normalize(
            center,
            new Cesium.Cartesian3(),
          );
          const offset = Cesium.Cartesian3.multiplyByScalar(
            surfaceNormal,
            heightOffset,
            new Cesium.Cartesian3(),
          );
          const translation = Cesium.Matrix4.fromTranslation(offset);
          tileset.modelMatrix = translation;
        }
      }

      if (tilesetConfig.colorBlendMode) {
        tileset.colorBlendMode =
          Cesium.Cesium3DTileColorBlendMode[tilesetConfig.colorBlendMode];
      }
      if (tilesetConfig.style) {
        tileset.style = new Cesium.Cesium3DTileStyle(tilesetConfig.style);
      }
      tileset._selectable = tilesetConfig.selectable !== false;

      tileset.tileFailed.addEventListener((event: any) => {
        console.warn(
          `[TileManager] Tile failed in ${tilesetConfig.name}: ${event.url}`,
          event.message,
        );
      });

      cesiumViewer.scene.primitives.add(tileset);
      loadedTilesets.set(tilesetConfig.id, tileset);
      loadingTilesets.delete(tilesetConfig.id);

      try {
        cesiumViewer.scene.requestRender();
      } catch (e) {
        // no-op if viewer destroyed
      }

      // Re-check store state: tileset may have been disabled during the async load
      const latestState = useViewerStore.getState();
      const latestConfig = latestState.tilesets.find(
        (t: TilesetConfig) => t.id === tilesetConfig.id,
      );
      if (!latestConfig?.enabled || !latestState.tilesetsVisible) {
        tileset.show = false;
        cesiumViewer.scene.primitives.remove(tileset);
        if (!tileset.isDestroyed()) {
          tileset.destroy();
        }
        loadedTilesets.delete(tilesetConfig.id);
        cesiumViewer.scene.requestRender();
        return;
      }

      // Extract and store bounding region from the tileset
      let loadedBounds: any = null;
      try {
        if (tileset.root?.boundingVolume?.region) {
          const region = tileset.root.boundingVolume.region;
          // Region format: [west, south, east, north, minHeight, maxHeight] in radians
          loadedBounds = {
            west: Cesium.Math.toDegrees(region[0]),
            south: Cesium.Math.toDegrees(region[1]),
            east: Cesium.Math.toDegrees(region[2]),
            north: Cesium.Math.toDegrees(region[3]),
            minHeight: region[4],
            maxHeight: region[5],
          };

          // Update the tileset config with the loaded bounds
          state.updateTileset(tilesetConfig.id, { loadedBounds });
        }
      } catch (error) {
        console.warn(
          "[TileManager] Failed to extract bounds from tileset:",
          error,
        );
      }

      if (!hasZoomedToFirstTilesetRef.current) {
        hasZoomedToFirstTilesetRef.current = true;
        cesiumViewer.flyTo(tileset, { duration: 2.0 });
      }
    } catch (error) {
      console.warn(
        `[TileManager] FAILED to load tileset: ${tilesetConfig.name} (${tilesetConfig.id}) — will not retry`,
        tilesetConfig.url,
      );
      failedTilesets.add(tilesetConfig.id);
      if (loadingTilesets.get(tilesetConfig.id) === thisLoadGeneration) {
        loadingTilesets.delete(tilesetConfig.id);
      }
      cancelledLoads.delete(tilesetConfig.id);
    }
  };

  return null;
};
