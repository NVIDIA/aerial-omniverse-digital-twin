/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useScatterers hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useScatterers } from "./useScatterers";
import type { Scatterer } from "@/types";

// Mock the scatterer manager
vi.mock("~/managers/scattererManager", () => ({
  scattererManager: {
    getAll: vi.fn(() => new Map()),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("useScatterers", () => {
  let mockScattererManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("~/managers/scattererManager");
    mockScattererManager = module.scattererManager;
    mockScattererManager.getAll.mockReturnValue(new Map());
    mockScattererManager.subscribe.mockReturnValue(vi.fn());
  });

  it("should return initial scatterers", () => {
    const initialScatterers = new Map<number, Scatterer>();
    const mockScatterer: Scatterer = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      batchIndices: [0],
      routePositions: [[[100, 200, 300]]],
    };
    initialScatterers.set(1, mockScatterer);

    mockScattererManager.getAll.mockReturnValue(initialScatterers);

    const { result } = renderHook(() => useScatterers());

    expect(result.current.size).toBe(1);
    expect(result.current.get(1)).toEqual(mockScatterer);
  });

  it("should subscribe to manager changes", () => {
    renderHook(() => useScatterers());

    expect(mockScattererManager.subscribe).toHaveBeenCalled();
  });

  it("should update when manager changes", async () => {
    const initialScatterers = new Map<number, Scatterer>();
    mockScattererManager.getAll.mockReturnValue(initialScatterers);

    let subscriberCallback: any = null;
    mockScattererManager.subscribe.mockImplementation((callback) => {
      subscriberCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useScatterers());

    expect(result.current.size).toBe(0);

    // Simulate manager update
    const updatedScatterers = new Map<number, Scatterer>();
    const mockScatterer: Scatterer = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      batchIndices: [0],
      routePositions: [[[100, 200, 300]]],
    };
    updatedScatterers.set(1, mockScatterer);

    if (subscriberCallback) {
      subscriberCallback(updatedScatterers);
    }

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });
  });

  it("should unsubscribe on unmount", () => {
    const unsubscribe = vi.fn();
    mockScattererManager.subscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useScatterers());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("should handle empty scatterers map", () => {
    mockScattererManager.getAll.mockReturnValue(new Map());

    const { result } = renderHook(() => useScatterers());

    expect(result.current.size).toBe(0);
  });

  it("should handle multiple scatterers", () => {
    const scatterers = new Map<number, Scatterer>();
    for (let i = 1; i <= 5; i++) {
      scatterers.set(i, {
        id: i,
        position: { cartographic: {} as any, terrainHeight: 0 },
        batchIndices: [0],
        routePositions: [[[i * 100, i * 200, i * 300]]],
      });
    }

    mockScattererManager.getAll.mockReturnValue(scatterers);

    const { result } = renderHook(() => useScatterers());

    expect(result.current.size).toBe(5);
    expect(result.current.get(3)).toBeDefined();
    expect(result.current.get(3)?.id).toBe(3);
  });
});
