/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for coordinateService
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  degreesToCartographic,
  cartographicToDegrees,
  calculateDistance,
  localToCartographic,
  setCoordinateConfig,
  resetCoordinateConfig,
  georefConfig,
} from "./coordinateService";
import * as Cesium from "cesium";

describe("coordinateService", () => {
  describe("degreesToCartographic", () => {
    it("should convert object format to cartographic", () => {
      const local = { x: 139.7437, y: 35.6624, z: 100 };
      const result = degreesToCartographic(local);

      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(Object);
    });

    it("should convert array format to cartographic", () => {
      const local = [139.7437, 35.6624, 100];
      const result = degreesToCartographic(local);

      expect(result).toBeDefined();
    });

    it("should handle array with missing height (defaults to 0)", () => {
      const local = [139.7437, 35.6624];
      const result = degreesToCartographic(local);

      expect(result).toBeDefined();
    });

    it("should handle object with missing height", () => {
      const local = { x: 139.7437, y: 35.6624 };
      const result = degreesToCartographic(local);

      expect(result).toBeDefined();
    });

    it("should throw error for invalid array", () => {
      expect(() => degreesToCartographic([139.7437])).toThrow();
    });

    it("should throw error for invalid object", () => {
      expect(() => degreesToCartographic({ x: 139.7437 })).toThrow();
      expect(() => degreesToCartographic({ y: 35.6624 })).toThrow();
    });
  });

  describe("cartographicToDegrees", () => {
    it("should convert cartographic to degrees", () => {
      const cartographic = new Cesium.Cartographic(
        Cesium.Math.toRadians(139.7437),
        Cesium.Math.toRadians(35.6624),
        100,
      );

      const result = cartographicToDegrees(cartographic);

      expect(result).toBeDefined();
      expect(result).toHaveProperty("x");
      expect(result).toHaveProperty("y");
      expect(result).toHaveProperty("z");
      expect(result.z).toBe(100);
    });

    it("should preserve height value", () => {
      const cartographic = new Cesium.Cartographic(
        Cesium.Math.toRadians(139.7437),
        Cesium.Math.toRadians(35.6624),
        250.5,
      );

      const result = cartographicToDegrees(cartographic);

      expect(result.z).toBe(250.5);
    });
  });

  describe("calculateDistance", () => {
    it("should calculate distance between two positions", () => {
      const pos1 = new Cesium.Cartographic(
        Cesium.Math.toRadians(139.7437),
        Cesium.Math.toRadians(35.6624),
        0,
      );
      const pos2 = new Cesium.Cartographic(
        Cesium.Math.toRadians(139.7537),
        Cesium.Math.toRadians(35.6724),
        0,
      );

      const distance = calculateDistance(pos1, pos2);

      expect(distance).toBeGreaterThan(0);
      expect(typeof distance).toBe("number");
    });

    it("should return 0 for same position", () => {
      const pos = new Cesium.Cartographic(
        Cesium.Math.toRadians(139.7437),
        Cesium.Math.toRadians(35.6624),
        0,
      );

      const distance = calculateDistance(pos, pos);

      expect(distance).toBeCloseTo(0, 0);
    });

    it("should return positive distance regardless of order", () => {
      const pos1 = new Cesium.Cartographic(
        Cesium.Math.toRadians(139.7437),
        Cesium.Math.toRadians(35.6624),
        0,
      );
      const pos2 = new Cesium.Cartographic(
        Cesium.Math.toRadians(139.7537),
        Cesium.Math.toRadians(35.6724),
        0,
      );

      const distance1 = calculateDistance(pos1, pos2);
      const distance2 = calculateDistance(pos2, pos1);

      expect(distance1).toBe(distance2);
      expect(distance1).toBeGreaterThan(0);
    });
  });

  describe("georefConfig", () => {
    it("should have valid Tokyo coordinates", () => {
      expect(georefConfig.centerLat).toBeCloseTo(35.662, 1);
      expect(georefConfig.centerLng).toBeCloseTo(139.743, 1);
    });

    it("should default to UTM Zone 54N CRS", () => {
      expect(georefConfig.crs).toBe("EPSG:32654");
    });
  });

  describe("localToCartographic (CRS-aware)", () => {
    afterEach(() => {
      resetCoordinateConfig();
    });

    it("returns the anchor lon/lat for the origin point", async () => {
      // Helsinki UTM35N: meridian convergence ~1.79 deg, large enough that
      // flat-ENU would be visibly wrong.
      await setCoordinateConfig({
        centerLat: 60.169857,
        centerLng: 24.938379,
        crs: "EPSG:32635",
        metersPerUnit: 1.0,
      });

      const carto = localToCartographic([0, 0, 0]);

      expect(Cesium.Math.toDegrees(carto.longitude)).toBeCloseTo(24.938379, 6);
      expect(Cesium.Math.toDegrees(carto.latitude)).toBeCloseTo(60.169857, 6);
      expect(carto.height).toBeCloseTo(0, 6);
    });

    it("treats local (X, Y) as UTM-grid offsets, not as true ENU", async () => {
      // Helsinki sits ~2.06 deg west of UTM 35's central meridian, so grid-
      // north tilts ~1.79 deg west of true-north. A local +Y=1000 m point
      // therefore lands slightly west of the anchor longitude — flat-ENU
      // (treating +Y as true north) would put it directly north.
      await setCoordinateConfig({
        centerLat: 60.169857,
        centerLng: 24.938379,
        crs: "EPSG:32635",
        metersPerUnit: 1.0,
      });

      const anchor = localToCartographic([0, 0, 0]);
      const localNorth1000m = localToCartographic([0, 1000, 0]);

      const deltaLonDeg =
        Cesium.Math.toDegrees(localNorth1000m.longitude) -
        Cesium.Math.toDegrees(anchor.longitude);
      const deltaLatDeg =
        Cesium.Math.toDegrees(localNorth1000m.latitude) -
        Cesium.Math.toDegrees(anchor.latitude);

      // Analytic predictions (gamma ~ -1.789 deg):
      //   delta_lat ~ +0.00898 deg, delta_lon ~ -0.00056 deg.
      // Tolerances ~10%; flat-ENU would put delta_lon ~ 0.
      expect(deltaLatDeg).toBeGreaterThan(0.0085);
      expect(deltaLatDeg).toBeLessThan(0.0095);
      expect(deltaLonDeg).toBeLessThan(-0.0004);
      expect(deltaLonDeg).toBeGreaterThan(-0.0007);

      // Distance ~1000 m within UTM scale-factor distortion (k0=0.9996).
      const dist = calculateDistance(anchor, localNorth1000m);
      expect(dist).toBeGreaterThan(995);
      expect(dist).toBeLessThan(1005);
    });

    it("resolves a non-UTM EPSG code via epsg-index (lazy load)", async () => {
      // EPSG:3879 (ETRS89 / GK25FIN) is not in the UTM pre-reg table, so the
      // origin round-tripping back proves the lazy epsg-index load worked.
      await setCoordinateConfig({
        centerLat: 60.169857,
        centerLng: 24.938379,
        crs: "EPSG:3879",
        metersPerUnit: 1.0,
      });

      const anchor = localToCartographic([0, 0, 0]);
      expect(Cesium.Math.toDegrees(anchor.longitude)).toBeCloseTo(24.938379, 5);
      expect(Cesium.Math.toDegrees(anchor.latitude)).toBeCloseTo(60.169857, 5);

      // GK25 scale factor near 1 at this longitude.
      const north1000m = localToCartographic([0, 1000, 0]);
      const dist = calculateDistance(anchor, north1000m);
      expect(dist).toBeGreaterThan(990);
      expect(dist).toBeLessThan(1010);
    });

    it("accepts a raw proj4 string (OSM / per-scene tmerc)", async () => {
      // OSM scenes ship a raw proj4 string instead of an EPSG code. The
      // anchor is intentionally offset from lat_0/lon_0 (producer rounds
      // them to 6 decimals while the anchor sits at the building-AABB
      // midpoint), so the round-trip below also verifies that
      // buildProjectionCache uses the real anchor projection rather than
      // assuming anchor == projection origin.
      await setCoordinateConfig({
        centerLat: 40.7123913387,
        centerLng: -74.0107921302,
        crs:
          "+proj=tmerc +lat_0=40.712115 +lon_0=-74.011615 +k=1 " +
          "+x_0=0 +y_0=0 +units=m +no_defs +ellps=WGS84",
        metersPerUnit: 1.0,
      });

      const anchor = localToCartographic([0, 0, 0]);
      expect(Cesium.Math.toDegrees(anchor.longitude)).toBeCloseTo(
        -74.0107921302,
        6,
      );
      expect(Cesium.Math.toDegrees(anchor.latitude)).toBeCloseTo(
        40.7123913387,
        6,
      );

      // tmerc with k=1 near the CM has sub-mm distortion; residual ~2 m is
      // calculateDistance's haversine vs ellipsoid difference.
      const north1000m = localToCartographic([0, 1000, 0]);
      const dist = calculateDistance(anchor, north1000m);
      expect(dist).toBeGreaterThan(995);
      expect(dist).toBeLessThan(1005);

      // Per-scene tmerc puts lon_0 ~ anchor lon, so convergence ~ 0 and a
      // local +Y step produces essentially no longitude shift — unlike UTM
      // 35N above. This is why OSM scenes looked aligned under flat-ENU.
      const lonShiftDeg =
        Cesium.Math.toDegrees(north1000m.longitude) -
        Cesium.Math.toDegrees(anchor.longitude);
      expect(Math.abs(lonShiftDeg)).toBeLessThan(1e-5);

      const latShiftDeg =
        Cesium.Math.toDegrees(north1000m.latitude) -
        Cesium.Math.toDegrees(anchor.latitude);
      expect(latShiftDeg).toBeGreaterThan(0.0085);
      expect(latShiftDeg).toBeLessThan(0.0095);
    });
  });
});
