/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cesium-related Type Definitions
 */

/**
 * Camera state for localStorage persistence
 */
export interface CameraState {
  position: {
    longitude: number;
    latitude: number;
    height: number;
  };
  orientation: {
    heading: number;
    pitch: number;
    roll: number;
  };
}

/**
 * Tileset configuration interface for 3D building tiles
 */
export interface TilesetConfig {
  id: string;
  name: string;
  url?: string; // URL for local/remote tilesets
  ionAssetId?: number; // Cesium Ion asset ID (alternative to url)
  enabled: boolean;
  priority: number; // Higher priority loads first
  selectable?: boolean;
  style?: object;
  colorBlendMode?: "REPLACE" | "MIX" | "HIGHLIGHT";
  // Optional center coordinates for distance-based loading
  center?: {
    longitude: number;
    latitude: number;
    height?: number;
  };
  // Optional bounding box for more precise distance calculations
  bounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  // Runtime bounds extracted from loaded tileset (in degrees)
  loadedBounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
    minHeight?: number;
    maxHeight?: number;
  };
}
