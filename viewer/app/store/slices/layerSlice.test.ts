/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for layerSlice
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLayerSlice } from "./layerSlice";
import type { LayerSlice } from "./layerSlice";

// Mock localStorage utils
vi.mock("../utils/localStorage", () => ({
  saveLayerVisibility: vi.fn(),
  saveTilesetConfigs: vi.fn(),
  saveBaseLayerId: vi.fn(),
}));

vi.mock("@/constants/baseLayers", () => ({
  DEFAULT_BASE_LAYER_ID: "bing_aerial",
}));

describe("layerSlice", () => {
  let slice: LayerSlice;
  let mockSet: any;
  let mockGet: any;
  let mockStore: any;

  beforeEach(() => {
    mockSet = vi.fn((updates: any) => {
      if (typeof updates === "function") {
        const currentState = mockGet();
        return updates(currentState);
      }
    });
    mockGet = vi.fn(() => ({
      rayPathsVisible: true,
      tilesetsVisible: true,
      tilesets: [
        { id: "tileset1", enabled: true },
        { id: "tileset2", enabled: false },
      ],
    }));
    mockStore = {};

    slice = createLayerSlice(mockSet, mockGet, mockStore);
  });

  describe("Initial State", () => {
    it("should have correct initial values", () => {
      expect(slice.rayPathsVisible).toBe(true);
      expect(slice.tilesetsVisible).toBe(true);
      expect(slice.baseLayerId).toBe("bing_aerial");
      expect(Array.isArray(slice.tilesets)).toBe(true);
    });
  });

  describe("toggleLayerVisibility", () => {
    it("should toggle tilesetsVisible", () => {
      mockGet.mockReturnValue({
        tilesetsVisible: true,
        rayPathsVisible: true,
      });

      slice.toggleLayerVisibility("tilesetsVisible");

      const result = mockSet.mock.calls[0][0](mockGet());
      expect(result.tilesetsVisible).toBe(false);
    });
  });

  describe("toggleRayPathsVisible", () => {
    it("should toggle rayPathsVisible", () => {
      mockGet.mockReturnValue({
        rayPathsVisible: true,
        tilesetsVisible: true,
      });

      slice.toggleRayPathsVisible();

      const result = mockSet.mock.calls[0][0](mockGet());
      expect(result.rayPathsVisible).toBe(false);
    });

    it("should toggle rayPathsVisible from false to true", () => {
      mockGet.mockReturnValue({
        rayPathsVisible: false,
        tilesetsVisible: true,
      });

      slice.toggleRayPathsVisible();

      const result = mockSet.mock.calls[0][0](mockGet());
      expect(result.rayPathsVisible).toBe(true);
    });
  });

  describe("toggleTileset", () => {
    it("should toggle tileset enabled state", () => {
      mockGet.mockReturnValue({
        tilesets: [
          { id: "tileset1", enabled: true },
          { id: "tileset2", enabled: false },
        ],
      });

      slice.toggleTileset("tileset1");

      const result = mockSet.mock.calls[0][0](mockGet());
      expect(result.tilesets[0].enabled).toBe(false);
      expect(result.tilesets[1].enabled).toBe(false);
    });

    it("should only toggle the specified tileset", () => {
      mockGet.mockReturnValue({
        tilesets: [
          { id: "tileset1", enabled: true },
          { id: "tileset2", enabled: false },
        ],
      });

      slice.toggleTileset("tileset2");

      const result = mockSet.mock.calls[0][0](mockGet());
      expect(result.tilesets[0].enabled).toBe(true);
      expect(result.tilesets[1].enabled).toBe(true);
    });
  });

  describe("updateTileset", () => {
    it("should update tileset properties", () => {
      mockGet.mockReturnValue({
        tilesets: [{ id: "tileset1", enabled: true, name: "Old Name" }],
      });

      slice.updateTileset("tileset1", { name: "New Name", enabled: false });

      const result = mockSet.mock.calls[0][0](mockGet());
      expect(result.tilesets[0].name).toBe("New Name");
      expect(result.tilesets[0].enabled).toBe(false);
    });
  });

  describe("setBaseLayer", () => {
    it("should set the base layer ID", () => {
      slice.setBaseLayer("osm");

      const result = mockSet.mock.calls[0][0]();
      expect(result.baseLayerId).toBe("osm");
    });
  });
});
