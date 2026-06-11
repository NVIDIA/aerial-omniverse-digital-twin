/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import { useViewerStore } from "../../store/viewerStore";
import { isEntity } from "../../services/cesium";
import { isRadioUnit } from "@/services/cesium";
import {
  getRotateRingRadiusWorld,
  getAzimuthRingPositions,
  getTiltRingPositions,
  type RotateRingType,
} from "../../utils/rotateGizmo";
import { radioUnitManager } from "~/managers/radioUnitManager";
import type { ObjectType } from "@/types";

/** Tube cross-section as fraction of ring radius (world units). */
const RING_TUBE_RADIUS_FRACTION = 0.04;

/** Segments along the circle path; smooth because tube is round. */
const RING_PATH_SEGMENTS = 256;

/** Segments for the tube cross-section circle (smooth torus). */
const RING_SHAPE_SEGMENTS = 32;

/** 2D circle shape for tube cross-section (radius in world units). */
function getTubeShape(radius: number, segments: number): Cesium.Cartesian2[] {
  const shape: Cesium.Cartesian2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * 2 * Math.PI;
    shape.push(
      new Cesium.Cartesian2(radius * Math.cos(t), radius * Math.sin(t)),
    );
  }
  return shape;
}

/** Brighter color for hover highlight */
function brighter(color: Cesium.Color, factor: number): Cesium.Color {
  const c = color;
  return new Cesium.Color(
    Math.min(1, c.red * factor),
    Math.min(1, c.green * factor),
    Math.min(1, c.blue * factor),
    c.alpha,
  );
}

function isRotatableEntity(obj: unknown): obj is Cesium.Entity {
  if (!obj || typeof obj === "string") return false;
  if (!isEntity(obj as ObjectType)) return false;
  return isRadioUnit(obj as Cesium.Entity);
}

interface RotateGizmoLayerProps {
  viewer: Cesium.Viewer;
}

/**
 * RotateGizmoLayer – Shows azimuth (cyan) and tilt (orange) rings at the selected RU
 * when the Rotate tool is enabled. Uses PolylineVolume (tube with round cross-section)
 * for smooth torus-like rings; both rings are always visible. Dragging a ring updates
 * orientation and mech_azimuth / mech_tilt.
 */
export const RotateGizmoLayer: React.FC<RotateGizmoLayerProps> = ({
  viewer,
}) => {
  const entityRefs = useRef<Cesium.Entity[]>([]);
  const hoveredRingRef = useRef<RotateRingType | null>(null);

  const rotateToolEnabled = useViewerStore((s) => s.rotateToolEnabled);
  const selectedObject = useViewerStore((s) => s.selectedObject);
  const hoveredRotateRing = useViewerStore((s) => s.hoveredRotateRing);
  hoveredRingRef.current = hoveredRotateRing;

  const showGizmo =
    rotateToolEnabled &&
    selectedObject != null &&
    isRotatableEntity(selectedObject);

  const selectedId =
    showGizmo && isEntity(selectedObject) ? selectedObject.id : null;

  useEffect(() => {
    if (!viewer) return;

    for (const e of entityRefs.current) {
      viewer.entities.remove(e);
    }
    entityRefs.current = [];

    if (!rotateToolEnabled || !showGizmo || !selectedId) {
      return;
    }

    const entity =
      typeof selectedId === "string"
        ? viewer.entities.getById(selectedId)
        : undefined;
    // Do not fall back to selectedEntityRef: after an entity is removed from the
    // collection, a stale reference would still evaluate callbacks with invalid positions.
    if (!entity) return;

    const ruId =
      typeof selectedId === "string"
        ? parseInt(selectedId.replace("ru-", ""), 10)
        : NaN;
    const ru = Number.isFinite(ruId) ? radioUnitManager.get(ruId) : undefined;
    if (!ru) return;

    const baseColors: Record<RotateRingType, Cesium.Color> = {
      azimuth: Cesium.Color.CYAN,
      tilt: new Cesium.Color(1, 0.5, 0, 1),
    };

    const makeOutlineColorProperty = (ring: RotateRingType) =>
      new Cesium.CallbackProperty(
        (_time: Cesium.JulianDate | undefined, result: Cesium.Color) => {
          const base = baseColors[ring];
          const color =
            hoveredRingRef.current === ring ? brighter(base, 1.5) : base;
          return Cesium.Color.clone(color, result);
        },
        false,
      );

    // Tube cross-section shape (circle); radius scales with ring radius in world units.
    const shapeProperty = new Cesium.CallbackProperty(
      (time: Cesium.JulianDate | undefined) => {
        const t = time ?? viewer.clock.currentTime;
        const pos = entity.position?.getValue(t);
        if (!pos) return [];
        const radius = getRotateRingRadiusWorld(viewer, pos);
        return getTubeShape(
          radius * RING_TUBE_RADIUS_FRACTION,
          RING_SHAPE_SEGMENTS,
        );
      },
      false,
    ) as unknown as Cesium.Property;

    const azimuthPositionsProperty = new Cesium.CallbackProperty(
      (time: Cesium.JulianDate | undefined) => {
        const t = time ?? viewer.clock.currentTime;
        const pos = entity.position?.getValue(t);
        if (!pos) return [];
        const radius = getRotateRingRadiusWorld(viewer, pos);
        return getAzimuthRingPositions(pos, radius, RING_PATH_SEGMENTS);
      },
      false,
    ) as unknown as Cesium.Property;

    const tiltPositionsProperty = new Cesium.CallbackProperty(
      (time: Cesium.JulianDate | undefined) => {
        const t = time ?? viewer.clock.currentTime;
        const pos = entity.position?.getValue(t);
        if (!pos) return [];
        const radius = getRotateRingRadiusWorld(viewer, pos);
        const ruCurrent = radioUnitManager.get(ruId);
        const heading = ruCurrent?.mechAzimuth ?? ru.mechAzimuth ?? 0;
        return getTiltRingPositions(pos, radius, heading, RING_PATH_SEGMENTS);
      },
      false,
    ) as unknown as Cesium.Property;

    // PolylineVolume = tube with round cross-section along path → smooth torus rings.
    const azimuthEntity = viewer.entities.add({
      id: "__rotate_gizmo_azimuth__",
      polylineVolume: new Cesium.PolylineVolumeGraphics({
        positions: azimuthPositionsProperty,
        shape: shapeProperty,
        cornerType: Cesium.CornerType.ROUNDED,
        material: new Cesium.ColorMaterialProperty(
          makeOutlineColorProperty("azimuth"),
        ),
      }),
      show: true,
    });
    (azimuthEntity as any).disableDepthTestDistance = Number.POSITIVE_INFINITY;
    entityRefs.current.push(azimuthEntity);

    const tiltEntity = viewer.entities.add({
      id: "__rotate_gizmo_tilt__",
      polylineVolume: new Cesium.PolylineVolumeGraphics({
        positions: tiltPositionsProperty,
        shape: shapeProperty,
        cornerType: Cesium.CornerType.ROUNDED,
        material: new Cesium.ColorMaterialProperty(
          makeOutlineColorProperty("tilt"),
        ),
      }),
      show: true,
    });
    (tiltEntity as any).disableDepthTestDistance = Number.POSITIVE_INFINITY;
    entityRefs.current.push(tiltEntity);

    return () => {
      for (const e of entityRefs.current) {
        viewer.entities.remove(e);
      }
      entityRefs.current = [];
    };
  }, [viewer, rotateToolEnabled, showGizmo, selectedId]);

  return null;
};
