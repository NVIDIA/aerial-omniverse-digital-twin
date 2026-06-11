/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for dataLoader (fetchFromDataSource, getCurrentDataSourceType)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchFromDataSource, getCurrentDataSourceType } from "./dataLoader";

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/services/database", () => ({
  minioClient: {
    hasCatalog: vi.fn(),
    queryViaCatalog: vi.fn(),
    fetchRaypathsSharded: vi.fn(),
    fetchParquetFile: vi.fn(),
  },
}));

import { useViewerStore } from "@/store/viewerStore";
import { minioClient } from "@/services/database";

describe("dataLoader", () => {
  beforeEach(() => {
    vi.mocked(useViewerStore.getState).mockReturnValue({
      dataSourceType: "minio",
    } as any);
    vi.mocked(minioClient.hasCatalog).mockReturnValue(false);
  });

  describe("getCurrentDataSourceType", () => {
    it("should return minio from the store", () => {
      vi.mocked(useViewerStore.getState).mockReturnValue({
        dataSourceType: "minio",
      } as any);
      expect(getCurrentDataSourceType()).toBe("minio");
    });
  });

  describe("fetchFromDataSource", () => {
    it("should use minio catalog when hasCatalog", async () => {
      vi.mocked(minioClient.hasCatalog).mockReturnValue(true);
      vi.mocked(minioClient.queryViaCatalog).mockResolvedValue({
        data: [{ x: 1 }],
        rows: 1,
      });
      const result = await fetchFromDataSource("my_table");
      expect(minioClient.queryViaCatalog).toHaveBeenCalledWith(
        "my_table",
        undefined,
      );
      expect(result).toEqual({ data: [{ x: 1 }], rows: 1 });
    });

    it("should use fetchRaypathsSharded for raypaths in legacy mode", async () => {
      vi.mocked(minioClient.hasCatalog).mockReturnValue(false);
      vi.mocked(minioClient.fetchRaypathsSharded).mockResolvedValue({
        data: [],
        rows: 0,
      });
      await fetchFromDataSource("raypaths");
      expect(minioClient.fetchRaypathsSharded).toHaveBeenCalledWith({
        maxRaypaths: 50000,
        skipOnError: true,
      });
    });

    it("should use fetchParquetFile for other tables in legacy mode", async () => {
      vi.mocked(minioClient.hasCatalog).mockReturnValue(false);
      vi.mocked(minioClient.fetchParquetFile).mockResolvedValue({
        data: [{ a: 1 }],
        rows: 1,
      });
      const result = await fetchFromDataSource("radio_units");
      expect(minioClient.fetchParquetFile).toHaveBeenCalledWith(
        "radio_units.parquet",
      );
      expect(result).toEqual({ data: [{ a: 1 }], rows: 1 });
    });
  });
});
