/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for scenarioSlice
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createScenarioSlice } from "./scenarioSlice";
import type { ScenarioSlice } from "./scenarioSlice";

describe("scenarioSlice", () => {
  let slice: ScenarioSlice;
  let mockSet: any;
  let mockGet: any;
  let mockStore: any;

  beforeEach(() => {
    mockSet = vi.fn((updates: any) => {
      if (typeof updates === "function") {
        const currentState = mockGet();
        return updates(currentState);
      }
    });
    mockGet = vi.fn(() => ({
      scenarioParams: slice?.scenarioParams || {},
    }));
    mockStore = {};

    slice = createScenarioSlice(mockSet, mockGet, mockStore);
  });

  describe("Initial State", () => {
    it("should have default scenario parameters", () => {
      expect(slice.scenarioParams).toBeDefined();
      expect(slice.scenarioParams.uePanelType).toBe("panel_01");
      expect(slice.scenarioParams.ruPanelType).toBe("panel_02");
      expect(slice.scenarioParams.simulateRAN).toBe(false);
      expect(slice.scenarioParams.duration).toBe(1.0);
      expect(slice.scenarioParams.rayBounces).toBe(5);
    });

    it("should have correct simulation defaults", () => {
      expect(slice.scenarioParams.simulationMode).toBe("Duration");
      expect(slice.scenarioParams.interval).toBe(1.0);
      expect(slice.scenarioParams.batches).toBe(1);
      expect(slice.scenarioParams.slotsPerBatch).toBe(1);
      expect(slice.scenarioParams.samplesPerSlot).toBe(1);
    });

    it("should have correct ray tracing defaults", () => {
      expect(slice.scenarioParams.emDiffuseType).toBe("Lambertian");
      expect(slice.scenarioParams.enableWidebandCFRs).toBe(true);
      expect(slice.scenarioParams.emittedRays).toBe(1);
      expect(slice.scenarioParams.maxPathsPerAntPair).toBe(500);
    });

    it("should have correct UE defaults", () => {
      expect(slice.scenarioParams.ueHeight).toBe(1.5);
      expect(slice.scenarioParams.ueRadius).toBe(0.5);
      expect(slice.scenarioParams.ueMaxSpeed).toBe(2.5);
      expect(slice.scenarioParams.ueMinSpeed).toBe(1.5);
    });

    it("should have correct visualization defaults", () => {
      expect(slice.scenarioParams.enableTemperatureColor).toBe(false);
      expect(slice.scenarioParams.maxDynamicRangeDB).toBe(200);
      expect(slice.scenarioParams.maxVisibleRayPaths).toBe(10);
      expect(slice.scenarioParams.raysWidth).toBe(20.0);
    });
  });

  describe("updateScenarioParams", () => {
    it("should update single parameter", () => {
      const initialParams = { ...slice.scenarioParams };
      slice.updateScenarioParams({ duration: 2.5 });

      const result = mockSet.mock.calls[0][0]({
        scenarioParams: initialParams,
      });
      expect(result.scenarioParams.duration).toBe(2.5);
      expect(result.scenarioParams.interval).toBe(1.0); // Should remain unchanged
    });

    it("should update multiple parameters", () => {
      const initialParams = { ...slice.scenarioParams };
      slice.updateScenarioParams({
        duration: 3.0,
        interval: 0.5,
        rayBounces: 10,
      });

      const result = mockSet.mock.calls[0][0]({
        scenarioParams: initialParams,
      });
      expect(result.scenarioParams.duration).toBe(3.0);
      expect(result.scenarioParams.interval).toBe(0.5);
      expect(result.scenarioParams.rayBounces).toBe(10);
    });

    it("should preserve other parameters when updating", () => {
      const initialParams = { ...slice.scenarioParams };
      slice.updateScenarioParams({ simulateRAN: true });

      const result = mockSet.mock.calls[0][0]({
        scenarioParams: initialParams,
      });
      expect(result.scenarioParams.simulateRAN).toBe(true);
      expect(result.scenarioParams.uePanelType).toBe("panel_01");
      expect(result.scenarioParams.duration).toBe(1.0);
    });

    it("should handle boolean parameters", () => {
      const initialParams = { ...slice.scenarioParams };
      slice.updateScenarioParams({
        enableDynamicScattering: true,
        enableSeededMobility: true,
      });

      const result = mockSet.mock.calls[0][0]({
        scenarioParams: initialParams,
      });
      expect(result.scenarioParams.enableDynamicScattering).toBe(true);
      expect(result.scenarioParams.enableSeededMobility).toBe(true);
    });

    it("should handle numeric parameters", () => {
      const initialParams = { ...slice.scenarioParams };
      slice.updateScenarioParams({
        maxNumVehicles: 100,
        numProceduralUEs: 50,
      });

      const result = mockSet.mock.calls[0][0]({
        scenarioParams: initialParams,
      });
      expect(result.scenarioParams.maxNumVehicles).toBe(100);
      expect(result.scenarioParams.numProceduralUEs).toBe(50);
    });
  });
});
