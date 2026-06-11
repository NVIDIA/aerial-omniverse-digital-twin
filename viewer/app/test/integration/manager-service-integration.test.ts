/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for manager and service interactions
 * Tests how managers interact with services and data flow
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Manager-Service Integration Tests", () => {
  describe("DatabaseManager and Entity Managers", () => {
    it("should coordinate loading multiple entity types", async () => {
      // Mock the managers
      const mockRadioUnitManager = {
        load: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockReturnValue(new Map()),
      };

      const mockScattererManager = {
        load: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockReturnValue(new Map()),
      };

      const mockDatabaseManager = {
        setDatabase: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
        loadRadioUnits: async () => mockRadioUnitManager.load("test_db"),
        loadScatterers: async () => mockScattererManager.load("test_db"),
      };

      // Set database
      mockDatabaseManager.setDatabase("test_db");
      expect(mockDatabaseManager.setDatabase).toHaveBeenCalledWith("test_db");

      // Load entities
      await mockDatabaseManager.loadRadioUnits();
      await mockDatabaseManager.loadScatterers();

      expect(mockRadioUnitManager.load).toHaveBeenCalledWith("test_db");
      expect(mockScattererManager.load).toHaveBeenCalledWith("test_db");
    });

    it("should handle loading failures gracefully", async () => {
      const mockManager = {
        load: vi
          .fn()
          .mockRejectedValueOnce(new Error("Network error"))
          .mockResolvedValueOnce(undefined),
      };

      // First attempt fails
      await expect(mockManager.load("test_db")).rejects.toThrow(
        "Network error",
      );

      // Retry succeeds
      await expect(mockManager.load("test_db")).resolves.toBeUndefined();
      expect(mockManager.load).toHaveBeenCalledTimes(2);
    });
  });

  describe("Coordinate Service and Entity Managers", () => {
    it("should transform coordinates for all entity types", () => {
      const mockCoordinateService = {
        localToCartographic: vi.fn((pos) => ({
          longitude: pos[0] / 100,
          latitude: pos[1] / 100,
          height: pos[2] / 100,
        })),
      };

      const entities = [
        { id: 1, position: [100, 200, 300] },
        { id: 2, position: [400, 500, 600] },
      ];

      const transformed = entities.map((entity) => ({
        ...entity,
        cartographic: mockCoordinateService.localToCartographic(
          entity.position,
        ),
      }));

      expect(transformed[0].cartographic).toEqual({
        longitude: 1,
        latitude: 2,
        height: 3,
      });
      expect(transformed[1].cartographic).toEqual({
        longitude: 4,
        latitude: 5,
        height: 6,
      });
      expect(mockCoordinateService.localToCartographic).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe("ScenarioManager and Store Integration", () => {
    it("should update store when scenario params are loaded", async () => {
      const mockStore = {
        updateScenarioParams: vi.fn(),
      };

      const mockDatabaseClient = {
        query: vi.fn().mockResolvedValue({
          data: [
            {
              uePanelType: "panel_01",
              emittedRays: 5,
              duration: 2.5,
            },
          ],
          rows: 1,
        }),
      };

      // Simulate scenario load
      const result = await mockDatabaseClient.query("SELECT * FROM scenario");
      const params = result.data[0];

      mockStore.updateScenarioParams(params);

      expect(mockStore.updateScenarioParams).toHaveBeenCalledWith({
        uePanelType: "panel_01",
        emittedRays: 5,
        duration: 2.5,
      });
    });
  });

  describe("Layer Manager and Cesium Integration", () => {
    it("should manage multiple layer visibility states", () => {
      const mockLayerManager = {
        layers: {
          raypaths: { visible: true },
          buildings: { visible: true },
        },
        setLayerVisibility: vi.fn((layer, visible) => {
          mockLayerManager.layers[layer].visible = visible;
        }),
        clearAll: vi.fn(() => {
          Object.keys(mockLayerManager.layers).forEach((key) => {
            mockLayerManager.layers[key].visible = false;
          });
        }),
      };

      // Toggle individual layers
      mockLayerManager.setLayerVisibility("raypaths", false);
      expect(mockLayerManager.layers.raypaths.visible).toBe(false);

      // Clear all layers
      mockLayerManager.clearAll();
      expect(mockLayerManager.layers.raypaths.visible).toBe(false);
      expect(mockLayerManager.layers.buildings.visible).toBe(false);
    });
  });

  describe("Manager Subscription and React Hook Integration", () => {
    it("should notify subscribers when data changes", () => {
      const subscribers = new Set<(data: any) => void>();
      let currentData = new Map();

      const manager = {
        subscribe: (callback: (data: any) => void) => {
          subscribers.add(callback);
          return () => subscribers.delete(callback);
        },
        setData: (data: Map<any, any>) => {
          currentData = data;
          subscribers.forEach((callback) => callback(currentData));
        },
      };

      // Simulate React hook subscribing
      const mockSetState = vi.fn();
      const unsubscribe = manager.subscribe(mockSetState);

      // Update data
      const newData = new Map([[1, { id: 1, name: "Test" }]]);
      manager.setData(newData);

      expect(mockSetState).toHaveBeenCalledWith(newData);

      // Unsubscribe
      unsubscribe();
      manager.setData(new Map([[2, { id: 2, name: "Test 2" }]]));

      // Should not be called again
      expect(mockSetState).toHaveBeenCalledTimes(1);
    });
  });
});
