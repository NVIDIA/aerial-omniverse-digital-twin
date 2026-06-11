/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDataSourceSlice, type DataSourceSlice } from "./dataSourceSlice";

const STORAGE_KEY = "data_source_type";

describe("createDataSourceSlice", () => {
  let mockSet: ReturnType<typeof vi.fn>;
  let slice: DataSourceSlice;

  beforeEach(() => {
    localStorage.clear();
    mockSet = vi.fn();
    const result = createDataSourceSlice(mockSet, null);
    slice = result;
  });

  describe("Initial state (getInitialDataSourceType)", () => {
    it("should default to minio when no value in localStorage", () => {
      expect(slice.dataSourceType).toBe("minio");
    });

    it("should use saved minio from localStorage", () => {
      localStorage.setItem(STORAGE_KEY, "minio");
      const s = createDataSourceSlice(mockSet, null);
      expect(s.dataSourceType).toBe("minio");
    });

    it("should default to minio when saved value is invalid", () => {
      localStorage.setItem(STORAGE_KEY, "invalid");
      const s = createDataSourceSlice(mockSet, null);
      expect(s.dataSourceType).toBe("minio");
    });

    it("should default to minio when localStorage throws", () => {
      const spy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("fail");
        });
      const s = createDataSourceSlice(mockSet, null);
      expect(s.dataSourceType).toBe("minio");
      spy.mockRestore();
    });
  });

  describe("setDataSourceType", () => {
    it("should call set with minio", () => {
      slice.setDataSourceType("minio");
      expect(mockSet).toHaveBeenCalledWith({ dataSourceType: "minio" });
    });

    it("should persist minio to localStorage", () => {
      slice.setDataSourceType("minio");
      expect(localStorage.getItem(STORAGE_KEY)).toBe("minio");
    });

    it("should handle localStorage errors gracefully", () => {
      const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("fail");
      });
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      slice.setDataSourceType("minio");
      expect(consoleSpy).toHaveBeenCalled();
      spy.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
