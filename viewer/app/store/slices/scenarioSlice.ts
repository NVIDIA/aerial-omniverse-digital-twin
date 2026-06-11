/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scenario slice
 * Manages: network type, scenario name, scenario parameters
 */
import type { ScenarioParams } from "@/types";

export interface ScenarioSlice {
  // State
  scenarioParams: ScenarioParams;

  // Actions
  updateScenarioParams: (params: Partial<ScenarioParams>) => void;
}

export const createScenarioSlice = (
  set: any,
  _get: any,
  _store: any,
): ScenarioSlice => ({
  // Initial state
  scenarioParams: {
    // Default Panels
    uePanelType: "panel_01",
    ruPanelType: "panel_02",

    // Simulation
    simulateRAN: false,
    simulationMode: "Duration",
    duration: 1.0,
    interval: 1.0,
    batches: 1,
    slotsPerBatch: 1,
    samplesPerSlot: 1,

    // Ray Tracing
    emDiffuseType: "Lambertian",
    enableWidebandCFRs: true,
    emittedRays: 1,
    maxPathsPerAntPair: 500,
    rayBounces: 5,

    // Ray Visualization
    enableTemperatureColor: false,
    maxDynamicRangeDB: 200,
    maxVisibleRayPaths: 500,
    raysSparsity: 1,
    raysWidth: 20.0,

    // User Equipments
    enableSeededMobility: false,
    mobilitySeed: 0,
    enableUrbanMobility: false,
    numProceduralUEs: 0,
    percIndoorProceduralUEs: 0.0,
    ueHeight: 1.5,
    ueRadius: 0.5,
    receptionSphereRadius: 2.0,
    ueMaxSpeed: 2.5,
    ueMinSpeed: 1.5,

    // Dynamic Scatterers
    enableDynamicScattering: false,
    maxNumVehicles: 0,
  },

  // Actions
  updateScenarioParams: (params) =>
    set((state: { scenarioParams: ScenarioParams }) => ({
      scenarioParams: { ...state.scenarioParams, ...params },
    })),
});
