/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useViewerStore } from "@/store/viewerStore";
import type { ScenarioParams } from "@/types";
import { fetchFromDataSource } from "./dataLoader";

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toInteger = (value: unknown): number | undefined => {
  const num = toFiniteNumber(value);
  return num !== undefined ? Math.trunc(num) : undefined;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
};

const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return undefined;
};

const toDiffuseType = (
  value: unknown,
): ScenarioParams["emDiffuseType"] | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "lambertian") {
    return "Lambertian";
  }
  if (normalized === "directional") {
    return "Directional";
  }
  return undefined;
};

const assignParam = <K extends keyof ScenarioParams>(
  target: Partial<ScenarioParams>,
  key: K,
  value: ScenarioParams[K] | undefined,
) => {
  if (value !== undefined) {
    target[key] = value;
  }
};

/**
 * Manager responsible for loading scenario parameters from the database
 * and keeping the viewer store in sync.
 */
export class ScenarioManager {
  private latestParams: Partial<ScenarioParams> | null = null;

  /**
   * Get the last successfully loaded params (if any)
   */
  getCurrentParams(): Partial<ScenarioParams> | null {
    return this.latestParams;
  }

  /**
   * Map a database result row into ScenarioParams
   */
  private mapRowToParams(
    row: Partial<ScenarioParams>,
  ): Partial<ScenarioParams> {
    const params: Partial<ScenarioParams> = {};

    const uePanel = toStringValue(row.uePanelType);
    assignParam(params, "uePanelType", uePanel);

    const ruPanel = toStringValue(row.ruPanelType);
    assignParam(params, "ruPanelType", ruPanel);

    const emittedRays = toInteger(row.emittedRays);
    assignParam(params, "emittedRays", emittedRays);

    const rayBounces = toInteger(row.rayBounces);
    assignParam(params, "rayBounces", rayBounces);

    const maxPaths = toInteger(row.maxPathsPerAntPair);
    assignParam(params, "maxPathsPerAntPair", maxPaths);

    const raysSparsity = toInteger(row.raysSparsity);
    if (raysSparsity !== undefined) {
      assignParam(params, "raysSparsity", Math.max(1, raysSparsity));
    }

    const batches = toInteger(row.batches);
    if (batches !== undefined) {
      assignParam(params, "batches", Math.max(1, batches));
    }

    const slotsPerBatch = toInteger(row.slotsPerBatch);
    assignParam(params, "slotsPerBatch", slotsPerBatch);

    const samplesPerSlot = toInteger(row.samplesPerSlot);
    assignParam(params, "samplesPerSlot", samplesPerSlot);

    const duration = toFiniteNumber(row.duration);
    assignParam(params, "duration", duration);

    const interval = toFiniteNumber(row.interval);
    assignParam(params, "interval", interval);

    const wideband = toBooleanValue(row.enableWidebandCFRs);
    assignParam(params, "enableWidebandCFRs", wideband);

    const numProceduralUEs = toInteger(row.numProceduralUEs);
    assignParam(params, "numProceduralUEs", numProceduralUEs);

    const ueHeight = toFiniteNumber(row.ueHeight);
    assignParam(params, "ueHeight", ueHeight);

    const ueMinSpeed = toFiniteNumber(row.ueMinSpeed);
    assignParam(params, "ueMinSpeed", ueMinSpeed);

    const ueMaxSpeed = toFiniteNumber(row.ueMaxSpeed);
    assignParam(params, "ueMaxSpeed", ueMaxSpeed);

    const seeded = toBooleanValue(row.enableSeededMobility);
    assignParam(params, "enableSeededMobility", seeded);

    const mobilitySeed = toInteger(row.mobilitySeed);
    assignParam(params, "mobilitySeed", mobilitySeed);

    const simulateRan = toBooleanValue(row.simulateRAN);
    assignParam(params, "simulateRAN", simulateRan);

    const diffuseType = toDiffuseType(row.emDiffuseType);
    assignParam(params, "emDiffuseType", diffuseType);

    const receptionRadius = toFiniteNumber(row.receptionSphereRadius);
    assignParam(params, "receptionSphereRadius", receptionRadius);

    const indoorPercentage = toFiniteNumber(row.percIndoorProceduralUEs);
    assignParam(params, "percIndoorProceduralUEs", indoorPercentage);

    const useSlotMode =
      typeof slotsPerBatch === "number" && slotsPerBatch > 0
        ? "Slots"
        : "Duration";
    assignParam(params, "simulationMode", useSlotMode);

    return params;
  }

  /**
   * Load scenario parameters from the selected database and update the store.
   */
  async load(database: string): Promise<void> {
    try {
      const result = await fetchFromDataSource("scenario", database);

      if (result.error) {
        console.error("[ScenarioManager] Load error:", result.error);
        return;
      }

      if (!result.data || result.data.length === 0) {
        console.warn("[ScenarioManager] No scenario data found");
        return;
      }

      const row = result.data[0] as Partial<ScenarioParams>;
      const params = this.mapRowToParams(row);
      this.latestParams = params;

      // Preserve ray visualization params from the store so "Load database" does not reset
      // the user's choices for sparsity, max visible paths, or dynamic range.
      const current = useViewerStore.getState().scenarioParams;
      params.raysSparsity = current.raysSparsity;
      params.maxVisibleRayPaths = current.maxVisibleRayPaths;
      params.maxDynamicRangeDB = current.maxDynamicRangeDB;

      const { updateScenarioParams } = useViewerStore.getState();
      updateScenarioParams(params);
    } catch (error) {
      console.error(
        "[ScenarioManager] Failed to load scenario parameters:",
        error,
      );
    }
  }
}

// Export singleton instance
export const scenarioManager = new ScenarioManager();
