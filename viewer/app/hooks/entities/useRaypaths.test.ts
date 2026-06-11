/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useRaypaths hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRaypaths } from "./useRaypaths";
import type { Raypath } from "@/types";

// Mock the raypath manager
vi.mock("~/managers/raypathManager", () => ({
  raypathManager: {
    getAll: vi.fn(() => []),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("useRaypaths", () => {
  let mockRaypathManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("~/managers/raypathManager");
    mockRaypathManager = module.raypathManager;
    mockRaypathManager.getAll.mockReturnValue([]);
    mockRaypathManager.subscribe.mockReturnValue(vi.fn());
  });

  it("should return initial raypaths", () => {
    const mockRaypath: Raypath = {
      id: 1,
      ruId: 1,
      ueId: 1,
      batchIdx: 0,
      ruPosition: { cartographic: {} as any, terrainHeight: 0 },
      uePositions: [],
      pathLoss: -100,
      reflectionCount: 3,
      pathPositions: [],
      signalStrengths: [],
    };
    const initialRaypaths = [mockRaypath];

    mockRaypathManager.getAll.mockReturnValue(initialRaypaths);

    const { result } = renderHook(() => useRaypaths());

    expect(result.current.length).toBe(1);
    expect(result.current[0]).toEqual(mockRaypath);
  });

  it("should subscribe to manager changes", () => {
    renderHook(() => useRaypaths());

    expect(mockRaypathManager.subscribe).toHaveBeenCalled();
  });

  it("should update when manager changes", async () => {
    mockRaypathManager.getAll.mockReturnValue([]);

    let subscriberCallback: any = null;
    mockRaypathManager.subscribe.mockImplementation((callback) => {
      subscriberCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useRaypaths());

    expect(result.current.length).toBe(0);

    // Simulate manager update
    const mockRaypath: Raypath = {
      id: 1,
      ruId: 1,
      ueId: 1,
      batchIdx: 0,
      ruPosition: { cartographic: {} as any, terrainHeight: 0 },
      uePositions: [],
      pathLoss: -100,
      reflectionCount: 3,
      pathPositions: [],
      signalStrengths: [],
    };
    const updatedRaypaths = [mockRaypath];

    if (subscriberCallback) {
      subscriberCallback(updatedRaypaths);
    }

    await waitFor(() => {
      expect(result.current.length).toBe(1);
    });
  });

  it("should unsubscribe on unmount", () => {
    const unsubscribe = vi.fn();
    mockRaypathManager.subscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useRaypaths());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("should handle empty raypaths array", () => {
    mockRaypathManager.getAll.mockReturnValue([]);

    const { result } = renderHook(() => useRaypaths());

    expect(result.current.length).toBe(0);
  });

  it("should handle multiple raypaths", () => {
    const raypaths: Raypath[] = [];
    for (let i = 1; i <= 5; i++) {
      raypaths.push({
        id: i,
        ruId: 1,
        ueId: i,
        batchIdx: 0,
        ruPosition: { cartographic: {} as any, terrainHeight: 0 },
        uePositions: [],
        pathLoss: -100,
        reflectionCount: 3,
        pathPositions: [],
        signalStrengths: [],
      });
    }

    mockRaypathManager.getAll.mockReturnValue(raypaths);

    const { result } = renderHook(() => useRaypaths());

    expect(result.current.length).toBe(5);
    expect(result.current[2]).toBeDefined();
    expect(result.current[2]?.ueId).toBe(3);
  });
});
