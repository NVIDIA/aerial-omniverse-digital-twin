/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main Viewer Store
 * Composed of multiple slices for better organization
 * Note: Entity state (radioUnits, scatterers, userEquipments) is managed by
 * their respective managers in app/managers/
 */
import { create } from "zustand";
import type {
  ObjectType,
  TilesetConfig,
  RadioUnit,
  ScenarioParams,
} from "./types";
import { createObjectSlice, type ObjectSlice } from "./slices/objectSlice";
import { createUISlice, type UISlice } from "./slices/uiSlice";
import { createLayerSlice, type LayerSlice } from "./slices/layerSlice";
import {
  createScenarioSlice,
  type ScenarioSlice,
} from "./slices/scenarioSlice";
import { createCameraSlice, type CameraSlice } from "./slices/cameraSlice";
import {
  createDataSourceSlice,
  type DataSourceSlice,
} from "./slices/dataSourceSlice";
import {
  createMaterialAssignmentSlice,
  type MaterialAssignmentSlice,
} from "./slices/materialAssignmentSlice";
import {
  loadLayerVisibility,
  loadToolButtonStates,
  loadActiveTab,
  loadTilesetConfigs,
  loadBaseLayerId,
  loadScenarioRayVisualization,
  saveScenarioRayVisualization,
  saveTilesetConfigs,
} from "./utils/localStorage";
import {
  buildGisTilesetConfigsFromStorage,
  buildGisTilesetConfigs,
  mergeSavedTilesetPreferences,
} from "@/utils/gisTilesets";
import { probeTilesetAvailability } from "@/utils/minioProxyResource";
import { DEFAULT_BASE_LAYER_ID } from "@/constants/baseLayers";
import * as Cesium from "cesium";

// Re-export types for convenience
export type { ObjectType, RadioUnit, TilesetConfig, ScenarioParams };
export { saveCameraState, loadCameraState } from "./utils/localStorage";

/** Only restore tilesets from localStorage once per session so remounts don't overwrite in-memory updates */
let tilesetsRestoredThisSession = false;

/** Reset for tests that need to run loadSavedState tileset restore again */
export function __resetTilesetsRestoredForTesting(): void {
  tilesetsRestoredThisSession = false;
}

/**
 * Rebuild 3D Tiles layer list from minio_settings.s3Endpoint + s3BucketName + gis_scene_url,
 * then merge saved per-layer enabled/priority from localStorage.
 */
export function refreshGisTilesetsFromStorage(): void {
  const built = buildGisTilesetConfigsFromStorage();
  refreshGisTilesets(built);
}

export function refreshGisTilesetsFromConfig(
  s3Endpoint: string,
  sceneUrl: string,
  s3BucketSegment?: string,
  vizBaseUrl?: string,
): void {
  const built = buildGisTilesetConfigs(s3Endpoint, sceneUrl, s3BucketSegment);
  refreshGisTilesets(built, vizBaseUrl);
}

function refreshGisTilesets(
  built: ReturnType<typeof buildGisTilesetConfigs>,
  vizBaseUrl?: string,
) {
  const saved = loadTilesetConfigs();
  const merged = mergeSavedTilesetPreferences(built, saved ?? null);
  // Mark URL-backed layers as "checking" so the UI reflects the in-flight probe
  // and TileManager holds off loading until availability is known.
  const withStatus = merged.map((t) =>
    t.url ? { ...t, availability: "checking" as const } : t,
  );
  // Set vizBaseUrl in the same update when supplied so TileManager sees the new
  // scene URL and the fresh "checking" configs atomically — otherwise a separate
  // vizBaseUrl change first processes the previous scenario's still-"available"
  // tilesets, racing/poisoning the new load (needs a manual 3D-tiles refresh).
  useViewerStore.setState(
    vizBaseUrl !== undefined
      ? { tilesets: withStatus, vizBaseUrl }
      : { tilesets: withStatus },
  );
  saveTilesetConfigs(withStatus);
  void probeTilesetsAvailability(withStatus);
}

/**
 * HEAD-probe each URL-backed tileset and update its availability in the store.
 * Missing layers (404) are excluded from loading by TileManager; unknown/other
 * errors fall through to a normal load attempt so working datasets are unaffected.
 */
async function probeTilesetsAvailability(
  tilesets: TilesetConfig[],
): Promise<void> {
  await Promise.all(
    tilesets.map(async (t) => {
      if (!t.url) return;
      const availability = await probeTilesetAvailability(t.url);
      // Only apply if this tileset is still present and still awaiting its probe,
      // so a newer refresh (which resets to "checking") is not clobbered.
      const current = useViewerStore
        .getState()
        .tilesets.find((x) => x.id === t.id);
      if (!current || current.availability !== "checking") return;
      useViewerStore.getState().updateTileset(t.id, { availability });
    }),
  );
}

/**
 * Combined ViewerState interface
 * Composed of all slices
 */
export type ViewerState = ObjectSlice &
  UISlice &
  LayerSlice &
  ScenarioSlice &
  CameraSlice &
  DataSourceSlice &
  MaterialAssignmentSlice & {
    // Additional action for loading saved state
    loadSavedState: () => void;
  };

/**
 * Create the main viewer store
 * Uses zustand slices pattern for better organization
 */
export const useViewerStore = create<ViewerState>((set, get, store) => ({
  ...createObjectSlice(set, get, store),
  ...createUISlice(set, get, store),
  ...createLayerSlice(set, get, store),
  ...createScenarioSlice(set, get, store),
  ...createCameraSlice(set, get, store),
  ...createDataSourceSlice(set, get),
  ...createMaterialAssignmentSlice(set, get),

  // Load saved state from localStorage (called after hydration on client)
  loadSavedState: () => {
    const saved = loadLayerVisibility();
    if (saved) {
      set({
        rayPathsVisible: saved.rayPathsVisible ?? true,
        tilesetsVisible: saved.tilesetsVisible ?? true,
      });
    }

    // Load tool button states
    const toolStates = loadToolButtonStates();
    if (toolStates) {
      set({
        selectToolEnabled: toolStates.selectToolEnabled ?? true,
        moveToolEnabled: toolStates.moveToolEnabled ?? false,
        rotateToolEnabled: toolStates.rotateToolEnabled ?? false,
      });
    }

    // Load active tab
    const activeTab = loadActiveTab();
    if (activeTab) {
      set({ activeRightTab: activeTab });
    }

    // Build GIS tilesets from endpoint + scene path; merge saved enabled/priority (once per session)
    if (!tilesetsRestoredThisSession) {
      refreshGisTilesetsFromStorage();
      tilesetsRestoredThisSession = true;
    }

    // Load base layer preference
    const savedBaseLayerId = loadBaseLayerId();
    if (savedBaseLayerId) {
      set({ baseLayerId: savedBaseLayerId });
    } else {
      set({ baseLayerId: DEFAULT_BASE_LAYER_ID });
    }

    // Load scenario ray visualization (raysSparsity, maxVisibleRayPaths, maxDynamicRangeDB)
    const savedRayVis = loadScenarioRayVisualization();
    if (savedRayVis && Object.keys(savedRayVis).length > 0) {
      set((state) => ({
        scenarioParams: { ...state.scenarioParams, ...savedRayVis },
      }));
    }
  },
}));

// Persist scenario ray visualization params when they change
if (typeof window !== "undefined") {
  let prevRayVis = {
    raysSparsity: useViewerStore.getState().scenarioParams.raysSparsity,
    maxVisibleRayPaths:
      useViewerStore.getState().scenarioParams.maxVisibleRayPaths,
    maxDynamicRangeDB:
      useViewerStore.getState().scenarioParams.maxDynamicRangeDB,
  };
  useViewerStore.subscribe(() => {
    const p = useViewerStore.getState().scenarioParams;
    if (
      p.raysSparsity !== prevRayVis.raysSparsity ||
      p.maxVisibleRayPaths !== prevRayVis.maxVisibleRayPaths ||
      p.maxDynamicRangeDB !== prevRayVis.maxDynamicRangeDB
    ) {
      saveScenarioRayVisualization({
        raysSparsity: p.raysSparsity,
        maxVisibleRayPaths: p.maxVisibleRayPaths,
        maxDynamicRangeDB: p.maxDynamicRangeDB,
      });
      prevRayVis = {
        raysSparsity: p.raysSparsity,
        maxVisibleRayPaths: p.maxVisibleRayPaths,
        maxDynamicRangeDB: p.maxDynamicRangeDB,
      };
    }
  });
}

const getState = (): ViewerState => useViewerStore.getState();
const getCesiumViewer = (): Cesium.Viewer | undefined =>
  getState().cesiumViewer;

/**
 * Get the Cesium terrain provider instance.
 */
export const getTerrainProvider = (): Cesium.TerrainProvider | undefined =>
  getCesiumViewer()?.terrainProvider;
