/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data Source Slice
 * The viewer uses MinIO / Iceberg for data (S3-compatible storage and catalog).
 */

export type DataSourceType = "minio";

const STORAGE_KEY_DATA_SOURCE = "data_source_type";

export interface DataSourceSlice {
  dataSourceType: DataSourceType;
  setDataSourceType: (type: DataSourceType) => void;
}

/**
 * Get initial data source type from localStorage or default to MinIO.
 */
const getInitialDataSourceType = (): DataSourceType => {
  if (typeof window === "undefined") {
    return "minio";
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY_DATA_SOURCE);
    if (saved === "minio") {
      return "minio";
    }
  } catch (error) {
    console.error("[DataSource Slice] Failed to load data source type:", error);
  }

  return "minio";
};

/**
 * Create data source slice
 */
export const createDataSourceSlice = (
  set: any,
  _get: any,
): DataSourceSlice => ({
  dataSourceType: getInitialDataSourceType(),

  setDataSourceType: (type: DataSourceType) => {
    set({ dataSourceType: type });

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_DATA_SOURCE, type);
      } catch (error) {
        console.error(
          "[DataSource Slice] Failed to save data source type:",
          error,
        );
      }
    }
  },
});
