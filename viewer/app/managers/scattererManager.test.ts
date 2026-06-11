/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for scattererManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ScattererManager } from "./scattererManager";
import type { Scatterer } from "@/types";

vi.mock("./dataLoader", () => ({
  fetchFromDataSource: vi.fn(),
}));

vi.mock("@/services/cesium", () => ({
  localToCartographicBatched: vi.fn((positions: number[][]) =>
    positions.map((pos) => ({
      longitude: 0,
      latitude: 0,
      height: pos[2] / 100,
    })),
  ),
}));

describe("ScattererManager", () => {
  let manager: ScattererManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ScattererManager();
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

    it("should return scatterer for existing id", () => {
      const scatterer: Scatterer = {
        id: 1,
        isIndoor: false,
        positions: [],
        orientations: [],
      };

      const scattererMap = new Map<number, Scatterer>();
      scattererMap.set(1, scatterer);
      manager.setAll(scattererMap);

      expect(manager.get(1)).toEqual(scatterer);
    });
  });

  describe("setAll", () => {
    it("should replace all scatterers", () => {
      const scatterer1: Scatterer = {
        id: 1,
        isIndoor: false,
        positions: [],
        orientations: [],
      };
      const scatterer2: Scatterer = { ...scatterer1, id: 2 };

      const map1 = new Map<number, Scatterer>();
      map1.set(1, scatterer1);
      manager.setAll(map1);
      expect(manager.getAll().size).toBe(1);

      const map2 = new Map<number, Scatterer>();
      map2.set(2, scatterer2);
      manager.setAll(map2);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeUndefined();
      expect(manager.get(2)).toEqual(scatterer2);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const scatterer: Scatterer = {
        id: 1,
        isIndoor: false,
        positions: [],
        orientations: [],
      };

      const scattererMap = new Map<number, Scatterer>();
      scattererMap.set(1, scatterer);
      manager.setAll(scattererMap);

      expect(callback).toHaveBeenCalledWith(manager.getAll());
    });
  });

  describe("clear", () => {
    it("should clear all scatterers", () => {
      const scatterer: Scatterer = {
        id: 1,
        isIndoor: false,
        positions: [],
        orientations: [],
      };

      const scattererMap = new Map<number, Scatterer>();
      scattererMap.set(1, scatterer);
      manager.setAll(scattererMap);

      manager.clear();
      expect(manager.getAll().size).toBe(0);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      manager.clear();

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("should remove scatterer by id", () => {
      const scatterer: Scatterer = {
        id: 1,
        isIndoor: false,
        positions: [],
        orientations: [],
      };

      const scattererMap = new Map<number, Scatterer>();
      scattererMap.set(1, scatterer);
      manager.setAll(scattererMap);

      manager.remove(1);

      expect(manager.getAll().size).toBe(0);
      expect(manager.get(1)).toBeUndefined();
    });

    it("should notify subscribers", () => {
      const scatterer: Scatterer = {
        id: 1,
        isIndoor: false,
        positions: [],
        orientations: [],
      };

      const scattererMap = new Map<number, Scatterer>();
      scattererMap.set(1, scatterer);
      manager.setAll(scattererMap);

      const callback = vi.fn();
      manager.subscribe(callback);
      manager.remove(1);

      expect(callback).toHaveBeenCalled();
    });

    it("should leave other scatterers when removing one", () => {
      const scatterer1: Scatterer = {
        id: 1,
        isIndoor: false,
        positions: [],
        orientations: [],
      };
      const scatterer2: Scatterer = { ...scatterer1, id: 2 };
      const scattererMap = new Map<number, Scatterer>();
      scattererMap.set(1, scatterer1);
      scattererMap.set(2, scatterer2);
      manager.setAll(scattererMap);

      manager.remove(1);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeUndefined();
      expect(manager.get(2)).toEqual(scatterer2);
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
    it("should load scatterers from database", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            id: 1,
            is_indoor_mobility: false,
            batch_indices: [0],
            route_positions: [[[100, 200, 300]]],
            route_orientations: [[[0, 0, 45]]],
            route_speeds: [[1.5]],
            route_times: [[0.0]],
          },
        ],
        rows: 1,
      });

      await manager.load("test_db");

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeDefined();
      expect(manager.get(1)?.positions[0].position.terrainHeight).toBe(0);
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
      const { scattererManager } = await import("./scattererManager");

      expect(scattererManager).toBeInstanceOf(ScattererManager);
    });
  });
});
