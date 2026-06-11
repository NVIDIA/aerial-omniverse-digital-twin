/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for radioUnitManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { RadioUnitManager } from "./radioUnitManager";
import type { RadioUnit } from "@/types";

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

describe("RadioUnitManager", () => {
  let manager: RadioUnitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new RadioUnitManager();
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

    it("should return radio unit for existing id", () => {
      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);
      expect(manager.get(1)).toEqual(ru);
    });
  });

  describe("add", () => {
    it("should add a radio unit", () => {
      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toEqual(ru);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);

      expect(callback).toHaveBeenCalledWith(manager.getAll());
    });
  });

  describe("remove", () => {
    it("should remove a radio unit", () => {
      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);
      manager.remove(1);

      expect(manager.getAll().size).toBe(0);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);
      manager.subscribe(callback);
      manager.remove(1);

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update a radio unit", () => {
      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);
      manager.update(1, { height: 20, radiatedPower: 30 });

      const updated = manager.get(1);
      expect(updated?.height).toBe(20);
      expect(updated?.radiatedPower).toBe(30);
    });

    it("should not update non-existent radio unit", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      manager.update(999, { height: 20 });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("setAll", () => {
    it("should replace all radio units", () => {
      const ru1: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      const ru2: RadioUnit = { ...ru1, id: 2 };

      manager.add(ru1);

      const newMap = new Map<number, RadioUnit>();
      newMap.set(2, ru2);

      manager.setAll(newMap);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeUndefined();
      expect(manager.get(2)).toEqual(ru2);
    });
  });

  describe("clear", () => {
    it("should clear all radio units", () => {
      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);
      manager.clear();

      expect(manager.getAll().size).toBe(0);
    });
  });

  describe("subscribe", () => {
    it("should return unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribe(callback);

      const ru: RadioUnit = {
        id: 1,
        position: {
          cartographic: {} as any,
          terrainHeight: 0,
        },
        orientation: {} as any,
        cellId: 1,
        duId: 1,
        duManualAssign: true,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      };

      manager.add(ru);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      manager.add({ ...ru, id: 2 });

      // Should not be called again after unsubscribe
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("load", () => {
    it("should load radio units from database", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            id: 1,
            position: [100, 200, 300],
            height: 10,
            mech_azimuth: 45,
            mech_tilt: -5,
            panel: ["panel_01"],
            radiated_power: 20,
            du_id: 1,
            du_manual_assign: false,
          },
        ],
        rows: 1,
      });

      await manager.load("test_db");

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeDefined();
    });

    it("should resolve panel by DB index via panelManager.getByIndex and populate carrierFreqMHz", async () => {
      const { panelManager } = await import("./panelManager");
      const { fetchFromDataSource } = await import("./dataLoader");

      // Simulate panelManager.load() — panels with non-sequential IDs (3, 5)
      vi.mocked(fetchFromDataSource).mockResolvedValueOnce({
        data: [
          {
            panel_name: "panel_03",
            name: "panel_03",
            antenna_names: ["infinitesimal_dipole"],
            frequencies: [3600000000],
            reference_freq: 3600000000,
            dual_polarized: true,
            num_loc_antenna_horz: 1,
            num_loc_antenna_vert: 2,
            antenna_spacing_horz: 4.16,
            antenna_spacing_vert: 4.16,
            antenna_roll_angle_first_polz: -0.7853982,
            antenna_roll_angle_second_polz: 0.7853982,
          },
          {
            panel_name: "panel_05",
            name: "panel_05",
            antenna_names: ["threeGPP_38901"],
            frequencies: [3600000000],
            reference_freq: 3600000000,
            dual_polarized: true,
            num_loc_antenna_horz: 8,
            num_loc_antenna_vert: 4,
            antenna_spacing_horz: 4.16,
            antenna_spacing_vert: 4.16,
            antenna_roll_angle_first_polz: 0,
            antenna_roll_angle_second_polz: 1.5707964,
          },
        ],
        rows: 2,
      });
      await panelManager.load("test_db");

      // RU panel indices: 0 → panel_03, 1 → panel_05
      vi.mocked(fetchFromDataSource).mockResolvedValueOnce({
        data: [
          {
            id: 1,
            position: [100, 200, 0],
            height: 10,
            mech_azimuth: 0,
            mech_tilt: 0,
            panel: [0],
            radiated_power: 20,
            du_id: 1,
            du_manual_assign: true,
          },
          {
            id: 2,
            position: [300, 400, 0],
            height: 15,
            mech_azimuth: 90,
            mech_tilt: -5,
            panel: [1],
            radiated_power: 30,
            du_id: 1,
            du_manual_assign: true,
          },
        ],
        rows: 2,
      });

      await manager.load("test_db");

      const ru1 = manager.get(1)!;
      expect(ru1.panelType).toBe("panel_03");
      expect(ru1.carrierFreqMHz).toBe(3600);

      const ru2 = manager.get(2)!;
      expect(ru2.panelType).toBe("panel_05");
      expect(ru2.carrierFreqMHz).toBe(3600);

      panelManager.clear();
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
  });
});
