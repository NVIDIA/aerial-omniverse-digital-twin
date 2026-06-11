/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DistributedUnit, Panel, RadioUnit } from "@/types";

/**
 * Effective antenna element count for DU matching.
 *
 * AODT YAML may describe the panel geometry (`num_loc_antenna_*`), dual-polarization, and/or
 * enumerate every concrete antenna entry in `antenna_names`. Some exports under-report the grid
 * dimensions but still list every antenna, so we honor whichever representation yields the larger
 * element count.
 */
export function panelAntennaElementCount(panel: Panel): number {
  const gridElements = panel.numLocAntennaHorz * panel.numLocAntennaVert;
  const polarizedElements =
    panel.dualPolarized === 2 ? gridElements * 2 : gridElements;
  const namedElements = Array.isArray(panel.antennaNames)
    ? panel.antennaNames.length
    : 0;
  return Math.max(polarizedElements, namedElements);
}

/**
 * Carrier frequency for the DU in Hz. Defaults and YML use MHz; values already in Hz are unchanged.
 */
export function duReferenceCarrierHz(du: DistributedUnit): number {
  const r = du.referenceFreq;
  if (!Number.isFinite(r)) return NaN;
  return r >= 1e8 ? r : r * 1e6;
}

export function carrierMatchesDuAndPanel(
  du: DistributedUnit,
  panel: Panel,
): boolean {
  const duHz = duReferenceCarrierHz(du);
  if (!Number.isFinite(duHz)) return false;
  return Math.abs(duHz - panel.referenceFreq) <= 1;
}

/**
 * Canonical `panel_XX` string for UI and lookup. Parquet/YML may use a numeric panel id.
 */
export function normalizeRuPanelTypeKey(panelType: unknown): string {
  if (panelType === null || panelType === undefined) return "";
  if (typeof panelType === "number" && Number.isFinite(panelType)) {
    return `panel_${String(Math.trunc(panelType)).padStart(2, "0")}`;
  }
  const s = String(panelType).trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return `panel_${String(n).padStart(2, "0")}`;
  }
  return s;
}

export function findPanelForRuPanelType(
  panelType: unknown,
  panels: Map<number, Panel>,
): Panel | undefined {
  const key = normalizeRuPanelTypeKey(panelType);
  if (!key) return undefined;
  for (const panel of panels.values()) {
    if (panel.name === key) return panel;
  }
  const m = /^panel_(\d+)$/i.exec(key);
  if (m) {
    const id = parseInt(m[1], 10);
    return panels.get(id);
  }
  return undefined;
}

/**
 * Pick a valid panel type for newly created automatic RUs.
 *
 * Keeps the requested panel type when it exists, otherwise reuses a valid panel type already used
 * by the scenario's RUs, and finally falls back to the lowest-id panel in the loaded scenario.
 */
export function pickPanelTypeForNewRu(
  panelType: unknown,
  panels: Map<number, Panel>,
  existingRadioUnits: Iterable<Pick<RadioUnit, "panelType">> = [],
): string {
  const requested = findPanelForRuPanelType(panelType, panels);
  if (requested) return requested.name;

  for (const ru of existingRadioUnits) {
    const existing = findPanelForRuPanelType(ru.panelType, panels);
    if (existing) return existing.name;
  }

  return Array.from(panels.values()).sort((a, b) => a.id - b.id)[0]?.name ?? "";
}

/** Squared straight-line-ish distance (ground arc + Δheight)² for ordering by proximity. */
function ruDuDistanceSquared(ru: RadioUnit, du: DistributedUnit): number {
  const c1 = ru.position.cartographic;
  const c2 = du.position.cartographic;
  const lat1 = c1.latitude;
  const lon1 = c1.longitude;
  const lat2 = c2.latitude;
  const lon2 = c2.longitude;
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return Infinity;
  }
  const h1 = c1.height + ru.position.terrainHeight;
  const h2 = c2.height + du.position.terrainHeight;
  const R = 6371000;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const a =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const centralAngle =
    2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  const ground = R * centralAngle;
  const dh = h2 - h1;
  return ground * ground + dh * dh;
}

/**
 * When DU assignment is automatic, picks the closest DU whose numAntennas and carrier match the
 * panel referenced by {@link RadioUnit.panelType}. Returns null when no matching DU exists.
 */
export function findClosestMatchingDuId(
  ru: RadioUnit,
  distributedUnits: Map<number, DistributedUnit>,
  panels: Map<number, Panel>,
): number | null {
  if (ru.duManualAssign) return null;

  const panel = findPanelForRuPanelType(ru.panelType, panels);
  if (!panel) return null;

  const elements = panelAntennaElementCount(panel);

  let bestId: number | null = null;
  let bestDistSq = Infinity;

  for (const du of distributedUnits.values()) {
    if (du.numAntennas !== elements) continue;
    if (!carrierMatchesDuAndPanel(du, panel)) continue;

    const dSq = ruDuDistanceSquared(ru, du);
    if (!Number.isFinite(dSq)) continue;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestId = du.id;
    }
  }

  return bestId;
}
