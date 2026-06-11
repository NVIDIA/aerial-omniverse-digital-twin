/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build 3D Tiles layer URLs from MinIO/S3 endpoint + GIS scene path (YML gis.scene.scene_url).
 */
import type { TilesetConfig } from "@/types";

export const GIS_SCENE_URL_STORAGE_KEY = "gis_scene_url";

/** Subfolders under .../viz/tiles/ that each contain tileset.json */
export const GIS_TILESET_SUBFOLDERS = [
  "exterior",
  "interior",
  "vegetation",
] as const;

/** Fallback first path segment when MinIO “S3 bucket name” / YAML bucket is empty. */
export const DEFAULT_S3_WAREHOUSE_SEGMENT = "warehouse";

const MINIO_SETTINGS_KEY = "minio_settings";

export function normalizeS3EndpointForTiles(endpoint: string): string {
  let e = endpoint.trim();
  if (e && !/^https?:\/\//i.test(e)) {
    e = `http://${e}`;
  }
  return e.replace(/\/+$/, "");
}

export function normalizeSceneUrl(scene: string): string {
  return scene.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Join URL path segments with single slashes (no duplicate slashes).
 * Base should be an origin with optional path, without trailing slash, e.g. http://host:9002
 */
export function joinS3PathSegments(
  base: string,
  ...segments: string[]
): string {
  const b = base.replace(/\/+$/, "");
  const rest = segments
    .map((s) => String(s).replace(/^\/+|\/+$/g, ""))
    .filter((s) => s.length > 0)
    .join("/");
  return rest ? `${b}/${rest}` : b;
}

/**
 * GIS YML may set scene_url to either the dataset root (…/tokyo_flat) or under
 * …/viz/tiles or …/viz/tiles/exterior. Normalize to the dataset root so we build
 * …/dataset/viz/tiles/layer/tileset.json exactly once.
 */
export function normalizeSceneToDatasetRoot(sceneUrl: string): string {
  let s = normalizeSceneUrl(sceneUrl);
  const v = "/viz/tiles";
  const i = s.indexOf(v);
  if (i !== -1) {
    s = s.slice(0, i);
  }
  return s.replace(/\/+$/, "");
}

/**
 * Dataset path for MinIO object keys: &lt;bucket&gt;/&lt;dataset&gt;/viz/tiles/…
 * Strips a leading `&lt;bucket&gt;/` if the user pasted a full key, and extracts the path from a full URL.
 */
export function normalizeWarehouseGisDatasetPath(
  sceneUrl: string,
  bucketSegment: string,
): string {
  const seg = bucketSegment.trim() || DEFAULT_S3_WAREHOUSE_SEGMENT;
  const segLower = seg.toLowerCase();
  let s = sceneUrl.trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname.replace(/^\/+/, "");
    } catch {
      s = normalizeSceneUrl(s);
    }
  } else {
    s = normalizeSceneUrl(s);
  }
  const firstSlash = s.indexOf("/");
  if (firstSlash !== -1) {
    const first = s.slice(0, firstSlash);
    if (first.toLowerCase() === segLower) {
      s = s.slice(firstSlash + 1);
    }
  } else if (s.toLowerCase() === segLower) {
    s = "";
  }
  return normalizeSceneToDatasetRoot(s);
}

/** e.g. ground_plane -> "Ground plane" */
export function formatGisFolderLabel(folder: string): string {
  return folder
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const VEGETATION_STYLE: TilesetConfig["style"] = {
  color: {
    conditions: [
      ["${mesh_part} === 'trunk'", "color('#7a4f3b')"],
      ["${mesh_part} === 'canopyCylinder'", "color('#44a13f')"],
      ["true", "color('white')"],
    ],
  },
};

export function buildGisTilesetConfigs(
  s3Endpoint: string,
  sceneUrl: string,
  s3BucketSegment?: string,
): TilesetConfig[] {
  const bucketSeg = s3BucketSegment?.trim() || DEFAULT_S3_WAREHOUSE_SEGMENT;
  const endpoint = normalizeS3EndpointForTiles(s3Endpoint);
  const datasetRoot = normalizeWarehouseGisDatasetPath(sceneUrl, bucketSeg);
  const tilesBase = joinS3PathSegments(
    endpoint,
    bucketSeg,
    datasetRoot,
    "viz",
    "tiles",
  );
  return GIS_TILESET_SUBFOLDERS.map((folder, index) => {
    const config: TilesetConfig = {
      id: `gis_${folder}`,
      name: formatGisFolderLabel(folder),
      url: joinS3PathSegments(tilesBase, folder, "tileset.json"),
      enabled: true,
      priority: GIS_TILESET_SUBFOLDERS.length - index,
    };
    if (folder === "vegetation") {
      config.selectable = false;
      config.colorBlendMode = "REPLACE";
      config.style = VEGETATION_STYLE;
    }
    return config;
  });
}

export function mergeSavedTilesetPreferences(
  built: TilesetConfig[],
  saved: TilesetConfig[] | null | undefined,
): TilesetConfig[] {
  if (!saved?.length) return built;
  return built.map((t) => {
    const s = saved.find((x) => x.id === t.id);
    if (!s) return t;
    return {
      ...t,
      enabled: s.enabled ?? t.enabled,
      priority: s.priority ?? t.priority,
    };
  });
}

/**
 * Reads minio_settings (s3Endpoint, s3BucketName) and gis_scene_url from localStorage.
 * Legacy key `warehouse` is still read. Tile URLs use …/&lt;bucket&gt;/&lt;dataset&gt;/viz/tiles/…
 */
export function buildGisTilesetConfigsFromStorage(): TilesetConfig[] {
  if (typeof window === "undefined") return [];

  let endpoint = "";
  let sceneUrl = "";
  let s3BucketSegment = "";
  try {
    const raw = localStorage.getItem(MINIO_SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as {
        s3Endpoint?: string;
        s3BucketName?: string;
        warehouse?: string;
      };
      if (typeof p.s3Endpoint === "string") endpoint = p.s3Endpoint;
      const bucket =
        (typeof p.s3BucketName === "string" ? p.s3BucketName : "") ||
        (typeof p.warehouse === "string" ? p.warehouse : "");
      s3BucketSegment = bucket;
    }
    const scene = localStorage.getItem(GIS_SCENE_URL_STORAGE_KEY);
    if (scene) sceneUrl = scene;
  } catch {
    return [];
  }

  if (!endpoint.trim() || !sceneUrl.trim()) return [];

  return buildGisTilesetConfigs(endpoint, sceneUrl, s3BucketSegment);
}
