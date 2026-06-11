/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { localToCartographicBatched } from "@/services/cesium";
import type {
  Scatterer,
  TimeIndexedPosition,
  TimeIndexedOrientation,
} from "@/types";
import * as Cesium from "cesium";
import { fetchFromDataSource } from "./dataLoader";

type Subscriber = (scatterers: Map<number, Scatterer>) => void;

/**
 * Manager class for scatterers (moving vehicles)
 * Handles loading scatterer data from the database and managing state
 */
export class ScattererManager {
  private scatterers: Map<number, Scatterer> = new Map();
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
    this.subscribers.forEach((callback) => callback(this.scatterers));
  }

  /**
   * Get all scatterers
   */
  getAll(): Map<number, Scatterer> {
    return this.scatterers;
  }

  /**
   * Get a single scatterer by ID
   */
  get(id: number): Scatterer | undefined {
    return this.scatterers.get(id);
  }

  /**
   * Set all scatterers (replaces existing)
   */
  setAll(scatterers: Map<number, Scatterer>): void {
    this.scatterers = new Map(scatterers);
    this.notify();
  }

  /**
   * Clear all scatterers
   */
  clear(): void {
    this.scatterers = new Map();
    this.notify();
  }

  /**
   * Remove a scatterer
   */
  remove(id: number): void {
    const newMap = new Map(this.scatterers);
    newMap.delete(id);
    this.scatterers = newMap;
    this.notify();
  }

  /**
   * Normalize Parquet data structure to match expected tabular column names
   * Converts array-like objects to actual arrays and ensures numeric values
   */
  private normalizeParquetData(scatterers: any[]): any[] {
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

    // Helper to normalize an orientation array [pitch, roll, yaw]
    const normalizeOrientation = (orient: any): number[] => {
      if (!orient) return [0, 0, 0];
      let arr: any[];
      if (Array.isArray(orient)) {
        arr = orient;
      } else if (typeof orient === "object") {
        arr = Object.values(orient);
      } else {
        arr = Array.from(orient);
      }
      return [toNumber(arr[0]), toNumber(arr[1]), toNumber(arr[2])];
    };

    return scatterers.map((scatterer) => {
      // Ensure batch_indices is an array of numbers
      const batchIndices = Array.isArray(scatterer.batch_indices)
        ? scatterer.batch_indices.map(toNumber)
        : scatterer.batch_indices
          ? Array.from(scatterer.batch_indices).map(toNumber)
          : [];

      // Ensure route_positions is a 3D array with proper numbers
      const routePositions = Array.isArray(scatterer.route_positions)
        ? scatterer.route_positions.map((batch: any) => {
            const batchArray = Array.isArray(batch) ? batch : Array.from(batch);
            return batchArray.map((pos: any) => normalizePosition(pos));
          })
        : scatterer.route_positions
          ? Array.from(scatterer.route_positions).map((batch: any) => {
              const batchArray = Array.isArray(batch)
                ? batch
                : Array.from(batch);
              return batchArray.map((pos: any) => normalizePosition(pos));
            })
          : [];

      // Ensure route_orientations is a 3D array with proper numbers
      const routeOrientations = Array.isArray(scatterer.route_orientations)
        ? scatterer.route_orientations.map((batch: any) => {
            const batchArray = Array.isArray(batch) ? batch : Array.from(batch);
            return batchArray.map((orient: any) =>
              normalizeOrientation(orient),
            );
          })
        : scatterer.route_orientations
          ? Array.from(scatterer.route_orientations).map((batch: any) => {
              const batchArray = Array.isArray(batch)
                ? batch
                : Array.from(batch);
              return batchArray.map((orient: any) =>
                normalizeOrientation(orient),
              );
            })
          : [];

      return {
        // Map Parquet column names to expected field names
        id: scatterer.id ?? scatterer.ID,
        is_indoor_mobility: scatterer.is_indoor_mobility,
        batch_indices: batchIndices,
        route_positions: routePositions,
        route_orientations: routeOrientations,
        route_speeds: scatterer.route_speeds,
        route_times: scatterer.route_times,
      };
    });
  }

  /**
   * Process scatterer data and convert to world coordinates
   * Returns a map of scatterer ID to array of position data for each time index
   * @param scatterers Raw scatterer data from database
   */
  private async processScattererData(
    scatterers: any[],
  ): Promise<Map<number, Scatterer>> {
    const result = new Map<number, Scatterer>();

    // Normalize data structure for MinIO/Parquet sources
    const normalizedData = this.normalizeParquetData(scatterers);

    for (const scatterer of normalizedData) {
      const positions: TimeIndexedPosition[] = [];
      const orientations: TimeIndexedOrientation[] = [];
      let timeIdx = 0;

      // Process each batch (typically there's only one batch per scatterer)
      for (
        let batchIdx = 0;
        batchIdx < scatterer.batch_indices.length;
        batchIdx++
      ) {
        const routePositions = scatterer.route_positions[batchIdx];
        const routeOrientations = scatterer.route_orientations[batchIdx];
        const cartographicBatch = localToCartographicBatched(routePositions);

        // Process each time index in the route
        for (let idx = 0; idx < routePositions.length; idx++) {
          // Extract orientation in degrees from database
          const [pitch, roll, yaw] = routeOrientations[idx];

          positions.push({
            timeIdx: timeIdx,
            position: {
              cartographic: cartographicBatch[idx],
              terrainHeight: 0,
            },
          });

          const orientation = Cesium.HeadingPitchRoll.fromDegrees(
            90 - yaw,
            90 - pitch,
            90 - roll,
          );

          orientations.push({
            timeIdx: timeIdx,
            orientation: orientation,
          });

          timeIdx++;
        }
      }
      result.set(scatterer.id, {
        id: scatterer.id,
        isIndoor: scatterer.is_indoor_mobility,
        positions: positions,
        orientations: orientations,
      });
    }
    return result;
  }

  /**
   * Load scatterers from the database (Parquet or Iceberg).
   */
  async load(database: string): Promise<void> {
    try {
      const result = await fetchFromDataSource("scatterers", database);

      if (result.error) {
        console.error("[ScattererManager] Load error:", result.error);
        return;
      }

      if (!result.data || result.data.length === 0) {
        return;
      }

      // Process the scatterer data to convert coordinates with terrain heights
      const scattererMap = await this.processScattererData(result.data);
      this.setAll(scattererMap);
    } catch (error) {
      console.error("[ScattererManager] Failed to load scatterers:", error);
      return;
    }
  }
}

// Export singleton instance
export const scattererManager = new ScattererManager();
