/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Simulation and Scenario Type Definitions
 */

/**
 * Time-index metadata for a single simulation step.
 * Used by the Timeline component and inferred from YML config.
 */
export interface TimeInfo {
  time_idx: number;
  batch_idx: number;
  slot_idx: number;
  symbol_idx: number;
}

/**
 * Scenario parameters (based on 3GPP/NVIDIA Aerial)
 */
export interface ScenarioParams {
  // Default Panels
  uePanelType: string;
  ruPanelType: string;

  // Simulation
  simulateRAN: boolean;
  simulationMode: "Duration" | "Slots";
  duration: number; // seconds
  interval: number; // seconds
  batches: number;
  slotsPerBatch: number;
  samplesPerSlot: number;

  // Ray Tracing
  emDiffuseType: "Lambertian" | "Directional";
  enableWidebandCFRs: boolean;
  emittedRays: number; // x1000
  maxPathsPerAntPair: number;
  rayBounces: number;

  // Ray Visualization
  enableTemperatureColor: boolean;
  maxDynamicRangeDB: number;
  maxVisibleRayPaths: number;
  raysSparsity: number;
  raysWidth: number; // cm

  // User Equipments
  enableSeededMobility: boolean;
  mobilitySeed: number;
  enableUrbanMobility: boolean;
  numProceduralUEs: number;
  percIndoorProceduralUEs: number; // percentage
  ueHeight: number; // meters
  ueRadius: number; // meters
  receptionSphereRadius: number; // meters
  ueMaxSpeed: number; // m/s
  ueMinSpeed: number; // m/s

  // Dynamic Scatterers
  enableDynamicScattering: boolean;
  maxNumVehicles: number;
}
