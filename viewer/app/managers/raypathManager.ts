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

type Subscriber = (raypaths: Raypath[]) => void;
type FilterSubscriber = (filters: RaypathFilterState) => void;

/**
 * Manager class for raypaths
 * Handles loading raypath data from the database and managing state
 */
class RaypathManager {
  private raypaths: Raypath[] = [];
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

  // Performance settings
  private maxRaysToLoad: number = 50000; // Maximum rays to load before sampling

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
   * Set all raypaths (replaces existing)
   */
  setAll(raypaths: Raypath[]): void {
    this.raypaths = [...raypaths];

    // Extract available RU and UE IDs
    this.availableRuIds.clear();
    this.availableUeIds.clear();
    for (const raypath of raypaths) {
      this.availableRuIds.add(raypath.ru_id);
      this.availableUeIds.add(raypath.ue_id);
    }

    // Load filters after we know available IDs
    this.loadFilters();
    this.notify();
  }

  /**
   * Clear all raypaths
   */
  clear(): void {
    this.raypaths = [];
    this.availableRuIds.clear();
    this.availableUeIds.clear();
    this.notify();
  }

  /**
   * Load raypaths from MinIO / Iceberg (Parquet or catalog query).
   */
  async load(database: string): Promise<void> {
    this.currentDatabase = database;

    try {
      const result = await fetchFromDataSource("raypaths", database);

      if (result.error) {
        console.error("[RaypathManager] MinIO load error:", result.error);
        return;
      }

      if (!result.data || result.data.length === 0) {
        return;
      }

      // Helper to convert to number
      const toNumber = (val: any): number => {
        if (typeof val === "number") return val;
        if (typeof val === "bigint") return Number(val);
        const num = Number(val);
        return isNaN(num) ? 0 : num;
      };

      // Normalize a single point [x, y, z]
      // Handles multiple formats:
      //   - Array: [x, y, z]
      //   - DuckDB/Iceberg struct (1-indexed): {"1": x, "2": y, "3": z}
      //   - DuckDB/Iceberg struct (0-indexed): {"0": x, "1": y, "2": z}
      //   - Named keys: {x, y, z}
      const normalizePoint = (point: any): number[] => {
        if (!point) return [0, 0, 0];
        if (Array.isArray(point)) {
          return [toNumber(point[0]), toNumber(point[1]), toNumber(point[2])];
        }
        if (typeof point === "object") {
          // DuckDB/Iceberg struct with 1-indexed string keys: {"1": x, "2": y, "3": z}
          if ("1" in point) {
            return [
              toNumber(point["1"]),
              toNumber(point["2"]),
              toNumber(point["3"]),
            ];
          }
          // 0-indexed string keys: {"0": x, "1": y, "2": z}
          if ("0" in point) {
            return [
              toNumber(point["0"]),
              toNumber(point["1"]),
              toNumber(point["2"]),
            ];
          }
          // Named keys: {x, y, z}
          if ("x" in point) {
            return [toNumber(point.x), toNumber(point.y), toNumber(point.z)];
          }
        }
        // Fallback for typed arrays or other iterables
        const arr = Array.from(point);
        return [toNumber(arr[0]), toNumber(arr[1]), toNumber(arr[2])];
      };

      // Helper to compute power in dBm from amplitude columns when not provided
      const computePowerDbm = (row: any): number => {
        const powerDb = row.power_dB ?? row.power_db;
        if (powerDb !== undefined && powerDb !== null) {
          return toNumber(powerDb);
        }
        // Calculate from ampl_re and ampl_im
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

      // Detect data format:
      //   Iceberg/DuckDB: each row is a complete ray, points is an array of structs
      //     e.g. points: [{"1": x1, "2": y1, "3": z1}, {"1": x2, "2": y2, "3": z2}]
      //   Legacy parquet: each row is a single point, rows are grouped by (ru_id, ue_id, time_idx)
      const firstRowPoints = result.data[0].points;
      const isCompleteRayFormat =
        Array.isArray(firstRowPoints) &&
        firstRowPoints.length >= 2 &&
        typeof firstRowPoints[0] === "object" &&
        !Array.isArray(firstRowPoints[0]);

      let processedData: {
        time_idx: number;
        ru_id: number;
        ue_id: number;
        points: number[][];
        power_dB: number;
      }[];

      if (isCompleteRayFormat) {
        // ── Iceberg format: each row is a complete ray ──
        // Normalize all points in each row's points array
        processedData = [];

        for (const row of result.data) {
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
        // ── Legacy parquet format: each row = one point, group by key ──
        const raypathMap = new Map<
          string,
          {
            time_idx: number;
            ru_id: number;
            ue_id: number;
            points: number[][];
            power_dB: number;
          }
        >();

        for (const row of result.data) {
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

      // Filter out raypaths with less than 2 points
      const validRaypaths = processedData.filter((r) => r.points.length >= 2);
      const invalidCount = processedData.length - validRaypaths.length;

      if (invalidCount > 0) {
        console.warn(
          `[RaypathManager] Filtered out ${invalidCount} raypaths with < 2 points`,
        );
      }

      this.setAll(validRaypaths as Raypath[]);
    } catch (error) {
      console.error(
        "[RaypathManager] Failed to load raypaths from MinIO:",
        error,
      );
    }
  }
}

// Export singleton instance
export const raypathManager = new RaypathManager();
