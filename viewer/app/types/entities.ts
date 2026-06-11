/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Entity Type Definitions
 * Centralized types for all entities in the simulation
 */
import * as Cesium from "cesium";

/**
 * Position with cartographic coordinates and orientation
 */
export interface Position {
  cartographic: Cesium.Cartographic; // position in cartographic coordinates
  terrainHeight: number; // terrain height (meters)
}

/**
 * Time-indexed position for mobile entities
 */
export interface TimeIndexedPosition {
  timeIdx: number;
  position: Position;
}

/**
 * Time-indexed orientation for mobile entities
 */
export interface TimeIndexedOrientation {
  timeIdx: number;
  orientation: Cesium.HeadingPitchRoll;
}

export interface Waypoint {
  id: number;
  position: Position;
  speed: number; // meters per second
  stop: number; // seconds (client: pause_duration)
  azimuth_offset: number; // degrees
  arrival_time: number; // seconds (-1 = auto)
}

/**
 * Radio Unit (Base Station)
 */
export interface RadioUnit {
  id: number;
  position: Position;
  orientation: Cesium.HeadingPitchRoll;
  cellId: number; // aerial:gnb:cell_id (0-10000)
  duId: number; // aerial:gnb:du_id
  duManualAssign: boolean; // aerial:gnb:du_manual_assign
  enableRays: boolean; // aerial:gnb:enable_rays
  height: number; // aerial:gnb:height (meters, 0.5-100.0)
  mechAzimuth: number; // aerial:gnb:mech_azimuth (degrees, 0-360)
  mechTilt: number; // aerial:gnb:mech_tilt (degrees, 0-360)
  panelType: string; // aerial:gnb:panel_type
  radiatedPower: number; // aerial:gnb:radiated_power (dBm, -20.0-80.0)
  /** Carrier frequency in MHz (aerial_gnb_carrier_freq); optional YAML pass-through */
  carrierFreqMHz?: number;
}

/**
 * Scatterer (dynamic vehicle)
 */
export interface Scatterer {
  id: number;
  positions: TimeIndexedPosition[];
  orientations: TimeIndexedOrientation[];
  isIndoor: boolean;
}

/**
 * User Equipment (UE)
 */
export interface UserEquipment {
  id: number;
  positions: TimeIndexedPosition[];
  isManual: boolean;
  isManualMobility: boolean;
  isIndoorMobility: boolean;
  radiatedPower: number;
  height: number;
  mechTilt: number;
  panel: number[];
  waypoints: Waypoint[];
}

/**
 * Raypath data from database
 */
export interface Raypath {
  time_idx: number;
  ru_id: number;
  ue_id: number;
  points: number[][]; // Array of [x, y, z] in cm
  power_dB: number;
}

/**
 * Distributed Unit (DU)
 */
export interface DistributedUnit {
  id: number;
  position: Position;
  referenceFreq: number; // Reference frequency in Hz
  subcarrierSpacing: number; // Subcarrier spacing in Hz
  fftSize: number; // FFT size
  numAntennas: number; // Number of antennas (1-64)
  maxChannelBandwidth: number; // Maximum channel bandwidth in MHz (read-only)
}

/**
 * Panel (Antenna Panel Configuration)
 */
export interface Panel {
  id: number;
  name: string;
  antennaNames: string[];
  frequencies: number[];
  referenceFreq: number;
  dualPolarized: number;
  numLocAntennaHorz: number;
  numLocAntennaVert: number;
  antennaSpacingHorzCm: number;
  antennaSpacingVertCm: number;
  antennaRollAngleFirstPolz: number;
  antennaRollAngleSecondPolz: number;
}

/**
 * Object types that can be selected in the viewer
 * - Cesium.Entity: Radio units, scatterers, user equipment (identified by entity ID)
 * - Cesium.Cesium3DTileFeature: 3D buildings and terrain features
 * - null: Nothing selected
 */
export type ObjectType = Cesium.Entity | Cesium.Cesium3DTileFeature | null;
