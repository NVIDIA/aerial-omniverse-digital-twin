/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for highlightService
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as Cesium from "cesium";
import {
  CesiumHighlightManager,
  getHighlightManager,
} from "./highlightService";

describe("CesiumHighlightManager", () => {
  let mockViewer: any;
  let manager: CesiumHighlightManager;

  beforeEach(() => {
    // Mock viewer
    mockViewer = {
      scene: {
        postProcessStages: {
          add: vi.fn(),
        },
        requestRender: vi.fn(),
      },
      entities: {
        getById: vi.fn(),
      },
    };

    // Mock Cesium window object (highlightService also uses window.Cesium for some APIs)
    (window as any).Cesium = {
      PostProcessStageLibrary: {
        isSilhouetteSupported: vi.fn(() => true),
        createEdgeDetectionStage: vi.fn(() => ({
          uniforms: {
            color: undefined,
            length: 0,
          },
          selected: [],
        })),
        createSilhouetteStage: vi.fn((stages) => ({ stages })),
      },
      Color: {
        BLUE: {
          r: 0,
          g: 0,
          b: 1,
          a: 1,
          withAlpha: vi.fn((a) => ({ r: 0, g: 0, b: 1, a })),
        },
        LIME: {
          r: 0,
          g: 1,
          b: 0,
          a: 1,
          withAlpha: vi.fn((a) => ({ r: 0, g: 1, b: 0, a })),
        },
      },
      Cesium3DTileFeature: class MockCesium3DTileFeature {},
      ConstantProperty: class MockConstantProperty {
        constructor(public value: any) {}
      },
      ColorMaterialProperty: Cesium.ColorMaterialProperty,
    };

    manager = new CesiumHighlightManager(mockViewer);
  });

  describe("Constructor", () => {
    it("should initialize with viewer", () => {
      expect(manager).toBeDefined();
    });

    it("should initialize silhouettes if supported", () => {
      const { PostProcessStageLibrary } = (window as any).Cesium;
      expect(PostProcessStageLibrary.isSilhouetteSupported).toHaveBeenCalled();
      expect(mockViewer.scene.postProcessStages.add).toHaveBeenCalled();
    });

    it("should skip silhouettes if not supported", () => {
      const { PostProcessStageLibrary } = (window as any).Cesium;
      PostProcessStageLibrary.isSilhouetteSupported.mockReturnValue(false);

      const newViewer = { ...mockViewer };
      newViewer.scene.postProcessStages.add = vi.fn();

      new CesiumHighlightManager(newViewer);

      expect(newViewer.scene.postProcessStages.add).not.toHaveBeenCalled();
    });
  });

  describe("highlightObject", () => {
    it("should handle null object", () => {
      expect(() => manager.highlightObject(null, false)).not.toThrow();
    });

    it("should highlight 3D tile feature", () => {
      const mockFeature = new (window as any).Cesium.Cesium3DTileFeature();

      manager.highlightObject(mockFeature, false);

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });

    it("should highlight entity with box", () => {
      const mockEntity = {
        id: "entity-1",
        box: {
          material: { r: 1, g: 0, b: 0 },
        },
      };

      manager.highlightObject(mockEntity as any, false);

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
      expect(mockEntity.box.material).toHaveProperty("a");
    });

    it("should highlight entity with cylinder", () => {
      const mockEntity = {
        id: "entity-2",
        cylinder: {
          material: { r: 1, g: 0, b: 0 },
        },
      };

      manager.highlightObject(mockEntity as any, false);

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });

    it("should highlight entity with point", () => {
      const mockEntity = {
        id: "entity-3",
        point: {
          color: { r: 1, g: 0, b: 0 },
          pixelSize: 10,
        },
      };

      manager.highlightObject(mockEntity as any, false);

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });

    it("should highlight entity with model", () => {
      const mockEntity = {
        id: "entity-4",
        model: {
          color: { r: 1, g: 1, b: 1 },
        },
      };

      manager.highlightObject(mockEntity as any, false);

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });

    it("should highlight entity with ellipsoid using ColorMaterialProperty", () => {
      const originalMaterial = { r: 1, g: 1, b: 1, a: 1 };
      const mockEntity = {
        id: "ue-1",
        ellipsoid: {
          material: originalMaterial,
        },
      };

      manager.highlightObject(mockEntity as any, false);

      expect(Cesium.ColorMaterialProperty).toHaveBeenCalledWith(
        expect.objectContaining({ r: 0, g: 1, b: 0, a: 0.8 }),
      );
      expect(mockEntity.ellipsoid.material).toBeDefined();
      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });

    it("should re-apply selection material when same entity highlighted again (e.g. during drag)", () => {
      const mockEntity = {
        id: "ue-1",
        ellipsoid: {
          material: { r: 1, g: 1, b: 1 },
        },
      };

      manager.highlightObject(mockEntity as any, false);
      expect(Cesium.ColorMaterialProperty).toHaveBeenCalledTimes(1);
      mockViewer.scene.requestRender.mockClear();

      manager.highlightObject(mockEntity as any, false);

      expect(Cesium.ColorMaterialProperty).toHaveBeenCalledTimes(2);
      expect(mockEntity.ellipsoid.material).toBeDefined();
      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });
  });

  describe("unhighlightHoveredObject", () => {
    it("should clear hover highlight", () => {
      manager.unhighlightHoveredObject();

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });

    it("should clear silhouette if available", () => {
      const silhouette = manager.getSilhouetteGreen();
      if (silhouette) {
        silhouette.selected = [{ test: "feature" }];
      }

      manager.unhighlightHoveredObject();

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });
  });

  describe("unhighlightSelectedObject", () => {
    it("should clear selection highlight", () => {
      manager.unhighlightSelectedObject();

      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });

    it("should restore ellipsoid with ColorMaterialProperty when original was raw Color", () => {
      const rawColor = { r: 1, g: 1, b: 1, a: 1 };
      const mockEntity = {
        id: "ue-1",
        ellipsoid: {
          material: rawColor,
        },
      };
      mockViewer.entities.getById.mockReturnValue(mockEntity);

      manager.highlightObject(mockEntity as any, false);
      expect(mockEntity.ellipsoid.material).not.toBe(rawColor);
      vi.mocked(Cesium.ColorMaterialProperty).mockClear();

      manager.unhighlightSelectedObject();

      expect(Cesium.ColorMaterialProperty).toHaveBeenCalledWith(rawColor);
      expect(mockEntity.ellipsoid.material).toBeDefined();
      expect(mockViewer.scene.requestRender).toHaveBeenCalled();
    });
  });

  describe("getSilhouetteGreen", () => {
    it("should return green silhouette", () => {
      const silhouette = manager.getSilhouetteGreen();
      expect(silhouette).toBeDefined();
      expect(silhouette).toHaveProperty("selected");
    });
  });

  describe("destroy", () => {
    it("should clean up resources", () => {
      manager.destroy();

      expect(manager.getSilhouetteGreen()).toBeNull();
    });

    it("should clear all highlight references", () => {
      // Highlight something first
      const mockEntity = {
        id: "entity-1",
        box: {
          material: { r: 1, g: 0, b: 0 },
        },
      };

      manager.highlightObject(mockEntity as any, false);

      // Now destroy
      manager.destroy();

      // Should not throw when trying to unhighlight after destroy
      expect(() => manager.unhighlightSelectedObject()).not.toThrow();
    });
  });
});

describe("getHighlightManager", () => {
  let mockViewer: any;

  beforeEach(() => {
    mockViewer = {
      scene: {
        postProcessStages: {
          add: vi.fn(),
        },
        requestRender: vi.fn(),
      },
      entities: {
        getById: vi.fn(),
      },
    };

    (window as any).Cesium = {
      PostProcessStageLibrary: {
        isSilhouetteSupported: vi.fn(() => true),
        createEdgeDetectionStage: vi.fn(() => ({
          uniforms: {
            color: undefined,
            length: 0,
          },
          selected: [],
        })),
        createSilhouetteStage: vi.fn((stages) => ({ stages })),
      },
      Color: {
        BLUE: { r: 0, g: 0, b: 1, withAlpha: vi.fn() },
        LIME: { r: 0, g: 1, b: 0, withAlpha: vi.fn() },
      },
      Cesium3DTileFeature: class MockCesium3DTileFeature {},
      ConstantProperty: class MockConstantProperty {
        constructor(public value: any) {}
      },
    };
  });

  it("should return null if viewer is null", () => {
    const result = getHighlightManager(null);
    expect(result).toBeNull();
  });

  it("should return null if window.Cesium is undefined", () => {
    delete (window as any).Cesium;
    const result = getHighlightManager(mockViewer);
    expect(result).toBeNull();
  });

  it("should create and cache highlight manager", () => {
    const manager1 = getHighlightManager(mockViewer);
    const manager2 = getHighlightManager(mockViewer);

    expect(manager1).toBeInstanceOf(CesiumHighlightManager);
    expect(manager1).toBe(manager2); // Same instance
  });

  it("should store manager on viewer instance", () => {
    getHighlightManager(mockViewer);

    expect(mockViewer._highlightManager).toBeInstanceOf(CesiumHighlightManager);
  });

  it("should return existing manager if already created", () => {
    const existingManager = new CesiumHighlightManager(mockViewer);
    mockViewer._highlightManager = existingManager;

    const result = getHighlightManager(mockViewer);

    expect(result).toBe(existingManager);
  });
});
