/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for layerManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LayerManager } from "./layerManager";

// Mock the layer imports
vi.mock("@/components/layers/RaypathLayer", () => ({
  raypathLayer: {
    clear: vi.fn(),
  },
}));

vi.mock("@/components/layers/RadioUnitLayer", () => ({
  radioUnitLayer: {
    clear: vi.fn(),
  },
}));

vi.mock("@/components/layers/DistributedUnitLayer", () => ({
  distributedUnitLayer: {
    clear: vi.fn(),
  },
}));

vi.mock("@/components/layers/ScattererLayer", () => ({
  scattererLayer: {
    clear: vi.fn(),
  },
}));

vi.mock("@/components/layers/UserEquipmentLayer", () => ({
  userEquipmentLayer: {
    clear: vi.fn(),
  },
}));

vi.mock("@/components/layers/SpawnZoneLayer", () => ({
  spawnZoneLayer: {
    clear: vi.fn(),
  },
}));

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: {
    getState: vi.fn(() => ({
      cesiumViewer: {
        entities: {
          values: [],
          removeAll: vi.fn(),
        },
        scene: {
          requestRender: vi.fn(),
        },
        isDestroyed: vi.fn(() => false),
      },
    })),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("LayerManager", () => {
  let manager: LayerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new LayerManager();
  });

  describe("Layer properties", () => {
    it("should have all layer references", () => {
      expect(manager.raypathLayer).toBeDefined();
      expect(manager.radioUnitLayer).toBeDefined();
      expect(manager.distributedUnitLayer).toBeDefined();
      expect(manager.scattererLayer).toBeDefined();
      expect(manager.userEquipmentLayer).toBeDefined();
      expect(manager.spawnZoneLayer).toBeDefined();
    });
  });

  describe("clearAll", () => {
    it("should clear all layers", async () => {
      const { raypathLayer } = await import("@/components/layers/RaypathLayer");
      const { scattererLayer } =
        await import("@/components/layers/ScattererLayer");
      const { userEquipmentLayer } =
        await import("@/components/layers/UserEquipmentLayer");

      manager.clearAll();

      expect(raypathLayer.clear).toHaveBeenCalled();
      expect(scattererLayer.clear).toHaveBeenCalled();
      expect(userEquipmentLayer.clear).toHaveBeenCalled();
    });

    it("should handle null viewer gracefully", async () => {
      const { useViewerStore } = await import("@/store/viewerStore");
      useViewerStore.getState.mockReturnValueOnce({
        cesiumViewer: null,
      });

      expect(() => manager.clearAll()).not.toThrow();
    });

    it("should not clear when viewer is destroyed", async () => {
      const { useViewerStore } = await import("@/store/viewerStore");
      const { raypathLayer } = await import("@/components/layers/RaypathLayer");
      useViewerStore.getState.mockReturnValueOnce({
        cesiumViewer: {
          isDestroyed: vi.fn(() => true),
          entities: { values: [], removeAll: vi.fn() },
          scene: { requestRender: vi.fn() },
        },
      });
      manager.clearAll();
      expect(raypathLayer.clear).not.toHaveBeenCalled();
    });

    it("should handle isDestroyed throwing", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { useViewerStore } = await import("@/store/viewerStore");
      useViewerStore.getState.mockReturnValueOnce({
        cesiumViewer: {
          isDestroyed: vi.fn(() => {
            throw new Error("destroy check failed");
          }),
          entities: { values: [], removeAll: vi.fn() },
          scene: { requestRender: vi.fn() },
        },
      });
      expect(() => manager.clearAll()).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("should call entities.removeAll when remainingCount > 0", async () => {
      const removeAll = vi.fn();
      const { useViewerStore } = await import("@/store/viewerStore");
      useViewerStore.getState.mockReturnValueOnce({
        cesiumViewer: {
          isDestroyed: vi.fn(() => false),
          entities: { values: [1, 2, 3], removeAll },
          scene: { requestRender: vi.fn() },
        },
      });
      manager.clearAll();
      expect(removeAll).toHaveBeenCalled();
    });

    it("should handle scene.requestRender throwing", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { useViewerStore } = await import("@/store/viewerStore");
      useViewerStore.getState.mockReturnValueOnce({
        cesiumViewer: {
          isDestroyed: vi.fn(() => false),
          entities: { values: [], removeAll: vi.fn() },
          scene: {
            requestRender: vi.fn(() => {
              throw new Error("render failed");
            }),
          },
        },
      });
      expect(() => manager.clearAll()).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("Singleton instance", () => {
    it("should export a singleton instance", async () => {
      const { layerManager } = await import("./layerManager");

      expect(layerManager).toBeInstanceOf(LayerManager);
    });
  });
});
