/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useSpawnZone hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSpawnZone } from "./useSpawnZone";
import type { SpawnZonePoint } from "~/managers/spawnZoneManager";

// Mock the spawn zone manager - inline to avoid hoisting issues
vi.mock("~/managers/spawnZoneManager", () => ({
  spawnZoneManager: {
    getPoints: vi.fn(() => []),
    getAltitude: vi.fn(() => 10),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("useSpawnZone", () => {
  let mockSpawnZoneManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("~/managers/spawnZoneManager");
    mockSpawnZoneManager = module.spawnZoneManager;
    mockSpawnZoneManager.getPoints.mockReturnValue([]);
    mockSpawnZoneManager.getAltitude.mockReturnValue(10);
    mockSpawnZoneManager.subscribe.mockReturnValue(vi.fn());
  });

  it("should return initial points and altitude", () => {
    const points: SpawnZonePoint[] = [
      { lat: 35.0, lon: 139.0, height: 0 },
      { lat: 35.1, lon: 139.1, height: 0 },
      { lat: 35.2, lon: 139.2, height: 0 },
    ];
    mockSpawnZoneManager.getPoints.mockReturnValue(points);
    mockSpawnZoneManager.getAltitude.mockReturnValue(25);

    const { result } = renderHook(() => useSpawnZone());

    expect(result.current.points).toEqual(points);
    expect(result.current.altitude).toBe(25);
  });

  it("should subscribe to manager changes", () => {
    renderHook(() => useSpawnZone());

    expect(mockSpawnZoneManager.subscribe).toHaveBeenCalled();
  });

  it("should update when manager changes", async () => {
    mockSpawnZoneManager.getPoints.mockReturnValue([]);
    mockSpawnZoneManager.getAltitude.mockReturnValue(10);

    let subscriberCallback: any = null;
    mockSpawnZoneManager.subscribe.mockImplementation((callback: any) => {
      subscriberCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useSpawnZone());

    expect(result.current.points).toHaveLength(0);

    const updatedPoints: SpawnZonePoint[] = [
      { lat: 35.0, lon: 139.0, height: 0 },
      { lat: 35.1, lon: 139.1, height: 0 },
      { lat: 35.2, lon: 139.2, height: 0 },
    ];

    if (subscriberCallback) {
      subscriberCallback(updatedPoints, 50);
    }

    await waitFor(() => {
      expect(result.current.points).toHaveLength(3);
      expect(result.current.altitude).toBe(50);
    });
  });

  it("should unsubscribe on unmount", () => {
    const unsubscribe = vi.fn();
    mockSpawnZoneManager.subscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useSpawnZone());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("should handle empty points", () => {
    mockSpawnZoneManager.getPoints.mockReturnValue([]);

    const { result } = renderHook(() => useSpawnZone());

    expect(result.current.points).toHaveLength(0);
  });

  it("should handle multiple points", () => {
    const points: SpawnZonePoint[] = [];
    for (let i = 0; i < 5; i++) {
      points.push({ lat: 35.0 + i * 0.1, lon: 139.0 + i * 0.1, height: 0 });
    }

    mockSpawnZoneManager.getPoints.mockReturnValue(points);

    const { result } = renderHook(() => useSpawnZone());

    expect(result.current.points).toHaveLength(5);
    expect(result.current.points[2].lat).toBeCloseTo(35.2);
  });
});
