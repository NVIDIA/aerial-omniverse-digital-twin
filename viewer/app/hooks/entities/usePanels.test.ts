/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for usePanels hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePanels } from "./usePanels";
import type { Panel } from "@/types";

// Mock the panel manager
vi.mock("~/managers/panelManager", () => ({
  panelManager: {
    getAll: vi.fn(() => new Map()),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("usePanels", () => {
  let mockPanelManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("~/managers/panelManager");
    mockPanelManager = module.panelManager;
    mockPanelManager.getAll.mockReturnValue(new Map());
    mockPanelManager.subscribe.mockReturnValue(vi.fn());
  });

  it("should return initial panels", () => {
    const initialPanels = new Map<number, Panel>();
    const mockPanel: Panel = {
      id: 1,
      name: "Panel 01",
      antennaNames: ["Antenna1"],
      frequencies: [28000000000],
      referenceFreq: 28000000000,
      dualPolarized: true,
      numLocAntennaHorz: 4,
      numLocAntennaVert: 4,
      antennaSpacingHorzCm: 50,
      antennaSpacingVertCm: 50,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 90,
    };
    initialPanels.set(1, mockPanel);

    mockPanelManager.getAll.mockReturnValue(initialPanels);

    const { result } = renderHook(() => usePanels());

    expect(result.current.size).toBe(1);
    expect(result.current.get(1)).toEqual(mockPanel);
  });

  it("should subscribe to manager changes", () => {
    renderHook(() => usePanels());

    expect(mockPanelManager.subscribe).toHaveBeenCalled();
  });

  it("should update when manager changes", async () => {
    const initialPanels = new Map<number, Panel>();
    mockPanelManager.getAll.mockReturnValue(initialPanels);

    let subscriberCallback: any = null;
    mockPanelManager.subscribe.mockImplementation((callback) => {
      subscriberCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => usePanels());

    expect(result.current.size).toBe(0);

    // Simulate manager update
    const updatedPanels = new Map<number, Panel>();
    const mockPanel: Panel = {
      id: 1,
      name: "Panel 01",
      antennaNames: ["Antenna1"],
      frequencies: [28000000000],
      referenceFreq: 28000000000,
      dualPolarized: true,
      numLocAntennaHorz: 4,
      numLocAntennaVert: 4,
      antennaSpacingHorzCm: 50,
      antennaSpacingVertCm: 50,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 90,
    };
    updatedPanels.set(1, mockPanel);

    if (subscriberCallback) {
      subscriberCallback(updatedPanels);
    }

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });
  });

  it("should unsubscribe on unmount", () => {
    const unsubscribe = vi.fn();
    mockPanelManager.subscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => usePanels());

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("should handle empty panels map", () => {
    mockPanelManager.getAll.mockReturnValue(new Map());

    const { result } = renderHook(() => usePanels());

    expect(result.current.size).toBe(0);
  });

  it("should handle multiple panels", () => {
    const panels = new Map<number, Panel>();
    for (let i = 1; i <= 3; i++) {
      panels.set(i, {
        id: i,
        name: `Panel ${i.toString().padStart(2, "0")}`,
        antennaNames: [`Antenna${i}`],
        frequencies: [28000000000],
        referenceFreq: 28000000000,
        dualPolarized: true,
        numLocAntennaHorz: 4,
        numLocAntennaVert: 4,
        antennaSpacingHorzCm: 50,
        antennaSpacingVertCm: 50,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: 90,
      });
    }

    mockPanelManager.getAll.mockReturnValue(panels);

    const { result } = renderHook(() => usePanels());

    expect(result.current.size).toBe(3);
    expect(result.current.get(2)).toBeDefined();
    expect(result.current.get(2)?.name).toBe("Panel 02");
  });
});
