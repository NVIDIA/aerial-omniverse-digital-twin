/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  selectRaysForBudget,
  selectDetailRays,
  GLOBAL_RAY_BUDGET,
  DETAIL_RAY_BUDGET,
  DETAIL_TIMESTEP_RADIUS,
  rayFingerprint,
} from "./rayBudget";

function ray(
  ue_id: number,
  time_idx: number,
  power_dB: number,
  ru_id = 1,
  points: number[][] = [
    [0, 0, 0],
    [1, 1, 1],
  ],
) {
  return { ue_id, time_idx, power_dB, ru_id, points };
}

describe("selectRaysForBudget", () => {
  it("exports an 800-ray global budget", () => {
    expect(GLOBAL_RAY_BUDGET).toBe(800);
  });

  it("returns all rays when under budget", () => {
    const rays = [ray(1, 0, -50), ray(2, 1, -60)];
    expect(selectRaysForBudget(rays, 10)).toEqual(rays);
  });

  it("prefers higher power within the same UE and timestep", () => {
    const rays = [
      ray(1, 0, -90),
      ray(1, 0, -40),
      ray(1, 0, -70),
      ray(1, 1, -80),
      ray(1, 1, -30),
    ];
    const selected = selectRaysForBudget(rays, 2);
    expect(selected).toEqual([ray(1, 0, -40), ray(1, 1, -30)]);
  });

  it("covers every timestep before spending budget on a second ray per group", () => {
    const rays = [];
    for (const ue of [1, 2]) {
      for (const t of [0, 1, 2]) {
        rays.push(ray(ue, t, -100));
        rays.push(ray(ue, t, -10));
      }
    }

    const selected = selectRaysForBudget(rays, 6);
    expect(selected).toHaveLength(6);
    expect(selected.map((r) => [r.ue_id, r.time_idx, r.power_dB])).toEqual([
      [1, 0, -10],
      [1, 1, -10],
      [1, 2, -10],
      [2, 0, -10],
      [2, 1, -10],
      [2, 2, -10],
    ]);

    const times = new Set(selected.map((r) => r.time_idx));
    expect(times).toEqual(new Set([0, 1, 2]));
  });

  it("does not spend the whole budget on early timesteps when UEs×times exceeds budget", () => {
    const rays = [];
    for (const ue of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const t of [0, 1, 2, 3, 4]) {
        rays.push(ray(ue, t, -50 - ue));
      }
    }

    const selected = selectRaysForBudget(rays, 10);
    expect(selected).toHaveLength(10);

    const times = new Set(selected.map((r) => r.time_idx));
    expect(times.size).toBe(5);
    expect(selected.filter((r) => r.ue_id === 1)).toHaveLength(5);
    expect(selected.filter((r) => r.ue_id === 2)).toHaveLength(5);
  });
});

describe("selectDetailRays", () => {
  it("exports detail budget defaults", () => {
    expect(DETAIL_RAY_BUDGET).toBe(500);
    expect(DETAIL_TIMESTEP_RADIUS).toBe(3);
  });

  it("excludes baseline fingerprints then applies the budget", () => {
    const baseline = [
      ray(1, 5, -10, 1, [
        [0, 0, 0],
        [1, 0, 0],
      ]),
    ];
    const candidates = [
      ray(1, 5, -10, 1, [
        [0, 0, 0],
        [1, 0, 0],
      ]), // same as baseline
      ray(1, 5, -20, 1, [
        [0, 0, 0],
        [2, 0, 0],
      ]),
      ray(1, 6, -15, 1, [
        [0, 0, 0],
        [3, 0, 0],
      ]),
    ];

    const detail = selectDetailRays(candidates, baseline, 10);
    expect(detail).toHaveLength(2);
    expect(detail.map((r) => r.power_dB).sort((a, b) => b - a)).toEqual([
      -15, -20,
    ]);
    expect(
      detail.every((r) => rayFingerprint(r) !== rayFingerprint(baseline[0])),
    ).toBe(true);
  });
});
