/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useDistributedUnits hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDistributedUnits } from "./useDistributedUnits";
import type { DistributedUnit } from "@/types";

// Mock the distributed unit manager
vi.mock("~/managers/distributedUnitManager", () => ({
  distributedUnitManager: {
    getAll: vi.fn(() => new Map()),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("useDistributedUnits", () => {
  let mockDistributedUnitManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("~/managers/distributedUnitManager");
    mockDistributedUnitManager = module.distributedUnitManager;
    mockDistributedUnitManager.getAll.mockReturnValue(new Map());
    mockDistributedUnitManager.subscribe.mockReturnValue(vi.fn());
  });

  it("should return initial distributed units", () => {
    const initialDUs = new Map<number, DistributedUnit>();
    const mockDU: DistributedUnit = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      height: 10,
    };
    initialDUs.set(1, mockDU);

    mockDistributedUnitManager.getAll.mockReturnValue(initialDUs);

    const { result } = renderHook(() => useDistributedUnits());

    expect(result.current.size).toBe(1);
    expect(result.current.get(1)).toEqual(mockDU);
  });

  it("should subscribe to manager changes", () => {
    renderHook(() => useDistributedUnits());

    expect(mockDistributedUnitManager.subscribe).toHaveBeenCalled();
  });

  it("should update when manager changes", async () => {
    const initialDUs = new Map<number, DistributedUnit>();
    mockDistributedUnitManager.getAll.mockReturnValue(initialDUs);

    let subscriberCallback: any = null;
    mockDistributedUnitManager.subscribe.mockImplementation((callback) => {
      subscriberCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useDistributedUnits());

    expect(result.current.size).toBe(0);

    // Simulate manager update
    const updatedDUs = new Map<number, DistributedUnit>();
    const mockDU: DistributedUnit = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      height: 10,
    };
    updatedDUs.set(1, mockDU);

    if (subscriberCallback) {
      subscriberCallback(updatedDUs);
    }

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });
  });

  it("should unsubscribe on unmount", () => {
    const unsubscribe = vi.fn();
    mockDistributedUnitManager.subscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useDistributedUnits());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("should handle empty distributed units map", () => {
    mockDistributedUnitManager.getAll.mockReturnValue(new Map());

    const { result } = renderHook(() => useDistributedUnits());

    expect(result.current.size).toBe(0);
  });

  it("should handle multiple distributed units", () => {
    const dus = new Map<number, DistributedUnit>();
    for (let i = 1; i <= 3; i++) {
      dus.set(i, {
        id: i,
        position: { cartographic: {} as any, terrainHeight: 0 },
        height: i * 10,
      });
    }

    mockDistributedUnitManager.getAll.mockReturnValue(dus);

    const { result } = renderHook(() => useDistributedUnits());

    expect(result.current.size).toBe(3);
    expect(result.current.get(2)).toBeDefined();
    expect(result.current.get(2)?.height).toBe(20);
  });
});
