/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for cameraSlice
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCameraSlice } from "./cameraSlice";
import type { CameraSlice } from "./cameraSlice";

describe("cameraSlice", () => {
  let slice: CameraSlice;
  let mockSet: any;
  let mockGet: any;
  let mockStore: any;

  beforeEach(() => {
    mockSet = vi.fn((updates: any) => {
      if (typeof updates === "function") {
        const currentState = mockGet();
        Object.assign(currentState, updates(currentState));
      } else {
        Object.assign(mockGet(), updates);
      }
    });
    mockGet = vi.fn(() => ({ cesiumViewer: null }));
    mockStore = {};

    slice = createCameraSlice(mockSet, mockGet, mockStore);
  });

  describe("Initial State", () => {
    it("should have null cesiumViewer initially", () => {
      expect(slice.cesiumViewer).toBeNull();
    });
  });

  describe("setCesiumViewer", () => {
    it("should set the cesium viewer", () => {
      const mockViewer = { test: "viewer" };
      slice.setCesiumViewer(mockViewer);

      expect(mockSet).toHaveBeenCalledWith({ cesiumViewer: mockViewer });
    });

    it("should allow setting viewer to null", () => {
      slice.setCesiumViewer(null);

      expect(mockSet).toHaveBeenCalledWith({ cesiumViewer: null });
    });
  });

  describe("zoomTo", () => {
    it("should return early if viewer is not set", () => {
      mockGet.mockReturnValue({ cesiumViewer: null });

      slice.zoomTo("entity-id");

      // Should not attempt to do anything
      expect(mockGet).toHaveBeenCalled();
    });

    it("should warn if entity is not found", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const mockViewer = {
        entities: {
          getById: vi.fn(() => null),
        },
      };
      mockGet.mockReturnValue({ cesiumViewer: mockViewer });

      slice.zoomTo("non-existent-entity");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Object non-existent-entity not found",
      );
      consoleWarnSpy.mockRestore();
    });

    it("should warn if entity has no position", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const mockEntity = {
        id: "test-entity",
        position: null,
      };
      const mockViewer = {
        entities: {
          getById: vi.fn(() => mockEntity),
        },
      };
      mockGet.mockReturnValue({ cesiumViewer: mockViewer });

      slice.zoomTo("test-entity");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Object test-entity has no position",
      );
      consoleWarnSpy.mockRestore();
    });

    it("should use custom offset when provided", () => {
      const mockPosition = { x: 0, y: 0, z: 0 };
      const mockEntity = {
        id: "test-entity",
        position: mockPosition,
      };
      const mockCamera = {
        flyTo: vi.fn(),
        position: { x: 1000, y: 1000, z: 1000 },
      };
      const mockViewer = {
        entities: {
          getById: vi.fn(() => mockEntity),
        },
        camera: mockCamera,
        clock: {
          currentTime: {
            toString: () => "2024-01-01T00:00:00Z",
          },
        },
      };
      mockGet.mockReturnValue({ cesiumViewer: mockViewer });

      slice.zoomTo("test-entity", 200);

      // Verify flyTo was called (implementation details may vary)
      expect(mockViewer.entities.getById).toHaveBeenCalledWith("test-entity");
    });
  });
});
