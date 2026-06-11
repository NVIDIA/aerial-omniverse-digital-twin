/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for objectSlice
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createObjectSlice } from "./objectSlice";
import type { ObjectSlice } from "./objectSlice";

// Mock the dependencies
vi.mock("@/services/cesium", () => ({
  getHighlightManager: vi.fn(() => ({
    highlightObject: vi.fn(),
    unhighlightHoveredObject: vi.fn(),
    unhighlightSelectedObject: vi.fn(),
  })),
  isEntity: vi.fn(() => true),
  is3DTileFeature: vi.fn(() => false),
}));

vi.mock("../utils/localStorage", () => ({
  saveToolButtonStates: vi.fn(),
}));

vi.mock("~/managers/spawnZoneManager", () => ({
  spawnZoneManager: {
    clear: vi.fn(),
    setPoints: vi.fn(),
    getPoints: vi.fn(() => []),
  },
}));

vi.mock("~/managers/userEquipmentManager", () => ({
  userEquipmentManager: {
    get: vi.fn(),
    setWaypoints: vi.fn(),
  },
}));

describe("objectSlice", () => {
  let slice: ObjectSlice;
  let mockSet: any;
  let mockGet: any;
  let mockStore: any;

  beforeEach(() => {
    mockSet = vi.fn((updates: any) => {
      if (typeof updates === "function") {
        const currentState = mockGet();
        const newState = updates(currentState);
        return newState;
      }
    });
    mockGet = vi.fn(() => ({
      cesiumViewer: {
        entities: {
          getById: vi.fn((id: string) => ({ id })),
        },
      },
      selectedObject: null,
      hoveredObject: null,
      ghostPreview: null,
      moveToolEnabled: false,
      selectToolEnabled: true,
      hoveredGizmoAxis: null,
    }));
    mockStore = {};

    slice = createObjectSlice(mockSet, mockGet, mockStore);
  });

  describe("Initial State", () => {
    it("should have correct initial values", () => {
      expect(slice.draggingObject).toBeNull();
      expect(slice.addingObject).toBe(false);
      expect(slice.creatingEntityType).toBeNull();
      expect(slice.ghostPreview).toBeNull();
      expect(slice.selectedObject).toBeNull();
      expect(slice.hoveredObject).toBeNull();
      expect(slice.selectToolEnabled).toBe(true);
      expect(slice.moveToolEnabled).toBe(false);
      expect(slice.draggingGizmoAxis).toBeNull();
      expect(slice.hoveredGizmoAxis).toBeNull();
    });
  });

  describe("setDraggingObject", () => {
    it("should set dragging object and update selected object", () => {
      const mockEntity = { id: "entity-1" };
      slice.setDraggingObject(mockEntity);

      expect(mockSet).toHaveBeenCalledWith({
        draggingObject: mockEntity,
        selectedObject: mockEntity,
      });
    });
  });

  describe("startCreatingEntity", () => {
    it("should initialize ghost preview for radioUnit", () => {
      slice.startCreatingEntity("radioUnit");

      expect(mockSet).toHaveBeenCalledWith({
        creatingEntityType: "radioUnit",
        addingObject: true,
        ghostPreview: {
          entityType: "radioUnit",
          position: null,
          surfaceNormal: null,
          snappedToSurface: false,
          surfaceHeight: 0,
        },
      });
    });

    it("should handle null entity type", () => {
      slice.startCreatingEntity(null);

      expect(mockSet).toHaveBeenCalledWith({
        creatingEntityType: null,
        addingObject: true,
        ghostPreview: null,
      });
    });
  });

  describe("cancelCreatingEntity", () => {
    it("should reset creating entity state", () => {
      slice.cancelCreatingEntity();

      expect(mockSet).toHaveBeenCalledWith({
        creatingEntityType: null,
        addingObject: false,
        ghostPreview: null,
        spawnZoneCreationPoints: [],
        editingSpawnZone: false,
      });
    });
  });

  describe("updateGhostPreview", () => {
    it("should update ghost preview with partial values", () => {
      mockGet.mockReturnValue({
        ghostPreview: {
          entityType: "radioUnit",
          position: null,
          surfaceNormal: null,
          snappedToSurface: false,
          surfaceHeight: 0,
        },
      });

      const mockPosition = { x: 1, y: 2, z: 3 };
      slice.updateGhostPreview({ position: mockPosition });

      expect(mockSet).toHaveBeenCalled();
    });

    it("should not update if ghost preview is null", () => {
      mockGet.mockReturnValue({ ghostPreview: null });

      slice.updateGhostPreview({ snappedToSurface: true });

      const result = mockSet.mock.calls[0][0](mockGet());
      expect(result.ghostPreview).toBeNull();
    });
  });

  describe("stopDraggingObject", () => {
    it("should set draggingObject to null", () => {
      slice.stopDraggingObject();

      expect(mockSet).toHaveBeenCalledWith({ draggingObject: null });
    });
  });

  describe("setSelectToolEnabled", () => {
    it("should update select tool state", () => {
      slice.setSelectToolEnabled(false);

      expect(mockSet).toHaveBeenCalledWith({
        selectToolEnabled: false,
        hoveredObject: null,
      });
    });
  });

  describe("setSelectedObject", () => {
    it("should handle string entity ID", () => {
      const mockViewer = {
        entities: {
          getById: vi.fn((id: string) => ({ id })),
        },
      };
      mockGet.mockReturnValue({
        cesiumViewer: mockViewer,
        selectedObject: null,
        hoveredObject: null,
      });

      slice.setSelectedObject("entity-123");

      expect(mockViewer.entities.getById).toHaveBeenCalledWith("entity-123");
    });

    it("should handle null object", () => {
      slice.setSelectedObject(null);

      expect(mockSet).toHaveBeenCalled();
    });

    it("should return early if viewer is not available", () => {
      mockGet.mockReturnValue({ cesiumViewer: null });

      slice.setSelectedObject("test");

      // Should not call mockSet
      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe("setHoveredObject", () => {
    it("should set the hovered object", () => {
      const mockObject = { id: "hovered" };
      slice.setHoveredObject(mockObject);

      expect(mockSet).toHaveBeenCalledWith({ hoveredObject: mockObject });
    });
  });

  describe("Spawn Zone", () => {
    it("should have correct initial spawn zone state", () => {
      expect(slice.spawnZoneCreationPoints).toEqual([]);
      expect(slice.editingSpawnZone).toBe(false);
    });

    it("should start creating spawn zone with empty points and no ghost preview", () => {
      slice.startCreatingEntity("spawnZone");

      expect(mockSet).toHaveBeenCalledWith({
        creatingEntityType: "spawnZone",
        addingObject: true,
        spawnZoneCreationPoints: [],
        ghostPreview: null,
      });
    });

    it("should add a spawn zone creation point", () => {
      mockGet.mockReturnValue({
        spawnZoneCreationPoints: [],
      });

      slice.addSpawnZoneCreationPoint({
        lat: 35.0,
        lon: 139.0,
        height: 0,
      });

      expect(mockSet).toHaveBeenCalledWith({
        spawnZoneCreationPoints: [{ lat: 35.0, lon: 139.0, height: 0 }],
      });
    });

    it("should remove a spawn zone creation point", () => {
      mockGet.mockReturnValue({
        spawnZoneCreationPoints: [
          { lat: 35.0, lon: 139.0, height: 0 },
          { lat: 35.1, lon: 139.1, height: 0 },
          { lat: 35.2, lon: 139.2, height: 0 },
        ],
      });

      slice.removeSpawnZoneCreationPoint(1);

      expect(mockSet).toHaveBeenCalledWith({
        spawnZoneCreationPoints: [
          { lat: 35.0, lon: 139.0, height: 0 },
          { lat: 35.2, lon: 139.2, height: 0 },
        ],
      });
    });

    it("should update a spawn zone creation point", () => {
      mockGet.mockReturnValue({
        spawnZoneCreationPoints: [
          { lat: 35.0, lon: 139.0, height: 0 },
          { lat: 35.1, lon: 139.1, height: 0 },
        ],
      });

      slice.updateSpawnZoneCreationPoint(0, {
        lat: 36.0,
        lon: 140.0,
        height: 5,
      });

      expect(mockSet).toHaveBeenCalledWith({
        spawnZoneCreationPoints: [
          { lat: 36.0, lon: 140.0, height: 5 },
          { lat: 35.1, lon: 139.1, height: 0 },
        ],
      });
    });

    it("should commit spawn zone and reset state", () => {
      mockGet.mockReturnValue({
        spawnZoneCreationPoints: [
          { lat: 35.0, lon: 139.0, height: 0 },
          { lat: 35.1, lon: 139.1, height: 0 },
          { lat: 35.2, lon: 139.2, height: 0 },
        ],
      });

      slice.commitSpawnZone();

      expect(mockSet).toHaveBeenCalledWith({
        creatingEntityType: null,
        addingObject: false,
        ghostPreview: null,
        spawnZoneCreationPoints: [],
        editingSpawnZone: false,
      });
    });

    it("should not commit spawn zone with no points", () => {
      mockGet.mockReturnValue({
        spawnZoneCreationPoints: [],
      });

      slice.commitSpawnZone();

      expect(mockSet).not.toHaveBeenCalled();
    });

    it("should cancel creating entity and reset spawn zone state", () => {
      mockGet.mockReturnValue({
        creatingEntityType: "spawnZone",
        editingSpawnZone: false,
      });

      slice.cancelCreatingEntity();

      expect(mockSet).toHaveBeenCalledWith({
        creatingEntityType: null,
        addingObject: false,
        ghostPreview: null,
        spawnZoneCreationPoints: [],
        editingSpawnZone: false,
      });
    });
  });
});
