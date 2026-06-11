/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import { useViewerStore } from "../../store/viewerStore";
import { isEntity } from "../../services/cesium";
import { getGizmoArrowLengthWorld } from "../../utils/moveGizmo";
import type { ObjectType } from "@/types";

const POLYLINE_WIDTH = 6;
const GIZMO_IDS = [
  "__move_gizmo_x__",
  "__move_gizmo_y__",
  "__move_gizmo_z__",
] as const;
const AXIS_NAMES: ("x" | "y" | "z")[] = ["x", "y", "z"];

/** Brighter color for hover highlight (Blender-style) */
function brighter(color: Cesium.Color, factor: number): Cesium.Color {
  const c = color;
  return new Cesium.Color(
    Math.min(1, c.red * factor),
    Math.min(1, c.green * factor),
    Math.min(1, c.blue * factor),
    c.alpha,
  );
}

/** Check if the selected object is a draggable entity (ru, du, ue) that can show the move gizmo */
function isDraggableEntity(obj: unknown): obj is Cesium.Entity {
  if (!obj || typeof obj === "string") return false;
  if (!isEntity(obj as ObjectType)) return false;
  const id = (obj as Cesium.Entity).id;
  return (
    typeof id === "string" &&
    (id.startsWith("ru-") || id.startsWith("du-") || id.startsWith("ue-"))
  );
}

function getAxisFromMatrix(
  enu: Cesium.Matrix4,
  col: 0 | 1 | 2,
): Cesium.Cartesian3 {
  const i = col * 4;
  return new Cesium.Cartesian3(enu[i], enu[i + 1], enu[i + 2]);
}

interface MoveGizmoLayerProps {
  viewer: Cesium.Viewer;
}

/**
 * MoveGizmoLayer – Shows axis arrows (Blender-style move gizmo) at the selected
 * entity when the Move tool is enabled. Arrows are X (East, red), Y (North, green), Z (Up, blue).
 */
export const MoveGizmoLayer: React.FC<MoveGizmoLayerProps> = ({ viewer }) => {
  const entityRefs = useRef<Cesium.Entity[]>([]);
  const hoveredAxisRef = useRef<"x" | "y" | "z" | null>(null);

  const moveToolEnabled = useViewerStore((s) => s.moveToolEnabled);
  const selectedObject = useViewerStore((s) => s.selectedObject);
  const hoveredGizmoAxis = useViewerStore((s) => s.hoveredGizmoAxis);
  hoveredAxisRef.current = hoveredGizmoAxis;

  const showGizmo =
    moveToolEnabled &&
    selectedObject != null &&
    isDraggableEntity(selectedObject);

  const selectedId =
    showGizmo && isEntity(selectedObject) ? selectedObject.id : null;

  useEffect(() => {
    if (!viewer) return;

    for (const e of entityRefs.current) {
      viewer.entities.remove(e);
    }
    entityRefs.current = [];

    if (!moveToolEnabled || !showGizmo || !selectedId) {
      return;
    }

    const entity =
      typeof selectedId === "string"
        ? viewer.entities.getById(selectedId)
        : undefined;
    if (!entity) return;

    const baseColors = [
      Cesium.Color.RED,
      Cesium.Color.GREEN,
      Cesium.Color.BLUE,
    ] as const;

    const makeColorProperty = (axisIndex: number) =>
      new Cesium.CallbackProperty(
        (_time: Cesium.JulianDate | undefined, result: Cesium.Color) => {
          const base = baseColors[axisIndex];
          const axisName = AXIS_NAMES[axisIndex];
          const color =
            hoveredAxisRef.current === axisName ? brighter(base, 1.5) : base;
          return Cesium.Color.clone(color, result);
        },
        false,
      );

    const makePositions = (axisCol: 0 | 1 | 2) =>
      new Cesium.CallbackProperty((time: Cesium.JulianDate | undefined) => {
        const t = time ?? viewer.clock.currentTime;
        const pos = entity.position?.getValue(t);
        if (!pos) return [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO];
        const arrowLength = getGizmoArrowLengthWorld(viewer, pos);
        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
        const axis = getAxisFromMatrix(enu, axisCol);
        Cesium.Cartesian3.normalize(axis, axis);
        const tip = Cesium.Cartesian3.add(
          pos,
          Cesium.Cartesian3.multiplyByScalar(
            axis,
            arrowLength,
            new Cesium.Cartesian3(),
          ),
          new Cesium.Cartesian3(),
        );
        return [pos, tip];
      }, false) as unknown as Cesium.Property;

    for (let i = 0; i < 3; i++) {
      const axisCol = i as 0 | 1 | 2;
      const polyline = new Cesium.PolylineGraphics({
        positions: makePositions(axisCol),
        width: POLYLINE_WIDTH,
        material: new Cesium.ColorMaterialProperty(makeColorProperty(i)),
        clampToGround: false,
      });
      // @ts-ignore - disableDepthTestDistance exists on the underlying primitive
      (polyline as any).disableDepthTestDistance = Number.POSITIVE_INFINITY;

      const gizmoEntity = viewer.entities.add({
        id: GIZMO_IDS[i],
        polyline,
        show: true,
      });
      entityRefs.current.push(gizmoEntity);
    }

    return () => {
      for (const e of entityRefs.current) {
        viewer.entities.remove(e);
      }
      entityRefs.current = [];
    };
  }, [viewer, moveToolEnabled, showGizmo, selectedId]);

  return null;
};
