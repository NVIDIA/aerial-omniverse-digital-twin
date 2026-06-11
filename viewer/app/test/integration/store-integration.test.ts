/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for store interactions
 * Tests how different slices work together
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";
import { createCameraSlice } from "../../store/slices/cameraSlice";
import { createObjectSlice } from "../../store/slices/objectSlice";
import { createUISlice } from "../../store/slices/uiSlice";

// Mock dependencies
vi.mock("@/services/cesium", () => ({
  getHighlightManager: vi.fn(() => ({
    highlightObject: vi.fn(),
    unhighlightHoveredObject: vi.fn(),
    unhighlightSelectedObject: vi.fn(),
  })),
  isEntity: vi.fn(() => true),
  is3DTileFeature: vi.fn(() => false),
}));

vi.mock("@/store/utils/localStorage", () => ({
  saveToolButtonStates: vi.fn(),
  saveActiveTab: vi.fn(),
}));

vi.mock("~/managers/spawnZoneManager", () => ({
  spawnZoneManager: { clear: vi.fn() },
}));

vi.mock("~/managers/userEquipmentManager", () => ({
  userEquipmentManager: {
    get: vi.fn(),
    setWaypoints: vi.fn(),
  },
}));

describe("Store Integration Tests", () => {
  let store: any;

  beforeEach(() => {
    // Create a minimal integrated store
    store = create((set, get, store) => ({
      ...createCameraSlice(set, get, store),
      ...createObjectSlice(set, get, store),
      ...createUISlice(set, get, store),
    }));
  });

  describe("Camera and Object Selection Integration", () => {
    it("should handle selecting an object and zooming to it", () => {
      const mockViewer = {
        entities: {
          getById: vi.fn((id) => ({
            id,
            position: { x: 0, y: 0, z: 0 },
          })),
        },
        camera: {
          flyTo: vi.fn(),
          position: { x: 1000, y: 1000, z: 1000 },
        },
        clock: {
          currentTime: { toString: () => "2024-01-01" },
        },
      };

      // Set viewer
      store.getState().setCesiumViewer(mockViewer);
      expect(store.getState().cesiumViewer).toBe(mockViewer);

      // Select an object
      store.getState().setSelectedObject("entity-123");

      // Verify selection
      expect(mockViewer.entities.getById).toHaveBeenCalledWith("entity-123");
    });
  });

  describe("UI State and Tool Interactions", () => {
    it("should manage sidebar and tool states together", () => {
      // Initial state
      expect(store.getState().leftSidebarCollapsed).toBe(false);
      expect(store.getState().selectToolEnabled).toBe(true);

      // Toggle sidebar
      store.getState().toggleLeftSidebar();
      expect(store.getState().leftSidebarCollapsed).toBe(true);

      // Disable select tool
      store.getState().setSelectToolEnabled(false);
      expect(store.getState().selectToolEnabled).toBe(false);

      // Toggle sidebar back
      store.getState().toggleLeftSidebar();
      expect(store.getState().leftSidebarCollapsed).toBe(false);

      // Tool state should persist
      expect(store.getState().selectToolEnabled).toBe(false);
    });

    it("should handle tab switching while managing other UI state", () => {
      // Set initial tab
      expect(store.getState().activeRightTab).toBe("Rays");

      // Switch to Entities tab
      store.getState().setActiveRightTab("Entities");
      expect(store.getState().activeRightTab).toBe("Entities");

      // Toggle sidebar shouldn't affect tab
      store.getState().toggleRightSidebar();
      expect(store.getState().activeRightTab).toBe("Entities");
      expect(store.getState().rightSidebarCollapsed).toBe(true);
    });
  });

  describe("Object Creation Workflow", () => {
    it("should manage object creation state flow", () => {
      // Start creating a radio unit
      store.getState().startCreatingEntity("radioUnit");

      expect(store.getState().creatingEntityType).toBe("radioUnit");
      expect(store.getState().addingObject).toBe(true);
      expect(store.getState().ghostPreview).toBeDefined();
      expect(store.getState().ghostPreview?.entityType).toBe("radioUnit");

      // Update ghost preview position
      const mockPosition = { x: 1, y: 2, z: 3 };
      store.getState().updateGhostPreview({
        position: mockPosition,
        snappedToSurface: true,
      });

      expect(store.getState().ghostPreview?.snappedToSurface).toBe(true);

      // Cancel creation
      store.getState().cancelCreatingEntity();
      expect(store.getState().creatingEntityType).toBeNull();
      expect(store.getState().addingObject).toBe(false);
      expect(store.getState().ghostPreview).toBeNull();
    });
  });

  describe("Simulation State Management", () => {
    it("should manage simulation lifecycle", () => {
      // Initial state
      expect(store.getState().isSimulationRunning).toBe(false);

      // Start simulation
      store.getState().startSimulation();
      expect(store.getState().isSimulationRunning).toBe(true);

      // Stop simulation
      store.getState().stopSimulation();
      expect(store.getState().isSimulationRunning).toBe(false);
    });

    it("should handle database changes during simulation", () => {
      // Set initial database
      store.getState().setSelectedDatabase("db1");
      expect(store.getState().selectedDatabase).toBe("db1");

      // Start simulation
      store.getState().startSimulation();
      expect(store.getState().isSimulationRunning).toBe(true);

      // Change database (should still work while simulation running)
      store.getState().setSelectedDatabase("db2");
      expect(store.getState().selectedDatabase).toBe("db2");
      expect(store.getState().isSimulationRunning).toBe(true);
    });
  });

  describe("Multiple Object Selection Flow", () => {
    it("should handle selecting, hovering, and dragging objects", () => {
      const mockViewer = {
        entities: {
          getById: vi.fn((id) => ({ id })),
        },
      };

      store.getState().setCesiumViewer(mockViewer);

      // Select first object
      store.getState().setSelectedObject("entity-1");
      expect(store.getState().selectedObject).toEqual({ id: "entity-1" });

      // Hover over another object
      const hoveredObject = { id: "entity-2" };
      store.getState().setHoveredObject(hoveredObject);
      expect(store.getState().hoveredObject).toEqual(hoveredObject);

      // Start dragging
      const draggingObject = { id: "entity-1" };
      store.getState().setDraggingObject(draggingObject);
      expect(store.getState().draggingObject).toEqual(draggingObject);
      expect(store.getState().selectedObject).toEqual(draggingObject);

      // Stop dragging
      store.getState().stopDraggingObject();
      expect(store.getState().draggingObject).toBeNull();
    });
  });
});
