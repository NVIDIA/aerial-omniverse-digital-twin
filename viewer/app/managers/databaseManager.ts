/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { radioUnitManager } from "./radioUnitManager";
import { distributedUnitManager } from "./distributedUnitManager";
import { scattererManager } from "./scattererManager";
import { userEquipmentManager } from "./userEquipmentManager";
import { raypathManager } from "./raypathManager";
import { panelManager } from "./panelManager";
import { layerManager } from "./layerManager";
import { scenarioManager } from "./scenarioManager";
import { useViewerStore } from "@/store/viewerStore";
import { minioClient } from "@/services/database";
import type { DataSourceType } from "@/store/slices/dataSourceSlice";
import type { QueryResult } from "@/services/database/minioClient";

/**
 * Manager class for database loading
 * Coordinates data managers and handles load logic (MinIO / Iceberg).
 */
export class DatabaseManager {
  private database: string | null = null;
  private dataSourceType: DataSourceType = "minio";

  public readonly radioUnitManager = radioUnitManager;
  public readonly distributedUnitManager = distributedUnitManager;
  public readonly scattererManager = scattererManager;
  public readonly userEquipmentManager = userEquipmentManager;
  public readonly raypathManager = raypathManager;
  public readonly panelManager = panelManager;
  public readonly scenarioManager = scenarioManager;

  public readonly layerManager = layerManager;

  setDatabase(database: string) {
    this.database = database;
  }

  setDataSourceType(type: DataSourceType) {
    this.dataSourceType = type;
  }

  getDataSourceType(): DataSourceType {
    return this.dataSourceType;
  }

  async fetchData(tableName: string): Promise<QueryResult> {
    if (minioClient.hasCatalog()) {
      return await minioClient.queryViaCatalog(tableName);
    }

    const filename = `${tableName}.parquet`;

    if (tableName === "raypaths") {
      return await minioClient.fetchRaypathsSharded({
        maxRaypaths: 50000,
        skipOnError: true,
      });
    }

    return await minioClient.fetchParquetFile(filename);
  }

  isReady(): boolean {
    const viewer = useViewerStore.getState().cesiumViewer;
    return viewer !== null && minioClient.isConnected();
  }

  clearAll() {
    layerManager.clearAll();
    panelManager.clear();
    raypathManager.clear();
  }

  async loadRaypaths(): Promise<void> {
    await raypathManager.load(this.database || "");
    const { maxVisibleRayPaths, raysSparsity } =
      useViewerStore.getState().scenarioParams;
    let rays = raypathManager.getAll();

    if (raysSparsity > 1) {
      const timeIndices = [...new Set(rays.map((r) => r.time_idx))].sort(
        (a, b) => a - b,
      );
      const kept = new Set(
        timeIndices.filter((_, i) => i % raysSparsity === 0),
      );
      rays = rays.filter((r) => kept.has(r.time_idx));
    }

    if (maxVisibleRayPaths > 0) {
      const counts = new Map<string, number>();
      rays = rays.filter((r) => {
        const key = `${r.ru_id}-${r.ue_id}-${r.time_idx}`;
        const count = counts.get(key) ?? 0;
        if (count >= maxVisibleRayPaths) return false;
        counts.set(key, count + 1);
        return true;
      });
    }

    if (raysSparsity > 1 || maxVisibleRayPaths > 0) {
      raypathManager.setAll(rays);
    }
  }

  async loadScenario(): Promise<void> {
    await this.scenarioManager.load(this.database || "");
  }

  async loadRadioUnits(): Promise<void> {
    await this.radioUnitManager.load(this.database || "");
  }

  async loadDistributedUnits(): Promise<void> {
    await this.distributedUnitManager.load(this.database || "");
  }

  async loadScatterers(): Promise<void> {
    await this.scattererManager.load(this.database || "");
  }

  async loadUserEquipments(): Promise<void> {
    await this.userEquipmentManager.load(this.database || "");
  }

  async loadPanels(): Promise<void> {
    await this.panelManager.load(this.database || "");
  }

  async loadAll(retryCount: number = 0): Promise<void> {
    if (!this.isReady()) {
      if (retryCount < 1) {
        console.warn("[DatabaseManager] Not ready, retrying in 500ms...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        return await this.loadAll(retryCount + 1);
      }
      throw new Error(
        "DatabaseManager not ready: viewer or data source not connected",
      );
    }

    const { dataSourceType } = useViewerStore.getState();
    this.setDataSourceType(dataSourceType);

    const minioDb = minioClient.getCurrentDatabase();
    this.setDatabase(minioDb);

    try {
      const { setYmlTimeData } = useViewerStore.getState();
      setYmlTimeData(null);

      await this.loadScenario();
      await this.loadPanels();
      await this.loadRadioUnits();
      await this.loadDistributedUnits();
      await this.loadScatterers();
      await this.loadUserEquipments();

      try {
        await this.loadRaypaths();
      } catch (raypathError) {
        console.warn(
          "[DatabaseManager] Raypath loading failed, but continuing with other data:",
          raypathError,
        );
      }
      return;
    } catch (error) {
      if (retryCount < 1) {
        console.warn("[DatabaseManager] Full load failed, retrying...", error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await this.loadAll(retryCount + 1);
      }
      throw error;
    }
  }
}

export const databaseManager = new DatabaseManager();
