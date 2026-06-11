/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for userEquipmentManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { UserEquipmentManager } from "./userEquipmentManager";
import type { UserEquipment } from "@/types";

// Mock dependencies
vi.mock("./dataLoader", () => ({
  fetchFromDataSource: vi.fn(),
}));

vi.mock("@/services/database", () => ({
  minioClient: {
    hasCatalog: () => false,
    getCurrentDatabase: () => "",
    getTablesFromCatalog: vi.fn(async () => []),
  },
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

describe("UserEquipmentManager", () => {
  let manager: UserEquipmentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new UserEquipmentManager();
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

    it("should return user equipment for existing id", () => {
      const ue: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      const ueMap = new Map<number, UserEquipment>();
      ueMap.set(1, ue);
      manager.setAll(ueMap);

      expect(manager.get(1)).toEqual(ue);
    });
  });

  describe("add", () => {
    it("should add a user equipment", () => {
      const ue: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      manager.add(ue);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toEqual(ue);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const ue: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      manager.add(ue);

      expect(callback).toHaveBeenCalledWith(manager.getAll());
    });
  });

  describe("remove", () => {
    it("should remove a user equipment", () => {
      const ue: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      manager.add(ue);
      manager.remove(1);

      expect(manager.getAll().size).toBe(0);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      const ue: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      manager.add(ue);
      manager.subscribe(callback);
      manager.remove(1);

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update a user equipment", () => {
      const ue: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      manager.add(ue);
      manager.update(1, { height: 2.0, radiatedPower: 30 });

      const updated = manager.get(1);
      expect(updated?.height).toBe(2.0);
      expect(updated?.radiatedPower).toBe(30);
    });

    it("should not update non-existent user equipment", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      manager.update(999, { height: 2.0 });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("setAll", () => {
    it("should replace all user equipments", () => {
      const ue1: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      const ue2: UserEquipment = { ...ue1, id: 2 };

      manager.add(ue1);

      const newMap = new Map<number, UserEquipment>();
      newMap.set(2, ue2);

      manager.setAll(newMap);

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeUndefined();
      expect(manager.get(2)).toEqual(ue2);
    });
  });

  describe("clear", () => {
    it("should clear all user equipments", () => {
      const ue: UserEquipment = {
        id: 1,
        isManual: false,
        isManualMobility: false,
        isIndoorMobility: false,
        radiatedPower: 20,
        height: 1.5,
        mechTilt: 0,
        panel: [0],
        positions: [],
        waypoints: [],
      };

      manager.add(ue);
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
    it("should load user equipments from database", async () => {
      const { fetchFromDataSource } = await import("./dataLoader");

      vi.mocked(fetchFromDataSource).mockResolvedValue({
        data: [
          {
            id: 1,
            is_manual: false,
            is_manual_mobility: false,
            is_indoor_mobility: false,
            radiated_power: 20,
            height: 1.5,
            mech_tilt: 0,
            panel: ["panel_01"],
            batch_indices: [0],
            route_positions: [[[100, 200, 300]]],
          },
        ],
        rows: 1,
      });

      await manager.load("test_db");

      expect(manager.getAll().size).toBe(1);
      expect(manager.get(1)).toBeDefined();
      expect(manager.get(1)?.positions[0].position.cartographic.height).toBe(3);
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
      const { userEquipmentManager } = await import("./userEquipmentManager");

      expect(userEquipmentManager).toBeInstanceOf(UserEquipmentManager);
    });
  });
});
