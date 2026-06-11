/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildGisTilesetConfigs,
  buildGisTilesetConfigsFromStorage,
  joinS3PathSegments,
  mergeSavedTilesetPreferences,
  normalizeS3EndpointForTiles,
  normalizeSceneUrl,
  normalizeWarehouseGisDatasetPath,
  GIS_SCENE_URL_STORAGE_KEY,
} from "./gisTilesets";

describe("gisTilesets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("builds tileset URLs from endpoint and scene path (default bucket segment)", () => {
    const configs = buildGisTilesetConfigs(
      "http://minio.example.local:9020",
      "gis_samples_v6/tokyo_flat",
    );
    expect(configs).toHaveLength(3);
    const exterior = configs.find((c) => c.id === "gis_exterior");
    expect(exterior?.url).toBe(
      "http://minio.example.local:9020/warehouse/gis_samples_v6/tokyo_flat/viz/tiles/exterior/tileset.json",
    );
    expect(exterior?.name).toBe("Exterior");
    const veg = configs.find((c) => c.id === "gis_vegetation");
    expect(veg?.colorBlendMode).toBe("REPLACE");
  });

  it("does not duplicate viz/tiles when scene_url already includes viz/tiles", () => {
    const fromDatasetRoot = buildGisTilesetConfigs(
      "http://x:1",
      "gis_samples_v6/tokyo_flat",
    );
    const fromTilesFolder = buildGisTilesetConfigs(
      "http://x:1",
      "gis_samples_v6/tokyo_flat/viz/tiles",
    );
    const fromLayerFolder = buildGisTilesetConfigs(
      "http://x:1",
      "gis_samples_v6/tokyo_flat/viz/tiles/exterior",
    );
    expect(fromDatasetRoot[0]?.url).toBe(fromTilesFolder[0]?.url);
    expect(fromDatasetRoot[0]?.url).toBe(fromLayerFolder[0]?.url);
    expect(fromTilesFolder[0]?.url).toBe(
      "http://x:1/warehouse/gis_samples_v6/tokyo_flat/viz/tiles/exterior/tileset.json",
    );
  });

  it("matches MinIO layout: http://host:port/warehouse/dataset/viz/tiles/layer/tileset.json", () => {
    const u = buildGisTilesetConfigs(
      "http://10.152.138.172:9002",
      "gis_samples_v6/tokyo_flat",
    )[0]?.url;
    expect(u).toBe(
      "http://10.152.138.172:9002/warehouse/gis_samples_v6/tokyo_flat/viz/tiles/exterior/tileset.json",
    );
  });

  it("normalizeWarehouseGisDatasetPath strips leading bucket segment and full URL path", () => {
    expect(
      normalizeWarehouseGisDatasetPath(
        "warehouse/gis_samples_v6/tokyo_flat",
        "warehouse",
      ),
    ).toBe("gis_samples_v6/tokyo_flat");
    expect(
      normalizeWarehouseGisDatasetPath(
        "http://10.152.138.172:9002/warehouse/gis_samples_v6/tokyo_flat/viz/tiles/exterior",
        "warehouse",
      ),
    ).toBe("gis_samples_v6/tokyo_flat");
    expect(
      normalizeWarehouseGisDatasetPath(
        "my-bucket/gis_samples_v6/tokyo_flat",
        "my-bucket",
      ),
    ).toBe("gis_samples_v6/tokyo_flat");
  });

  it("joinS3PathSegments avoids duplicate slashes", () => {
    expect(
      joinS3PathSegments("http://h:2/", "warehouse", "a/b", "viz", "tiles"),
    ).toBe("http://h:2/warehouse/a/b/viz/tiles");
  });

  it("normalizes endpoint without scheme and trims slashes", () => {
    expect(normalizeS3EndpointForTiles("10.0.0.1:9000")).toBe(
      "http://10.0.0.1:9000",
    );
    expect(normalizeSceneUrl("/a/b/")).toBe("a/b");
  });

  it("buildGisTilesetConfigsFromStorage returns [] when data missing", () => {
    expect(buildGisTilesetConfigsFromStorage()).toEqual([]);
  });

  it("buildGisTilesetConfigsFromStorage reads minio_settings s3BucketName for URL path", () => {
    localStorage.setItem(
      "minio_settings",
      JSON.stringify({
        s3Endpoint: "http://h:1",
        catalogUri: "",
        s3BucketName: "parquet-export-test",
      }),
    );
    localStorage.setItem(GIS_SCENE_URL_STORAGE_KEY, "scene/path");
    const configs = buildGisTilesetConfigsFromStorage();
    expect(configs[0]?.url).toBe(
      "http://h:1/parquet-export-test/scene/path/viz/tiles/exterior/tileset.json",
    );
  });

  it("buildGisTilesetConfigsFromStorage still builds when s3BucketName is empty", () => {
    localStorage.setItem(
      "minio_settings",
      JSON.stringify({ s3Endpoint: "http://h:1", s3BucketName: "" }),
    );
    localStorage.setItem(GIS_SCENE_URL_STORAGE_KEY, "scene/path");
    const configs = buildGisTilesetConfigsFromStorage();
    expect(configs).toHaveLength(3);
    expect(configs[0]?.url).toContain("/warehouse/scene/path/");
  });

  it("mergeSavedTilesetPreferences restores enabled from saved", () => {
    const built = buildGisTilesetConfigs("http://x", "p");
    const merged = mergeSavedTilesetPreferences(built, [
      { id: "gis_exterior", enabled: false } as any,
    ]);
    expect(merged.find((t) => t.id === "gis_exterior")?.enabled).toBe(false);
    expect(merged.find((t) => t.id === "gis_interior")?.enabled).toBe(true);
  });
});
