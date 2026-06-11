/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useRadioUnits hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRadioUnits } from "./useRadioUnits";
import type { RadioUnit } from "@/types";

// Mock the radio unit manager - inline to avoid hoisting issues
vi.mock("~/managers/radioUnitManager", () => ({
  radioUnitManager: {
    getAll: vi.fn(() => new Map()),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("useRadioUnits", () => {
  let mockRadioUnitManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Get the mocked module
    const module = await import("~/managers/radioUnitManager");
    mockRadioUnitManager = module.radioUnitManager;
    mockRadioUnitManager.getAll.mockReturnValue(new Map());
    mockRadioUnitManager.subscribe.mockReturnValue(vi.fn());
  });

  it("should return initial radio units", () => {
    const initialRadioUnits = new Map<number, RadioUnit>();
    const mockRU: RadioUnit = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      orientation: {} as any,
      cellId: 1,
      duId: 1,
      duManualAssign: false,
      enableRays: true,
      height: 10,
      mechAzimuth: 0,
      mechTilt: 0,
      panelType: "panel_01",
      radiatedPower: 20,
    };
    initialRadioUnits.set(1, mockRU);

    mockRadioUnitManager.getAll.mockReturnValue(initialRadioUnits);

    const { result } = renderHook(() => useRadioUnits());

    expect(result.current.size).toBe(1);
    expect(result.current.get(1)).toEqual(mockRU);
  });

  it("should subscribe to manager changes", () => {
    renderHook(() => useRadioUnits());

    expect(mockRadioUnitManager.subscribe).toHaveBeenCalled();
  });

  it("should update when manager changes", async () => {
    const initialRadioUnits = new Map<number, RadioUnit>();
    mockRadioUnitManager.getAll.mockReturnValue(initialRadioUnits);

    let subscriberCallback: any = null;
    mockRadioUnitManager.subscribe.mockImplementation((callback) => {
      subscriberCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useRadioUnits());

    expect(result.current.size).toBe(0);

    // Simulate manager update
    const updatedRadioUnits = new Map<number, RadioUnit>();
    const mockRU: RadioUnit = {
      id: 1,
      position: { cartographic: {} as any, terrainHeight: 0 },
      orientation: {} as any,
      cellId: 1,
      duId: 1,
      duManualAssign: false,
      enableRays: true,
      height: 10,
      mechAzimuth: 0,
      mechTilt: 0,
      panelType: "panel_01",
      radiatedPower: 20,
    };
    updatedRadioUnits.set(1, mockRU);

    if (subscriberCallback) {
      subscriberCallback(updatedRadioUnits);
    }

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });
  });

  it("should unsubscribe on unmount", () => {
    const unsubscribe = vi.fn();
    mockRadioUnitManager.subscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useRadioUnits());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("should handle empty radio units map", () => {
    mockRadioUnitManager.getAll.mockReturnValue(new Map());

    const { result } = renderHook(() => useRadioUnits());

    expect(result.current.size).toBe(0);
  });

  it("should handle multiple radio units", () => {
    const radioUnits = new Map<number, RadioUnit>();
    for (let i = 1; i <= 5; i++) {
      radioUnits.set(i, {
        id: i,
        position: { cartographic: {} as any, terrainHeight: 0 },
        orientation: {} as any,
        cellId: i,
        duId: i,
        duManualAssign: false,
        enableRays: true,
        height: 10,
        mechAzimuth: 0,
        mechTilt: 0,
        panelType: "panel_01",
        radiatedPower: 20,
      });
    }

    mockRadioUnitManager.getAll.mockReturnValue(radioUnits);

    const { result } = renderHook(() => useRadioUnits());

    expect(result.current.size).toBe(5);
    expect(result.current.get(3)).toBeDefined();
    expect(result.current.get(3)?.id).toBe(3);
  });
});
