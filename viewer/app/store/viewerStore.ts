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
  mergeSavedTilesetPreferences,
} from "@/utils/gisTilesets";
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
  const saved = loadTilesetConfigs();
  const merged = mergeSavedTilesetPreferences(built, saved ?? null);
  useViewerStore.setState({ tilesets: merged });
  saveTilesetConfigs(merged);
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
