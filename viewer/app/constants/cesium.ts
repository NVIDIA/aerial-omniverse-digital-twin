/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cesium Configuration Constants
 * Camera, terrain, and viewer settings
 */

/**
 * Vertical datum correction for Japanese datasets
 * Japanese 3D data (PLATEAU) uses Tokyo Peil (TP) datum, which is geoid-based.
 * The WGS84 ellipsoid is approximately 37-40m above the geoid in Tokyo.
 * This offset corrects for the datum difference when using ellipsoid terrain.
 */
export const VERTICAL_DATUM_OFFSET = {
  /**
   * Height offset to apply when terrain sampling is not available (meters)
   * Negative value lowers entities to align with ellipsoid surface
   */
  TOKYO_PEIL_CORRECTION: 0,
} as const;
