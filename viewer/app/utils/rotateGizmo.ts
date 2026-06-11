/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared utilities for the 3D rotation gizmo (azimuth + tilt rings for RU orientation).
 * Used by RotateGizmoLayer (rendering) and usePickingHandlers (raycast + drag).
 */
import * as Cesium from "cesium";
import {
  getGizmoArrowLengthWorld,
  distanceRayToSegmentSquared,
} from "./moveGizmo";

/** Number of segments per ring for hit testing and drawing. */
export const ROTATE_RING_SEGMENTS = 64;

/** Pick threshold: max distance from ray to ring segment (world units) to count as hit. */
export const ROTATE_RING_PICK_THRESHOLD_FRACTION = 0.4;

/** Ring type for RU: azimuth (horizontal) or tilt (vertical in plane of forward+Up). */
export type RotateRingType = "azimuth" | "tilt";

/**
 * Get ENU axes at a position (east, north, up as unit vectors).
 */
function getEnuAxes(position: Cesium.Cartesian3): {
  east: Cesium.Cartesian3;
  north: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
} {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  return {
    east: new Cesium.Cartesian3(enu[0], enu[1], enu[2]),
    north: new Cesium.Cartesian3(enu[4], enu[5], enu[6]),
    up: new Cesium.Cartesian3(enu[8], enu[9], enu[10]),
  };
}

/** Scale factor for rotate ring radius (fraction of move gizmo arrow length). */
export const ROTATE_RING_RADIUS_SCALE = 0.85;

/**
 * Returns the world-space radius of the rotate rings (smaller than move gizmo arrows).
 */
export function getRotateRingRadiusWorld(
  viewer: Cesium.Viewer,
  entityPosition: Cesium.Cartesian3,
): number {
  return getGizmoArrowLengthWorld(viewer, entityPosition);
}

/**
 * Sample points on a circle in 3D: center + radius * (cos θ * axisU + sin θ * axisV).
 */
function sampleCirclePoints(
  center: Cesium.Cartesian3,
  axisU: Cesium.Cartesian3,
  axisV: Cesium.Cartesian3,
  radius: number,
  numPoints: number,
): Cesium.Cartesian3[] {
  const points: Cesium.Cartesian3[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * 2 * Math.PI;
    const offset = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(
        axisU,
        radius * Math.cos(t),
        new Cesium.Cartesian3(),
      ),
      Cesium.Cartesian3.multiplyByScalar(
        axisV,
        radius * Math.sin(t),
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );
    points.push(Cesium.Cartesian3.add(center, offset, new Cesium.Cartesian3()));
  }
  points.push(Cesium.Cartesian3.clone(points[0], new Cesium.Cartesian3()));
  return points;
}

/**
 * Minimum squared distance from ray (O + t*D, t>=0) to a closed polyline (segments + closing segment).
 */
function distanceRayToPolylineSquared(
  O: Cesium.Cartesian3,
  D: Cesium.Cartesian3,
  points: Cesium.Cartesian3[],
): number {
  let minD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const A = points[i];
    const B = points[(i + 1) % points.length];
    const d2 = distanceRayToSegmentSquared(O, D, A, B);
    if (d2 < minD2) minD2 = d2;
  }
  return minD2;
}

/**
 * Which rotate ring (if any) the screen position is over, by raycasting.
 * headingDeg and pitchDeg are the current RU orientation in degrees (mech_azimuth, mech_tilt).
 */
export function getRotateRingHitByRay(
  viewer: Cesium.Viewer,
  screenPosition: Cesium.Cartesian2,
  entityPosition: Cesium.Cartesian3,
  headingDeg: number,
  pitchDeg: number,
): RotateRingType | null {
  const ray = viewer.camera.getPickRay(screenPosition);
  if (!ray) return null;

  const O = ray.origin;
  const D = ray.direction;
  const radius = getRotateRingRadiusWorld(viewer, entityPosition);
  const threshold = radius * ROTATE_RING_PICK_THRESHOLD_FRACTION;
  const thresholdSq = threshold * threshold;

  const { east, north, up } = getEnuAxes(entityPosition);
  const headingRad = Cesium.Math.toRadians(headingDeg);
  const forward = Cesium.Cartesian3.add(
    Cesium.Cartesian3.multiplyByScalar(
      east,
      Math.cos(headingRad),
      new Cesium.Cartesian3(),
    ),
    Cesium.Cartesian3.multiplyByScalar(
      north,
      Math.sin(headingRad),
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(forward, forward);

  const azimuthPoints = sampleCirclePoints(
    entityPosition,
    east,
    north,
    radius,
    ROTATE_RING_SEGMENTS,
  );
  const tiltPoints = sampleCirclePoints(
    entityPosition,
    forward,
    up,
    radius,
    ROTATE_RING_SEGMENTS,
  );

  const d2Azimuth = distanceRayToPolylineSquared(O, D, azimuthPoints);
  const d2Tilt = distanceRayToPolylineSquared(O, D, tiltPoints);

  if (d2Azimuth <= thresholdSq && d2Tilt <= thresholdSq) {
    return d2Azimuth <= d2Tilt ? "azimuth" : "tilt";
  }
  if (d2Azimuth <= thresholdSq) return "azimuth";
  if (d2Tilt <= thresholdSq) return "tilt";
  return null;
}

/**
 * Get current azimuth angle (degrees, 0–360) from screen position by projecting
 * the ray onto the horizontal plane and measuring angle from North.
 */
export function getAzimuthAngleFromScreen(
  viewer: Cesium.Viewer,
  screenPosition: Cesium.Cartesian2,
  entityPosition: Cesium.Cartesian3,
): number {
  const ray = viewer.camera.getPickRay(screenPosition);
  if (!ray) return 0;

  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(entityPosition);
  const up = new Cesium.Cartesian3(enu[8], enu[9], enu[10]);

  const denom = Cesium.Cartesian3.dot(ray.direction, up);
  if (Math.abs(denom) < 1e-8) return 0;

  const t =
    Cesium.Cartesian3.dot(
      Cesium.Cartesian3.subtract(
        entityPosition,
        ray.origin,
        new Cesium.Cartesian3(),
      ),
      up,
    ) / denom;
  if (t < 0) return 0;

  const hit = Cesium.Cartesian3.add(
    ray.origin,
    Cesium.Cartesian3.multiplyByScalar(
      ray.direction,
      t,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  const toHit = Cesium.Cartesian3.subtract(
    hit,
    entityPosition,
    new Cesium.Cartesian3(),
  );
  const north = new Cesium.Cartesian3(enu[4], enu[5], enu[6]);
  const east = new Cesium.Cartesian3(enu[0], enu[1], enu[2]);

  const northProj = Cesium.Cartesian3.subtract(
    north,
    Cesium.Cartesian3.multiplyByScalar(
      up,
      Cesium.Cartesian3.dot(north, up),
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  const toHitHorz = Cesium.Cartesian3.subtract(
    toHit,
    Cesium.Cartesian3.multiplyByScalar(
      up,
      Cesium.Cartesian3.dot(toHit, up),
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );

  Cesium.Cartesian3.normalize(northProj, northProj);
  const len = Cesium.Cartesian3.magnitude(toHitHorz);
  if (len < 1e-6) return 0;
  const angle = Math.atan2(
    Cesium.Cartesian3.dot(toHitHorz, east),
    Cesium.Cartesian3.dot(toHitHorz, northProj),
  );
  let deg = Cesium.Math.toDegrees(angle);
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Get current tilt angle (degrees) from screen position by projecting
 * the ray onto the vertical plane (forward–Up) and measuring angle from horizontal.
 */
export function getTiltAngleFromScreen(
  viewer: Cesium.Viewer,
  screenPosition: Cesium.Cartesian2,
  entityPosition: Cesium.Cartesian3,
  headingDeg: number,
): number {
  const ray = viewer.camera.getPickRay(screenPosition);
  if (!ray) return 0;

  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(entityPosition);
  const east = new Cesium.Cartesian3(enu[0], enu[1], enu[2]);
  const north = new Cesium.Cartesian3(enu[4], enu[5], enu[6]);
  const up = new Cesium.Cartesian3(enu[8], enu[9], enu[10]);

  const headingRad = Cesium.Math.toRadians(headingDeg);
  const forward = Cesium.Cartesian3.add(
    Cesium.Cartesian3.multiplyByScalar(
      east,
      Math.cos(headingRad),
      new Cesium.Cartesian3(),
    ),
    Cesium.Cartesian3.multiplyByScalar(
      north,
      Math.sin(headingRad),
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  const right = Cesium.Cartesian3.cross(forward, up, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(right, right);

  const denom = Cesium.Cartesian3.dot(ray.direction, right);
  if (Math.abs(denom) < 1e-8) return 0;

  const t =
    Cesium.Cartesian3.dot(
      Cesium.Cartesian3.subtract(
        entityPosition,
        ray.origin,
        new Cesium.Cartesian3(),
      ),
      right,
    ) / denom;
  if (t < 0) return 0;

  const hit = Cesium.Cartesian3.add(
    ray.origin,
    Cesium.Cartesian3.multiplyByScalar(
      ray.direction,
      t,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  const toHit = Cesium.Cartesian3.subtract(
    hit,
    entityPosition,
    new Cesium.Cartesian3(),
  );
  const forwardComp = Cesium.Cartesian3.dot(toHit, forward);
  const upComp = Cesium.Cartesian3.dot(toHit, up);
  const angle = Math.atan2(upComp, forwardComp);
  return Cesium.Math.toDegrees(angle);
}

/**
 * Get polyline positions for the azimuth ring (horizontal circle).
 * Used by RotateGizmoLayer for drawing.
 */
export function getAzimuthRingPositions(
  center: Cesium.Cartesian3,
  radius: number,
  numPoints: number = ROTATE_RING_SEGMENTS,
): Cesium.Cartesian3[] {
  const { east, north } = getEnuAxes(center);
  return sampleCirclePoints(center, east, north, radius, numPoints);
}

/**
 * Get polyline positions for the tilt ring (vertical circle in forward–Up plane).
 * Used by RotateGizmoLayer for drawing (and by hit-testing in getRotateRingHitByRay).
 */
export function getTiltRingPositions(
  center: Cesium.Cartesian3,
  radius: number,
  headingDeg: number,
  numPoints: number = ROTATE_RING_SEGMENTS,
): Cesium.Cartesian3[] {
  const { east, north, up } = getEnuAxes(center);
  const headingRad = Cesium.Math.toRadians(headingDeg);
  const forward = Cesium.Cartesian3.add(
    Cesium.Cartesian3.multiplyByScalar(
      east,
      Math.cos(headingRad),
      new Cesium.Cartesian3(),
    ),
    Cesium.Cartesian3.multiplyByScalar(
      north,
      Math.sin(headingRad),
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(forward, forward);
  return sampleCirclePoints(center, forward, up, radius, numPoints);
}

/**
 * Orientation quaternion for the tilt-ring ellipse so the ellipse lies in the
 * forward–up plane (normal = right). Used by RotateGizmoLayer with EllipseGraphics.
 */
export function getTiltRingOrientation(
  position: Cesium.Cartesian3,
  headingDeg: number,
): Cesium.Quaternion {
  const { east, north, up } = getEnuAxes(position);
  const headingRad = Cesium.Math.toRadians(headingDeg);
  const forward = Cesium.Cartesian3.add(
    Cesium.Cartesian3.multiplyByScalar(
      east,
      Math.cos(headingRad),
      new Cesium.Cartesian3(),
    ),
    Cesium.Cartesian3.multiplyByScalar(
      north,
      Math.sin(headingRad),
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(forward, forward);
  const right = Cesium.Cartesian3.cross(forward, up, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(right, right);
  const m = new Cesium.Matrix3();
  Cesium.Matrix3.fromColumnMajorArray(
    [
      forward.x,
      forward.y,
      forward.z,
      up.x,
      up.y,
      up.z,
      right.x,
      right.y,
      right.z,
    ],
    m,
  );
  return Cesium.Quaternion.fromRotationMatrix(m);
}
