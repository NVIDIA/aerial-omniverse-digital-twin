/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layer visibility slice
 * Manages: tilesets visibility, base layers
 */
import type { TilesetConfig } from "@/types";
import {
  saveLayerVisibility,
  saveTilesetConfigs,
  saveBaseLayerId,
} from "../utils/localStorage";
import { DEFAULT_BASE_LAYER_ID } from "@/constants/baseLayers";

export interface LayerSlice {
  // State
  rayPathsVisible: boolean;
  tilesets: TilesetConfig[];
  tilesetsVisible: boolean;
  baseLayerId: string;
  vizBaseUrl: string | null;
  tileRefreshCounter: number;

  // Actions
  toggleLayerVisibility: (layer: "tilesetsVisible") => void;
  toggleRayPathsVisible: () => void;
  toggleTileset: (id: string) => void;
  updateTileset: (id: string, updates: Partial<TilesetConfig>) => void;
  setTilesets: (tilesets: TilesetConfig[]) => void;
  setBaseLayer: (id: string) => void;
  setVizBaseUrl: (url: string | null) => void;
  refreshTilesets: () => void;
}

export const createLayerSlice = (
  set: any,
  get: any,
  _store: any,
): LayerSlice => {
  return {
    // Initial state (tilesets filled by loadSavedState → refreshGisTilesetsFromStorage)
    rayPathsVisible: true,
    tilesets: [],
    tilesetsVisible: true,
    baseLayerId: DEFAULT_BASE_LAYER_ID,
    vizBaseUrl: null,
    tileRefreshCounter: 0,

    // Actions
    toggleLayerVisibility: (layer) =>
      set((state: any) => {
        const newValue = !state[layer];
        const newState: any = { [layer]: newValue };

        // Save layer visibility to localStorage
        const currentState = get();
        const updatedState = { ...currentState, ...newState };
        saveLayerVisibility({
          rayPathsVisible: updatedState.rayPathsVisible,
          tilesetsVisible: updatedState.tilesetsVisible,
        });

        return newState;
      }),

    toggleRayPathsVisible: () =>
      set((state: any) => {
        const newValue = !state.rayPathsVisible;
        const newState = { rayPathsVisible: newValue };

        // Save layer visibility to localStorage
        const currentState = get();
        const updatedState = { ...currentState, ...newState };
        saveLayerVisibility({
          rayPathsVisible: updatedState.rayPathsVisible,
          tilesetsVisible: updatedState.tilesetsVisible,
        });

        return newState;
      }),

    toggleTileset: (id: string) =>
      set((state: any) => {
        const updatedTilesets = state.tilesets.map((t: TilesetConfig) =>
          t.id === id ? { ...t, enabled: !t.enabled } : t,
        );
        saveTilesetConfigs(updatedTilesets);
        return { tilesets: updatedTilesets };
      }),

    updateTileset: (id: string, updates: Partial<TilesetConfig>) =>
      set((state: any) => {
        const updatedTilesets = state.tilesets.map((t: TilesetConfig) =>
          t.id === id ? { ...t, ...updates } : t,
        );
        saveTilesetConfigs(updatedTilesets);
        return { tilesets: updatedTilesets };
      }),

    setTilesets: (tilesets: TilesetConfig[]) =>
      set(() => {
        saveTilesetConfigs(tilesets);
        return { tilesets };
      }),

    setBaseLayer: (id: string) =>
      set(() => {
        saveBaseLayerId(id);
        return { baseLayerId: id };
      }),

    setVizBaseUrl: (url: string | null) => set(() => ({ vizBaseUrl: url })),

    refreshTilesets: () =>
      set((state: any) => ({
        tileRefreshCounter: state.tileRefreshCounter + 1,
      })),
  };
};
