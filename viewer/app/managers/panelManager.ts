/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Panel } from "@/types";
import { fetchFromDataSource } from "./dataLoader";

type Subscriber = (panels: Map<number, Panel>) => void;

/**
 * UI state stores polarization as 2 = dual and 0 = single, while source data
 * may use booleans, strings, or numeric flags.
 */
function normalizeDualPolarized(value: unknown): number {
  if (value === true) return 2;
  if (typeof value === "number") return value === 1 || value === 2 ? 2 : 0;
  if (typeof value === "bigint")
    return value === BigInt(1) || value === BigInt(2) ? 2 : 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "2", "dual", "dual_polarized"].includes(normalized)) {
      return 2;
    }
  }
  return 0;
}

/**
 * Manager class for panels (antenna panel configurations)
 * Handles loading panel data from the database and managing state
 */
export class PanelManager {
  private panels: Map<number, Panel> = new Map();
  private indexToId: number[] = [];
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
    this.subscribers.forEach((callback) => callback(this.panels));
  }

  /**
   * Get all panels
   */
  getAll(): Map<number, Panel> {
    return this.panels;
  }

  /**
   * Get a single panel by ID
   */
  get(id: number): Panel | undefined {
    return this.panels.get(id);
  }

  /**
   * Get a panel by its DB index (0-based position in panels table).
   */
  getByIndex(index: number): Panel | undefined {
    const id = this.indexToId[index];
    return id != null ? this.panels.get(id) : undefined;
  }

  /**
   * Set all panels (replaces existing)
   */
  setAll(panels: Map<number, Panel>): void {
    this.panels = new Map(panels);
    this.notify();
  }

  /**
   * Clear all panels
   */
  clear(): void {
    this.panels = new Map();
    this.notify();
  }

  /**
   * Update a single panel
   */
  update(id: number, updates: Partial<Panel>): void {
    const panel = this.panels.get(id);
    if (!panel) {
      console.warn(`[PanelManager] Panel ${id} not found`);
      return;
    }

    const updatedPanel = { ...panel, ...updates };
    this.panels = new Map(this.panels);
    this.panels.set(id, updatedPanel);
    this.notify();
  }

  /**
   * Remove a panel
   */
  remove(id: number): void {
    const newMap = new Map(this.panels);
    newMap.delete(id);
    this.panels = newMap;
    this.notify();
  }

  /**
   * Load panels from the database (Parquet or Iceberg).
   */
  async load(database: string): Promise<void> {
    try {
      const result = await fetchFromDataSource("panels", database);

      if (result.error) {
        console.error("[PanelManager] Load error:", result.error);
        return;
      }

      if (!result.data || result.data.length === 0) {
        return;
      }

      // Process the panel data
      const panelMap = new Map<number, Panel>();
      const indexToId: number[] = [];

      // Helper to convert to number
      const toNumber = (val: any): number => {
        if (typeof val === "number") return val;
        if (typeof val === "bigint") return Number(val);
        const num = Number(val);
        return isNaN(num) ? 0 : num;
      };

      for (const panel of result.data) {
        // Map Parquet column names (snake_case) to camelCase field names
        const antennaNamesSrc = panel.antennaNames ?? panel.antenna_names;
        const antennaNames = Array.isArray(antennaNamesSrc)
          ? antennaNamesSrc.map(String)
          : antennaNamesSrc
            ? Array.from(antennaNamesSrc).map(String)
            : [];

        const frequenciesSrc = panel.frequencies;
        const frequencies = Array.isArray(frequenciesSrc)
          ? frequenciesSrc.map(toNumber)
          : frequenciesSrc
            ? Array.from(frequenciesSrc).map(toNumber)
            : [];

        const id = Number(panel.panel_name.split("_").pop());
        indexToId.push(id);

        panelMap.set(id, {
          id,
          name: panel.name ?? panel.panel_name,
          antennaNames: antennaNames,
          frequencies: frequencies,
          referenceFreq: panel.referenceFreq ?? panel.reference_freq,
          dualPolarized: normalizeDualPolarized(
            panel.dualPolarized ?? panel.dual_polarized,
          ),
          numLocAntennaHorz:
            panel.numLocAntennaHorz ?? panel.num_loc_antenna_horz,
          numLocAntennaVert:
            panel.numLocAntennaVert ?? panel.num_loc_antenna_vert,
          antennaSpacingHorzCm:
            panel.antennaSpacingHorzCm ?? panel.antenna_spacing_horz,
          antennaSpacingVertCm:
            panel.antennaSpacingVertCm ?? panel.antenna_spacing_vert,
          antennaRollAngleFirstPolz:
            panel.antennaRollAngleFirstPolz ??
            panel.antenna_roll_angle_first_polz,
          antennaRollAngleSecondPolz:
            panel.antennaRollAngleSecondPolz ??
            panel.antenna_roll_angle_second_polz,
        });
      }

      this.indexToId = indexToId;
      this.setAll(panelMap);
    } catch (error) {
      console.error("[PanelManager] Failed to load panels:", error);
      return;
    }
  }
}

// Export singleton instance
export const panelManager = new PanelManager();
