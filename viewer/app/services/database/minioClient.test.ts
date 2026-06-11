/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("hyparquet", () => ({
  parquetReadObjects: vi.fn(async () => []),
}));

// Import after mocks
const {
  minioClient: _singleton,
  parseIcebergQualifiedName,
  resolveAvailableNamespaceSelection,
  resolveCatalogTableRef,
} = await import("./minioClient");
type MinIOServiceType = typeof _singleton;

// We need a fresh instance per test, so we'll access the class via the singleton's constructor
const MinIOService = (_singleton as any).constructor;

describe("MinIOService", () => {
  let client: MinIOServiceType;

  beforeEach(() => {
    localStorage.clear();
    client = new MinIOService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("initial state", () => {
    it("should not be connected initially", () => {
      expect(client.isConnected()).toBe(false);
    });

    it("should return null connection info when not connected", () => {
      expect(client.getConnectionInfo()).toBeNull();
    });

    it("should not have catalog initially", () => {
      expect(client.hasCatalog()).toBe(false);
    });

    it("should have empty current database", () => {
      expect(client.getCurrentDatabase()).toBe("");
    });
  });

  describe("connect (direct mode)", () => {
    it("should connect with valid URL", async () => {
      const result = await client.connect({
        baseUrl: "http://example.com/warehouse/",
      });

      expect(result.success).toBe(true);
      expect(client.isConnected()).toBe(true);
    });

    it("should normalize URL by adding trailing slash", async () => {
      await client.connect({
        baseUrl: "http://example.com/warehouse",
      });

      const info = client.getConnectionInfo();
      expect(info?.baseUrl).toBe("http://example.com/warehouse/");
    });

    it("should fail with empty URL", async () => {
      const result = await client.connect({ baseUrl: "" });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(client.isConnected()).toBe(false);
    });

    it("should fail with whitespace-only URL", async () => {
      const result = await client.connect({ baseUrl: "   " });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should fail with invalid URL format", async () => {
      const result = await client.connect({ baseUrl: "not-a-url" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid URL");
    });

    it("should persist config to localStorage", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      const saved = localStorage.getItem("minio_config");
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!);
      expect(parsed.baseUrl).toBe("http://example.com/bucket/");
    });

    it("should store access and secret keys", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
        accessKey: "myAccessKey",
        secretKey: "mySecretKey",
      });

      const info = client.getConnectionInfo();
      expect(info).toBeDefined();
      expect(info?.baseUrl).toBe("http://example.com/bucket/");
    });
  });

  describe("connect (catalog mode)", () => {
    it("should fail with empty catalog URI", async () => {
      const result = await client.connect({
        baseUrl: "",
        catalogUri: "   ",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Catalog URI is required");
    });

    it("should fail with invalid catalog URI format", async () => {
      const result = await client.connect({
        baseUrl: "",
        catalogUri: "not-a-url",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid Catalog URI");
    });
  });

  describe("disconnect", () => {
    it("should disconnect and clear state", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });
      expect(client.isConnected()).toBe(true);

      client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionInfo()).toBeNull();
    });

    it("should clear localStorage on disconnect", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      client.disconnect();

      expect(localStorage.getItem("minio_config")).toBeNull();
    });

    it("should clear current database on disconnect", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });
      client.setCurrentDatabase("stale_db");

      client.disconnect();

      expect(client.getCurrentDatabase()).toBe("");
    });
  });

  describe("setCurrentDatabase / getCurrentDatabase", () => {
    it("should set and get current database", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      client.setCurrentDatabase("my_database");
      expect(client.getCurrentDatabase()).toBe("my_database");
    });

    it("should include database in connection info", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      client.setCurrentDatabase("test_db");
      const info = client.getConnectionInfo();
      expect(info?.database).toBe("test_db");
    });

    it("should update persisted config with database", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      client.setCurrentDatabase("persistent_db");

      const saved = JSON.parse(localStorage.getItem("minio_config")!);
      expect(saved.database).toBe("persistent_db");
    });

    it("should set currentDatabase even when not connected (no localStorage update)", () => {
      client.setCurrentDatabase("test");
      // The property is set even without config (it's a simple assignment)
      expect(client.getCurrentDatabase()).toBe("test");
      // But localStorage should NOT be updated since there's no config
      expect(localStorage.getItem("minio_config")).toBeNull();
    });

    it("should reset a stale database when connecting without a database", async () => {
      client.setCurrentDatabase("non_RAN_1RU_20UEs_12Slots_5Batches");

      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      expect(client.getCurrentDatabase()).toBe("");
      expect(client.getConnectionInfo()?.database).toBe("");
    });
  });

  describe("hasCatalog", () => {
    it("should return false without catalog URI", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      expect(client.hasCatalog()).toBe(false);
    });
  });

  describe("getConnectionInfo", () => {
    it("should return full connection info", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      client.setCurrentDatabase("demo");

      const info = client.getConnectionInfo();
      expect(info).toEqual({
        baseUrl: "http://example.com/bucket/",
        database: "demo",
        catalogUri: undefined,
        catalogType: undefined,
        glueRegion: undefined,
        s3BucketName: undefined,
        s3Endpoint: undefined,
      });
    });
  });

  describe("fetchParquetFile", () => {
    it("should return error when not connected", async () => {
      const result = await client.fetchParquetFile("test.parquet");

      expect(result.error).toContain("Not connected");
      expect(result.data).toEqual([]);
      expect(result.rows).toBe(0);
    });
  });

  describe("fetchRaypathsSharded", () => {
    it("should return error when not connected", async () => {
      const result = await client.fetchRaypathsSharded();

      expect(result.error).toContain("Not connected");
      expect(result.data).toEqual([]);
    });
  });

  describe("queryViaCatalog", () => {
    it("should return error when catalog not configured", async () => {
      await client.connect({
        baseUrl: "http://example.com/bucket/",
      });

      const result = await client.queryViaCatalog("test_table");

      expect(result.error).toContain("Catalog not configured");
    });

    it("should query AWS Glue catalog without requiring a REST catalog URI", async () => {
      localStorage.setItem(
        "minio_config",
        JSON.stringify({
          baseUrl: "",
          catalogType: "glue",
          glueRegion: "us-west-2",
          s3BucketName: "test-bucket",
        }),
      );
      client = new MinIOService();
      client.setCurrentDatabase("test_namespace");

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          action: "queryTable",
          catalogType: "glue",
          catalogUri: "",
          glueRegion: "us-west-2",
          namespace: "test_namespace",
          table: "ues",
          s3BucketName: "test-bucket",
        });

        return new Response(
          JSON.stringify({
            data: [{ id: 1 }],
            rows: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await client.queryViaCatalog("ues");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: [{ id: 1 }], rows: 1 });
    });
  });

  describe("parseIcebergQualifiedName", () => {
    it("parses namespace.table", () => {
      expect(parseIcebergQualifiedName("default.cirs")).toEqual({
        namespace: "default",
        table: "cirs",
      });
    });

    it("parses nested namespace.table using the last dot", () => {
      expect(parseIcebergQualifiedName("a.b.my_table")).toEqual({
        namespace: "a.b",
        table: "my_table",
      });
    });

    it("returns null for unqualified names", () => {
      expect(parseIcebergQualifiedName("ues")).toBeNull();
      expect(parseIcebergQualifiedName(".bad")).toBeNull();
    });
  });

  describe("resolveCatalogTableRef", () => {
    it("uses qualified id without default namespace", () => {
      const r = resolveCatalogTableRef("default.cirs", "");
      expect("error" in r).toBe(false);
      if (!("error" in r)) {
        expect(r.namespace).toBe("default");
        expect(r.table).toBe("cirs");
      }
    });

    it("requires namespace for short names", () => {
      const r = resolveCatalogTableRef("ues", "");
      expect(r).toEqual({
        error:
          'Select an Iceberg namespace (database) or use a qualified table name like "namespace.table".',
      });
    });

    it("combines short name with default namespace", () => {
      const r = resolveCatalogTableRef("ues", "default");
      expect("error" in r).toBe(false);
      if (!("error" in r)) {
        expect(r.namespace).toBe("default");
        expect(r.table).toBe("ues");
      }
    });
  });

  describe("resolveAvailableNamespaceSelection", () => {
    it("keeps the catalog namespace casing for a case-insensitive match", () => {
      expect(
        resolveAvailableNamespaceSelection(
          [
            "cicd_test_dt_db_aws",
            "non_ran_1ru_20ues_12slots_5batches",
            "test_dt_db",
          ],
          "non_RAN_1RU_20UEs_12Slots_5Batches",
        ),
      ).toBe("non_ran_1ru_20ues_12slots_5batches");
    });

    it("falls back to the first namespace when the preferred one is stale", () => {
      expect(
        resolveAvailableNamespaceSelection(["db_a", "db_b"], "old_db"),
      ).toBe("db_a");
    });

    it("returns an empty namespace when no databases are available", () => {
      expect(resolveAvailableNamespaceSelection([], "old_db")).toBe("");
    });
  });

  describe("config restoration from localStorage", () => {
    it("should restore connection from localStorage on init", () => {
      localStorage.setItem(
        "minio_config",
        JSON.stringify({
          baseUrl: "http://restored.com/bucket/",
          accessKey: "key",
        }),
      );

      const restored = new MinIOService();
      expect(restored.isConnected()).toBe(true);
      expect(restored.getConnectionInfo()?.baseUrl).toBe(
        "http://restored.com/bucket/",
      );
    });

    it("should restore the current database from localStorage", () => {
      localStorage.setItem(
        "minio_config",
        JSON.stringify({
          baseUrl: "http://restored.com/bucket/",
          database: "/restored_db/",
        }),
      );

      const restored = new MinIOService();
      expect(restored.getCurrentDatabase()).toBe("restored_db");
      expect(restored.getConnectionInfo()?.database).toBe("restored_db");
    });

    it("should handle corrupted localStorage gracefully", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      localStorage.setItem("minio_config", "not-valid-json");

      const restored = new MinIOService();
      expect(restored.isConnected()).toBe(false);

      consoleSpy.mockRestore();
    });
  });
});
