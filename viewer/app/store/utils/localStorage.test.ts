/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for localStorage utilities
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveCameraState,
  loadCameraState,
  saveLayerVisibility,
  loadLayerVisibility,
  saveToolButtonStates,
  loadToolButtonStates,
  saveActiveTab,
  loadActiveTab,
  saveScenarioRayVisualization,
  loadScenarioRayVisualization,
  saveTilesetConfigs,
  loadTilesetConfigs,
  saveRaypathFilters,
  loadRaypathFilters,
  saveBaseLayerId,
  loadBaseLayerId,
} from "./localStorage";

describe("localStorage utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("Camera State", () => {
    it("should return null when no camera state is saved", () => {
      const state = loadCameraState();
      expect(state).toBeNull();
    });

    it("should load saved camera state", () => {
      const mockState = {
        position: { longitude: 139.7437, latitude: 35.6624, height: 1000 },
        orientation: { heading: 0, pitch: -0.5, roll: 0 },
      };

      localStorage.setItem("cesium_camera_state", JSON.stringify(mockState));

      const loaded = loadCameraState();
      expect(loaded).toEqual(mockState);
    });
  });

  describe("Layer Visibility", () => {
    it("should save and load layer visibility", () => {
      const visibility = {
        rayPathsVisible: true,
        tilesetsVisible: false,
      };

      saveLayerVisibility(visibility);
      const loaded = loadLayerVisibility();

      expect(loaded).toEqual(visibility);
    });

    it("should return null when no visibility is saved", () => {
      const visibility = loadLayerVisibility();
      expect(visibility).toBeNull();
    });

    it("should handle partial visibility state", () => {
      const partial = {
        rayPathsVisible: false,
      };

      saveLayerVisibility(partial as any);
      const loaded = loadLayerVisibility();

      expect(loaded).toHaveProperty("rayPathsVisible", false);
    });
  });

  describe("Tool Button States", () => {
    it("should save and load tool button states", () => {
      const states = {
        selectToolEnabled: false,
      };

      saveToolButtonStates(states);
      const loaded = loadToolButtonStates();

      expect(loaded).toEqual(states);
    });

    it("should return null when no states are saved", () => {
      const states = loadToolButtonStates();
      expect(states).toBeNull();
    });
  });

  describe("Active Tab", () => {
    it("should save and load active tab", () => {
      saveActiveTab("Entities");
      const loaded = loadActiveTab();

      expect(loaded).toBe("Entities");
    });

    it("should handle Settings tab", () => {
      saveActiveTab("Settings");
      const loaded = loadActiveTab();

      expect(loaded).toBe("Settings");
    });

    it("should handle Rays tab", () => {
      saveActiveTab("Rays");
      const loaded = loadActiveTab();

      expect(loaded).toBe("Rays");
    });

    it("should treat saved Scenario as Rays (backward compatibility)", () => {
      localStorage.setItem("active_right_tab", "Scenario");
      const loaded = loadActiveTab();

      expect(loaded).toBe("Rays");
    });

    it("should return null when no tab is saved", () => {
      const tab = loadActiveTab();
      expect(tab).toBeNull();
    });

    it("should return null for invalid tab value", () => {
      localStorage.setItem("active_right_tab", "InvalidTab");
      const tab = loadActiveTab();

      expect(tab).toBeNull();
    });
  });

  describe("Scenario Ray Visualization", () => {
    it("should save and load ray visualization params", () => {
      const params = {
        raysSparsity: 2,
        maxVisibleRayPaths: 20,
        maxDynamicRangeDB: 100,
      };
      saveScenarioRayVisualization(params);
      const loaded = loadScenarioRayVisualization();
      expect(loaded).toEqual(params);
    });

    it("should return null when nothing is saved", () => {
      const loaded = loadScenarioRayVisualization();
      expect(loaded).toBeNull();
    });

    it("should ignore invalid or out-of-range values", () => {
      localStorage.setItem(
        "scenario_ray_visualization",
        JSON.stringify({
          raysSparsity: 0,
          maxVisibleRayPaths: -1,
          maxDynamicRangeDB: "not a number",
        }),
      );
      const loaded = loadScenarioRayVisualization();
      expect(loaded).toBeNull();
    });

    it("should load partial valid state", () => {
      saveScenarioRayVisualization({
        raysSparsity: 5,
        maxVisibleRayPaths: 10,
        maxDynamicRangeDB: 150,
      });
      localStorage.setItem(
        "scenario_ray_visualization",
        JSON.stringify({
          raysSparsity: 3,
          maxVisibleRayPaths: "invalid",
          maxDynamicRangeDB: 200,
        }),
      );
      const loaded = loadScenarioRayVisualization();
      expect(loaded).toEqual({
        raysSparsity: 3,
        maxDynamicRangeDB: 200,
      });
    });
  });

  describe("Tileset Configs", () => {
    it("should save and load tileset configs", () => {
      const tilesets = [
        {
          id: "tileset1",
          name: "Test Tileset",
          url: "/test/tileset.json",
          enabled: true,
          priority: 1,
          loadedBounds: { test: "value" }, // Should be excluded
        },
        {
          id: "tileset2",
          name: "Another Tileset",
          ionAssetId: 12345,
          enabled: false,
          priority: 2,
        },
      ];

      saveTilesetConfigs(tilesets as any);
      const loaded = loadTilesetConfigs();

      expect(loaded).toBeDefined();
      expect(loaded).toHaveLength(2);
      expect(loaded![0].id).toBe("tileset1");
      expect(loaded![0]).not.toHaveProperty("loadedBounds");
    });

    it("should return null when no configs are saved", () => {
      const configs = loadTilesetConfigs();
      expect(configs).toBeNull();
    });
  });

  describe("Raypath Filters", () => {
    it("should save and load raypath filters for specific database", () => {
      const filters = {
        enabledRuIds: [1, 2, 3],
        enabledUeIds: [10, 20],
        allRuEnabled: false,
        allUeEnabled: true,
      };

      saveRaypathFilters("test_db", filters);
      const loaded = loadRaypathFilters("test_db");

      expect(loaded).toEqual(filters);
    });

    it("should return null when no filters are saved", () => {
      const filters = loadRaypathFilters("test_db");
      expect(filters).toBeNull();
    });

    it("should keep filters separate per database", () => {
      const filters1 = {
        enabledRuIds: [1, 2],
        enabledUeIds: [],
        allRuEnabled: true,
        allUeEnabled: true,
      };
      const filters2 = {
        enabledRuIds: [3, 4],
        enabledUeIds: [5],
        allRuEnabled: false,
        allUeEnabled: false,
      };

      saveRaypathFilters("db1", filters1);
      saveRaypathFilters("db2", filters2);

      const loaded1 = loadRaypathFilters("db1");
      const loaded2 = loadRaypathFilters("db2");

      expect(loaded1).toEqual(filters1);
      expect(loaded2).toEqual(filters2);
    });

    it("should save and load with empty database using default key", () => {
      const filters = {
        enabledRuIds: [1],
        enabledUeIds: [2],
        allRuEnabled: false,
        allUeEnabled: false,
      };
      saveRaypathFilters("", filters);
      const loaded = loadRaypathFilters("");
      expect(loaded).toEqual(filters);
    });
  });

  describe("Base Layer", () => {
    it("should save and load base layer ID", () => {
      saveBaseLayerId("osm");
      const loaded = loadBaseLayerId();

      expect(loaded).toBe("osm");
    });

    it("should return null when no base layer is saved", () => {
      const id = loadBaseLayerId();
      expect(id).toBeNull();
    });

    it("should handle various layer IDs", () => {
      const ids = ["bing_aerial", "osm", "cesium_ion", "custom_layer"];

      ids.forEach((id) => {
        saveBaseLayerId(id);
        const loaded = loadBaseLayerId();
        expect(loaded).toBe(id);
      });
    });

    it("should not throw when saveBaseLayerId and localStorage.setItem throws", () => {
      const origSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = vi.fn(() => {
        throw new Error("Quota exceeded");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      saveBaseLayerId("osm");
      expect(warn).toHaveBeenCalled();
      localStorage.setItem = origSetItem;
      warn.mockRestore();
    });

    it("should return null when loadBaseLayerId and localStorage throws", () => {
      const origGetItem = localStorage.getItem.bind(localStorage);
      localStorage.getItem = vi.fn(() => {
        throw new Error("Storage unavailable");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const id = loadBaseLayerId();
      expect(id).toBeNull();
      expect(warn).toHaveBeenCalled();
      localStorage.getItem = origGetItem;
      warn.mockRestore();
    });
  });

  describe("Raypath Filters error paths", () => {
    it("should return null and warn when loadRaypathFilters JSON.parse throws", () => {
      localStorage.setItem("raypath_filters_test_db", "invalid json {{{");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const loaded = loadRaypathFilters("test_db");
      expect(loaded).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
