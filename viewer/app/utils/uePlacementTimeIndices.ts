/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useViewerStore } from "@/store/viewerStore";

/**
 * Returns the time indices to use when placing a new user equipment.
 * Uses ymlTimeData from the store when available so the UE has a position at every
 * timeline step; otherwise returns [0, 1] so the path polyline has at least 2 points.
 */
export function getTimeIndicesForNewUE(): number[] {
  const ymlTimeData = useViewerStore.getState().ymlTimeData;
  return ymlTimeData && ymlTimeData.length > 0
    ? ymlTimeData.map((t) => t.time_idx)
    : [0, 1];
}
