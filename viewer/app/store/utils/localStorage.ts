/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LocalStorage utilities for persisting viewer state
 */
import type { CameraState, TilesetConfig } from "../types";

// ==================== Camera State ====================
const CAMERA_STATE_KEY = "cesium_camera_state";

export const saveCameraState = (viewer: any) => {
  if (typeof window === "undefined" || !viewer) return;

  try {
    const Cesium = window.Cesium;
    if (!Cesium) return;

    const camera = viewer.camera;
    const position = camera.positionCartographic;

    const cameraState: CameraState = {
      position: {
        longitude: Cesium.Math.toDegrees(position.longitude),
        latitude: Cesium.Math.toDegrees(position.latitude),
        height: position.height,
      },
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll,
      },
    };

    localStorage.setItem(CAMERA_STATE_KEY, JSON.stringify(cameraState));
  } catch (error) {
    console.warn("[LocalStorage] Failed to save camera position:", error);
  }
};

export const loadCameraState = (): CameraState | null => {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(CAMERA_STATE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn("[LocalStorage] Failed to load camera position:", error);
  }

  return null;
};

// ==================== Layer Visibility ====================
const LAYER_VISIBILITY_KEY = "layer_visibility";

interface LayerVisibilityState {
  rayPathsVisible: boolean;
  tilesetsVisible: boolean;
}

export const saveLayerVisibility = (visibility: LayerVisibilityState) => {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(LAYER_VISIBILITY_KEY, JSON.stringify(visibility));
  } catch (error) {
    console.warn("[LocalStorage] Failed to save layer visibility:", error);
  }
};

export const loadLayerVisibility = (): Partial<LayerVisibilityState> | null => {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(LAYER_VISIBILITY_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn("[LocalStorage] Failed to load layer visibility:", error);
  }

  return null;
};

// ==================== Tool Button States ====================
const TOOL_STATES_KEY = "tool_button_states";

interface ToolButtonStates {
  selectToolEnabled: boolean;
  moveToolEnabled?: boolean;
  rotateToolEnabled?: boolean;
}

export const saveToolButtonStates = (states: ToolButtonStates) => {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TOOL_STATES_KEY, JSON.stringify(states));
  } catch (error) {
    console.warn("[LocalStorage] Failed to save tool button states:", error);
  }
};

export const loadToolButtonStates = (): Partial<ToolButtonStates> | null => {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(TOOL_STATES_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn("[LocalStorage] Failed to load tool button states:", error);
  }

  return null;
};

// ==================== Active Tab ====================
const ACTIVE_TAB_KEY = "active_right_tab";

export const saveActiveTab = (tab: "Entities" | "Rays" | "Settings") => {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
  } catch (error) {
    console.warn("[LocalStorage] Failed to save active tab:", error);
  }
};

export const loadActiveTab = (): "Entities" | "Rays" | "Settings" | null => {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    if (saved && ["Entities", "Rays", "Settings"].includes(saved)) {
      return saved as "Entities" | "Rays" | "Settings";
    }
    // Backward compatibility: treat old "Scenario" as "Rays"
    if (saved === "Scenario") return "Rays";
  } catch (error) {
    console.warn("[LocalStorage] Failed to load active tab:", error);
  }

  return null;
};

// ==================== Scenario Ray Visualization ====================
const SCENARIO_RAY_VISUALIZATION_KEY = "scenario_ray_visualization";

export interface ScenarioRayVisualizationState {
  raysSparsity: number;
  maxVisibleRayPaths: number;
  maxDynamicRangeDB: number;
}

export const saveScenarioRayVisualization = (
  params: ScenarioRayVisualizationState,
) => {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(
      SCENARIO_RAY_VISUALIZATION_KEY,
      JSON.stringify({
        raysSparsity: params.raysSparsity,
        maxVisibleRayPaths: params.maxVisibleRayPaths,
        maxDynamicRangeDB: params.maxDynamicRangeDB,
      }),
    );
  } catch (error) {
    console.warn(
      "[LocalStorage] Failed to save scenario ray visualization:",
      error,
    );
  }
};

export const loadScenarioRayVisualization =
  (): Partial<ScenarioRayVisualizationState> | null => {
    if (typeof window === "undefined") return null;

    try {
      const saved = localStorage.getItem(SCENARIO_RAY_VISUALIZATION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          const out: Partial<ScenarioRayVisualizationState> = {};
          if (
            typeof parsed.raysSparsity === "number" &&
            parsed.raysSparsity >= 1
          ) {
            out.raysSparsity = parsed.raysSparsity;
          }
          if (
            typeof parsed.maxVisibleRayPaths === "number" &&
            parsed.maxVisibleRayPaths >= 0
          ) {
            out.maxVisibleRayPaths = parsed.maxVisibleRayPaths;
          }
          if (
            typeof parsed.maxDynamicRangeDB === "number" &&
            parsed.maxDynamicRangeDB >= 0
          ) {
            out.maxDynamicRangeDB = parsed.maxDynamicRangeDB;
          }
          return Object.keys(out).length > 0 ? out : null;
        }
      }
    } catch (error) {
      console.warn(
        "[LocalStorage] Failed to load scenario ray visualization:",
        error,
      );
    }

    return null;
  };

// ==================== Tileset Configs ====================
const TILESET_CONFIGS_KEY = "tileset_configs";

export const saveTilesetConfigs = (tilesets: TilesetConfig[]) => {
  if (typeof window === "undefined") return;

  try {
    // Only save user-modifiable properties, exclude runtime properties like loadedBounds
    const configsToSave = tilesets.map((t) => {
      const { loadedBounds, ...config } = t;
      return config;
    });
    localStorage.setItem(TILESET_CONFIGS_KEY, JSON.stringify(configsToSave));
  } catch (error) {
    console.warn("[LocalStorage] Failed to save tileset configs:", error);
  }
};

export const loadTilesetConfigs = (): TilesetConfig[] | null => {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(TILESET_CONFIGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn("[LocalStorage] Failed to load tileset configs:", error);
  }

  return null;
};

// ==================== Raypath Filter Preferences ====================
const RAYPATH_FILTERS_KEY_PREFIX = "raypath_filters_";

export interface RaypathFilterState {
  enabledRuIds: number[]; // Empty array means all enabled
  enabledUeIds: number[]; // Empty array means all enabled
  allRuEnabled: boolean;
  allUeEnabled: boolean;
}

const RAYPATH_FILTERS_DEFAULT_KEY = "__default__";

/**
 * Get the localStorage key for raypath filters for a specific database.
 * Uses a stable default key when database is empty so filters always persist.
 */
const getRaypathFiltersKey = (database: string): string => {
  return `${RAYPATH_FILTERS_KEY_PREFIX}${database || RAYPATH_FILTERS_DEFAULT_KEY}`;
};

/**
 * Save raypath filter preferences for a specific database
 */
export const saveRaypathFilters = (
  database: string,
  filters: RaypathFilterState,
) => {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(
      getRaypathFiltersKey(database),
      JSON.stringify(filters),
    );
  } catch (error) {
    console.warn("[LocalStorage] Failed to save raypath filters:", error);
  }
};

function isRaypathFilterState(obj: unknown): obj is RaypathFilterState {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    Array.isArray(o.enabledRuIds) &&
    Array.isArray(o.enabledUeIds) &&
    typeof o.allRuEnabled === "boolean" &&
    typeof o.allUeEnabled === "boolean"
  );
}

/**
 * Load raypath filter preferences for a specific database
 */
export const loadRaypathFilters = (
  database: string,
): RaypathFilterState | null => {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(getRaypathFiltersKey(database));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (isRaypathFilterState(parsed)) return parsed;
    }
  } catch (error) {
    console.warn("[LocalStorage] Failed to load raypath filters:", error);
  }

  return null;
};

// ==================== Base Layer ====================
const BASE_LAYER_KEY = "base_layer_id";

export const saveBaseLayerId = (id: string) => {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(BASE_LAYER_KEY, id);
  } catch (error) {
    console.warn("[LocalStorage] Failed to save base layer:", error);
  }
};

export const loadBaseLayerId = (): string | null => {
  if (typeof window === "undefined") return null;

  try {
    return localStorage.getItem(BASE_LAYER_KEY);
  } catch (error) {
    console.warn("[LocalStorage] Failed to load base layer:", error);
  }

  return null;
};
