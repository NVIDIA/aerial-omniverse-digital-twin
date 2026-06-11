/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data Loader Utility
 * Loads table data from MinIO (Iceberg catalog or legacy Parquet files).
 */

import { minioClient } from "@/services/database";
import type { QueryResult } from "@/services/database/minioClient";
import type { DataSourceType } from "@/store/slices/dataSourceSlice";
import { useViewerStore } from "@/store/viewerStore";

/**
 * Fetch data from the active MinIO / Iceberg connection.
 * @param tableName The table/file name (without .parquet extension for legacy Parquet mode)
 * @param _database Namespace or prefix (used by MinIO client state)
 */
export async function fetchFromDataSource(
  tableName: string,
  _database?: string,
): Promise<QueryResult> {
  if (minioClient.hasCatalog()) {
    return await minioClient.queryViaCatalog(
      tableName,
      tableName === "raypaths"
        ? {
            where: `ru_ant_el = {'1': 0, '2': 0} AND ue_ant_el = {'1': 0, '2': 0}`,
          }
        : undefined,
    );
  }

  if (tableName === "raypaths") {
    return await minioClient.fetchRaypathsSharded({
      maxRaypaths: 50000,
      skipOnError: true,
    });
  }

  const filename = `${tableName}.parquet`;
  return await minioClient.fetchParquetFile(filename);
}

/**
 * Get the current data source type (always MinIO in this viewer).
 */
export function getCurrentDataSourceType(): DataSourceType {
  return useViewerStore.getState().dataSourceType;
}
