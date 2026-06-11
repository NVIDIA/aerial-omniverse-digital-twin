/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { localToCartographic } from "@/services/cesium";
import type { DistributedUnit } from "@/types";
import { fetchFromDataSource } from "./dataLoader";

type Subscriber = (distributedUnits: Map<number, DistributedUnit>) => void;

/**
 * Manager class for distributed units
 * Handles loading DU data from the database and managing state
 */
export class DistributedUnitManager {
  private distributedUnits: Map<number, DistributedUnit> = new Map();
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
    this.subscribers.forEach((callback) => callback(this.distributedUnits));
  }

  /**
   * Get all distributed units
   */
  getAll(): Map<number, DistributedUnit> {
    return this.distributedUnits;
  }

  /**
   * Get a single distributed unit by ID
   */
  get(id: number): DistributedUnit | undefined {
    return this.distributedUnits.get(id);
  }

  /**
   * Add a distributed unit
   */
  add(du: DistributedUnit): void {
    const newMap = new Map(this.distributedUnits);
    newMap.set(du.id, du);
    this.distributedUnits = newMap;
    this.notify();
  }

  /**
   * Remove a distributed unit
   */
  remove(id: number): void {
    const newMap = new Map(this.distributedUnits);
    newMap.delete(id);
    this.distributedUnits = newMap;
    this.notify();
  }

  /**
   * Update a distributed unit
   */
  update(id: number, updates: Partial<DistributedUnit>): void {
    const existing = this.distributedUnits.get(id);
    if (existing) {
      const newMap = new Map(this.distributedUnits);
      newMap.set(id, { ...existing, ...updates });
      this.distributedUnits = newMap;
      this.notify();
    }
  }

  /**
   * Set all distributed units (replaces existing)
   */
  setAll(distributedUnits: Map<number, DistributedUnit>): void {
    this.distributedUnits = new Map(distributedUnits);
    this.notify();
  }

  /**
   * Clear all distributed units
   */
  clear(): void {
    this.distributedUnits = new Map();
    this.notify();
  }

  /**
   * Normalize Parquet data structure to match expected tabular column names
   * Converts array-like objects to actual arrays and ensures numeric values
   */
  private normalizeParquetData(dus: any[]): any[] {
    // Helper to convert to number
    const toNumber = (val: any): number => {
      if (typeof val === "number") return val;
      if (typeof val === "bigint") return Number(val);
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    };

    return dus.map((du) => {
      // Ensure position is an array of numbers [x, y, z]
      const posArray = Array.isArray(du.position)
        ? du.position
        : du.position
          ? Array.from(du.position)
          : [0, 0, 0];
      const position = [
        toNumber(posArray[0]),
        toNumber(posArray[1]),
        toNumber(posArray[2]),
      ];

      return {
        // Map Parquet column names to expected field names
        id: du.id ?? du.ID,
        subcarrier_spacing: du.subcarrier_spacing,
        fft_size: du.fft_size,
        num_antennas: du.num_antennas,
        max_channel_bandwidth: du.max_channel_bandwidth,
        reference_freq: du.reference_freq,
        position: position,
      };
    });
  }

  /**
   * Convert database distributed unit data to DistributedUnit interface
   */
  private processDistributedUnitData(dus: any[]): Map<number, DistributedUnit> {
    const result = new Map<number, DistributedUnit>();

    // Normalize data structure for MinIO/Parquet sources
    const normalizedData = this.normalizeParquetData(dus);

    for (const du of normalizedData) {
      const cartographic = localToCartographic(du.position);

      result.set(du.id, {
        id: du.id,
        position: {
          cartographic: cartographic,
          terrainHeight: 0,
        },
        referenceFreq: du.reference_freq ?? 3600.0,
        subcarrierSpacing: du.subcarrier_spacing,
        fftSize: du.fft_size,
        numAntennas: du.num_antennas,
        maxChannelBandwidth: du.max_channel_bandwidth,
      });
    }
    return result;
  }

  /**
   * Load distributed units from the database (Parquet or Iceberg).
   */
  async load(database: string): Promise<void> {
    try {
      const result = await fetchFromDataSource("dus", database);

      if (result.error) {
        console.error("[DistributedUnitManager] Load error:", result.error);
        return;
      }

      if (!result.data || result.data.length === 0) {
        return;
      }

      const distributedUnitMap = this.processDistributedUnitData(result.data);
      this.setAll(distributedUnitMap);
    } catch (error) {
      console.error(
        "[DistributedUnitManager] Failed to load distributed units:",
        error,
      );
      return;
    }
  }
}

// Export singleton instance
export const distributedUnitManager = new DistributedUnitManager();
