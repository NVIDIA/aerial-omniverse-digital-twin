/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useUserEquipments hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useUserEquipments } from "./useUserEquipments";
import type { UserEquipment } from "@/types";

// Mock the user equipment manager
vi.mock("~/managers/userEquipmentManager", () => ({
  userEquipmentManager: {
    getAll: vi.fn(() => new Map()),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("useUserEquipments", () => {
  let mockUserEquipmentManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("~/managers/userEquipmentManager");
    mockUserEquipmentManager = module.userEquipmentManager;
    mockUserEquipmentManager.getAll.mockReturnValue(new Map());
    mockUserEquipmentManager.subscribe.mockReturnValue(vi.fn());
  });

  it("should return initial user equipments", () => {
    const initialUEs = new Map<number, UserEquipment>();
    const mockUE: UserEquipment = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      batchIndices: [0],
      routePositions: [[[100, 200, 300]]],
    };
    initialUEs.set(1, mockUE);

    mockUserEquipmentManager.getAll.mockReturnValue(initialUEs);

    const { result } = renderHook(() => useUserEquipments());

    expect(result.current.size).toBe(1);
    expect(result.current.get(1)).toEqual(mockUE);
  });

  it("should subscribe to manager changes", () => {
    renderHook(() => useUserEquipments());

    expect(mockUserEquipmentManager.subscribe).toHaveBeenCalled();
  });

  it("should update when manager changes", async () => {
    const initialUEs = new Map<number, UserEquipment>();
    mockUserEquipmentManager.getAll.mockReturnValue(initialUEs);

    let subscriberCallback: any = null;
    mockUserEquipmentManager.subscribe.mockImplementation((callback) => {
      subscriberCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useUserEquipments());

    expect(result.current.size).toBe(0);

    // Simulate manager update
    const updatedUEs = new Map<number, UserEquipment>();
    const mockUE: UserEquipment = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      batchIndices: [0],
      routePositions: [[[100, 200, 300]]],
    };
    updatedUEs.set(1, mockUE);

    if (subscriberCallback) {
      subscriberCallback(updatedUEs);
    }

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });
  });

  it("should unsubscribe on unmount", () => {
    const unsubscribe = vi.fn();
    mockUserEquipmentManager.subscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useUserEquipments());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("should handle empty user equipments map", () => {
    mockUserEquipmentManager.getAll.mockReturnValue(new Map());

    const { result } = renderHook(() => useUserEquipments());

    expect(result.current.size).toBe(0);
  });

  it("should handle multiple user equipments", () => {
    const ues = new Map<number, UserEquipment>();
    for (let i = 1; i <= 10; i++) {
      ues.set(i, {
        id: i,
        position: { cartographic: {} as any, terrainHeight: 0 },
        batchIndices: [0],
        routePositions: [[[i * 100, i * 200, i * 300]]],
      });
    }

    mockUserEquipmentManager.getAll.mockReturnValue(ues);

    const { result } = renderHook(() => useUserEquipments());

    expect(result.current.size).toBe(10);
    expect(result.current.get(5)).toBeDefined();
    expect(result.current.get(5)?.id).toBe(5);
  });
});
