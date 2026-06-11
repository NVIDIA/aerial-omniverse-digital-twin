/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Default property values for newly created entities
 * Used when placing entities on the map via the creation tool
 */

import * as Cesium from "cesium";
import type { RadioUnit, DistributedUnit, UserEquipment } from "@/types";

/**
 * Default values for new Radio Units
 */
export const DEFAULT_RADIO_UNIT_PROPERTIES: Omit<
  RadioUnit,
  "id" | "cellId" | "position"
> = {
  orientation: new Cesium.HeadingPitchRoll(0, 0, 0),
  duId: -1,
  duManualAssign: false,
  enableRays: true,
  height: 2.5,
  mechAzimuth: 0.0,
  mechTilt: 0.0,
  panelType: "panel_02",
  radiatedPower: 43.0,
  /** MHz; matches DU default carrier so YAML exports aerial_gnb_carrier_freq for new/placed RUs */
  carrierFreqMHz: 3600.0,
};

/**
 * Default values for new Distributed Units
 */
export const DEFAULT_DISTRIBUTED_UNIT_PROPERTIES: Omit<
  DistributedUnit,
  "id" | "position"
> = {
  referenceFreq: 3600.0, // 3600 MHz default carrier frequency
  subcarrierSpacing: 30000, // 30 kHz default (stored in Hz)
  fftSize: 4096, // Default FFT size
  numAntennas: 4, // Default number of antennas
  maxChannelBandwidth: 100, // 100 MHz default
};

/**
 * Default values for new User Equipment
 */
export const DEFAULT_USER_EQUIPMENT_PROPERTIES: Omit<
  UserEquipment,
  "id" | "positions" | "waypoints"
> = {
  isManual: true,
  isManualMobility: false,
  isIndoorMobility: false,
  radiatedPower: 23.0,
  height: 1.5,
  mechTilt: 0.0,
  panel: [0],
};

/**
 * Default height above terrain for new entities (in meters)
 */
export const DEFAULT_ENTITY_HEIGHTS = {
  radioUnit: 0, // Height from surface (uses clicked position)
  distributedUnit: 15.0, // 15m above terrain
  userEquipment: 0, // Height from surface (uses clicked position)
} as const;
