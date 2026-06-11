/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for distributedUnitManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DistributedUnitManager } from "./distributedUnitManager";
import type { DistributedUnit } from "@/types";

// Mock dependencies
vi.mock("./dataLoader", () => ({
  fetchFromDataSource: vi.fn(),
}));

vi.mock("@/services/cesium", () => ({
  localToCartographic: vi.fn(() => ({
    longitude: 0,
    latitude: 0,
    height: 0,
  })),
}));

describe("DistributedUnitManager", () => {
  let manager: DistributedUnitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DistributedUnitManager();
  });

  describe("Initial State", () => {
    it("should start with empty map", () => {
      expect(manager.getAll().size).toBe(0);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent id", () => {
      expect(manager.get(999)).toBeUndefined();
    });

    it("should return distributed unit for existing id", () => {
      const du: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      const duMap = new Map<number, DistributedUnit>();
      duMap.set(1, du);
      manager.setAll(duMap);

      expect(manager.get(1)).toEqual(du);
    });
  });

  describe("add", () => {
    it("should add a distributed unit", () => {
      const du: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      manager.add(du);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toEqual(du);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const du: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      manager.add(du);

      expect(callback).toHaveBeenCalledWith(manager.getAll());
    });
  });

  describe("remove", () => {
    it("should remove a distributed unit", () => {
      const du: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      manager.add(du);
      manager.remove(1);

      expect(manager.getAll().size).toBe(0);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      const du: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      manager.add(du);
      manager.subscribe(callback);
      manager.remove(1);

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update a distributed unit", () => {
      const du: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      manager.add(du);
      manager.update(1, { numAntennas: 8, fftSize: 4096 });

      const updated = manager.get(1);
      expect(updated?.numAntennas).toBe(8);
      expect(updated?.fftSize).toBe(4096);
    });

    it("should not update non-existent distributed unit", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      manager.update(999, { numAntennas: 8 });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("setAll", () => {
    it("should replace all distributed units", () => {
      const du1: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      const du2: DistributedUnit = { ...du1, id: 2 };

      manager.add(du1);

      const newMap = new Map<number, DistributedUnit>();
      newMap.set(2, du2);

      manager.setAll(newMap);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeUndefined();
      expect(manager.get(2)).toEqual(du2);
    });
  });

  describe("clear", () => {
    it("should clear all distributed units", () => {
      const du: DistributedUnit = {
        id: 1,
        position: { cartographic: {} as any, terrainHeight: 0 },
        subcarrierSpacing: 30000,
        fftSize: 2048,
        numAntennas: 4,
        maxChannelBandwidth: 100000000,
      };

      manager.add(du);
      manager.clear();

      expect(manager.getAll().size).toBe(0);
    });
  });

  describe("subscribe", () => {
    it("should return unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribe(callback);

      manager.clear();
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      manager.clear();

      // Should not be called again after unsubscribe
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("load", () => {
    it("should load distributed units from database", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            id: 1,
            position: [100, 200, 300],
            subcarrier_spacing: 30000,
            fft_size: 2048,
            num_antennas: 4,
            max_channel_bandwidth: 100000000,
          },
        ],
        rows: 1,
      });

      await manager.load("test_db");

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeDefined();
    });

    it("should handle query errors", async () => {
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

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [],
        rows: 0,
      });

      await manager.load("test_db");

      expect(manager.getAll().size).toBe(0);
    });

    it("should handle exceptions", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      vi.mocked(fetchFromDataSource).mockRejectedValue(
        new Error("Network error"),
      );

      await manager.load("test_db");

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("Singleton instance", () => {
    it("should export a singleton instance", async () => {
      const { distributedUnitManager } =
        await import("./distributedUnitManager");

      expect(distributedUnitManager).toBeInstanceOf(DistributedUnitManager);
    });
  });
});
