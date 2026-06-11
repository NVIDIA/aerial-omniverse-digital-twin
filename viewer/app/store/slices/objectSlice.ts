/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Object selection and interaction slice
 * Manages: selectedObject, hoveredObject, draggingObject, addingObject, selectToolEnabled
 */
import type { ObjectType, Waypoint } from "@/types";
import { saveToolButtonStates } from "../utils/localStorage";
import { getHighlightManager } from "@/services/cesium";
import * as Cesium from "cesium";
import { isEntity, is3DTileFeature } from "@/services/cesium";
import { spawnZoneManager } from "~/managers/spawnZoneManager";
import { userEquipmentManager } from "~/managers/userEquipmentManager";

// Helper to check if object is a valid Cesium object (Entity or 3D Tile Feature)
const isCesiumObject = (obj: any): boolean =>
  isEntity(obj) || is3DTileFeature(obj);

type LatLonHeight = { lat: number; lon: number; height: number };

/** Pending waypoint during map edit — keeps terrain vs offset split like Waypoint.position */
export type WaypointEditPoint = {
  lat: number;
  lon: number;
  terrainHeight: number;
  offsetHeight: number;
};

/**
 * Compute the convex hull of a set of 2D points (lat/lon) to guarantee convex polygon.
 */
function computeConvexHull(points: LatLonHeight[]): LatLonHeight[] {
  if (points.length < 3) return points;

  const sorted = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);

  const cross = (O: LatLonHeight, A: LatLonHeight, B: LatLonHeight) =>
    (A.lon - O.lon) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lon - O.lon);

  const lower: LatLonHeight[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: LatLonHeight[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half (duplicated at junction)
  lower.pop();
  upper.pop();

  return [...lower, ...upper];
}

/**
 * Entity types that can be created via the creation tool
 */
export type CreatableEntityType =
  | "radioUnit"
  | "distributedUnit"
  | "userEquipment"
  | "panel"
  | "spawnZone"
  | "waypoint"
  | null;

/**
 * Ghost preview state during object creation
 */
export interface GhostPreview {
  entityType: CreatableEntityType;
  position: Cesium.Cartesian3 | null;
  surfaceNormal: Cesium.Cartesian3 | null;
  snappedToSurface: boolean;
  surfaceHeight: number;
}

/** Axis for move gizmo constrained drag */
export type GizmoAxis = "x" | "y" | "z" | null;

/** Ring for rotate gizmo (RU orientation: azimuth = heading, tilt = pitch) */
export type RotateRingType = "azimuth" | "tilt" | null;

export interface ObjectSlice {
  // State
  draggingObject: Cesium.Entity | null;
  addingObject: boolean;
  creatingEntityType: CreatableEntityType;
  ghostPreview: GhostPreview | null;
  selectedObject: ObjectType;
  hoveredObject: ObjectType;
  selectToolEnabled: boolean;
  moveToolEnabled: boolean;
  rotateToolEnabled: boolean;
  /** When set, dragging moves the selected entity only along this axis (x=East, y=North, z=Up) */
  draggingGizmoAxis: GizmoAxis;
  /** Axis under the mouse for hover highlight (Blender-style) */
  hoveredGizmoAxis: GizmoAxis;
  /** When set, dragging rotates the selected RU on this ring (azimuth or tilt) */
  draggingRotateRing: RotateRingType;
  /** Rotate ring under the mouse for hover highlight */
  hoveredRotateRing: RotateRingType;
  /** Points accumulated during spawn zone creation / editing */
  spawnZoneCreationPoints: Array<{ lat: number; lon: number; height: number }>;
  editingSpawnZone: boolean;
  waypointEditingPoints: WaypointEditPoint[];
  waypointEditingId: number | null;

  // Actions
  setDraggingObject: (draggingObject: ObjectType) => void;
  setHoveredGizmoAxis: (axis: GizmoAxis) => void;
  setRotateToolEnabled: (enabled: boolean) => void;
  setHoveredRotateRing: (ring: RotateRingType) => void;
  setDraggingRotateRing: (ring: RotateRingType) => void;
  startCreatingEntity: (entityType: CreatableEntityType) => void;
  cancelCreatingEntity: () => void;
  updateGhostPreview: (preview: Partial<GhostPreview>) => void;
  stopDraggingObject: () => void;
  addSpawnZoneCreationPoint: (point: {
    lat: number;
    lon: number;
    height: number;
  }) => void;
  commitSpawnZone: () => void;
  startEditingSpawnZone: () => void;
  removeSpawnZoneCreationPoint: (index: number) => void;
  updateSpawnZoneCreationPoint: (
    index: number,
    point: { lat: number; lon: number; height: number },
  ) => void;
  setSelectToolEnabled: (enabled: boolean) => void;
  setMoveToolEnabled: (enabled: boolean) => void;
  /** Set transform tool: 'move' | 'rotate' | null. Mutually exclusive; one state update for instant UI. */
  setTransformTool: (tool: "move" | "rotate" | null) => void;
  setDraggingGizmoAxis: (axis: GizmoAxis) => void;
  setSelectedObject: (object: ObjectType | string) => void;
  setHoveredObject: (object: ObjectType) => void;
  startEditingWaypoints: (id: number) => void;
  addWaypoint: (point: WaypointEditPoint) => void;
  removeWaypoint: (index: number) => void;
  updateWaypoint: (index: number, point: WaypointEditPoint) => void;
  commitWaypoints: () => void;
  cancelWaypoints: () => void;
}

export const createObjectSlice = (
  set: any,
  _get: any,
  _store: any,
): ObjectSlice => ({
  // Initial state
  draggingObject: null,
  addingObject: false,
  creatingEntityType: null,
  ghostPreview: null,
  selectedObject: null,
  hoveredObject: null,
  selectToolEnabled: true,
  moveToolEnabled: false,
  rotateToolEnabled: false,
  draggingGizmoAxis: null,
  hoveredGizmoAxis: null,
  draggingRotateRing: null,
  hoveredRotateRing: null,
  spawnZoneCreationPoints: [],
  editingSpawnZone: false,
  waypointEditingPoints: [],
  waypointEditingId: null,

  // Actions
  setDraggingObject: (draggingObject) =>
    set({ draggingObject, selectedObject: draggingObject }),
  startCreatingEntity: (entityType: CreatableEntityType) => {
    if (entityType === "spawnZone") spawnZoneManager.clear();
    set({
      creatingEntityType: entityType,
      addingObject: true,
      spawnZoneCreationPoints:
        entityType === "spawnZone"
          ? []
          : (_get() as ObjectSlice).spawnZoneCreationPoints,
      ghostPreview:
        entityType && entityType !== "spawnZone"
          ? {
              entityType,
              position: null,
              surfaceNormal: null,
              snappedToSurface: false,
              surfaceHeight: 0,
            }
          : null,
    });
  },
  cancelCreatingEntity: () => {
    const state = _get() as ObjectSlice;
    const isSpawnZoneCreation =
      state.creatingEntityType === "spawnZone" && !state.editingSpawnZone;
    if (isSpawnZoneCreation) spawnZoneManager.clear();
    set({
      creatingEntityType: null,
      addingObject: false,
      ghostPreview: null,
      spawnZoneCreationPoints: [],
      editingSpawnZone: false,
    });
  },
  updateGhostPreview: (preview: Partial<GhostPreview>) =>
    set((state: ObjectSlice) => ({
      ghostPreview: state.ghostPreview
        ? { ...state.ghostPreview, ...preview }
        : null,
    })),
  stopDraggingObject: () => set({ draggingObject: null }),
  addSpawnZoneCreationPoint: (point: {
    lat: number;
    lon: number;
    height: number;
  }) => {
    const state = _get() as ObjectSlice;
    const points = [...state.spawnZoneCreationPoints, point];
    if (points.length >= 3)
      spawnZoneManager.setPoints(computeConvexHull(points));
    set({ spawnZoneCreationPoints: points });
  },
  commitSpawnZone: () => {
    const state = _get() as ObjectSlice;
    if (state.spawnZoneCreationPoints.length === 0) return;
    spawnZoneManager.setPoints(
      computeConvexHull(state.spawnZoneCreationPoints),
    );
    set({
      creatingEntityType: null,
      addingObject: false,
      ghostPreview: null,
      spawnZoneCreationPoints: [],
      editingSpawnZone: false,
    });
  },
  startEditingSpawnZone: () => {
    const points = spawnZoneManager.getPoints();
    if (points.length === 0) return;
    set({
      editingSpawnZone: true,
      creatingEntityType: "spawnZone" as CreatableEntityType,
      addingObject: true,
      spawnZoneCreationPoints: [...points],
      ghostPreview: null,
    });
  },
  removeSpawnZoneCreationPoint: (index: number) => {
    const state = _get() as ObjectSlice;
    const points = [...state.spawnZoneCreationPoints];
    points.splice(index, 1);
    if (points.length >= 3)
      spawnZoneManager.setPoints(computeConvexHull(points));
    else spawnZoneManager.clear();
    set({ spawnZoneCreationPoints: points });
  },
  updateSpawnZoneCreationPoint: (
    index: number,
    point: { lat: number; lon: number; height: number },
  ) => {
    const state = _get() as ObjectSlice;
    const points = [...state.spawnZoneCreationPoints];
    points[index] = point;
    if (points.length >= 3)
      spawnZoneManager.setPoints(computeConvexHull(points));
    else spawnZoneManager.clear();
    set({ spawnZoneCreationPoints: points });
  },
  setSelectToolEnabled: (enabled) => {
    set({
      selectToolEnabled: enabled,
      ...(!enabled ? { hoveredObject: null } : {}),
    });
    if (!enabled) {
      const viewer = _get().cesiumViewer;
      if (viewer) {
        const highlightManager = getHighlightManager(viewer);
        highlightManager?.unhighlightHoveredObject();
      }
    }
    const s = _get();
    saveToolButtonStates({
      selectToolEnabled: enabled,
      moveToolEnabled: s.moveToolEnabled ?? false,
      rotateToolEnabled: s.rotateToolEnabled ?? false,
    });
  },
  setMoveToolEnabled: (enabled) => {
    set({
      moveToolEnabled: enabled,
      ...(enabled ? {} : { hoveredGizmoAxis: null }),
    });
    const s = _get();
    saveToolButtonStates({
      selectToolEnabled: s.selectToolEnabled ?? true,
      moveToolEnabled: enabled,
      rotateToolEnabled: s.rotateToolEnabled ?? false,
    });
  },
  setRotateToolEnabled: (enabled) => {
    set({
      rotateToolEnabled: enabled,
      ...(enabled ? {} : { hoveredRotateRing: null }),
    });
    const s = _get();
    saveToolButtonStates({
      selectToolEnabled: s.selectToolEnabled ?? true,
      moveToolEnabled: s.moveToolEnabled ?? false,
      rotateToolEnabled: enabled,
    });
  },
  setTransformTool: (tool: "move" | "rotate" | null) => {
    set({
      moveToolEnabled: tool === "move",
      rotateToolEnabled: tool === "rotate",
      ...(tool !== "move" ? { hoveredGizmoAxis: null } : {}),
      ...(tool !== "rotate" ? { hoveredRotateRing: null } : {}),
    });
    const s = _get();
    saveToolButtonStates({
      selectToolEnabled: s.selectToolEnabled ?? true,
      moveToolEnabled: tool === "move",
      rotateToolEnabled: tool === "rotate",
    });
  },
  setDraggingGizmoAxis: (axis) => set({ draggingGizmoAxis: axis }),
  setHoveredGizmoAxis: (axis) => set({ hoveredGizmoAxis: axis }),
  setDraggingRotateRing: (ring) => set({ draggingRotateRing: ring }),
  setHoveredRotateRing: (ring) => set({ hoveredRotateRing: ring }),
  setSelectedObject: (object: ObjectType | string) => {
    const state = _get();
    const viewer = state.cesiumViewer;
    if (!viewer) return;

    const highlightManager = getHighlightManager(viewer);
    // Clear both hover and selection highlights
    highlightManager?.unhighlightHoveredObject();
    highlightManager?.unhighlightSelectedObject();

    let resolvedObject: ObjectType = null;
    if (typeof object === "string") {
      resolvedObject = viewer.entities.getById(object) || null;
    } else {
      resolvedObject = object;
    }

    // Update state after clearing highlights
    set({ selectedObject: resolvedObject, hoveredObject: null });

    // Apply new highlight after state is updated
    if (isCesiumObject(resolvedObject)) {
      highlightManager?.highlightObject(resolvedObject, false);
    }
  },
  setHoveredObject: (object) => set({ hoveredObject: object }),
  startEditingWaypoints: (id: number) => {
    const waypoints = userEquipmentManager.get(id)?.waypoints ?? [];
    const existingPoints = waypoints.map((w) => ({
      lat: Cesium.Math.toDegrees(w.position.cartographic.latitude),
      lon: Cesium.Math.toDegrees(w.position.cartographic.longitude),
      terrainHeight: w.position.terrainHeight,
      offsetHeight: w.position.cartographic.height,
    }));
    set({
      waypointEditingId: id,
      waypointEditingPoints: existingPoints,
      creatingEntityType: "waypoint",
      addingObject: true,
      ghostPreview: null,
    });
  },
  addWaypoint: (point: WaypointEditPoint) => {
    const state = _get() as ObjectSlice;
    const points = [...state.waypointEditingPoints, point];
    set({ waypointEditingPoints: points });
  },
  removeWaypoint: (index: number) => {
    const state = _get() as ObjectSlice;
    const points = [...state.waypointEditingPoints];
    points.splice(index, 1);
    set({ waypointEditingPoints: points });
  },
  updateWaypoint: (index: number, point: WaypointEditPoint) => {
    const state = _get() as ObjectSlice;
    const points = [...state.waypointEditingPoints];
    points[index] = point;
    set({ waypointEditingPoints: points });
  },
  commitWaypoints: () => {
    const state = _get() as ObjectSlice;
    if (state.waypointEditingPoints.length === 0) return;
    const existingWaypoints =
      userEquipmentManager.get(state.waypointEditingId!)?.waypoints ?? [];
    const maxExistingId =
      existingWaypoints.length > 0
        ? Math.max(...existingWaypoints.map((w) => w.id))
        : -1;

    const waypoints: Waypoint[] = state.waypointEditingPoints.map((p, i) => ({
      id:
        i < existingWaypoints.length
          ? existingWaypoints[i].id // preserve original ID
          : maxExistingId + 1 + (i - existingWaypoints.length), // new sequential ID
      // keep offset height (value from UI slider) and terrain height separate for 3D mobility
      position: {
        cartographic: Cesium.Cartographic.fromDegrees(
          p.lon,
          p.lat,
          p.offsetHeight,
        ),
        terrainHeight: p.terrainHeight,
      },
      speed: existingWaypoints[i]?.speed ?? 1.5,
      stop: existingWaypoints[i]?.stop ?? 0.0,
      azimuth_offset: existingWaypoints[i]?.azimuth_offset ?? 0.0,
      arrival_time: existingWaypoints[i]?.arrival_time ?? -1,
    }));
    userEquipmentManager.setWaypoints(state.waypointEditingId!, waypoints);
    set({
      waypointEditingId: null,
      waypointEditingPoints: [],
      creatingEntityType: null,
      addingObject: false,
    });
  },
  cancelWaypoints: () => {
    const state = _get() as ObjectSlice;
    if (state.waypointEditingId === null) return;
    set({
      waypointEditingId: null,
      waypointEditingPoints: [],
      creatingEntityType: null,
      addingObject: false,
    });
  },
});
