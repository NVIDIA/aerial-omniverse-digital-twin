/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { parquetReadObjects } from "hyparquet";
import { readMinioProxyCredentialsFromStorage } from "@/utils/minioProxyResource";

// Configuration constants for raypath loading
const RAYPATH_CONFIG = {
  // Maximum number of raypaths to load (set to Infinity to load all)
  // Large raypath files (30-50MB each) can cause memory issues
  // Recommended: 50000-100000 for good performance
  MAX_RAYPATHS: 50000,

  // Skip files on error instead of failing completely
  SKIP_ON_ERROR: true,

  // Warn if file size exceeds this threshold (in MB)
  LARGE_FILE_WARNING_MB: 50,
};

export interface MinIOConfig {
  baseUrl: string; // e.g., http://your-minio-host:9000/warehouse/
  database?: string; // Subdirectory/prefix (e.g., demo_s3_ui)
  accessKey?: string; // MinIO access key (like AWS access key)
  secretKey?: string; // MinIO secret key (like AWS secret key)

  // Iceberg Catalog fields (new approach - replaces direct parquet fetching)
  catalogUri?: string; // Iceberg REST catalog URI (e.g., http://your-catalog-host:19120/iceberg/)
  /** When `glue`, use AWS Glue Data Catalog instead of REST (`catalogUri` not used). */
  catalogType?: "rest" | "glue";
  /** AWS region for Glue API and S3 (Glue catalog mode). */
  glueRegion?: string;
  /** S3 bucket name (or s3://bucket prefix) for Iceberg data paths. */
  s3BucketName?: string;
  s3Endpoint?: string; // S3/MinIO endpoint URL (e.g., http://your-s3-host:9002)
}

function resolveS3BucketName(
  config: MinIOConfig & { warehouse?: string },
): string {
  return config.s3BucketName?.trim() || config.warehouse?.trim() || "";
}

export interface QueryResult {
  data: any[];
  rows: number;
  error?: string;
}

/**
 * Normalize namespace/database strings for Iceberg REST (trim, strip slashes).
 * Trailing slashes break catalog URLs and table resolution.
 */
export function normalizeIcebergNamespace(namespace: string): string {
  return namespace.trim().replace(/^\/+|\/+$/g, "");
}

function databaseOptionToNamespace(database: string): string {
  return database === "(root)" ? "" : normalizeIcebergNamespace(database);
}

export function resolveAvailableNamespaceSelection(
  databases: string[],
  preferredDatabase?: string,
): string {
  const normalizedDatabases = databases.map(databaseOptionToNamespace);
  if (normalizedDatabases.length === 0) return "";

  const hasPreferred =
    preferredDatabase !== undefined && preferredDatabase !== "";
  if (hasPreferred) {
    const preferred = databaseOptionToNamespace(preferredDatabase);
    const exact = normalizedDatabases.find((db) => db === preferred);
    if (exact !== undefined) return exact;

    const caseInsensitive = normalizedDatabases.find(
      (db) => db.toLowerCase() === preferred.toLowerCase(),
    );
    if (caseInsensitive !== undefined) return caseInsensitive;
  }

  return normalizedDatabases[0];
}

/**
 * Parse a qualified Iceberg table id (`namespace.table`, or nested `a.b.table`
 * where the namespace is `a.b` and the table is `table`).
 * Mirrors PyIceberg `load_table("default.cirs")` style identifiers.
 */
export function parseIcebergQualifiedName(
  identifier: string,
): { namespace: string; table: string } | null {
  const t = identifier.trim();
  const lastDot = t.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === t.length - 1) {
    return null;
  }
  return {
    namespace: normalizeIcebergNamespace(t.slice(0, lastDot)),
    table: t.slice(lastDot + 1).trim(),
  };
}

/**
 * Resolve a short table name (`ues`) using the default namespace, or a
 * qualified name (`default.ues`) from the catalog alone.
 */
export function resolveCatalogTableRef(
  identifier: string,
  defaultNamespace: string,
): { namespace: string; table: string } | { error: string } {
  const qualified = parseIcebergQualifiedName(identifier);
  if (qualified) {
    return qualified;
  }
  const ns = normalizeIcebergNamespace(defaultNamespace);
  if (!ns) {
    return {
      error:
        'Select an Iceberg namespace (database) or use a qualified table name like "namespace.table".',
    };
  }
  return { namespace: ns, table: identifier.trim() };
}

/**
 * MinIO Data Source Client
 * Fetches and parses Parquet files from MinIO directory structure
 */
class MinIOService {
  private config: MinIOConfig | null = null;
  private isConnectedFlag: boolean = false;
  private configStorageKey = "minio_config";
  private currentDatabase: string = ""; // Selected subdirectory/prefix

  constructor() {
    // Restore config from localStorage on initialization
    if (typeof window !== "undefined") {
      const savedConfig = localStorage.getItem(this.configStorageKey);
      if (savedConfig) {
        try {
          const raw = JSON.parse(savedConfig) as MinIOConfig & {
            warehouse?: string;
          };
          if (!raw.s3BucketName?.trim() && raw.warehouse?.trim()) {
            raw.s3BucketName = raw.warehouse.trim();
          }
          if (raw.database) {
            raw.database = normalizeIcebergNamespace(raw.database);
            this.currentDatabase = raw.database;
          }
          this.config = raw;
          this.isConnectedFlag = true;
        } catch (error) {
          console.error("[MinIO Client] Failed to parse saved config:", error);
        }
      }
    }
  }

  /**
   * Connect to MinIO source.
   * Supports two modes:
   * - Catalog mode: uses Iceberg REST catalog + DuckDB for server-side queries
   * - Direct mode (legacy): fetches parquet files directly from MinIO URL
   */
  async connect(
    config: MinIOConfig,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const DEFAULT_GLUE_REGION = "us-east-1";
      const requestedDatabase = normalizeIcebergNamespace(
        config.database || "",
      );

      // Catalog mode: AWS Glue Data Catalog (no REST URI)
      if (config.catalogType === "glue") {
        const region = config.glueRegion?.trim() || DEFAULT_GLUE_REGION;

        this.config = {
          baseUrl: config.baseUrl || "",
          catalogUri: "",
          catalogType: "glue",
          glueRegion: region,
          s3BucketName: resolveS3BucketName(config),
          s3Endpoint: config.s3Endpoint?.trim() || "",
          accessKey: config.accessKey,
          secretKey: config.secretKey,
          database: requestedDatabase,
        };
        this.currentDatabase = requestedDatabase;

        try {
          await this.getNamespacesFromCatalog();
        } catch (error) {
          this.config = null;
          this.currentDatabase = "";
          const msg = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: `Could not connect to AWS Glue catalog: ${msg}`,
          };
        }

        this.isConnectedFlag = true;

        if (typeof window !== "undefined") {
          localStorage.setItem(
            this.configStorageKey,
            JSON.stringify(this.config),
          );
        }

        return { success: true };
      }

      // Catalog mode: connect via Iceberg REST catalog
      if (config.catalogUri) {
        let normalizedCatalogUri = config.catalogUri.trim();
        if (!normalizedCatalogUri) {
          return {
            success: false,
            error: "Catalog URI is required.",
          };
        }

        // Validate catalog URI format
        try {
          new URL(normalizedCatalogUri);
        } catch {
          return {
            success: false,
            error:
              "Invalid Catalog URI format. Please provide a valid HTTP/HTTPS URL.",
          };
        }

        // Normalize: ensure trailing slash
        if (!normalizedCatalogUri.endsWith("/")) {
          normalizedCatalogUri += "/";
        }

        // Set config first (needed for icebergRequest calls)
        this.config = {
          baseUrl: config.baseUrl || "",
          catalogUri: normalizedCatalogUri,
          catalogType: "rest",
          s3BucketName: resolveS3BucketName(config),
          s3Endpoint: config.s3Endpoint?.trim() || "",
          accessKey: config.accessKey,
          secretKey: config.secretKey,
          database: requestedDatabase,
        };
        this.currentDatabase = requestedDatabase;

        // Validate connectivity by listing namespaces
        try {
          await this.getNamespacesFromCatalog();
        } catch (error) {
          // Reset config on failure
          this.config = null;
          this.currentDatabase = "";
          const msg = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: `Could not connect to catalog: ${msg}`,
          };
        }

        this.isConnectedFlag = true;

        // Persist config to localStorage
        if (typeof window !== "undefined") {
          localStorage.setItem(
            this.configStorageKey,
            JSON.stringify(this.config),
          );
        }

        return { success: true };
      }

      // Direct mode (legacy): connect via MinIO URL
      if (!config.baseUrl || typeof config.baseUrl !== "string") {
        return {
          success: false,
          error: "MinIO URL or Catalog URI is required.",
        };
      }

      // Normalize URL: ensure it ends with a slash
      let normalizedUrl = config.baseUrl.trim();
      if (!normalizedUrl) {
        return {
          success: false,
          error: "MinIO URL cannot be empty. Please provide a valid URL.",
        };
      }

      if (!normalizedUrl.endsWith("/")) {
        normalizedUrl += "/";
      }

      // Validate URL format
      try {
        new URL(normalizedUrl);
      } catch {
        return {
          success: false,
          error: "Invalid URL format. Please provide a valid HTTP/HTTPS URL.",
        };
      }

      this.config = {
        baseUrl: normalizedUrl,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        database: requestedDatabase,
      };
      this.currentDatabase = requestedDatabase;
      this.isConnectedFlag = true;

      // Persist config to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem(
          this.configStorageKey,
          JSON.stringify(this.config),
        );
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("[MinIO Client] Connection failed:", errorMessage, error);
      return {
        success: false,
        error: `Connection failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Disconnect from MinIO source
   */
  disconnect(): void {
    this.config = null;
    this.isConnectedFlag = false;
    this.currentDatabase = "";

    // Clear persisted config
    if (typeof window !== "undefined") {
      localStorage.removeItem(this.configStorageKey);
    }
  }

  /**
   * Check if connected to MinIO
   */
  isConnected(): boolean {
    return this.isConnectedFlag;
  }

  /**
   * Set the current database (subdirectory)
   */
  setCurrentDatabase(database: string): void {
    const normalized = normalizeIcebergNamespace(database);
    this.currentDatabase = normalized;
    if (this.config) {
      this.config.database = normalized;
      // Update persisted config
      if (typeof window !== "undefined") {
        localStorage.setItem(
          this.configStorageKey,
          JSON.stringify(this.config),
        );
      }
    }
  }

  /**
   * Get the current database
   */
  getCurrentDatabase(): string {
    return this.currentDatabase;
  }

  /**
   * Construct full URL for a Parquet file
   * Includes the database/subdirectory if set
   */
  private constructFileUrl(baseUrl: string, filename: string): string {
    const databasePath = this.currentDatabase ? `${this.currentDatabase}/` : "";
    return `${baseUrl}${databasePath}${filename}`;
  }

  /**
   * Fetch via server-side proxy to avoid CORS issues
   * Works with any MinIO URL
   */
  private async fetchViaProxy(url: string): Promise<Response> {
    // Use absolute URL to ensure it works during SSR and client-side
    const apiUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/minio`
        : "/api/minio";

    const body: Record<string, string> = { url, method: "GET" };
    const creds = readMinioProxyCredentialsFromStorage();
    if (creds) {
      body.accessKey = creds.accessKey;
      body.secretKey = creds.secretKey;
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Try to get error details from response
      let errorDetails = "";
      let fullErrorData: any = {};
      try {
        fullErrorData = await response.json();
        errorDetails = fullErrorData.error || JSON.stringify(fullErrorData);

        // Only log detailed errors for non-404s (404s are normal for optional files)
        if (response.status !== 404) {
          console.error(
            `[MinIO Client] Proxy error (${response.status}):`,
            errorDetails,
          );
          if (fullErrorData.url) {
            console.error(`[MinIO Client] Failed URL:`, fullErrorData.url);
          }
          if (fullErrorData.minioError) {
            console.error(
              `[MinIO Client] MinIO error response:`,
              fullErrorData.minioError,
            );
          }
        }
      } catch {
        errorDetails = await response.text();
        if (response.status !== 404) {
          console.error(
            `[MinIO Client] Proxy error (${response.status}):`,
            errorDetails,
          );
        }
      }

      throw new Error(
        `Proxy request failed: HTTP ${response.status} - ${errorDetails}`,
      );
    }
    return response;
  }

  /**
   * Fetch a JSON file from MinIO via the proxy.
   * Returns null on any failure (404, network error, parse error).
   */
  async fetchJson(url: string): Promise<any | null> {
    try {
      const response = await this.fetchViaProxy(url);
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Fetch and parse a Parquet file from MinIO
   * Uses server-side proxy to avoid CORS issues with any MinIO URL
   */
  async fetchParquetFile(filename: string): Promise<QueryResult> {
    if (!this.config) {
      return {
        data: [],
        rows: 0,
        error: "Not connected to MinIO. Please connect first.",
      };
    }

    try {
      const fileUrl = this.constructFileUrl(this.config.baseUrl, filename);
      // Fetch via proxy to avoid CORS
      const response = await this.fetchViaProxy(fileUrl);

      const arrayBuffer = await response.arrayBuffer();

      // Try to parse the Parquet file
      try {
        const data = await this.parseParquetBuffer(arrayBuffer);
        return {
          data,
          rows: data.length,
        };
      } catch (parseError) {
        // If parsing fails due to file being too large, return empty result
        const parseErrorMsg =
          parseError instanceof Error ? parseError.message : "Unknown error";
        if (
          parseErrorMsg.includes("call stack") ||
          parseErrorMsg.includes("stack size") ||
          parseErrorMsg.includes("too large")
        ) {
          console.error(
            `[MinIO Client] ${filename} is too large to parse, skipping...`,
          );
          return {
            data: [],
            rows: 0,
            error: `File too large: ${filename}`,
          };
        }
        throw parseError; // Re-throw other parse errors
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Check if this is a 404 (file not found) - this is normal for optional files
      if (errorMessage.includes("HTTP 404")) {
        return {
          data: [],
          rows: 0,
          error: `File not found: ${filename}`,
        };
      }

      // For other errors, log as error
      console.error(
        `[MinIO Client] Failed to fetch ${filename}:`,
        errorMessage,
      );
      return {
        data: [],
        rows: 0,
        error: `Failed to read ${filename}: ${errorMessage}`,
      };
    }
  }

  /**
   * Parse a Parquet file buffer into an array of objects
   * For large files, this may take some time
   */
  private async parseParquetBuffer(buffer: ArrayBuffer): Promise<any[]> {
    try {
      // Check file size to warn about large files
      const sizeMB = buffer.byteLength / (1024 * 1024);
      if (sizeMB > RAYPATH_CONFIG.LARGE_FILE_WARNING_MB) {
        console.warn(
          `[MinIO Client] Parsing large Parquet file (${sizeMB.toFixed(2)} MB), this may take a while...`,
        );
      }

      // Use hyparquet to read the Parquet file
      // For very large files, we might hit memory/stack limits
      const data = await parquetReadObjects({ file: buffer });

      return data;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if it's a stack overflow error
      if (
        errorMessage.includes("call stack") ||
        errorMessage.includes("stack size")
      ) {
        console.error(
          "[MinIO Client] File too large to parse in memory. Consider using smaller files or implementing streaming.",
        );
        throw new Error(
          "Parquet file too large - maximum call stack exceeded. Try smaller files.",
        );
      }

      console.error("[MinIO Client] Failed to parse Parquet buffer:", error);
      throw error;
    }
  }

  /**
   * Fetch sharded raypath files from raypaths/data/ directory
   * Files are named like: ue1_08a7e6a7.parquet, ue2_569c732a.parquet, etc.
   *
   * Due to large file sizes (30-50MB each), this uses several strategies:
   * 1. Load files sequentially (not parallel) to reduce memory pressure
   * 2. Skip files that are too large to parse
   * 3. Optionally limit total raypaths loaded
   */
  async fetchRaypathsSharded(options?: {
    maxRaypaths?: number;
    skipOnError?: boolean;
  }): Promise<QueryResult> {
    if (!this.config) {
      return {
        data: [],
        rows: 0,
        error: "Not connected to MinIO. Please connect first.",
      };
    }

    const maxRaypaths = options?.maxRaypaths ?? RAYPATH_CONFIG.MAX_RAYPATHS;
    const skipOnError = options?.skipOnError ?? RAYPATH_CONFIG.SKIP_ON_ERROR;

    try {
      // List all files in raypaths/data/ directory
      const raypathDir = this.currentDatabase
        ? `${this.currentDatabase}/raypaths/data`
        : "raypaths/data";

      const files = await this.listFilesInDirectory(raypathDir);

      // Filter for .parquet files that match known raypath naming patterns
      const raypathFiles = files.filter(
        (file) =>
          file.endsWith(".parquet") &&
          (/^ue\d+_[a-f0-9]+\.parquet$/i.test(file) ||
            /^node\d+_t\d+_\d+\.parquet$/i.test(file)),
      );

      if (raypathFiles.length === 0) {
        console.warn("[MinIO Client] No raypath files found in raypaths/data/");
        return {
          data: [],
          rows: 0,
        };
      }

      // Load files SEQUENTIALLY (not parallel) to reduce memory pressure
      const allRaypaths: any[] = [];

      for (let i = 0; i < raypathFiles.length; i++) {
        // Check if we've hit the limit
        if (allRaypaths.length >= maxRaypaths) {
          break;
        }

        const filename = raypathFiles[i];
        const fullPath = `raypaths/data/${filename}`;

        try {
          const result = await this.fetchParquetFile(fullPath);

          if (!result.error && result.data) {
            // Check if adding this file would exceed the limit
            const raypathsToAdd =
              maxRaypaths === Infinity
                ? result.data
                : result.data.slice(
                    0,
                    Math.max(0, maxRaypaths - allRaypaths.length),
                  );

            for (const item of raypathsToAdd) {
              allRaypaths.push(item);
            }

            // Force garbage collection hint (browsers may ignore)
            if (globalThis.gc) {
              globalThis.gc();
            }
          } else if (result.error) {
            if (skipOnError) {
              console.warn(
                `[MinIO Client] ✗ Skipped ${filename}: ${result.error}`,
              );
            } else {
              throw new Error(`Failed to load ${filename}: ${result.error}`);
            }
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);

          if (skipOnError) {
            console.warn(
              `[MinIO Client] ✗ Failed to load ${filename}: ${errorMsg}`,
            );
          } else {
            throw error;
          }
        }

        // Small delay between files to allow browser to process events
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      return {
        data: allRaypaths,
        rows: allRaypaths.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        "[MinIO Client] Failed to fetch sharded raypaths:",
        errorMessage,
      );
      return {
        data: [],
        rows: 0,
        error: `Failed to fetch raypaths: ${errorMessage}`,
      };
    }
  }

  /**
   * Get current connection config
   */
  getConnectionInfo(): {
    baseUrl: string;
    database?: string;
    catalogUri?: string;
    catalogType?: "rest" | "glue";
    glueRegion?: string;
    s3BucketName?: string;
    s3Endpoint?: string;
  } | null {
    if (!this.config) {
      return null;
    }

    return {
      baseUrl: this.config.baseUrl,
      database: this.currentDatabase,
      catalogUri: this.config.catalogUri,
      catalogType: this.config.catalogType,
      glueRegion: this.config.glueRegion,
      s3BucketName: this.config.s3BucketName,
      s3Endpoint: this.config.s3Endpoint,
    };
  }

  // ============================================================
  // Iceberg Catalog Methods
  // ============================================================

  /**
   * Check if catalog mode is configured
   */
  hasCatalog(): boolean {
    return !!(
      this.config?.catalogUri?.trim() || this.config?.catalogType === "glue"
    );
  }

  /**
   * Get the Iceberg API route URL
   */
  private getIcebergApiUrl(): string {
    return typeof window !== "undefined"
      ? `${window.location.origin}/api/iceberg`
      : "/api/iceberg";
  }

  /**
   * Make a request to the server-side Iceberg API route.
   * The route handles catalog REST API calls and DuckDB queries.
   */
  private async icebergRequest(body: Record<string, any>): Promise<any> {
    const apiUrl = this.getIcebergApiUrl();
    const isGlue = this.config?.catalogType === "glue";

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogType: isGlue ? "glue" : "rest",
        catalogUri: isGlue ? "" : this.config?.catalogUri,
        glueRegion: isGlue ? this.config?.glueRegion : undefined,
        s3BucketName: this.config?.s3BucketName,
        s3Endpoint: this.config?.s3Endpoint,
        accessKey: this.config?.accessKey,
        secretKey: this.config?.secretKey,
        ...body,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    return result;
  }

  /**
   * List namespaces (databases) from the Iceberg catalog.
   * Used instead of getDatabases() when catalog mode is active.
   */
  async getNamespacesFromCatalog(): Promise<string[]> {
    const result = await this.icebergRequest({ action: "listNamespaces" });
    return result.namespaces || [];
  }

  /**
   * List tables in a namespace from the Iceberg catalog.
   */
  async getTablesFromCatalog(namespace: string): Promise<string[]> {
    const result = await this.icebergRequest({
      action: "listTables",
      namespace: normalizeIcebergNamespace(namespace),
    });
    return result.tables || [];
  }

  /**
   * List every namespace and its tables (same flow as PyIceberg
   * `list_namespaces()` + `list_tables(ns)` in the example script).
   */
  async listDatabasesAndTablesFromCatalog(): Promise<
    { namespace: string; tables: string[] }[]
  > {
    const result = await this.icebergRequest({
      action: "listDatabasesAndTables",
    });
    return result.databases || [];
  }

  /**
   * Query a table via the Iceberg catalog + DuckDB (server-side).
   * This is the main replacement for fetchParquetFile() - instead of
   * downloading entire parquet files to the browser, the server queries
   * only the needed data using DuckDB.
   *
   * Pass either a short table name (`ues`) together with a selected namespace,
   * or a qualified catalog id (`default.ues`) — matching the PyIceberg
   * `catalog.load_table("namespace.table")` convention.
   */
  async queryViaCatalog(
    tableName: string,
    options?: {
      columns?: string[];
      where?: string;
      limit?: number;
    },
  ): Promise<QueryResult> {
    if (!this.hasCatalog()) {
      return {
        data: [],
        rows: 0,
        error: "Catalog not configured. Please connect with REST or AWS Glue.",
      };
    }

    const ref = resolveCatalogTableRef(tableName, this.currentDatabase);
    if ("error" in ref) {
      return {
        data: [],
        rows: 0,
        error: ref.error,
      };
    }

    try {
      const result = await this.icebergRequest({
        action: "queryTable",
        namespace: ref.namespace,
        table: ref.table,
        columns: options?.columns,
        where: options?.where,
        limit: options?.limit,
      });

      // Handle table-not-found gracefully (normal for optional tables)
      if (result.error) {
        console.warn(
          `[MinIO Client] Catalog query warning for ${tableName}: ${result.error}`,
        );
        return {
          data: result.data || [],
          rows: result.rows || 0,
          error: result.error,
        };
      }

      return {
        data: result.data || [],
        rows: result.rows || 0,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `[MinIO Client] Catalog query failed for ${tableName}:`,
        msg,
      );
      return {
        data: [],
        rows: 0,
        error: `Catalog query failed: ${msg}`,
      };
    }
  }

  /**
   * List files in a specific directory (for debugging)
   */
  async listFilesInDirectory(directory: string = ""): Promise<string[]> {
    if (!this.config) {
      throw new Error("Not connected to MinIO");
    }

    try {
      const prefix = directory ? `${directory}/` : "";
      const listUrl = `${this.config.baseUrl}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
      const response = await this.fetchViaProxy(listUrl);

      if (!response.ok) {
        console.error(
          `[MinIO Client] Failed to list files: ${response.status}`,
        );
        return [];
      }

      const xmlText = await response.text();
      const files: string[] = [];

      // Extract all Keys from Contents
      const keyRegex =
        /<Contents>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<\/Contents>/g;
      let match;

      while ((match = keyRegex.exec(xmlText)) !== null) {
        const key = match[1];
        // Remove the prefix to show just the filename
        const filename = key.startsWith(prefix)
          ? key.substring(prefix.length)
          : key;
        if (filename && !filename.endsWith("/")) {
          files.push(filename);
        }
      }
      return files;
    } catch (error) {
      console.error("[MinIO Client] Error listing files:", error);
      return [];
    }
  }

  /**
   * List available databases (subdirectories) in the bucket
   */
  async getDatabases(): Promise<string[]> {
    if (!this.config) {
      throw new Error("Not connected to MinIO");
    }

    try {
      // Use S3 ListObjectsV2 API to list directories
      // list-type=2 uses ListObjectsV2, delimiter=/ groups by directory
      const listUrl = `${this.config.baseUrl}?list-type=2&delimiter=/&max-keys=1000`;

      const response = await this.fetchViaProxy(listUrl);

      if (!response.ok) {
        console.error(
          `[MinIO Client] Failed to list directories: ${response.status}`,
        );
        return [];
      }

      // Parse XML response
      const xmlText = await response.text();
      const foundDirs: string[] = [];

      // Check if there are files at root level (Contents elements with no prefix)
      const contentsMatch = xmlText.match(/<Contents>/g);
      if (contentsMatch && contentsMatch.length > 0) {
        foundDirs.push("(root)");
      }

      // Extract CommonPrefixes (directories)
      const prefixRegex =
        /<CommonPrefixes>[\s\S]*?<Prefix>(.*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g;
      let match;

      while ((match = prefixRegex.exec(xmlText)) !== null) {
        const dirName = match[1];
        // Remove trailing slash
        const cleanName = dirName.endsWith("/")
          ? dirName.slice(0, -1)
          : dirName;
        if (cleanName) {
          foundDirs.push(cleanName);
        }
      }

      return foundDirs;
    } catch (error) {
      console.error("[MinIO Client] Error listing directories:", error);
      throw error;
    }
  }
}

// Create a singleton instance
export const minioClient = new MinIOService();
