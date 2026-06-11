/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared utilities for the 3D translation gizmo (Blender-style XYZ move axes).
 * Used by MoveGizmoLayer (rendering) and usePickingHandlers (raycast + drag).
 */
import * as Cesium from "cesium";

/** Baseline length of each axis arrow in pixels on screen at the reference distance. */
export const GIZMO_PIXEL_LENGTH = 70;

/** Min/max world length (meters) so the gizmo doesn't vanish or dominate the view. */
export const GIZMO_MIN_WORLD_LENGTH = 0.5;
export const GIZMO_MAX_WORLD_LENGTH = 500;

/**
 * Sub-linear exponent for distance scaling (0 < exp < 1).
 * Lower values = more growth when zoomed close.
 */
export const GIZMO_DISTANCE_EXPONENT = 0.7;

/** Distance (meters) at which the gizmo matches GIZMO_PIXEL_LENGTH exactly. */
export const GIZMO_REFERENCE_DISTANCE = 200;

/**
 * Returns the world-space length of each gizmo arrow.
 * Uses sub-linear distance scaling so the gizmo appears larger on screen when
 * the camera is close, and settles to a constant pixel size at the reference distance.
 */
export function getGizmoArrowLengthWorld(
  viewer: Cesium.Viewer,
  entityPosition: Cesium.Cartesian3,
): number {
  const camera = viewer.camera;
  const distance = Cesium.Cartesian3.distance(
    camera.positionWC,
    entityPosition,
  );
  const canvas = viewer.scene.canvas;
  const height = canvas.clientHeight || 1;
  const frustum = camera.frustum;
  let tanHalfFov: number;
  if (frustum instanceof Cesium.PerspectiveFrustum) {
    const fov = frustum.fov ?? Cesium.Math.PI_OVER_THREE;
    tanHalfFov = Math.tan(fov * 0.5);
  } else if (frustum instanceof Cesium.PerspectiveOffCenterFrustum) {
    const n = frustum.near;
    const top = frustum.top ?? 1;
    const bottom = frustum.bottom ?? -1;
    tanHalfFov = (top - bottom) / (2 * n);
  } else {
    tanHalfFov = Math.tan(Cesium.Math.PI_OVER_THREE * 0.5);
  }
  const scaledDistance =
    GIZMO_REFERENCE_DISTANCE *
    Math.pow(distance / GIZMO_REFERENCE_DISTANCE, GIZMO_DISTANCE_EXPONENT);
  const worldLength =
    2 * scaledDistance * tanHalfFov * (GIZMO_PIXEL_LENGTH / height);
  return Math.max(
    GIZMO_MIN_WORLD_LENGTH,
    Math.min(GIZMO_MAX_WORLD_LENGTH, worldLength),
  );
}

/** Pick threshold as fraction of arrow length; ray must come this close to axis segment. */
export const GIZMO_AXIS_PICK_THRESHOLD_FRACTION = 0.35;

/** Screen-space radius (px) around the gizmo origin where axis picking is suppressed to allow free drag of the entity body. */
export const GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX = 15;

/** Squared distance from ray (O + t*D, t>=0) to segment A->B. */
export function distanceRayToSegmentSquared(
  O: Cesium.Cartesian3,
  D: Cesium.Cartesian3,
  A: Cesium.Cartesian3,
  B: Cesium.Cartesian3,
): number {
  const AB = Cesium.Cartesian3.subtract(B, A, new Cesium.Cartesian3());
  const OA = Cesium.Cartesian3.subtract(A, O, new Cesium.Cartesian3());
  const d = Cesium.Cartesian3.dot(AB, D);
  const n = Cesium.Cartesian3.dot(OA, AB);
  const m = Cesium.Cartesian3.dot(OA, D);
  const L2 = Cesium.Cartesian3.magnitudeSquared(AB);
  const denom = d * d - L2;
  if (Math.abs(denom) < 1e-10) return Number.POSITIVE_INFINITY;
  let s = (m * d - n) / denom;
  s = Math.max(0, Math.min(1, s));
  const t = s * d - m;
  const tClamped = Math.max(0, t);
  const R = Cesium.Cartesian3.add(
    O,
    Cesium.Cartesian3.multiplyByScalar(D, tClamped, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  const S = Cesium.Cartesian3.add(
    A,
    Cesium.Cartesian3.multiplyByScalar(AB, s, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  return Cesium.Cartesian3.distanceSquared(R, S);
}

/**
 * Which gizmo axis (if any) the screen position is over, by raycasting.
 * Uses screen-constant arrow length so hit test matches visual.
 */
export function getGizmoAxisHitByRay(
  viewer: Cesium.Viewer,
  screenPosition: Cesium.Cartesian2,
  entityPosition: Cesium.Cartesian3,
): "x" | "y" | "z" | null {
  const ray = viewer.camera.getPickRay(screenPosition);
  if (!ray) return null;

  const originScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    entityPosition,
    new Cesium.Cartesian2(),
  );
  if (
    originScreen &&
    Cesium.Cartesian2.distanceSquared(screenPosition, originScreen) <
      GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX * GIZMO_ORIGIN_FREE_DRAG_RADIUS_PX
  ) {
    return null;
  }

  const O = ray.origin;
  const D = ray.direction;
  const arrowLength = getGizmoArrowLengthWorld(viewer, entityPosition);
  const threshold = arrowLength * GIZMO_AXIS_PICK_THRESHOLD_FRACTION;
  const bestDistSq = threshold * threshold;

  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(entityPosition);
  const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
  let bestAxis: "x" | "y" | "z" | null = null;
  let bestD2 = bestDistSq;

  for (const axis of axes) {
    const col = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const i = col * 4;
    const axisDir = new Cesium.Cartesian3(enu[i], enu[i + 1], enu[i + 2]);
    Cesium.Cartesian3.normalize(axisDir, axisDir);
    const B = Cesium.Cartesian3.add(
      entityPosition,
      Cesium.Cartesian3.multiplyByScalar(
        axisDir,
        arrowLength,
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );
    const distSq = distanceRayToSegmentSquared(O, D, entityPosition, B);
    if (distSq < bestD2) {
      bestD2 = distSq;
      bestAxis = axis;
    }
  }
  return bestAxis;
}

/** World-space unit direction for the given axis at the given position (ENU: x=East, y=North, z=Up). */
export function getGizmoAxisDirection(
  position: Cesium.Cartesian3,
  axis: "x" | "y" | "z",
): Cesium.Cartesian3 {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  const col = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const i = col * 4;
  const v = new Cesium.Cartesian3(enu[i], enu[i + 1], enu[i + 2]);
  Cesium.Cartesian3.normalize(v, v);
  return v;
}
