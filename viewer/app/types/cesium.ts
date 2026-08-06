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
 * Runtime availability of a tileset's source (probed via a HEAD request before load):
 * - "checking": probe in flight
 * - "available": source responded OK, safe to load
 * - "missing": source returned 404 (e.g. a layer this dataset does not ship, by design)
 * - "unknown": probe could not determine availability (network/other error) — load is still attempted
 * This is a transient/runtime value and is not persisted to localStorage.
 */
export type TilesetAvailability =
  | "checking"
  | "available"
  | "missing"
  | "unknown";

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
  // Runtime availability of the tileset source (not persisted)
  availability?: TilesetAvailability;
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
