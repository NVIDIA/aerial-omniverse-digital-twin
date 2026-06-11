/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cesium Coordinate Conversion Service
 *
 * Local positions are in the producer's projected CRS (typically a UTM zone),
 * so a simple ENU frame at the anchor would introduce a rotational error
 * proportional to the meridian convergence. We project each point with proj4
 * using the scene's actual CRS, falling back to flat-ENU only if the CRS can't
 * be resolved.
 *
 * CRS resolution: WGS84/UTM zones are pre-registered at module load; any other
 * EPSG code lazy-imports `epsg-index/all.json` once per session.
 */
import * as Cesium from "cesium";
import proj4 from "proj4";
import { getTerrainProvider } from "@/store/viewerStore";

// `epsg-index` ships no .d.ts.
declare module "epsg-index/all.json" {
  type EpsgEntry = {
    code: string;
    proj4?: string;
    name?: string;
    wkt?: string;
  };
  const index: Record<string, EpsgEntry>;
  export default index;
}

// Pre-register WGS84/UTM zones (EPSG:32601-32660 N, 32701-32760 S).
// Non-UTM CRSs are resolved lazily from epsg-index in `ensureEpsgRegistered`.
for (let zone = 1; zone <= 60; zone++) {
  const z2 = String(zone).padStart(2, "0");
  proj4.defs(
    `EPSG:326${z2}`,
    `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs +type=crs`,
  );
  proj4.defs(
    `EPSG:327${z2}`,
    `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs +type=crs`,
  );
}

let _epsgAll: Record<string, { proj4?: string }> | null = null;
let _epsgAllLoad: Promise<void> | null = null;

async function loadEpsgAll(): Promise<void> {
  if (_epsgAll) return;
  if (_epsgAllLoad) return _epsgAllLoad;
  _epsgAllLoad = (async () => {
    try {
      const mod = await import("epsg-index/all.json");
      _epsgAll =
        (mod as { default?: Record<string, { proj4?: string }> }).default ??
        (mod as unknown as Record<string, { proj4?: string }>);
    } catch (e) {
      console.warn(
        "[coordinateService] Failed to load epsg-index; non-UTM CRSs will fall back to flat-ENU",
        e,
      );
      _epsgAll = {};
    }
  })();
  return _epsgAllLoad;
}

/** Returns true if `crs` is (or becomes) known to proj4. */
export async function ensureEpsgRegistered(crs: string): Promise<boolean> {
  if ((proj4.defs as (name: string) => unknown)(crs)) return true;

  // Only EPSG:NNNN codes are looked up in epsg-index; raw proj4 strings are
  // handled directly by proj4 in buildProjectionCache.
  const m = /^EPSG:(\d+)$/i.exec(crs.trim());
  if (!m) return false;

  await loadEpsgAll();
  const entry = _epsgAll?.[m[1]];
  if (!entry?.proj4) return false;

  proj4.defs(crs, entry.proj4);
  return true;
}

interface CoordinateConfig {
  centerLat: number;
  centerLng: number;
  /** Projected CRS for local (X, Y); must match `asim:crs` in metadata. */
  crs: string;
  metersPerUnit: number;
}

const DEFAULT_CONFIG: CoordinateConfig = {
  centerLat: 35.662410736083984,
  centerLng: 139.7437744140625,
  crs: "EPSG:32654", // UTM Zone 54N (Tokyo)
  metersPerUnit: 0.01,
};

export let georefConfig: CoordinateConfig = { ...DEFAULT_CONFIG };

// Cached proj4 transformer + anchor projection so we don't rebuild per call.
interface ProjectionCache {
  crs: string;
  centerLat: number;
  centerLng: number;
  anchorX: number;
  anchorY: number;
  // null when we fell back to flat-ENU because proj4 doesn't know the CRS.
  toGeo: proj4.Converter | null;
  fallbackEnuMatrix: Cesium.Matrix4 | null;
}

let _projectionCache: ProjectionCache | null = null;

function buildProjectionCache(): ProjectionCache {
  let anchorX = 0;
  let anchorY = 0;
  let toGeo: proj4.Converter | null = null;
  let fallbackEnuMatrix: Cesium.Matrix4 | null = null;

  // proj4() accepts either a registered name or a raw proj4 string; throws
  // if it can't resolve either.
  let isGeographic = false;
  try {
    const toProj = proj4("EPSG:4326", georefConfig.crs);
    // Reject geographic CRSs (lat/lon in degrees): anchorX/anchorY would
    // be degrees, not meters, so the `anchor + xMeters` math downstream
    // would be nonsense. Local (X, Y) must be in a projected CRS.
    isGeographic = (toProj as any)?.oProj?.projName === "longlat";
    if (!isGeographic) {
      [anchorX, anchorY] = toProj.forward([
        georefConfig.centerLng,
        georefConfig.centerLat,
      ]);
      toGeo = proj4(georefConfig.crs, "EPSG:4326");
    }
  } catch (e) {
    console.warn(
      `[coordinateService] Unknown CRS '${georefConfig.crs}'; falling back to flat-ENU.`,
      e,
    );
    toGeo = null;
  }

  if (isGeographic) {
    throw new Error(
      `[coordinateService] CRS '${georefConfig.crs}' is geographic ` +
        `(lon/lat in degrees); local (X, Y) offsets must be in a projected ` +
        `CRS (meters).`,
    );
  }

  if (!toGeo) {
    const centerCart = Cesium.Cartographic.fromDegrees(
      georefConfig.centerLng,
      georefConfig.centerLat,
      0,
    );
    fallbackEnuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartographic.toCartesian(centerCart),
    );
  }

  return {
    crs: georefConfig.crs,
    centerLat: georefConfig.centerLat,
    centerLng: georefConfig.centerLng,
    anchorX,
    anchorY,
    toGeo,
    fallbackEnuMatrix,
  };
}

function getProjectionCache(): ProjectionCache {
  if (
    _projectionCache &&
    _projectionCache.crs === georefConfig.crs &&
    _projectionCache.centerLat === georefConfig.centerLat &&
    _projectionCache.centerLng === georefConfig.centerLng
  ) {
    return _projectionCache;
  }
  _projectionCache = buildProjectionCache();
  return _projectionCache;
}

/**
 * Update the coordinate configuration. Async so callers can await CRS
 * registration via the lazy epsg-index import; not awaiting is safe but the
 * first frame may render with the previous CRS.
 */
export async function setCoordinateConfig(
  config: Partial<CoordinateConfig>,
): Promise<void> {
  georefConfig = { ...georefConfig, ...config };
  _projectionCache = null;
  if (config.crs) {
    await ensureEpsgRegistered(config.crs);
  }
}

export function resetCoordinateConfig(): void {
  georefConfig = { ...DEFAULT_CONFIG };
  _projectionCache = null;
}

/**
 * Convert lon/lat (degrees) to Cesium Cartographic (radians).
 * Accepts either `{x, y, z}` or `[x, y, z]`; z defaults to 0.
 */
export function degreesToCartographic(
  local: { x: number; y: number; z: number } | [number, number, number] | any,
): Cesium.Cartographic {
  if (Array.isArray(local)) {
    if (local.length < 2) {
      throw new Error(
        `Invalid position array: expected at least [x, y], got ${JSON.stringify(local)}`,
      );
    }
    return new Cesium.Cartographic(
      Cesium.Math.toRadians(local[0]),
      Cesium.Math.toRadians(local[1]),
      local[2] ?? 0,
    );
  }

  if (local.x === undefined || local.y === undefined) {
    throw new Error(
      `Invalid position object: x and y are required. Received: ${JSON.stringify(local)}`,
    );
  }

  return new Cesium.Cartographic(
    Cesium.Math.toRadians(local.x),
    Cesium.Math.toRadians(local.y),
    local.z ?? 0,
  );
}

/** Cartographic (radians) back to {x, y, z} in degrees / meters. */
export function cartographicToDegrees(cartographic: Cesium.Cartographic): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: Cesium.Math.toDegrees(cartographic.longitude),
    y: Cesium.Math.toDegrees(cartographic.latitude),
    z: cartographic.height,
  };
}

/** Great-circle distance in meters between two cartographic positions. */
export function calculateDistance(
  pos1: Cesium.Cartographic,
  pos2: Cesium.Cartographic,
): number {
  const R = 6371000;
  const dLat = pos2.latitude - pos1.latitude;
  const dLon = pos2.longitude - pos1.longitude;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pos1.latitude) *
      Math.cos(pos2.latitude) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert a local scene-frame position to WGS84 Cartographic.
 * Local (X, Y) are projected-CRS offsets (not ENU), so the result is free of
 * meridian-convergence error. Z is treated as ellipsoidal height at the
 * anchor's normal — negligible error at city scale.
 *
 * @param position [x, y, z] in scene units (controlled by `metersPerUnit`).
 */
export function localToCartographic(position: number[]): Cesium.Cartographic {
  const [x, y, z] = position;
  const mpu = georefConfig.metersPerUnit;
  const xMeters = x * mpu;
  const yMeters = y * mpu;
  const zMeters = z * mpu;

  const cache = getProjectionCache();

  if (cache.toGeo) {
    const [lon, lat] = cache.toGeo.forward([
      cache.anchorX + xMeters,
      cache.anchorY + yMeters,
    ]);
    return Cesium.Cartographic.fromDegrees(lon, lat, zMeters);
  }

  // Flat-ENU fallback (CRS unknown).
  const offset = new Cesium.Cartesian3(xMeters, yMeters, zMeters);
  const worldPos = Cesium.Matrix4.multiplyByPoint(
    cache.fallbackEnuMatrix!,
    offset,
    new Cesium.Cartesian3(),
  );
  return Cesium.Cartographic.fromCartesian(worldPos);
}

/**
 * Batch version of `localToCartographic` — reuses one proj4 transformer for
 * all points, much faster than per-point calls in a tight loop.
 */
export function localToCartographicBatched(
  points: number[][],
): Cesium.Cartographic[] {
  const cache = getProjectionCache();
  const mpu = georefConfig.metersPerUnit;

  if (cache.toGeo) {
    const toGeo = cache.toGeo;
    const ax = cache.anchorX;
    const ay = cache.anchorY;
    return points.map(([x, y, z]) => {
      const xMeters = x * mpu;
      const yMeters = y * mpu;
      const zMeters = z * mpu;
      const [lon, lat] = toGeo.forward([ax + xMeters, ay + yMeters]);
      return Cesium.Cartographic.fromDegrees(lon, lat, zMeters);
    });
  }

  // Flat-ENU fallback path.
  const matrix = cache.fallbackEnuMatrix!;
  return points.map(([x, y, z]) => {
    const offset = new Cesium.Cartesian3(x * mpu, y * mpu, z * mpu);
    const worldPos = Cesium.Matrix4.multiplyByPoint(
      matrix,
      offset,
      new Cesium.Cartesian3(),
    );
    return Cesium.Cartographic.fromCartesian(worldPos);
  });
}

/**
 * True if the terrain provider supports sampling. EllipsoidTerrainProvider
 * has no `availability` so it's filtered out.
 */
export function canSampleTerrain(
  terrainProvider?: Cesium.TerrainProvider,
): boolean {
  const provider = terrainProvider ?? getTerrainProvider();
  if (!provider) return false;
  return !!(provider as any).availability;
}

/** Sample terrain heights per entity; empty map if sampling unsupported. */
export async function sampleTerrain(
  entities: {
    id: number;
    position: number[];
  }[],
): Promise<Map<number, number>> {
  const terrainProvider = getTerrainProvider();
  if (!terrainProvider || !canSampleTerrain(terrainProvider)) {
    return new Map();
  }

  const positions: number[][] = [];
  const entityIds: number[] = [];
  for (const entity of entities) {
    entityIds.push(entity.id);
    positions.push(entity.position);
  }
  const cartographic = localToCartographicBatched(positions);

  try {
    const sampledPositions = await Cesium.sampleTerrainMostDetailed(
      terrainProvider,
      cartographic,
    );

    const terrainHeights = new Map<number, number>();
    for (let index = 0; index < positions.length; index++) {
      terrainHeights.set(entityIds[index], sampledPositions[index].height);
    }

    return terrainHeights;
  } catch (e) {
    console.warn("[sampleTerrain] Terrain sampling failed:", e);
    return new Map();
  }
}

/**
 * Batch-sample terrain heights for many entities × waypoints in a single
 * `sampleTerrainMostDetailed` call. Returns 0-heights when sampling is
 * unsupported.
 */
export async function batchSampleTerrain(
  entities: {
    id: number;
    batch_indices: number[];
    route_positions: number[][][];
  }[],
): Promise<
  Map<
    number,
    Map<number, { cartographic: Cesium.Cartographic; terrainHeight: number }[]>
  >
> {
  const terrainProvider = getTerrainProvider();
  const canSample = terrainProvider && canSampleTerrain(terrainProvider);

  const allPoints: number[][] = [];
  const entityPointRanges: Array<{
    start: number;
    end: number;
    entityId: number;
    batchIdx: number;
  }> = [];

  let currentIndex = 0;
  // Chunk to avoid "Maximum call stack size exceeded" on .push(...largeArray).
  const CHUNK_SIZE = 10000;

  for (const entity of entities) {
    for (let batchIdx = 0; batchIdx < entity.batch_indices.length; batchIdx++) {
      const positions = entity.route_positions[batchIdx];
      const start = currentIndex;
      const end = currentIndex + positions.length;
      entityPointRanges.push({
        start,
        end,
        entityId: entity.id,
        batchIdx,
      });

      for (let i = 0; i < positions.length; i += CHUNK_SIZE) {
        const chunk = positions.slice(i, i + CHUNK_SIZE);
        allPoints.push(...chunk);
      }

      currentIndex = end;
    }
  }

  const cartographicBatch = localToCartographicBatched(allPoints);

  let allTerrainHeights: number[];

  if (canSample) {
    try {
      // One sampling call for every point — the main perf win here.
      const sampledPositions = await Cesium.sampleTerrainMostDetailed(
        terrainProvider!,
        cartographicBatch,
      );
      allTerrainHeights = sampledPositions.map((pos) => pos.height);
    } catch (e) {
      console.warn("[batchSampleTerrain] Terrain sampling failed:", e);
      allTerrainHeights = new Array(cartographicBatch.length).fill(0);
    }
  } else {
    allTerrainHeights = new Array(cartographicBatch.length).fill(0);
  }

  const terrainHeightMap = new Map();
  for (const { start, end, entityId, batchIdx } of entityPointRanges) {
    const batchTerrainHeights = allTerrainHeights.slice(start, end);
    if (!terrainHeightMap.has(entityId)) {
      terrainHeightMap.set(entityId, new Map());
    }
    terrainHeightMap.get(entityId)!.set(
      batchIdx,
      batchTerrainHeights.map((height, index) => {
        const cartographic = cartographicBatch[start + index];
        // Restore the original (pre-sampling) height; scene units -> meters.
        cartographic.height =
          allPoints[start + index][2] * georefConfig.metersPerUnit;

        return {
          cartographic: cartographic,
          terrainHeight: height,
        };
      }),
    );
  }
  return terrainHeightMap;
}
