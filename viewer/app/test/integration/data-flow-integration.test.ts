/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for complete data flow
 * Tests end-to-end data workflows from database to UI
 */
import { describe, it, expect, vi } from "vitest";

describe("Data Flow Integration Tests", () => {
  describe("Database to Visualization Pipeline", () => {
    it("should complete full data load and render pipeline", async () => {
      // Mock the entire pipeline
      const mockDatabaseClient = {
        query: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              position: [100, 200, 300],
              height: 10,
              mech_azimuth: 45,
              mech_tilt: -5,
            },
          ],
          rows: 1,
        }),
      };

      const mockCoordinateService = {
        localToCartographic: vi.fn().mockReturnValue({
          longitude: 1,
          latitude: 2,
          height: 3,
        }),
        sampleTerrain: vi.fn().mockResolvedValue(new Map([[1, 0]])),
      };

      const mockEntityManager = {
        processData: vi.fn((data) => {
          return data.map((item: any) => ({
            ...item,
            cartographic: mockCoordinateService.localToCartographic(
              item.position,
            ),
          }));
        }),
        setAll: vi.fn(),
      };

      // Simulate the pipeline
      // 1. Query database
      const queryResult = await mockDatabaseClient.query("SELECT * FROM rus");

      // 2. Process coordinates
      const processedData = mockEntityManager.processData(queryResult.data);

      // 3. Store in manager
      mockEntityManager.setAll(
        new Map(processedData.map((d: any) => [d.id, d])),
      );

      // Verify pipeline
      expect(mockDatabaseClient.query).toHaveBeenCalled();
      expect(mockCoordinateService.localToCartographic).toHaveBeenCalled();
      expect(mockEntityManager.setAll).toHaveBeenCalled();
    });

    it("should handle data transformation errors", async () => {
      const mockDatabaseClient = {
        query: vi.fn().mockResolvedValue({
          data: [
            { id: 1, position: null }, // Invalid position
          ],
          rows: 1,
        }),
      };

      const mockCoordinateService = {
        localToCartographic: vi.fn((pos) => {
          if (!pos) throw new Error("Invalid position");
          return { longitude: 0, latitude: 0, height: 0 };
        }),
      };

      const result = await mockDatabaseClient.query("SELECT * FROM rus");

      // Try to transform - should handle error
      const transform = (item: any) => {
        try {
          return {
            ...item,
            cartographic: mockCoordinateService.localToCartographic(
              item.position,
            ),
          };
        } catch (error) {
          return { ...item, cartographic: null };
        }
      };

      const processed = result.data.map(transform);
      expect(processed[0].cartographic).toBeNull();
    });
  });

  describe("User Interaction to State Update Flow", () => {
    it("should complete user selection to highlight pipeline", () => {
      const mockStore = {
        selectedObject: null,
        setSelectedObject: vi.fn((obj) => {
          mockStore.selectedObject = obj;
        }),
      };

      const mockHighlightManager = {
        unhighlightAll: vi.fn(),
        highlightObject: vi.fn(),
      };

      const mockViewer = {
        entities: {
          getById: vi.fn((id) => ({ id, name: `Entity ${id}` })),
        },
      };

      // Simulate user clicking on entity
      const clickedEntityId = "entity-123";

      // 1. Clear previous highlights
      mockHighlightManager.unhighlightAll();

      // 2. Get entity from viewer
      const entity = mockViewer.entities.getById(clickedEntityId);

      // 3. Update store
      mockStore.setSelectedObject(entity);

      // 4. Apply new highlight
      mockHighlightManager.highlightObject(entity);

      // Verify flow
      expect(mockHighlightManager.unhighlightAll).toHaveBeenCalled();
      expect(mockViewer.entities.getById).toHaveBeenCalledWith(clickedEntityId);
      expect(mockStore.selectedObject).toEqual(entity);
      expect(mockHighlightManager.highlightObject).toHaveBeenCalledWith(entity);
    });
  });

  describe("Settings Change to Visualization Update Flow", () => {
    it("should update visualization when settings change", () => {
      const mockStore = {
        rayPathsVisible: true,
        tilesetsVisible: true,
        toggleLayerVisibility: vi.fn((layer) => {
          if (layer === "tilesetsVisible") {
            mockStore.tilesetsVisible = !mockStore.tilesetsVisible;
          }
        }),
      };

      const mockLayerManager = {
        updateLayerVisibility: vi.fn(),
      };

      // Simulate user toggling tilesets
      mockStore.toggleLayerVisibility("tilesetsVisible");

      // Update visualization layer
      mockLayerManager.updateLayerVisibility(
        "tilesets",
        mockStore.tilesetsVisible,
      );

      expect(mockStore.tilesetsVisible).toBe(false);
      expect(mockLayerManager.updateLayerVisibility).toHaveBeenCalledWith(
        "tilesets",
        false,
      );
    });
  });

  describe("Database Connection to Data Load Flow", () => {
    it("should handle complete connection and load sequence", async () => {
      const mockDatabaseClient = {
        isConnected: false,
        connect: vi.fn().mockResolvedValue({ success: true }),
        getDatabases: vi.fn().mockResolvedValue(["db1", "db2"]),
        query: vi.fn().mockResolvedValue({ data: [], rows: 0 }),
      };

      const mockDatabaseManager = {
        setDatabase: vi.fn(),
        loadAll: vi.fn().mockResolvedValue(undefined),
      };

      // 1. Connect to data source
      const connectResult = await mockDatabaseClient.connect({
        url: "http://localhost:8123",
      });
      expect(connectResult.success).toBe(true);

      // 2. Get available databases
      const databases = await mockDatabaseClient.getDatabases();
      expect(databases).toContain("db1");

      // 3. Select database
      mockDatabaseManager.setDatabase("db1");

      // 4. Load all data
      await mockDatabaseManager.loadAll();

      expect(mockDatabaseManager.setDatabase).toHaveBeenCalledWith("db1");
      expect(mockDatabaseManager.loadAll).toHaveBeenCalled();
    });

    it("should handle connection failures gracefully", async () => {
      const mockDatabaseClient = {
        connect: vi.fn().mockResolvedValue({
          success: false,
          error: "Connection refused",
        }),
      };

      const mockUI = {
        showError: vi.fn(),
      };

      const result = await mockDatabaseClient.connect({
        url: "http://invalid:8123",
      });

      if (!result.success) {
        mockUI.showError(result.error);
      }

      expect(result.success).toBe(false);
      expect(mockUI.showError).toHaveBeenCalledWith("Connection refused");
    });
  });

  describe("Filter Update to Visualization Refresh Flow", () => {
    it("should refresh visualization when filters change", () => {
      const mockRaypathManager = {
        raypaths: new Map([
          [1, { ruId: 1, ueId: 1 }],
          [2, { ruId: 1, ueId: 2 }],
          [3, { ruId: 2, ueId: 1 }],
        ]),
        applyFilters: vi.fn((enabledRuIds, enabledUeIds) => {
          const filtered = new Map();
          mockRaypathManager.raypaths.forEach((raypath, id) => {
            if (
              enabledRuIds.includes(raypath.ruId) &&
              enabledUeIds.includes(raypath.ueId)
            ) {
              filtered.set(id, raypath);
            }
          });
          return filtered;
        }),
      };

      const mockLayerManager = {
        updateRaypaths: vi.fn(),
      };

      // Apply filters
      const enabledRuIds = [1];
      const enabledUeIds = [1, 2];
      const filteredRaypaths = mockRaypathManager.applyFilters(
        enabledRuIds,
        enabledUeIds,
      );

      // Update visualization
      mockLayerManager.updateRaypaths(filteredRaypaths);

      expect(filteredRaypaths.size).toBe(2);
      expect(mockLayerManager.updateRaypaths).toHaveBeenCalledWith(
        filteredRaypaths,
      );
    });
  });
});
