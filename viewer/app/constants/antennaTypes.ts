/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Available antenna types for panel configuration.
 * Note: Start with a letter to avoid pattern file saved with the same name
 * then importing back does not work with USD prim path starting with a number.
 */
export const ANTENNA_TYPES = [
  "isotropic",
  "infinitesimal_dipole",
  "halfwave_dipole",
  "rec_microstrip_patch",
  "threeGPP_38901",
  "polarized_isotropic",
  "custom",
] as const;
