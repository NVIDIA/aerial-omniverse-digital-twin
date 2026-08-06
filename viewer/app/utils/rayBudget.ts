/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export const GLOBAL_RAY_BUDGET = 800;
export const DETAIL_RAY_BUDGET = 500;
export const DETAIL_TIMESTEP_RADIUS = 3;

export interface RayBudgetCandidate {
  ue_id: number;
  time_idx: number;
  power_dB: number;
}

export interface RayFingerprintSource extends RayBudgetCandidate {
  ru_id: number;
  points: number[][];
}

/** Stable identity for excluding baseline rays from a detail window. */
export function rayFingerprint(r: RayFingerprintSource): string {
  const path = r.points
    .map((p) => `${p[0] ?? 0},${p[1] ?? 0},${p[2] ?? 0}`)
    .join(";");
  return [r.ru_id, r.ue_id, r.time_idx, r.power_dB, path].join("|");
}

/** Highest-power per (ue, time), round-robin UEs→timesteps up to `budget`. */
export function selectRaysForBudget<T extends RayBudgetCandidate>(
  rays: T[],
  budget: number = GLOBAL_RAY_BUDGET,
): T[] {
  if (budget <= 0 || rays.length === 0) return [];
  if (rays.length <= budget) return rays;

  const groups = new Map<string, T[]>();
  for (const ray of rays) {
    const key = `${ray.ue_id}\0${ray.time_idx}`;
    const list = groups.get(key);
    if (list) list.push(ray);
    else groups.set(key, [ray]);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => b.power_dB - a.power_dB);
  }

  const ueIds = [...new Set(rays.map((r) => r.ue_id))].sort((a, b) => a - b);
  const timeIdxs = [...new Set(rays.map((r) => r.time_idx))].sort(
    (a, b) => a - b,
  );

  const selected: T[] = [];
  let depth = 0;

  while (selected.length < budget) {
    let added = false;
    for (const ueId of ueIds) {
      for (const timeIdx of timeIdxs) {
        if (selected.length >= budget) break;
        const list = groups.get(`${ueId}\0${timeIdx}`);
        if (!list || depth >= list.length) continue;
        selected.push(list[depth]);
        added = true;
      }
      if (selected.length >= budget) break;
    }
    if (!added) break;
    depth += 1;
  }

  return selected;
}

/** Detail candidates: drop rays already in `exclude`, then apply the budget selector. */
export function selectDetailRays<T extends RayFingerprintSource>(
  candidates: T[],
  exclude: Iterable<RayFingerprintSource>,
  budget: number = DETAIL_RAY_BUDGET,
): T[] {
  const excluded = new Set([...exclude].map(rayFingerprint));
  const novel = candidates.filter((r) => !excluded.has(rayFingerprint(r)));
  return selectRaysForBudget(novel, budget);
}
