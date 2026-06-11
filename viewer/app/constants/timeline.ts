/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Cesium from "cesium";

/**
 * Centralized timeline configuration for all layers
 * Maps time indices to JulianDate for consistent time-based animations
 */
export const TIMELINE_CONFIG = {
  /**
   * Base time for the simulation - the reference point for time_idx = 0
   */
  baseTime: Cesium.JulianDate.now(),

  /**
   * Time step between consecutive time indices (in seconds)
   * Each time_idx increment represents this many seconds
   */
  timeStep: 1,
} as const;
