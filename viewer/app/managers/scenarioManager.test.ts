/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for scenarioManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ScenarioManager } from "./scenarioManager";

vi.mock("./dataLoader", () => ({
  fetchFromDataSource: vi.fn(),
}));

const defaultScenarioParams = {
  raysSparsity: 1,
  maxVisibleRayPaths: 10,
  maxDynamicRangeDB: 200,
};

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: {
    getState: vi.fn(() => ({
      updateScenarioParams: vi.fn(),
      dataSourceType: "minio",
      scenarioParams: {
        raysSparsity: 1,
        maxVisibleRayPaths: 10,
        maxDynamicRangeDB: 200,
      },
    })),
  },
}));

describe("ScenarioManager", () => {
  let manager: ScenarioManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ScenarioManager();
  });

  describe("getCurrentParams", () => {
    it("should return null initially", () => {
      expect(manager.getCurrentParams()).toBeNull();
    });
  });

  describe("load", () => {
    it("should load scenario parameters from database", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const { useViewerStore } = await import("@/store/viewerStore");
      const mockUpdateParams = vi.fn();

      useViewerStore.getState.mockReturnValue({
        updateScenarioParams: mockUpdateParams,
        scenarioParams: defaultScenarioParams,
      });

      const mockData = {
        uePanelType: "panel_01",
        ruPanelType: "panel_02",
        emittedRays: 5,
        rayBounces: 10,
        maxPathsPerAntPair: 500,
        duration: 2.5,
        interval: 0.5,
        enableWidebandCFRs: 1,
        simulateRAN: 0,
      };

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [mockData],
        rows: 1,
      });

      await manager.load("test_db");

      expect(fetchFromDataSource).toHaveBeenCalledWith("scenario", "test_db");
      expect(mockUpdateParams).toHaveBeenCalled();
    });

    it("should handle query errors gracefully", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [],
        rows: 0,
        error: "Query failed",
      });

      await manager.load("test_db");

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should handle empty results", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [],
        rows: 0,
      });

      await manager.load("test_db");

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it("should map database values to ScenarioParams correctly", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const { useViewerStore } = await import("@/store/viewerStore");
      const mockUpdate = vi.fn();
      useViewerStore.getState.mockReturnValue({
        updateScenarioParams: mockUpdate,
        scenarioParams: defaultScenarioParams,
      });

      const mockData = {
        uePanelType: "panel_01",
        ruPanelType: "panel_02",
        emittedRays: 5,
        rayBounces: 10,
        maxPathsPerAntPair: 500,
        raysSparsity: 2,
        batches: 3,
        slotsPerBatch: 0,
        samplesPerSlot: 1,
        duration: 2.5,
        interval: 0.5,
        enableWidebandCFRs: true,
        numProceduralUEs: 100,
        ueHeight: 1.5,
        ueMinSpeed: 1.0,
        ueMaxSpeed: 3.0,
        enableSeededMobility: false,
        mobilitySeed: 42,
        simulateRAN: true,
        emDiffuseType: "Lambertian",
        receptionSphereRadius: 2.0,
        percIndoorProceduralUEs: 0.5,
      };

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [mockData],
        rows: 1,
      });

      await manager.load("test_db");

      const calledWith = mockUpdate.mock.calls[0][0];
      expect(calledWith).toBeDefined();
      expect(calledWith.uePanelType).toBe("panel_01");
      expect(calledWith.emittedRays).toBe(5);
      expect(calledWith.duration).toBe(2.5);
      expect(calledWith.simulationMode).toBe("Duration");
    });

    it("should handle numeric values correctly", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const { useViewerStore } = await import("@/store/viewerStore");
      const mockUpdate = vi.fn();
      useViewerStore.getState.mockReturnValue({
        updateScenarioParams: mockUpdate,
        scenarioParams: defaultScenarioParams,
      });

      const mockData = {
        emittedRays: 0,
        raysSparsity: 0,
        batches: 0,
      };

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [mockData],
        rows: 1,
      });

      await manager.load("test_db");

      const calledWith = mockUpdate.mock.calls[0][0];
      expect(calledWith.raysSparsity).toBe(1);
      expect(calledWith.batches).toBe(1);
    });

    it("should handle boolean conversions", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const { useViewerStore } = await import("@/store/viewerStore");
      const mockUpdate = vi.fn();
      useViewerStore.getState.mockReturnValue({
        updateScenarioParams: mockUpdate,
        scenarioParams: defaultScenarioParams,
      });

      const mockData = {
        enableWidebandCFRs: 1,
        simulateRAN: 0,
      };

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [mockData],
        rows: 1,
      });

      await manager.load("test_db");

      const calledWith = mockUpdate.mock.calls[0][0];
      expect(calledWith.enableWidebandCFRs).toBe(true);
      expect(calledWith.simulateRAN).toBe(false);
    });

    it("should preserve ray visualization params from store (not from DB row)", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const { useViewerStore } = await import("@/store/viewerStore");
      const mockUpdate = vi.fn();
      useViewerStore.getState.mockReturnValue({
        updateScenarioParams: mockUpdate,
        scenarioParams: {
          raysSparsity: 2,
          maxVisibleRayPaths: 20,
          maxDynamicRangeDB: 100,
        },
      });

      const mockData = {
        uePanelType: "panel_01",
        raysSparsity: 99,
        maxPathsPerAntPair: 500,
      };

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [mockData],
        rows: 1,
      });

      await manager.load("test_db");

      const calledWith = mockUpdate.mock.calls[0][0];
      expect(calledWith.raysSparsity).toBe(2);
      expect(calledWith.maxVisibleRayPaths).toBe(20);
      expect(calledWith.maxDynamicRangeDB).toBe(100);
    });
  });
});
