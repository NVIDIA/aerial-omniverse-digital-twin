/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for UE placement time indices
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useViewerStore } from "@/store/viewerStore";
import { getTimeIndicesForNewUE } from "./uePlacementTimeIndices";

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: {
    getState: vi.fn(),
  },
}));

describe("getTimeIndicesForNewUE", () => {
  beforeEach(() => {
    vi.mocked(useViewerStore.getState).mockReturnValue({
      ymlTimeData: null,
    } as any);
  });

  it("should return [0, 1] when ymlTimeData is null", () => {
    vi.mocked(useViewerStore.getState).mockReturnValue({
      ymlTimeData: null,
    } as any);

    expect(getTimeIndicesForNewUE()).toEqual([0, 1]);
  });

  it("should return [0, 1] when ymlTimeData is empty", () => {
    vi.mocked(useViewerStore.getState).mockReturnValue({
      ymlTimeData: [],
    } as any);

    expect(getTimeIndicesForNewUE()).toEqual([0, 1]);
  });

  it("should return time_idx values from ymlTimeData when present", () => {
    vi.mocked(useViewerStore.getState).mockReturnValue({
      ymlTimeData: [
        { time_idx: 0, batch_idx: 0, slot_idx: 0, symbol_idx: 0 },
        { time_idx: 1, batch_idx: 1, slot_idx: 0, symbol_idx: 0 },
        { time_idx: 2, batch_idx: 2, slot_idx: 0, symbol_idx: 0 },
        { time_idx: 3, batch_idx: 3, slot_idx: 0, symbol_idx: 0 },
      ],
    } as any);

    expect(getTimeIndicesForNewUE()).toEqual([0, 1, 2, 3]);
  });

  it("should handle sparse time indices from ymlTimeData", () => {
    vi.mocked(useViewerStore.getState).mockReturnValue({
      ymlTimeData: [
        { time_idx: 0, batch_idx: 0, slot_idx: 0, symbol_idx: 0 },
        { time_idx: 5, batch_idx: 1, slot_idx: 0, symbol_idx: 0 },
        { time_idx: 10, batch_idx: 2, slot_idx: 0, symbol_idx: 0 },
      ],
    } as any);

    expect(getTimeIndicesForNewUE()).toEqual([0, 5, 10]);
  });
});
