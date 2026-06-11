/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { localToCartographicBatched } from "@/services/cesium";
import { minioClient } from "@/services/database";
import type { UserEquipment, TimeIndexedPosition, Waypoint } from "@/types";
import { fetchFromDataSource } from "./dataLoader";
import { panelManager } from "./panelManager";

type Subscriber = (userEquipments: Map<number, UserEquipment>) => void;

/**
 * Manager class for user equipment
 * Handles loading UE data from the database and managing state
 */
export class UserEquipmentManager {
  private userEquipments: Map<number, UserEquipment> = new Map();
  private subscribers: Set<Subscriber> = new Set();

  /**
   * Subscribe to state changes
   */
  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Notify all subscribers of state change
   */
  private notify() {
    this.subscribers.forEach((callback) => callback(this.userEquipments));
  }

  /**
   * Get all user equipments
   */
  getAll(): Map<number, UserEquipment> {
    return this.userEquipments;
  }

  /**
   * Get a single user equipment by ID
   */
  get(id: number): UserEquipment | undefined {
    return this.userEquipments.get(id);
  }

  /**
   * Add a user equipment
   */
  add(ue: UserEquipment): void {
    const newMap = new Map(this.userEquipments);
    newMap.set(ue.id, ue);
    this.userEquipments = newMap;
    this.notify();
  }

  /**
   * Remove a user equipment
   */
  remove(id: number): void {
    const newMap = new Map(this.userEquipments);
    newMap.delete(id);
    this.userEquipments = newMap;
    this.notify();
  }

  /**
   * Update a user equipment
   */
  update(id: number, updates: Partial<UserEquipment>): void {
    const existing = this.userEquipments.get(id);
    if (existing) {
      const newMap = new Map(this.userEquipments);
      newMap.set(id, { ...existing, ...updates });
      this.userEquipments = newMap;
      this.notify();
    }
  }

  /**
   * Set all user equipments (replaces existing)
   */
  setAll(userEquipments: Map<number, UserEquipment>): void {
    this.userEquipments = new Map(userEquipments);
    this.notify();
  }

  setWaypoints(id: number, waypoints: Waypoint[]): void {
    const existing = this.userEquipments.get(id);
    if (existing) {
      const newMap = new Map(this.userEquipments);
      newMap.set(id, { ...existing, waypoints });
      this.userEquipments = newMap;
      this.notify();
    }
  }

  addWaypoint(id: number, waypoint: Waypoint): void {
    const existing = this.userEquipments.get(id);
    if (existing) {
      const newMap = new Map(this.userEquipments);
      newMap.set(id, {
        ...existing,
        waypoints: [...existing.waypoints, waypoint],
      });
      this.userEquipments = newMap;
      this.notify();
    }
  }

  removeWaypoint(id: number, index: number): void {
    const existing = this.userEquipments.get(id);
    if (existing) {
      const newMap = new Map(this.userEquipments);
      newMap.set(id, {
        ...existing,
        waypoints: existing.waypoints.filter((_, i) => i !== index),
      });
      this.userEquipments = newMap;
      this.notify();
    }
  }

  updateWaypoint(id: number, index: number, updates: Partial<Waypoint>): void {
    const existing = this.userEquipments.get(id);
    if (existing) {
      const newMap = new Map(this.userEquipments);
      const firstPositionIndex = existing.positions.findIndex(
        (p) => p.timeIdx === 0,
      );
      newMap.set(id, {
        ...existing,
        positions:
          index === 0 && updates.position && firstPositionIndex >= 0
            ? existing.positions.map((pos, i) =>
                i === firstPositionIndex
                  ? { ...pos, position: updates.position! }
                  : pos,
              )
            : existing.positions,
        waypoints: existing.waypoints.map((wp, i) =>
          i === index ? { ...wp, ...updates } : wp,
        ),
      });
      this.userEquipments = newMap;
      this.notify();
    }
  }

  getWaypoints(id: number): Waypoint[] {
    const existing = this.userEquipments.get(id);
    return existing?.waypoints ?? [];
  }

  /**
   * Clear all user equipments
   */
  clear(): void {
    this.userEquipments = new Map();
    this.notify();
  }

  /**
   * Normalize Parquet data structure to match expected tabular column names
   * Converts array-like objects to actual arrays and ensures numeric values
   */
  private normalizeParquetData(ueData: any[]): any[] {
    // Helper to convert to number
    const toNumber = (val: any): number => {
      if (typeof val === "number") return val;
      if (typeof val === "bigint") return Number(val);
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    };

    // Helper to normalize a position array [x, y, z]
    const normalizePosition = (pos: any): number[] => {
      let arr: any[] = [0, 0, 0];
      if (!pos) return arr;

      if (Array.isArray(pos)) {
        arr = pos;
      } else if (typeof pos === "object") {
        arr = Object.values(pos);
      } else {
        arr = Array.from(pos);
      }
      return [toNumber(arr[0]), toNumber(arr[1]), toNumber(arr[2])];
    };

    return ueData.map((ue) => {
      // Ensure batch_indices is an array of numbers
      const batchIndices = Array.isArray(ue.batch_indices)
        ? ue.batch_indices.map(toNumber)
        : ue.batch_indices
          ? Array.from(ue.batch_indices).map(toNumber)
          : [];

      // Ensure route_positions is a 3D array with proper numbers
      const routePositions = Array.isArray(ue.route_positions)
        ? ue.route_positions.map((batch: any) => {
            const batchArray = Array.isArray(batch) ? batch : Array.from(batch);
            return batchArray.map((pos: any) => normalizePosition(pos));
          })
        : ue.route_positions
          ? Array.from(ue.route_positions).map((batch: any) => {
              const batchArray = Array.isArray(batch)
                ? batch
                : Array.from(batch);
              return batchArray.map((pos: any) => normalizePosition(pos));
            })
          : [];

      // Ensure panel is an array of numbers
      const panel = Array.isArray(ue.panel)
        ? ue.panel.map(toNumber)
        : ue.panel
          ? Array.from(ue.panel).map(toNumber)
          : [];

      // Normalize waypoint_points (same format as route_positions)
      const waypointPoints = Array.isArray(ue.waypoint_points)
        ? ue.waypoint_points.map((batch: any) => {
            const batchArray = Array.isArray(batch) ? batch : Array.from(batch);
            return batchArray.map((pos: any) => normalizePosition(pos));
          })
        : ue.waypoint_points
          ? Array.from(ue.waypoint_points).map((batch: any) => {
              const batchArray = Array.isArray(batch)
                ? batch
                : Array.from(batch);
              return batchArray.map((pos: any) => normalizePosition(pos));
            })
          : [];

      // Normalize batched numeric arrays
      const normalizeBatchedNumbers = (field: any): number[][] =>
        Array.isArray(field)
          ? field.map((batch: any) => {
              const arr = Array.isArray(batch) ? batch : Array.from(batch);
              return arr.map(toNumber);
            })
          : field
            ? Array.from(field).map((batch: any) => {
                const arr = Array.isArray(batch) ? batch : Array.from(batch);
                return arr.map(toNumber);
              })
            : [];

      const waypointSpeeds = normalizeBatchedNumbers(ue.waypoint_speeds);
      const waypointStops = normalizeBatchedNumbers(ue.waypoint_stops);
      const waypointAzimuthOffsets = normalizeBatchedNumbers(
        ue.waypoint_azimuth_offsets,
      );

      return {
        // Map Parquet column names to expected field names
        id: ue.id ?? ue.ID,
        is_manual: ue.is_manual,
        is_manual_mobility: ue.is_manual_mobility,
        is_indoor_mobility: ue.is_indoor_mobility,
        radiated_power: ue.radiated_power,
        height: ue.height,
        mech_tilt: ue.mech_tilt,
        batch_indices: batchIndices,
        route_positions: routePositions,
        waypoint_points: waypointPoints,
        waypoint_speeds: waypointSpeeds,
        waypoint_stops: waypointStops,
        waypoint_azimuth_offsets: waypointAzimuthOffsets,
        panel: panel,
      };
    });
  }

  /**
   * Process user equipment data and convert to world coordinates
   * Returns a map of UE ID to array of position data for each time index
   * @param userEquipments Raw user equipment data from database
   */
  private async processUserEquipmentData(
    ueData: any[],
  ): Promise<Map<number, UserEquipment>> {
    const result = new Map<number, UserEquipment>();

    // Normalize data structure for MinIO/Parquet sources
    const normalizedData = this.normalizeParquetData(ueData);

    for (const ue of normalizedData) {
      const positions: TimeIndexedPosition[] = [];
      let timeIdx = 0;

      // Process each batch (typically there's only one batch per UE)
      for (let batchIdx = 0; batchIdx < ue.batch_indices.length; batchIdx++) {
        const routePositions = ue.route_positions[batchIdx];

        // Skip if no positions in this batch
        if (!routePositions || routePositions.length === 0) {
          continue;
        }
        const cartographicBatch = localToCartographicBatched(routePositions);

        // Process each time index in the waypoint
        for (let idx = 0; idx < routePositions.length; idx++) {
          positions.push({
            timeIdx: timeIdx,
            position: {
              cartographic: cartographicBatch[idx],
              terrainHeight: 0,
            },
          });
          timeIdx++;
        }
      }

      // Construct waypoints
      const waypoints: Waypoint[] = [];
      if (ue.is_manual) {
        for (let batchIdx = 0; batchIdx < ue.batch_indices.length; batchIdx++) {
          const wpBatch = ue.waypoint_points[batchIdx];
          if (!wpBatch || wpBatch.length === 0) continue;
          const speedBatch = ue.waypoint_speeds?.[batchIdx];
          const stopBatch = ue.waypoint_stops?.[batchIdx];
          const azimuthBatch = ue.waypoint_azimuth_offsets?.[batchIdx];
          const cartographicBatch = localToCartographicBatched(wpBatch);
          for (let idx = 0; idx < wpBatch.length; idx++) {
            const cartographic = cartographicBatch[idx];
            const terrainHeight = cartographic.height;
            cartographic.height = 0;
            waypoints.push({
              id: waypoints.length,
              position: { cartographic, terrainHeight },
              speed: speedBatch?.[idx] ?? 0,
              stop: stopBatch?.[idx] ?? 0,
              azimuth_offset: azimuthBatch?.[idx] ?? 0,
              arrival_time: -1,
            });
          }
        }
      }

      result.set(ue.id, {
        id: ue.id,
        isManual: ue.is_manual,
        isManualMobility: ue.is_manual_mobility,
        isIndoorMobility: ue.is_indoor_mobility,
        radiatedPower: ue.radiated_power,
        height: ue.height,
        mechTilt: ue.mech_tilt,
        panel: [panelManager.getByIndex(ue.panel[0])?.id ?? ue.panel[0]],
        positions: positions,
        waypoints,
      });
    }
    return result;
  }

  /**
   * Log Iceberg table names for the current namespace (helps debug missing `ues`).
   */
  private async logCatalogTablesHint(namespace: string): Promise<void> {
    if (!minioClient.hasCatalog()) return;
    try {
      const tables = await minioClient.getTablesFromCatalog(namespace);
      console.warn(
        `[UserEquipmentManager] Iceberg tables in namespace "${namespace}":`,
        tables.length ? tables.join(", ") : "(none)",
      );
    } catch (e) {
      console.warn("[UserEquipmentManager] listTables failed:", e);
    }
  }

  /**
   * Load user equipments from the database (Parquet or Iceberg).
   * In catalog mode, data must come from a registered Iceberg table named `ues`
   * (case may vary); raw Parquet in MinIO alone is not queried.
   */
  async load(database: string): Promise<void> {
    try {
      const ns = minioClient.getCurrentDatabase();

      let result = await fetchFromDataSource("ues", database);

      if (
        minioClient.hasCatalog() &&
        result.error &&
        /not found/i.test(result.error)
      ) {
        const tables = await minioClient.getTablesFromCatalog(ns);
        const alt = tables.find((t) => t.toLowerCase() === "ues");
        if (alt && alt !== "ues") {
          console.warn(
            `[UserEquipmentManager] Retrying with catalog table name "${alt}"`,
          );
          result = await fetchFromDataSource(alt, database);
        }
      }

      if (result.error) {
        console.error("[UserEquipmentManager] Load error:", result.error);
        await this.logCatalogTablesHint(ns);
        return;
      }

      if (!result.data || result.data.length === 0) {
        console.warn(
          `[UserEquipmentManager] No UE rows from table "ues" (namespace: "${ns}"). ` +
            `Data is loaded server-side via Iceberg + DuckDB (not the MinIO browser URL). ` +
            `If Parquet exists at s3://<bucket>/<namespace>/ues/data/*.parquet, set "S3 Bucket Name" ` +
            `in MinIO settings to that <bucket> and reload; the server falls back to that path when the catalog snapshot is empty.`,
        );
        await this.logCatalogTablesHint(ns);
        return;
      }

      const ueData = result.data as any[];

      // Update the viewer store with the loaded user equipments
      const userEquipmentMap = await this.processUserEquipmentData(ueData);
      this.setAll(userEquipmentMap);
    } catch (error) {
      console.error(
        "[UserEquipmentManager] Failed to load user equipments:",
        error,
      );
      return;
    }
  }
}

// Export singleton instance
export const userEquipmentManager = new UserEquipmentManager();
