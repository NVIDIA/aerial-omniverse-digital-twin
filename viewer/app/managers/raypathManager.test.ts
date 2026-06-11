/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Raypath } from "@/types";
import type { RaypathFilterState } from "@/store/utils/localStorage";

vi.mock("@/store/utils/localStorage", () => ({
  loadRaypathFilters: vi.fn(() => null),
  saveRaypathFilters: vi.fn(),
}));

vi.mock("./dataLoader", () => ({
  fetchFromDataSource: vi.fn(),
}));

function makeRaypath(overrides: Partial<Raypath> = {}): Raypath {
  return {
    time_idx: 0,
    ru_id: 1,
    ue_id: 1,
    points: [
      [0, 0, 0],
      [100, 100, 100],
    ],
    power_dB: -80,
    ...overrides,
  };
}

describe("RaypathManager", () => {
  let RaypathManager: any;
  let manager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get a fresh class (not the singleton)
    const mod = await import("./raypathManager");
    // The module exports a singleton; we need the class.
    // Access via constructor of the singleton.
    RaypathManager = (mod.raypathManager as any).constructor;
    manager = new RaypathManager();
  });

  describe("Initial State", () => {
    it("should start with empty raypaths", () => {
      expect(manager.getAll()).toEqual([]);
      expect(manager.getAllUnfiltered()).toEqual([]);
    });

    it("should have default filter state", () => {
      const filters = manager.getFilters();
      expect(filters.allRuEnabled).toBe(true);
      expect(filters.allUeEnabled).toBe(true);
      expect(filters.enabledRuIds).toEqual([]);
      expect(filters.enabledUeIds).toEqual([]);
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("should notify subscribers when raypaths change via setAll", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const raypaths = [makeRaypath()];
      manager.setAll(raypaths);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(raypaths);
    });

    it("should stop notifying after unsubscribe", () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribe(callback);

      manager.setAll([makeRaypath()]);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      manager.setAll([makeRaypath({ ru_id: 2 })]);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should support multiple subscribers", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      manager.subscribe(cb1);
      manager.subscribe(cb2);

      manager.setAll([makeRaypath()]);

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  describe("subscribeToFilters", () => {
    it("should notify filter subscribers when filter action is invoked", () => {
      const callback = vi.fn();
      manager.subscribeToFilters(callback);

      manager.setAll([makeRaypath({ ru_id: 1 }), makeRaypath({ ru_id: 2 })]);
      manager.setRuFilter(1, false);

      expect(callback).toHaveBeenCalled();
    });

    it("should stop notifying after unsubscribe", () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribeToFilters(callback);

      unsubscribe();
      manager.setAll([makeRaypath({ ru_id: 1 })]);
      manager.setAllRuEnabled(false);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("setAll", () => {
    it("should replace all raypaths", () => {
      const raypaths = [makeRaypath({ ru_id: 1 }), makeRaypath({ ru_id: 2 })];
      manager.setAll(raypaths);

      expect(manager.getAll()).toHaveLength(2);
    });

    it("should extract available RU and UE IDs", () => {
      const raypaths = [
        makeRaypath({ ru_id: 1, ue_id: 10 }),
        makeRaypath({ ru_id: 2, ue_id: 20 }),
        makeRaypath({ ru_id: 1, ue_id: 30 }),
      ];
      manager.setAll(raypaths);

      expect(manager.getAvailableRuIds()).toEqual([1, 2]);
      expect(manager.getAvailableUeIds()).toEqual([10, 20, 30]);
    });

    it("should return available IDs sorted numerically", () => {
      const raypaths = [
        makeRaypath({ ru_id: 5 }),
        makeRaypath({ ru_id: 1 }),
        makeRaypath({ ru_id: 10 }),
      ];
      manager.setAll(raypaths);

      expect(manager.getAvailableRuIds()).toEqual([1, 5, 10]);
    });
  });

  describe("clear", () => {
    it("should remove all raypaths", () => {
      manager.setAll([makeRaypath(), makeRaypath({ ru_id: 2 })]);
      expect(manager.getAll()).toHaveLength(2);

      manager.clear();
      expect(manager.getAll()).toHaveLength(0);
    });

    it("should clear available IDs", () => {
      manager.setAll([makeRaypath({ ru_id: 5, ue_id: 10 })]);
      manager.clear();

      expect(manager.getAvailableRuIds()).toEqual([]);
      expect(manager.getAvailableUeIds()).toEqual([]);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);
      manager.clear();
      expect(callback).toHaveBeenCalled();
    });
  });

  describe("getFilteredRaypaths", () => {
    const raypaths = [
      makeRaypath({ ru_id: 1, ue_id: 10 }),
      makeRaypath({ ru_id: 1, ue_id: 20 }),
      makeRaypath({ ru_id: 2, ue_id: 10 }),
      makeRaypath({ ru_id: 2, ue_id: 20 }),
    ];

    it("should return all raypaths when allRuEnabled and allUeEnabled", () => {
      manager.setAll(raypaths);

      const filtered = manager.getFilteredRaypaths();
      expect(filtered).toHaveLength(4);
    });

    it("should filter by RU ID when individual RU filter is set", () => {
      manager.setAll(raypaths);
      // Transition from allRuEnabled to individual — disable RU 2
      manager.setRuFilter(2, false);

      const filtered = manager.getFilteredRaypaths();
      expect(filtered).toHaveLength(2);
      expect(filtered.every((r: Raypath) => r.ru_id === 1)).toBe(true);
    });

    it("should filter by UE ID when individual UE filter is set", () => {
      manager.setAll(raypaths);
      manager.setUeFilter(20, false);

      const filtered = manager.getFilteredRaypaths();
      expect(filtered).toHaveLength(2);
      expect(filtered.every((r: Raypath) => r.ue_id === 10)).toBe(true);
    });

    it("should combine RU and UE filters", () => {
      manager.setAll(raypaths);
      manager.setRuFilter(2, false);
      manager.setUeFilter(20, false);

      const filtered = manager.getFilteredRaypaths();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].ru_id).toBe(1);
      expect(filtered[0].ue_id).toBe(10);
    });
  });

  describe("setRuFilter", () => {
    it("should populate all RU IDs on first individual filter call", () => {
      manager.setAll([
        makeRaypath({ ru_id: 1 }),
        makeRaypath({ ru_id: 2 }),
        makeRaypath({ ru_id: 3 }),
      ]);

      // First call transitions from allRuEnabled to individual
      manager.setRuFilter(2, false);

      const filters = manager.getFilters();
      expect(filters.allRuEnabled).toBe(false);
      // Should have IDs 1 and 3 (2 was disabled)
      expect(filters.enabledRuIds).toContain(1);
      expect(filters.enabledRuIds).toContain(3);
      expect(filters.enabledRuIds).not.toContain(2);
    });

    it("should enable an RU that was disabled", () => {
      manager.setAll([makeRaypath({ ru_id: 1 }), makeRaypath({ ru_id: 2 })]);

      manager.setRuFilter(2, false);
      manager.setRuFilter(2, true);

      const filters = manager.getFilters();
      expect(filters.enabledRuIds).toContain(2);
    });

    it("should not duplicate IDs when enabling already-enabled RU", () => {
      manager.setAll([makeRaypath({ ru_id: 1 })]);

      manager.setRuFilter(1, false);
      manager.setRuFilter(1, true);
      manager.setRuFilter(1, true); // duplicate enable

      const filters = manager.getFilters();
      const count = filters.enabledRuIds.filter(
        (id: number) => id === 1,
      ).length;
      expect(count).toBe(1);
    });
  });

  describe("setUeFilter", () => {
    it("should populate all UE IDs on first individual filter call", () => {
      manager.setAll([makeRaypath({ ue_id: 10 }), makeRaypath({ ue_id: 20 })]);

      manager.setUeFilter(10, false);

      const filters = manager.getFilters();
      expect(filters.allUeEnabled).toBe(false);
      expect(filters.enabledUeIds).not.toContain(10);
      expect(filters.enabledUeIds).toContain(20);
    });
  });

  describe("setAllRuEnabled / setAllUeEnabled", () => {
    it("should enable all RUs and populate with available IDs", () => {
      manager.setAll([makeRaypath({ ru_id: 1 }), makeRaypath({ ru_id: 2 })]);

      manager.setAllRuEnabled(false);
      expect(manager.getFilters().enabledRuIds).toEqual([]);

      manager.setAllRuEnabled(true);
      const filters = manager.getFilters();
      expect(filters.allRuEnabled).toBe(true);
      expect(filters.enabledRuIds.sort()).toEqual([1, 2]);
    });

    it("should disable all UEs and clear IDs", () => {
      manager.setAll([makeRaypath({ ue_id: 10 }), makeRaypath({ ue_id: 20 })]);

      manager.setAllUeEnabled(false);
      const filters = manager.getFilters();
      expect(filters.allUeEnabled).toBe(false);
      expect(filters.enabledUeIds).toEqual([]);
    });
  });

  describe("isRuEnabled / isUeEnabled", () => {
    it("should return true for all IDs when allRuEnabled is true", () => {
      manager.setAll([makeRaypath({ ru_id: 1 })]);
      expect(manager.isRuEnabled(1)).toBe(true);
      expect(manager.isRuEnabled(999)).toBe(true); // allRuEnabled ignores the ID
    });

    it("should check enabledRuIds when allRuEnabled is false", () => {
      manager.setAll([makeRaypath({ ru_id: 1 }), makeRaypath({ ru_id: 2 })]);

      manager.setRuFilter(2, false);

      expect(manager.isRuEnabled(1)).toBe(true);
      expect(manager.isRuEnabled(2)).toBe(false);
    });

    it("should return true for all IDs when allUeEnabled is true", () => {
      expect(manager.isUeEnabled(42)).toBe(true);
    });

    it("should check enabledUeIds when allUeEnabled is false", () => {
      manager.setAll([makeRaypath({ ue_id: 10 }), makeRaypath({ ue_id: 20 })]);

      manager.setUeFilter(10, false);

      expect(manager.isUeEnabled(10)).toBe(false);
      expect(manager.isUeEnabled(20)).toBe(true);
    });
  });

  describe("getFilters returns a copy", () => {
    it("should return a new object reference on each call", () => {
      const filters1 = manager.getFilters();
      const filters2 = manager.getFilters();
      expect(filters1).not.toBe(filters2);
    });

    it("should not allow mutation of top-level boolean fields", () => {
      const filters = manager.getFilters();
      filters.allRuEnabled = false;

      const internal = manager.getFilters();
      expect(internal.allRuEnabled).toBe(true);
    });
  });

  describe("load", () => {
    it("should handle MinIO load errors", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      vi.mocked(fetchFromDataSource).mockResolvedValue({
        error: "Not connected",
        data: [],
      });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await manager.load("test_db");

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should handle empty MinIO data", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [],
      });

      await manager.load("test_db");
      expect(manager.getAll()).toHaveLength(0);
    });

    it("should process Iceberg format raypaths from MinIO", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            time_idx: 0,
            ru_id: 1,
            ue_id: 1,
            points: [
              { "1": 100, "2": 200, "3": 300 },
              { "1": 400, "2": 500, "3": 600 },
            ],
            power_dB: -70,
          },
        ],
      });

      await manager.load("test_db");

      expect(manager.getAll()).toHaveLength(1);
      const ray = manager.getAll()[0];
      expect(ray.points).toEqual([
        [100, 200, 300],
        [400, 500, 600],
      ]);
    });

    it("should filter out raypaths with fewer than 2 points", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // First row must have 2+ struct points for Iceberg format detection
      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            time_idx: 0,
            ru_id: 2,
            ue_id: 1,
            points: [
              { "1": 100, "2": 200, "3": 300 },
              { "1": 400, "2": 500, "3": 600 },
            ],
            power_dB: -60,
          },
          {
            time_idx: 0,
            ru_id: 1,
            ue_id: 1,
            points: [{ "1": 100, "2": 200, "3": 300 }],
            power_dB: -70,
          },
        ],
      });

      await manager.load("test_db");

      expect(manager.getAll()).toHaveLength(1);
      expect(manager.getAll()[0].ru_id).toBe(2);
      warnSpy.mockRestore();
    });

    it("should compute power_dB from amplitudes when not provided", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");
      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            time_idx: 0,
            ru_id: 1,
            ue_id: 1,
            points: [
              { "1": 0, "2": 0, "3": 0 },
              { "1": 1, "2": 1, "3": 1 },
            ],
            ampl_re: [1.0],
            ampl_im: [0.0],
          },
        ],
      });

      await manager.load("test_db");
      const ray = manager.getAll()[0];
      // power = 10 * log10(1^2 + 0^2) = 0 dB
      expect(ray.power_dB).toBeCloseTo(0, 1);
    });
  });
});
