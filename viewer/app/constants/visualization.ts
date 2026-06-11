/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Visualization Constants
 * Color ranges, gradients, and visual parameters
 */

/**
 * Signal strength range for visualization
 */
export const SIGNAL_RANGE = {
  MIN: -180, // dBm - weakest signal
  MAX: -40, // dBm - strongest signal
} as const;
