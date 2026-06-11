/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const raypaths = [
    {
      time_idx: 0,
      ru_id: 1,
      ue_id: 2,
      points: [
        [0.1, 0.2, 10],
        [0.3, 0.4, 20],
      ],
      power_dB: -80,
    },
  ];

  const createdEntities = new Map<string, Record<string, unknown>>();
  const viewer = {
    terrainProvider: null,
    scene: {
      requestRender: vi.fn(),
    },
    entities: {
      getById: vi.fn((id: string) => createdEntities.get(id)),
      remove: vi.fn((entity: Record<string, unknown>) => {
        for (const [id, storedEntity] of createdEntities) {
          if (storedEntity === entity) {
            createdEntities.delete(id);
            break;
          }
        }
      }),
      getOrCreateEntity: vi.fn((id: string) => {
        if (!createdEntities.has(id)) {
          createdEntities.set(id, { id });
        }
        return createdEntities.get(id);
      }),
    },
  };

  return {
    createdEntities,
    raypaths,
    viewer,
    getState: vi.fn(() => ({
      cesiumViewer: viewer,
      rayPathsVisible: true,
      scenarioParams: {
        maxDynamicRangeDB: 50,
      },
    })),
    storeSubscribe: vi.fn(() => vi.fn()),
    raypathSubscribe: vi.fn(() => vi.fn()),
    raypathSubscribeToFilters: vi.fn(() => vi.fn()),
    isRuEnabled: vi.fn(() => true),
    isUeEnabled: vi.fn(() => true),
  };
});

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: {
    getState: mocks.getState,
    subscribe: mocks.storeSubscribe,
  },
}));

vi.mock("~/managers/raypathManager", () => ({
  raypathManager: {
    getAll: vi.fn(() => mocks.raypaths),
    subscribe: mocks.raypathSubscribe,
    subscribeToFilters: mocks.raypathSubscribeToFilters,
    isRuEnabled: mocks.isRuEnabled,
    isUeEnabled: mocks.isUeEnabled,
  },
}));

vi.mock("@/services/cesium", () => ({
  canSampleTerrain: vi.fn(() => false),
  localToCartographicBatched: vi.fn((points: number[][]) =>
    points.map(([longitude, latitude, height]) => ({
      longitude,
      latitude,
      height,
    })),
  ),
}));

vi.mock("@/services/visualization", () => ({
  getViridisColor: vi.fn(() => [68, 1, 84]),
}));

vi.mock("@/constants", () => ({
  TIMELINE_CONFIG: {
    baseTime: {
      dayNumber: 1,
      secondsOfDay: 0,
    },
    timeStep: 1,
  },
}));

describe("RaypathLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createdEntities.clear();
  });

  it("visualizes raypaths when crypto.randomUUID is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
    });

    try {
      const { raypathLayer } = await import("./RaypathLayer");

      await expect(raypathLayer.visualize()).resolves.toBeUndefined();

      expect(mocks.viewer.entities.getOrCreateEntity).toHaveBeenCalledWith(
        expect.stringMatching(/^raypath-/),
      );
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }
  });
});
