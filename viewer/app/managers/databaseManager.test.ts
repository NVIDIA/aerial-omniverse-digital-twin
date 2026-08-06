/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for databaseManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseManager } from "./databaseManager";
import { minioClient } from "@/services/database";

// Mock dependencies
vi.mock("./radioUnitManager", () => ({
  radioUnitManager: {
    load: vi.fn(),
  },
}));

vi.mock("./distributedUnitManager", () => ({
  distributedUnitManager: {
    load: vi.fn(),
  },
}));

vi.mock("./scattererManager", () => ({
  scattererManager: {
    load: vi.fn(),
  },
}));

vi.mock("./userEquipmentManager", () => ({
  userEquipmentManager: {
    load: vi.fn(),
  },
}));

vi.mock("./raypathManager", () => ({
  raypathManager: {
    load: vi.fn(async () => 1),
    clear: vi.fn(),
    getAll: vi.fn(() => []),
    setAll: vi.fn(),
    isBaselineLoadCurrent: vi.fn(() => true),
  },
}));

vi.mock("./panelManager", () => ({
  panelManager: {
    load: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("./layerManager", () => ({
  layerManager: {
    clearAll: vi.fn(),
  },
}));

vi.mock("./scenarioManager", () => ({
  scenarioManager: {
    load: vi.fn(),
  },
}));

vi.mock("@/services/database", () => ({
  minioClient: {
    isConnected: vi.fn(() => false),
    getCurrentDatabase: vi.fn(() => ""),
  },
}));

const mockSetYmlTimeData = vi.fn();
const mockTriggerTimelineRefresh = vi.fn();

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: {
    getState: vi.fn(() => ({
      cesiumViewer: { test: "viewer" },
      dataSourceType: "minio",
      setYmlTimeData: mockSetYmlTimeData,
      triggerTimelineRefresh: mockTriggerTimelineRefresh,
      scenarioParams: {
        maxVisibleRayPaths: 500,
        raysSparsity: 1,
      },
    })),
  },
}));

describe("DatabaseManager", () => {
  let manager: DatabaseManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DatabaseManager();
  });

  describe("setDatabase", () => {
    it("should set the database", () => {
      vi.mocked(minioClient.isConnected).mockReturnValue(true);
      manager.setDatabase("test_db");
      expect(manager.isReady()).toBe(true);
      vi.mocked(minioClient.isConnected).mockReturnValue(false);
    });
  });

  describe("isReady", () => {
    it("should return false when database is not set", () => {
      expect(manager.isReady()).toBe(false);
    });

    it("should return true when viewer is set and MinIO is connected", () => {
      manager.setDatabase("test_db");
      vi.mocked(minioClient.isConnected).mockReturnValue(true);
      expect(manager.isReady()).toBe(true);
      vi.mocked(minioClient.isConnected).mockReturnValue(false);
    });
  });

  describe("clearAll", () => {
    it("should delegate to layerManager", async () => {
      const { layerManager } = await import("./layerManager");

      manager.clearAll();

      expect(layerManager.clearAll).toHaveBeenCalled();
    });
  });

  describe("load methods", () => {
    beforeEach(() => {
      manager.setDatabase("test_db");
      vi.mocked(minioClient.isConnected).mockReturnValue(true);
    });

    it("should load raypaths", async () => {
      const { raypathManager } = await import("./raypathManager");

      await manager.loadRaypaths();

      expect(raypathManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should load scenario", async () => {
      const { scenarioManager } = await import("./scenarioManager");

      await manager.loadScenario();

      expect(scenarioManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should load radio units", async () => {
      const { radioUnitManager } = await import("./radioUnitManager");

      await manager.loadRadioUnits();

      expect(radioUnitManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should load distributed units", async () => {
      const { distributedUnitManager } =
        await import("./distributedUnitManager");

      await manager.loadDistributedUnits();

      expect(distributedUnitManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should load scatterers", async () => {
      const { scattererManager } = await import("./scattererManager");

      await manager.loadScatterers();

      expect(scattererManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should load user equipments", async () => {
      const { userEquipmentManager } = await import("./userEquipmentManager");

      await manager.loadUserEquipments();

      expect(userEquipmentManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should load panels", async () => {
      const { panelManager } = await import("./panelManager");

      await manager.loadPanels();

      expect(panelManager.load).toHaveBeenCalledWith("test_db");
    });
  });

  describe("loadAll", () => {
    it("should load all managers in sequence", async () => {
      manager.setDatabase("test_db");
      vi.mocked(minioClient.isConnected).mockReturnValue(true);
      vi.mocked(minioClient.getCurrentDatabase).mockReturnValue("test_db");

      const { scenarioManager } = await import("./scenarioManager");
      const { panelManager } = await import("./panelManager");
      const { radioUnitManager } = await import("./radioUnitManager");
      const { distributedUnitManager } =
        await import("./distributedUnitManager");
      const { scattererManager } = await import("./scattererManager");
      const { userEquipmentManager } = await import("./userEquipmentManager");
      const { raypathManager } = await import("./raypathManager");

      await manager.loadAll();

      expect(scenarioManager.load).toHaveBeenCalledWith("test_db");
      expect(panelManager.load).toHaveBeenCalledWith("test_db");
      expect(radioUnitManager.load).toHaveBeenCalledWith("test_db");
      expect(distributedUnitManager.load).toHaveBeenCalledWith("test_db");
      expect(scattererManager.load).toHaveBeenCalledWith("test_db");
      expect(userEquipmentManager.load).toHaveBeenCalledWith("test_db");
      expect(raypathManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should refresh the timeline before starting raypath load", async () => {
      manager.setDatabase("test_db");
      vi.mocked(minioClient.isConnected).mockReturnValue(true);
      mockTriggerTimelineRefresh.mockClear();

      const { raypathManager } = await import("./raypathManager");
      const order: string[] = [];
      mockTriggerTimelineRefresh.mockImplementation(() => {
        order.push("timeline");
      });
      vi.mocked(raypathManager.load).mockImplementation(async () => {
        order.push("rays");
      });

      await manager.loadAll();
      await Promise.resolve();

      expect(mockTriggerTimelineRefresh).toHaveBeenCalled();
      expect(raypathManager.load).toHaveBeenCalled();
      expect(order[0]).toBe("timeline");
    });

    it("should retry on failure", async () => {
      manager.setDatabase("test_db");
      vi.mocked(minioClient.isConnected).mockReturnValue(true);

      const { scenarioManager } = await import("./scenarioManager");
      scenarioManager.load
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(undefined);

      await manager.loadAll();

      expect(scenarioManager.load).toHaveBeenCalledTimes(2);
    });
  });
});
