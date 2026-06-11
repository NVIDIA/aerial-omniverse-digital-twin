/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Cesium from "cesium";
import {
  GIZMO_PIXEL_LENGTH,
  GIZMO_MIN_WORLD_LENGTH,
  GIZMO_MAX_WORLD_LENGTH,
  GIZMO_DISTANCE_EXPONENT,
  GIZMO_REFERENCE_DISTANCE,
  GIZMO_AXIS_PICK_THRESHOLD_FRACTION,
  GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX,
  distanceRayToSegmentSquared,
  getGizmoAxisDirection,
  getGizmoArrowLengthWorld,
} from "./moveGizmo";

// Enhanced Cesium mocks for vector math needed by these tests
vi.mock("cesium", () => {
  class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    static subtract(a: Vec3, b: Vec3, result: Vec3) {
      result.x = a.x - b.x;
      result.y = a.y - b.y;
      result.z = a.z - b.z;
      return result;
    }
    static add(a: Vec3, b: Vec3, result: Vec3) {
      result.x = a.x + b.x;
      result.y = a.y + b.y;
      result.z = a.z + b.z;
      return result;
    }
    static dot(a: Vec3, b: Vec3) {
      return a.x * b.x + a.y * b.y + a.z * b.z;
    }
    static magnitudeSquared(v: Vec3) {
      return v.x * v.x + v.y * v.y + v.z * v.z;
    }
    static multiplyByScalar(v: Vec3, scalar: number, result: Vec3) {
      result.x = v.x * scalar;
      result.y = v.y * scalar;
      result.z = v.z * scalar;
      return result;
    }
    static distanceSquared(a: Vec3, b: Vec3) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      return dx * dx + dy * dy + dz * dz;
    }
    static distance(a: Vec3, b: Vec3) {
      return Math.sqrt(Vec3.distanceSquared(a, b));
    }
    static normalize(v: Vec3, result: Vec3) {
      const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (mag === 0) return result;
      result.x = v.x / mag;
      result.y = v.y / mag;
      result.z = v.z / mag;
      return result;
    }
  }

  return {
    Cartesian3: Vec3,
    Cartesian2: class {
      x: number;
      y: number;
      constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
      }
      static distanceSquared(a: any, b: any) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
      }
    },
    Transforms: {
      eastNorthUpToFixedFrame: vi.fn((position: Vec3) => {
        // Return a 4x4 column-major identity-like matrix
        // col 0 = East (1,0,0), col 1 = North (0,1,0), col 2 = Up (0,0,1)
        return [
          1,
          0,
          0,
          0, // column 0 (East)
          0,
          1,
          0,
          0, // column 1 (North)
          0,
          0,
          1,
          0, // column 2 (Up)
          position.x,
          position.y,
          position.z,
          1, // column 3 (translation)
        ];
      }),
    },
    SceneTransforms: {
      worldToWindowCoordinates: vi.fn(),
    },
    Math: {
      toDegrees: (rad: number) => rad * (180 / Math.PI),
      toRadians: (deg: number) => deg * (Math.PI / 180),
      PI_OVER_THREE: Math.PI / 3,
    },
    PerspectiveFrustum: class {
      fov: number | undefined;
      constructor(opts?: { fov?: number }) {
        this.fov = opts?.fov;
      }
    },
    PerspectiveOffCenterFrustum: class {
      near: number;
      top: number | undefined;
      bottom: number | undefined;
      constructor(opts?: { near?: number; top?: number; bottom?: number }) {
        this.near = opts?.near ?? 1;
        this.top = opts?.top;
        this.bottom = opts?.bottom;
      }
    },
  };
});

describe("moveGizmo constants", () => {
  it("should export valid pixel length", () => {
    expect(GIZMO_PIXEL_LENGTH).toBe(70);
  });

  it("should have min < max world length", () => {
    expect(GIZMO_MIN_WORLD_LENGTH).toBeLessThan(GIZMO_MAX_WORLD_LENGTH);
    expect(GIZMO_MIN_WORLD_LENGTH).toBeGreaterThan(0);
  });

  it("should have distance exponent between 0 and 1", () => {
    expect(GIZMO_DISTANCE_EXPONENT).toBeGreaterThan(0);
    expect(GIZMO_DISTANCE_EXPONENT).toBeLessThan(1);
  });

  it("should have positive reference distance", () => {
    expect(GIZMO_REFERENCE_DISTANCE).toBeGreaterThan(0);
  });

  it("should have pick threshold fraction between 0 and 1", () => {
    expect(GIZMO_AXIS_PICK_THRESHOLD_FRACTION).toBeGreaterThan(0);
    expect(GIZMO_AXIS_PICK_THRESHOLD_FRACTION).toBeLessThan(1);
  });

  it("should have positive origin free drag radius", () => {
    expect(GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX).toBeGreaterThan(0);
  });
});

describe("distanceRayToSegmentSquared", () => {
  it("should return Infinity for collinear ray and segment (degenerate denominator)", () => {
    const O = new Cesium.Cartesian3(0, 0, 0);
    const D = new Cesium.Cartesian3(1, 0, 0);
    const A = new Cesium.Cartesian3(5, 0, 0);
    const B = new Cesium.Cartesian3(10, 0, 0);

    const distSq = distanceRayToSegmentSquared(O, D, A, B);
    expect(distSq).toBe(Number.POSITIVE_INFINITY);
  });

  it("should return Infinity for parallel ray and segment (degenerate denominator)", () => {
    const O = new Cesium.Cartesian3(0, 1, 0);
    const D = new Cesium.Cartesian3(1, 0, 0);
    const A = new Cesium.Cartesian3(5, 0, 0);
    const B = new Cesium.Cartesian3(10, 0, 0);

    const distSq = distanceRayToSegmentSquared(O, D, A, B);
    expect(distSq).toBe(Number.POSITIVE_INFINITY);
  });

  it("should return a finite non-negative value for skew ray and segment", () => {
    const O = new Cesium.Cartesian3(0, 0, 0);
    const D = new Cesium.Cartesian3(1, 1, 0);
    const A = new Cesium.Cartesian3(5, 0, 2);
    const B = new Cesium.Cartesian3(5, 0, 8);

    const distSq = distanceRayToSegmentSquared(O, D, A, B);
    expect(distSq).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(distSq)).toBe(true);
  });

  it("should handle zero-length segment gracefully", () => {
    const O = new Cesium.Cartesian3(0, 0, 0);
    const D = new Cesium.Cartesian3(1, 0, 0);
    const A = new Cesium.Cartesian3(5, 5, 0);
    const B = new Cesium.Cartesian3(5, 5, 0);

    const distSq = distanceRayToSegmentSquared(O, D, A, B);
    expect(distSq).toBe(Number.POSITIVE_INFINITY);
  });

  it("should return smaller distance for a closer segment", () => {
    const O = new Cesium.Cartesian3(0, 0, 0);
    const D = new Cesium.Cartesian3(1, 1, 0);
    // Near segment
    const A1 = new Cesium.Cartesian3(3, 0, 0.5);
    const B1 = new Cesium.Cartesian3(3, 0, 5);
    // Far segment (same but offset in y)
    const A2 = new Cesium.Cartesian3(3, 0, 10);
    const B2 = new Cesium.Cartesian3(3, 0, 20);

    const distSqNear = distanceRayToSegmentSquared(O, D, A1, B1);
    const distSqFar = distanceRayToSegmentSquared(O, D, A2, B2);

    // Both should be finite
    expect(Number.isFinite(distSqNear)).toBe(true);
    expect(Number.isFinite(distSqFar)).toBe(true);
    // Near segment should have smaller or equal distance
    expect(distSqNear).toBeLessThanOrEqual(distSqFar);
  });
});

describe("getGizmoAxisDirection", () => {
  it("should return East direction for x axis", () => {
    const pos = new Cesium.Cartesian3(100, 200, 300);
    const dir = getGizmoAxisDirection(pos, "x");

    // With our identity ENU mock, x=East should be (1,0,0) normalized
    expect(dir.x).toBeCloseTo(1, 5);
    expect(dir.y).toBeCloseTo(0, 5);
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it("should return North direction for y axis", () => {
    const pos = new Cesium.Cartesian3(100, 200, 300);
    const dir = getGizmoAxisDirection(pos, "y");

    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.y).toBeCloseTo(1, 5);
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it("should return Up direction for z axis", () => {
    const pos = new Cesium.Cartesian3(100, 200, 300);
    const dir = getGizmoAxisDirection(pos, "z");

    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.y).toBeCloseTo(0, 5);
    expect(dir.z).toBeCloseTo(1, 5);
  });
});

describe("getGizmoArrowLengthWorld", () => {
  it("should return a value clamped between min and max", () => {
    const mockViewer = {
      camera: {
        positionWC: new Cesium.Cartesian3(0, 0, 1000),
        frustum: new Cesium.PerspectiveFrustum({ fov: Math.PI / 3 }),
      },
      scene: {
        canvas: { clientHeight: 800 },
      },
    } as any;

    const entityPos = new Cesium.Cartesian3(0, 0, 0);
    const length = getGizmoArrowLengthWorld(mockViewer, entityPos);

    expect(length).toBeGreaterThanOrEqual(GIZMO_MIN_WORLD_LENGTH);
    expect(length).toBeLessThanOrEqual(GIZMO_MAX_WORLD_LENGTH);
  });

  it("should increase with camera distance", () => {
    const makeViewer = (dist: number) =>
      ({
        camera: {
          positionWC: new Cesium.Cartesian3(0, 0, dist),
          frustum: new Cesium.PerspectiveFrustum({ fov: Math.PI / 3 }),
        },
        scene: {
          canvas: { clientHeight: 800 },
        },
      }) as any;

    const entityPos = new Cesium.Cartesian3(0, 0, 0);
    const closeLength = getGizmoArrowLengthWorld(makeViewer(100), entityPos);
    const farLength = getGizmoArrowLengthWorld(makeViewer(10000), entityPos);

    expect(farLength).toBeGreaterThan(closeLength);
  });

  it("should handle zero canvas height gracefully", () => {
    const mockViewer = {
      camera: {
        positionWC: new Cesium.Cartesian3(0, 0, 500),
        frustum: new Cesium.PerspectiveFrustum({ fov: Math.PI / 3 }),
      },
      scene: {
        canvas: { clientHeight: 0 },
      },
    } as any;

    const entityPos = new Cesium.Cartesian3(0, 0, 0);
    const length = getGizmoArrowLengthWorld(mockViewer, entityPos);

    // clientHeight 0 → fallback to 1 → very large value, clamped to max
    expect(length).toBe(GIZMO_MAX_WORLD_LENGTH);
  });
});
