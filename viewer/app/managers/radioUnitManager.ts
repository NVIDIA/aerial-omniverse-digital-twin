/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { localToCartographic } from "@/services/cesium";
import type { RadioUnit } from "@/types";
import * as Cesium from "cesium";
import { findClosestMatchingDuId } from "@/utils/ruDuAutoAssign";
import { distributedUnitManager } from "./distributedUnitManager";
import { panelManager } from "./panelManager";
import { fetchFromDataSource } from "./dataLoader";

type Subscriber = (radioUnits: Map<number, RadioUnit>) => void;

/**
 * Manager class for radio units
 * Handles loading RU data from the database and managing state
 */
export class RadioUnitManager {
  private radioUnits: Map<number, RadioUnit> = new Map();
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
    this.subscribers.forEach((callback) => callback(this.radioUnits));
  }

  /**
   * Get all radio units
   */
  getAll(): Map<number, RadioUnit> {
    return this.radioUnits;
  }

  /**
   * Get a single radio unit by ID
   */
  get(id: number): RadioUnit | undefined {
    return this.radioUnits.get(id);
  }

  /**
   * Add a radio unit
   */
  add(ru: RadioUnit): void {
    let resolved = ru;
    if (!ru.duManualAssign) {
      const assignedDuId = findClosestMatchingDuId(
        ru,
        distributedUnitManager.getAll(),
        panelManager.getAll(),
      );
      resolved = {
        ...ru,
        duId: assignedDuId !== null ? assignedDuId : -1,
      };
    }

    const newMap = new Map(this.radioUnits);
    newMap.set(resolved.id, resolved);
    this.radioUnits = newMap;
    this.notify();
  }

  /**
   * Remove a radio unit
   */
  remove(id: number): void {
    const newMap = new Map(this.radioUnits);
    newMap.delete(id);
    this.radioUnits = newMap;
    this.notify();
  }

  /**
   * Update a radio unit
   */
  update(id: number, updates: Partial<RadioUnit>): void {
    const existing = this.radioUnits.get(id);
    if (!existing) return;

    let merged: RadioUnit = { ...existing, ...updates };

    if (!merged.duManualAssign) {
      const shouldRecomputeDu =
        updates.duManualAssign === false ||
        ("panelType" in updates && updates.panelType !== undefined) ||
        ("position" in updates && updates.position !== undefined);

      if (shouldRecomputeDu) {
        const assignedDuId = findClosestMatchingDuId(
          merged,
          distributedUnitManager.getAll(),
          panelManager.getAll(),
        );
        merged = {
          ...merged,
          duId: assignedDuId !== null ? assignedDuId : -1,
        };
      }
    }

    const newMap = new Map(this.radioUnits);
    newMap.set(id, merged);
    this.radioUnits = newMap;
    this.notify();
  }

  /**
   * Set all radio units (replaces existing)
   */
  setAll(radioUnits: Map<number, RadioUnit>): void {
    this.radioUnits = new Map(radioUnits);
    this.notify();
  }

  /**
   * Clear all radio units
   */
  clear(): void {
    this.radioUnits = new Map();
    this.notify();
  }

  /**
   * Normalize Parquet data structure to match expected tabular column names
   * Converts array-like objects to actual arrays and ensures numeric values
   */
  private normalizeParquetData(rus: any[]): any[] {
    // Helper to convert to number
    const toNumber = (val: any): number => {
      if (typeof val === "number") return val;
      if (typeof val === "bigint") return Number(val);
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    };

    return rus.map((ru) => {
      // Ensure position is an array of numbers [x, y, z]
      const posArray = Array.isArray(ru.position)
        ? ru.position
        : ru.position
          ? Array.from(ru.position)
          : [0, 0, 0];
      const position = [
        toNumber(posArray[0]),
        toNumber(posArray[1]),
        toNumber(posArray[2]),
      ];

      // Ensure panel is an array of numbers
      const panel = Array.isArray(ru.panel)
        ? ru.panel.map(toNumber)
        : ru.panel
          ? Array.from(ru.panel).map(toNumber)
          : [];

      return {
        // Map Parquet column names to expected field names
        id: ru.id ?? ru.ID,
        subcarrier_spacing: ru.subcarrier_spacing,
        fft_size: ru.fft_size,
        radiated_power: ru.radiated_power,
        height: ru.height,
        mech_azimuth: ru.mech_azimuth,
        mech_tilt: ru.mech_tilt,
        du_id: ru.du_id,
        du_manual_assign: ru.du_manual_assign,
        position: position,
        panel: panel,
      };
    });
  }

  /**
   * Convert database radio unit data to RadioUnit interface
   */
  private processRadioUnitData(rus: any[]): Map<number, RadioUnit> {
    const result = new Map<number, RadioUnit>();

    // Normalize data structure for MinIO/Parquet sources
    const normalizedData = this.normalizeParquetData(rus);

    for (const ru of normalizedData) {
      const cartographic = localToCartographic(ru.position);
      const orientation = Cesium.HeadingPitchRoll.fromDegrees(
        ru.mech_azimuth,
        ru.mech_tilt,
        0,
      );

      const panelIndex =
        Array.isArray(ru.panel) && ru.panel.length > 0
          ? ru.panel[0]
          : undefined;
      const panel =
        panelIndex != null ? panelManager.getByIndex(panelIndex) : undefined;

      result.set(ru.id, {
        id: ru.id,
        position: {
          cartographic: cartographic,
          terrainHeight: 0,
        },
        orientation: orientation,
        cellId: ru.id,
        duId: ru.du_id,
        duManualAssign: ru.du_manual_assign,
        enableRays: true,
        height: ru.height,
        mechAzimuth: ru.mech_azimuth,
        mechTilt: ru.mech_tilt,
        panelType: panel?.name ?? "",
        radiatedPower: ru.radiated_power,
        carrierFreqMHz: panel ? panel.referenceFreq / 1e6 : undefined,
      });
    }
    return result;
  }

  /**
   * Load radio units from the database (Parquet or Iceberg).
   */
  async load(database: string): Promise<void> {
    try {
      const result = await fetchFromDataSource("rus", database);

      if (result.error) {
        console.error("[RadioUnitManager] Load error:", result.error);
        return;
      }

      if (!result.data || result.data.length === 0) {
        return;
      }

      const radioUnitMap = this.processRadioUnitData(result.data);
      this.setAll(radioUnitMap);
    } catch (error) {
      console.error("[RadioUnitManager] Failed to load radio units:", error);
      return;
    }
  }
}

// Export singleton instance
export const radioUnitManager = new RadioUnitManager();
