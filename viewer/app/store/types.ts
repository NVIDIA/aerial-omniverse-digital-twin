/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types for the viewer store
 * Re-exports from centralized type definitions
 *
 * NOTE: This file maintained for backwards compatibility.
 * New code should import from @/types instead.
 */

// Re-export all types from centralized locations
export type {
  ObjectType,
  Position,
  TimeIndexedPosition,
  RadioUnit,
  DistributedUnit,
  Scatterer,
  UserEquipment,
  Waypoint,
} from "@/types/entities";

export type { TilesetConfig, CameraState } from "@/types/cesium";

export type { ScenarioParams } from "@/types/simulation";
