/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for baseLayers constants
 */
import { describe, it, expect } from "vitest";
import {
  BASE_LAYERS,
  DEFAULT_BASE_LAYER_ID,
  getBaseLayerById,
  type BaseLayerConfig,
} from "./baseLayers";

describe("baseLayers", () => {
  describe("BASE_LAYERS", () => {
    it("should be a non-empty array", () => {
      expect(Array.isArray(BASE_LAYERS)).toBe(true);
      expect(BASE_LAYERS.length).toBeGreaterThan(0);
    });

    it("should include sentinel2, carto-dark, carto-light, carto-voyager, osm", () => {
      const ids = BASE_LAYERS.map((l) => l.id);
      expect(ids).toContain("sentinel2");
      expect(ids).toContain("carto-dark");
      expect(ids).toContain("carto-light");
      expect(ids).toContain("carto-voyager");
      expect(ids).toContain("osm");
    });

    it("each layer should have required BaseLayerConfig fields", () => {
      BASE_LAYERS.forEach((layer: BaseLayerConfig) => {
        expect(layer).toHaveProperty("id");
        expect(layer).toHaveProperty("name");
        expect(layer).toHaveProperty("type");
        expect(layer).toHaveProperty("url");
        expect(layer).toHaveProperty("credit");
        expect(layer).toHaveProperty("maximumLevel");
        expect(["wmts", "url", "osm"]).toContain(layer.type);
      });
    });
  });

  describe("DEFAULT_BASE_LAYER_ID", () => {
    it("should default to osm", () => {
      expect(DEFAULT_BASE_LAYER_ID).toBe("osm");
    });
  });

  describe("getBaseLayerById", () => {
    it("should return config for valid id", () => {
      const layer = getBaseLayerById("sentinel2");
      expect(layer).toBeDefined();
      expect(layer?.id).toBe("sentinel2");
      expect(layer?.name).toBe("Sentinel-2 Satellite");
    });

    it("should return config for osm", () => {
      const layer = getBaseLayerById("osm");
      expect(layer).toBeDefined();
      expect(layer?.id).toBe("osm");
    });

    it("should return undefined for unknown id", () => {
      expect(getBaseLayerById("unknown")).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(getBaseLayerById("")).toBeUndefined();
    });
  });
});
