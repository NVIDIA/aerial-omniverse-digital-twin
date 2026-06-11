/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for panelManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PanelManager } from "./panelManager";
import type { Panel } from "@/types";

vi.mock("./dataLoader", () => ({
  fetchFromDataSource: vi.fn(),
}));

describe("PanelManager", () => {
  let manager: PanelManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PanelManager();
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

    it("should return panel for existing id", () => {
      const mockPanel: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panelMap = new Map<number, Panel>();
      panelMap.set(1, mockPanel);
      manager.setAll(panelMap);

      expect(manager.get(1)).toEqual(mockPanel);
    });
  });

  describe("setAll", () => {
    it("should replace all panels", () => {
      const panel1: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panel2: Panel = { ...panel1, id: 2, name: "Panel 02" };

      const map1 = new Map<number, Panel>();
      map1.set(1, panel1);
      manager.setAll(map1);
      expect(manager.getAll().size).toBe(1);

      const map2 = new Map<number, Panel>();
      map2.set(2, panel2);
      manager.setAll(map2);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeUndefined();
      expect(manager.get(2)).toEqual(panel2);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const panel: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panelMap = new Map<number, Panel>();
      panelMap.set(1, panel);
      manager.setAll(panelMap);

      expect(callback).toHaveBeenCalledWith(manager.getAll());
    });
  });

  describe("clear", () => {
    it("should clear all panels", () => {
      const panel: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panelMap = new Map<number, Panel>();
      panelMap.set(1, panel);
      manager.setAll(panelMap);

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

  describe("update", () => {
    it("should update a panel", () => {
      const panel: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panelMap = new Map<number, Panel>();
      panelMap.set(1, panel);
      manager.setAll(panelMap);

      manager.update(1, { name: "Updated Panel" });

      const updated = manager.get(1);
      expect(updated?.name).toBe("Updated Panel");
      expect(updated?.id).toBe(1);
    });

    it("should not update non-existent panel", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      manager.update(999, { name: "Test" });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[PanelManager] Panel 999 not found",
      );
      consoleWarnSpy.mockRestore();
    });

    it("should notify subscribers on update", () => {
      const panel: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panelMap = new Map<number, Panel>();
      panelMap.set(1, panel);
      manager.setAll(panelMap);

      const callback = vi.fn();
      manager.subscribe(callback);

      manager.update(1, { name: "Updated" });

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("should remove panel by id", () => {
      const panel: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panelMap = new Map<number, Panel>();
      panelMap.set(1, panel);
      manager.setAll(panelMap);

      manager.remove(1);

      expect(manager.getAll().size).toBe(0);
      expect(manager.get(1)).toBeUndefined();
    });

    it("should notify subscribers", () => {
      const panel: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };

      const panelMap = new Map<number, Panel>();
      panelMap.set(1, panel);
      manager.setAll(panelMap);

      const callback = vi.fn();
      manager.subscribe(callback);
      manager.remove(1);

      expect(callback).toHaveBeenCalled();
    });

    it("should leave other panels when removing one", () => {
      const panel1: Panel = {
        id: 1,
        name: "Panel 01",
        antennaNames: ["Antenna1"],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      };
      const panel2: Panel = { ...panel1, id: 2, name: "Panel 02" };
      const panelMap = new Map<number, Panel>();
      panelMap.set(1, panel1);
      panelMap.set(2, panel2);
      manager.setAll(panelMap);

      manager.remove(1);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeUndefined();
      expect(manager.get(2)).toEqual(panel2);
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
    it("should load panels from database", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            panel_name: "Panel_01",
            name: "Panel 01",
            antennaNames: ["Antenna1"],
            frequencies: [28000000000],
            referenceFreq: 28000000000,
            dualPolarized: true,
            numLocAntennaHorz: 4,
            numLocAntennaVert: 4,
            antennaSpacingHorzCm: 50,
            antennaSpacingVertCm: 50,
            antennaRollAngleFirstPolz: 0,
            antennaRollAngleSecondPolz: 90,
          },
        ],
        rows: 1,
      });

      await manager.load("test_db");

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeDefined();
      expect(manager.get(1)?.name).toBe("Panel 01");
      expect(manager.get(1)?.dualPolarized).toBe(2);
    });

    it("should normalize database polarization values to panel state", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        // database panel_id is 0-based
        data: [
          { panel_name: "Panel_01", dual_polarized: true },
          { panel_name: "Panel_02", dual_polarized: 1 },
          { panel_name: "Panel_03", dual_polarized: "2" },
          { panel_name: "Panel_04", dual_polarized: false },
        ],
        rows: 4,
      });

      await manager.load("test_db");

      expect(manager.get(1)?.dualPolarized).toBe(2);
      expect(manager.get(2)?.dualPolarized).toBe(2);
      expect(manager.get(3)?.dualPolarized).toBe(2);
      expect(manager.get(4)?.dualPolarized).toBe(0);
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
      const { panelManager } = await import("./panelManager");

      expect(panelManager).toBeInstanceOf(PanelManager);
    });
  });
});
