/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Raypath } from "@/types";
import {
  loadRaypathFilters,
  saveRaypathFilters,
  type RaypathFilterState,
} from "@/store/utils/localStorage";
import { fetchFromDataSource } from "./dataLoader";
import { minioClient } from "@/services/database";
import {
  DETAIL_RAY_BUDGET,
  DETAIL_TIMESTEP_RADIUS,
  GLOBAL_RAY_BUDGET,
  selectDetailRays,
  selectRaysForBudget,
} from "@/utils/rayBudget";

type Subscriber = (raypaths: Raypath[]) => void;
type FilterSubscriber = (filters: RaypathFilterState) => void;

/**
 * Manager class for raypaths
 * Handles loading raypath data from the database and managing state
 */
class RaypathManager {
  /** Published union of baseline + detail (what layers subscribe to). */
  private raypaths: Raypath[] = [];
  private baselineRays: Raypath[] = [];
  private detailRays: Raypath[] = [];
  private detailGeneration = 0;
  private baselineLoadGeneration = 0;
  private subscribers: Set<Subscriber> = new Set();
  private filterSubscribers: Set<FilterSubscriber> = new Set();

  // Filter state
  private filters: RaypathFilterState = {
    enabledRuIds: [],
    enabledUeIds: [],
    allRuEnabled: true,
    allUeEnabled: true,
  };
  private currentDatabase: string = "";

  // Available IDs (populated after loading)
  private availableRuIds: Set<number> = new Set();
  private availableUeIds: Set<number> = new Set();
  /**
   * Subscribe to state changes
   */
  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Subscribe to filter changes
   */
  subscribeToFilters(callback: FilterSubscriber): () => void {
    this.filterSubscribers.add(callback);
    return () => this.filterSubscribers.delete(callback);
  }

  /**
   * Notify all subscribers of state change (sends ALL raypaths, not filtered)
   */
  private notify() {
    this.subscribers.forEach((callback) => callback(this.raypaths));
  }

  /**
   * Notify filter subscribers of filter change
   * Creates a new object to ensure React detects the state change
   */
  private notifyFilterChange() {
    const filtersCopy: RaypathFilterState = {
      ...this.filters,
      enabledRuIds: [...this.filters.enabledRuIds],
      enabledUeIds: [...this.filters.enabledUeIds],
    };
    this.filterSubscribers.forEach((callback) => callback(filtersCopy));
  }

  /**
   * Get all raypaths (unfiltered)
   */
  getAllUnfiltered(): Raypath[] {
    return this.raypaths;
  }

  /**
   * Get filtered raypaths based on current filter settings
   */
  getFilteredRaypaths(): Raypath[] {
    return this.raypaths.filter((raypath) => {
      const ruEnabled =
        this.filters.allRuEnabled ||
        this.filters.enabledRuIds.includes(raypath.ru_id);
      const ueEnabled =
        this.filters.allUeEnabled ||
        this.filters.enabledUeIds.includes(raypath.ue_id);
      return ruEnabled && ueEnabled;
    });
  }

  /**
   * Get all raypaths (unfiltered - for rendering all entities)
   */
  getAll(): Raypath[] {
    return this.raypaths;
  }

  /**
   * Get available RU IDs from loaded raypaths
   */
  getAvailableRuIds(): number[] {
    return Array.from(this.availableRuIds).sort((a, b) => a - b);
  }

  /**
   * Get available UE IDs from loaded raypaths
   */
  getAvailableUeIds(): number[] {
    return Array.from(this.availableUeIds).sort((a, b) => a - b);
  }

  /**
   * Get current filter state
   */
  getFilters(): RaypathFilterState {
    return { ...this.filters };
  }

  /**
   * Set RU filter (only notifies filter subscribers, not main subscribers)
   */
  setRuFilter(ruId: number, enabled: boolean): void {
    // If transitioning from "all enabled" to individual selection,
    // first populate enabledRuIds with all available IDs
    if (this.filters.allRuEnabled) {
      this.filters.enabledRuIds = Array.from(this.availableRuIds);
      this.filters.allRuEnabled = false;
    }

    if (enabled) {
      if (!this.filters.enabledRuIds.includes(ruId)) {
        this.filters.enabledRuIds = [...this.filters.enabledRuIds, ruId];
      }
    } else {
      this.filters.enabledRuIds = this.filters.enabledRuIds.filter(
        (id) => id !== ruId,
      );
    }
    this.saveFilters();
    this.notifyFilterChange();
  }

  /**
   * Set UE filter (only notifies filter subscribers, not main subscribers)
   */
  setUeFilter(ueId: number, enabled: boolean): void {
    // If transitioning from "all enabled" to individual selection,
    // first populate enabledUeIds with all available IDs
    if (this.filters.allUeEnabled) {
      this.filters.enabledUeIds = Array.from(this.availableUeIds);
      this.filters.allUeEnabled = false;
    }

    if (enabled) {
      if (!this.filters.enabledUeIds.includes(ueId)) {
        this.filters.enabledUeIds = [...this.filters.enabledUeIds, ueId];
      }
    } else {
      this.filters.enabledUeIds = this.filters.enabledUeIds.filter(
        (id) => id !== ueId,
      );
    }
    this.saveFilters();
    this.notifyFilterChange();
  }

  /**
   * Toggle all RUs enabled/disabled (only notifies filter subscribers)
   */
  setAllRuEnabled(enabled: boolean): void {
    this.filters.allRuEnabled = enabled;
    if (enabled) {
      // When enabling all, populate with all available IDs
      this.filters.enabledRuIds = Array.from(this.availableRuIds);
    } else {
      this.filters.enabledRuIds = [];
    }
    this.saveFilters();
    this.notifyFilterChange();
  }

  /**
   * Toggle all UEs enabled/disabled (only notifies filter subscribers)
   */
  setAllUeEnabled(enabled: boolean): void {
    this.filters.allUeEnabled = enabled;
    if (enabled) {
      // When enabling all, populate with all available IDs
      this.filters.enabledUeIds = Array.from(this.availableUeIds);
    } else {
      this.filters.enabledUeIds = [];
    }
    this.saveFilters();
    this.notifyFilterChange();
  }

  /**
   * Check if a specific RU is enabled
   */
  isRuEnabled(ruId: number): boolean {
    return (
      this.filters.allRuEnabled || this.filters.enabledRuIds.includes(ruId)
    );
  }

  /**
   * Check if a specific UE is enabled
   */
  isUeEnabled(ueId: number): boolean {
    return (
      this.filters.allUeEnabled || this.filters.enabledUeIds.includes(ueId)
    );
  }

  /**
   * Save filters to localStorage (uses stable key even when database is empty)
   */
  private saveFilters(): void {
    saveRaypathFilters(this.currentDatabase, this.filters);
  }

  /**
   * Load filters from localStorage for current database
   */
  private loadFilters(): void {
    const savedFilters = loadRaypathFilters(this.currentDatabase);
    if (savedFilters) {
      this.filters = {
        ...savedFilters,
        enabledRuIds: [...savedFilters.enabledRuIds],
        enabledUeIds: [...savedFilters.enabledUeIds],
      };
    } else {
      // Default: all enabled
      this.filters = {
        enabledRuIds: Array.from(this.availableRuIds),
        enabledUeIds: Array.from(this.availableUeIds),
        allRuEnabled: true,
        allUeEnabled: true,
      };
    }
    this.notifyFilterChange();
  }

  /**
   * Replace baseline rays (clears any detail window).
   */
  setAll(raypaths: Raypath[]): void {
    this.baselineRays = [...raypaths];
    this.detailRays = [];
    this.detailGeneration += 1;
    this.publishMerged();
  }

  clearDetail(): void {
    this.detailGeneration += 1;
    if (this.detailRays.length === 0) return;
    this.detailRays = [];
    this.publishMerged();
  }

  private publishMerged(): void {
    this.raypaths = [...this.baselineRays, ...this.detailRays];

    this.availableRuIds.clear();
    this.availableUeIds.clear();
    for (const raypath of this.raypaths) {
      this.availableRuIds.add(raypath.ru_id);
      this.availableUeIds.add(raypath.ue_id);
    }

    this.loadFilters();
    this.notify();
  }

  /**
   * Clear all raypaths
   */
  clear(): void {
    this.baselineLoadGeneration += 1;
    this.baselineRays = [];
    this.detailRays = [];
    this.detailGeneration += 1;
    this.raypaths = [];
    this.availableRuIds.clear();
    this.availableUeIds.clear();
    this.notify();
  }

  isBaselineLoadCurrent(generation: number): boolean {
    return generation === this.baselineLoadGeneration;
  }

  /**
   * Load denser rays for centerTimeIdx ± radius when the timeline is stopped.
   */
  async loadDetailWindow(
    centerTimeIdx: number,
    radius: number = DETAIL_TIMESTEP_RADIUS,
    budget: number = DETAIL_RAY_BUDGET,
  ): Promise<void> {
    if (!minioClient.hasCatalog() || !this.currentDatabase) return;

    const generation = ++this.detailGeneration;
    const tMin = centerTimeIdx - radius;
    const tMax = centerTimeIdx + radius;

    try {
      const result = await fetchFromDataSource(
        "raypaths",
        this.currentDatabase,
        {
          where: `time_idx BETWEEN ${tMin} AND ${tMax}`,
          // Extra headroom so we still have ~budget after excluding baseline.
          rayBudget: budget + GLOBAL_RAY_BUDGET,
        },
      );

      if (generation !== this.detailGeneration) return;

      if (result.error || !result.data?.length) {
        this.detailRays = [];
        this.publishMerged();
        return;
      }

      const processed = this.processRawRows(result.data);
      const detail = selectDetailRays(processed, this.baselineRays, budget);

      if (generation !== this.detailGeneration) return;

      this.detailRays = detail;
      this.publishMerged();
    } catch (error) {
      if (generation !== this.detailGeneration) return;
      console.error("[RaypathManager] Detail window load failed:", error);
    }
  }

  private processRawRows(data: any[]): Raypath[] {
    const toNumber = (val: any): number => {
      if (typeof val === "number") return val;
      if (typeof val === "bigint") return Number(val);
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    };

    const normalizePoint = (point: any): number[] => {
      if (!point) return [0, 0, 0];
      if (Array.isArray(point)) {
        return [toNumber(point[0]), toNumber(point[1]), toNumber(point[2])];
      }
      if (typeof point === "object") {
        if ("1" in point) {
          return [
            toNumber(point["1"]),
            toNumber(point["2"]),
            toNumber(point["3"]),
          ];
        }
        if ("0" in point) {
          return [
            toNumber(point["0"]),
            toNumber(point["1"]),
            toNumber(point["2"]),
          ];
        }
        if ("x" in point) {
          return [toNumber(point.x), toNumber(point.y), toNumber(point.z)];
        }
      }
      const arr = Array.from(point);
      return [toNumber(arr[0]), toNumber(arr[1]), toNumber(arr[2])];
    };

    const computePowerDbm = (row: any): number => {
      const powerDb = row.power_dB ?? row.power_db;
      if (powerDb !== undefined && powerDb !== null) {
        return toNumber(powerDb);
      }
      const amplReArray = Array.isArray(row.ampl_re)
        ? row.ampl_re
        : Array.from(row.ampl_re || []);
      const amplImArray = Array.isArray(row.ampl_im)
        ? row.ampl_im
        : Array.from(row.ampl_im || []);
      const amplRe = Number(amplReArray[0] ?? 0);
      const amplIm = Number(amplImArray[0] ?? 0);
      const tapPower = amplRe * amplRe + amplIm * amplIm;
      return tapPower > 0 ? 10 * Math.log10(tapPower) + 30 : -200;
    };

    const firstRowPoints = data[0]?.points;
    const isCompleteRayFormat =
      Array.isArray(firstRowPoints) &&
      firstRowPoints.length >= 2 &&
      typeof firstRowPoints[0] === "object" &&
      !Array.isArray(firstRowPoints[0]);

    let processedData: Raypath[];

    if (isCompleteRayFormat) {
      processedData = [];
      for (const row of data) {
        const points = Array.isArray(row.points)
          ? row.points.map(normalizePoint)
          : [normalizePoint(row.points)];
        if (points.length < 2) continue;
        processedData.push({
          time_idx: toNumber(row.time_idx),
          ru_id: toNumber(row.ru_id),
          ue_id: toNumber(row.ue_id),
          points,
          power_dB: computePowerDbm(row),
        });
      }
    } else {
      const raypathMap = new Map<string, Raypath>();
      for (const row of data) {
        const key = `${row.ru_id}-${row.ue_id}-${row.time_idx}`;
        const singlePoint =
          Array.isArray(row.points) && row.points.length > 0
            ? normalizePoint(row.points[0])
            : normalizePoint(row.points);
        if (!raypathMap.has(key)) {
          raypathMap.set(key, {
            time_idx: toNumber(row.time_idx),
            ru_id: toNumber(row.ru_id),
            ue_id: toNumber(row.ue_id),
            points: [],
            power_dB: computePowerDbm(row),
          });
        }
        raypathMap.get(key)!.points.push(singlePoint);
      }
      processedData = Array.from(raypathMap.values());
    }

    return processedData.filter((r) => r.points.length >= 2);
  }

  /**
   * Load raypaths from MinIO / Iceberg (Parquet or catalog query).
   * Returns the load generation so callers can ignore stale completions.
   */
  async load(database: string): Promise<number> {
    const generation = ++this.baselineLoadGeneration;
    this.currentDatabase = database;

    try {
      const result = await fetchFromDataSource("raypaths", database);

      if (generation !== this.baselineLoadGeneration) return generation;

      if (result.error) {
        console.error("[RaypathManager] MinIO load error:", result.error);
        return generation;
      }

      if (!result.data || result.data.length === 0) {
        if (generation !== this.baselineLoadGeneration) return generation;
        this.setAll([]);
        return generation;
      }

      const validRaypaths = this.processRawRows(result.data);
      const budgeted = selectRaysForBudget(validRaypaths, GLOBAL_RAY_BUDGET);
      if (generation !== this.baselineLoadGeneration) return generation;
      this.setAll(budgeted);
      return generation;
    } catch (error) {
      console.error(
        "[RaypathManager] Failed to load raypaths from MinIO:",
        error,
      );
      return generation;
    }
  }
}

// Export singleton instance
export const raypathManager = new RaypathManager();
