/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for viewerStore (loadSavedState, getTerrainProvider)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useViewerStore,
  getTerrainProvider,
  __resetTilesetsRestoredForTesting,
  type ViewerState,
} from "./viewerStore";

// Mock localStorage helpers so we control what loadSavedState reads
vi.mock("./utils/localStorage", () => ({
  loadLayerVisibility: vi.fn(),
  loadToolButtonStates: vi.fn(),
  loadActiveTab: vi.fn(),
  loadTilesetConfigs: vi.fn(),
  loadBaseLayerId: vi.fn(),
  loadScenarioRayVisualization: vi.fn(),
  saveScenarioRayVisualization: vi.fn(),
  saveTilesetConfigs: vi.fn(),
}));

vi.mock("@/constants/baseLayers", () => ({
  DEFAULT_BASE_LAYER_ID: "osm",
}));

import {
  loadLayerVisibility,
  loadToolButtonStates,
  loadActiveTab,
  loadTilesetConfigs,
  loadBaseLayerId,
  loadScenarioRayVisualization,
} from "./utils/localStorage";

describe("viewerStore", () => {
  beforeEach(() => {
    __resetTilesetsRestoredForTesting();
    localStorage.clear();
    useViewerStore.setState({ tilesets: [] });
    vi.mocked(loadLayerVisibility).mockReturnValue(null);
    vi.mocked(loadToolButtonStates).mockReturnValue(null);
    vi.mocked(loadActiveTab).mockReturnValue(null);
    vi.mocked(loadTilesetConfigs).mockReturnValue(null);
    vi.mocked(loadBaseLayerId).mockReturnValue(null);
    vi.mocked(loadScenarioRayVisualization).mockReturnValue(null);
  });

  describe("loadSavedState", () => {
    it("should apply saved layer visibility when present", () => {
      vi.mocked(loadLayerVisibility).mockReturnValue({
        rayPathsVisible: false,
        tilesetsVisible: false,
      });
      useViewerStore.getState().loadSavedState();
      expect(useViewerStore.getState().rayPathsVisible).toBe(false);
      expect(useViewerStore.getState().tilesetsVisible).toBe(false);
    });

    it("should apply saved tool button states when present", () => {
      vi.mocked(loadToolButtonStates).mockReturnValue({
        selectToolEnabled: false,
      });
      useViewerStore.getState().loadSavedState();
      expect(useViewerStore.getState().selectToolEnabled).toBe(false);
    });

    it("should apply saved active tab when present", () => {
      vi.mocked(loadActiveTab).mockReturnValue("Settings");
      useViewerStore.getState().loadSavedState();
      expect(useViewerStore.getState().activeRightTab).toBe("Settings");
    });

    it("should merge saved tileset configs with GIS-built tilesets", () => {
      localStorage.setItem(
        "minio_settings",
        JSON.stringify({
          s3Endpoint: "http://example.com:9000",
          catalogUri: "",
          s3BucketName: "warehouse",
          s3Provider: "minio",
        }),
      );
      localStorage.setItem("gis_scene_url", "gis_samples_v6/tokyo_flat");
      vi.mocked(loadTilesetConfigs).mockReturnValue([
        { id: "gis_exterior", enabled: false } as any,
      ]);
      useViewerStore.getState().loadSavedState();
      const tilesets = useViewerStore.getState().tilesets;
      const exterior = tilesets.find((t) => t.id === "gis_exterior");
      expect(exterior?.enabled).toBe(false);
      expect(exterior?.url).toContain("example.com:9000");
      expect(exterior?.url).toContain(
        "/warehouse/gis_samples_v6/tokyo_flat/viz/tiles/exterior/",
      );
    });

    it("should set baseLayerId from saved value when present", () => {
      vi.mocked(loadBaseLayerId).mockReturnValue("osm");
      useViewerStore.getState().loadSavedState();
      expect(useViewerStore.getState().baseLayerId).toBe("osm");
    });

    it("should set baseLayerId to DEFAULT_BASE_LAYER_ID when no saved value", () => {
      vi.mocked(loadBaseLayerId).mockReturnValue(null);
      useViewerStore.getState().loadSavedState();
      expect(useViewerStore.getState().baseLayerId).toBe("osm");
    });

    it("should apply saved scenario ray visualization params when present", () => {
      vi.mocked(loadScenarioRayVisualization).mockReturnValue({
        raysSparsity: 2,
        maxVisibleRayPaths: 20,
        maxDynamicRangeDB: 100,
      });
      useViewerStore.getState().loadSavedState();
      const { scenarioParams } = useViewerStore.getState();
      expect(scenarioParams.raysSparsity).toBe(2);
      expect(scenarioParams.maxVisibleRayPaths).toBe(20);
      expect(scenarioParams.maxDynamicRangeDB).toBe(100);
    });

    it("should not overwrite scenario params when no ray viz saved", () => {
      const before = useViewerStore.getState().scenarioParams;
      vi.mocked(loadScenarioRayVisualization).mockReturnValue(null);
      useViewerStore.getState().loadSavedState();
      const after = useViewerStore.getState().scenarioParams;
      expect(after.raysSparsity).toBe(before.raysSparsity);
      expect(after.maxVisibleRayPaths).toBe(before.maxVisibleRayPaths);
      expect(after.maxDynamicRangeDB).toBe(before.maxDynamicRangeDB);
    });

    it("should merge partial saved ray viz with existing scenario params", () => {
      vi.mocked(loadScenarioRayVisualization).mockReturnValue({
        raysSparsity: 5,
      });
      useViewerStore.getState().loadSavedState();
      const { scenarioParams } = useViewerStore.getState();
      expect(scenarioParams.raysSparsity).toBe(5);
      expect(scenarioParams.maxVisibleRayPaths).toBeDefined();
      expect(scenarioParams.maxDynamicRangeDB).toBeDefined();
    });
  });

  describe("getTerrainProvider", () => {
    it("should return undefined when no Cesium viewer", () => {
      expect(getTerrainProvider()).toBeUndefined();
    });

    it("should return terrainProvider when viewer is set", () => {
      const mockTerrain = { type: "mock-terrain" };
      useViewerStore.getState().setCesiumViewer({
        terrainProvider: mockTerrain,
      } as any);
      expect(getTerrainProvider()).toBe(mockTerrain);
      useViewerStore.getState().setCesiumViewer(null);
    });
  });
});
