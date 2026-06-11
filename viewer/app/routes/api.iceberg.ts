/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createRequire } from "node:module";
import {
  GlueClient,
  GetDatabasesCommand,
  GetTableCommand,
  GetTablesCommand,
} from "@aws-sdk/client-glue";

/**
 * Iceberg Catalog API Route
 *
 * Server-side API route that:
 * 1. Resolves table metadata — REST catalog HTTP API, or AWS Glue (`GetTable`) when
 *    `catalogType: "glue"` (same discovery roles as PyIceberg in
 *    `client/examples/example_query_tables.py`).
 * 2. Runs DuckDB against S3 Parquet — same pipeline for REST and Glue: manifest /
 *    `iceberg_metadata()` → `parquet_scan([...])` (equivalent to PyIceberg
 *    `scan.plan_files()`), then `iceberg_scan` / layout fallbacks.
 * 3. Returns query results as JSON to the client.
 *
 * Usage: POST /api/iceberg with JSON body specifying the action.
 */

// ============================================================
// Types
// ============================================================

interface IcebergRequest {
  action:
    | "listNamespaces"
    | "listTables"
    | "listDatabasesAndTables"
    | "queryTable"
    | "describeTable"
    | "testConnection";
  /** REST catalog base URL; omitted when using AWS Glue (`catalogType: "glue"`). */
  catalogUri?: string;
  /** Defaults to REST when `catalogUri` is set; use `glue` for AWS Glue Data Catalog. */
  catalogType?: "rest" | "glue";
  /** AWS region for Glue API calls (required when `catalogType` is `glue`). */
  glueRegion?: string;
  /** S3 bucket (or s3://bucket) for Parquet path fallbacks. */
  s3BucketName?: string;
  /** @deprecated Prefer s3BucketName; still accepted for older clients. */
  warehouse?: string;
  s3Endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  namespace?: string;
  table?: string;
  columns?: string[];
  where?: string;
  limit?: number;
}

// ============================================================
// DuckDB Module Management (lazy-loaded, cached)
// ============================================================

let duckdbModule: any = null;
let dbInstance: any = null;
let extensionsInstalled = false;
let icebergExtensionAvailable = false;
let initError: string | null = null;

/**
 * Initialize DuckDB with required extensions.
 * The database instance and extensions are cached across requests.
 */
async function initDuckDB(): Promise<any> {
  if (dbInstance && extensionsInstalled) return dbInstance;
  if (initError) throw new Error(initError);

  try {
    // Load duckdb using createRequire since it's a native CJS module
    // that cannot be loaded via ESM import in Vite's SSR context
    if (!duckdbModule) {
      const require = createRequire(import.meta.url);
      duckdbModule = require("duckdb");
    }

    // Create in-memory database
    if (!dbInstance) {
      dbInstance = await new Promise<any>((resolve, reject) => {
        const db = new duckdbModule.Database(
          ":memory:",
          (err: Error | null) => {
            if (err) reject(err);
            else resolve(db);
          },
        );
      });
    }

    if (!extensionsInstalled) {
      // Install and load httpfs (required for S3 access)
      try {
        await runSQL(dbInstance, "INSTALL httpfs;");
        await runSQL(dbInstance, "LOAD httpfs;");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // httpfs might already be loaded
        if (!msg.includes("already loaded")) {
          console.error("[Iceberg API] Failed to load httpfs:", e);
          throw new Error(
            "Failed to load DuckDB httpfs extension. Internet access may be required for first run.",
          );
        }
      }

      // Try to install iceberg extension (optional - has fallback)
      try {
        await runSQL(dbInstance, "INSTALL iceberg;");
        await runSQL(dbInstance, "LOAD iceberg;");
        // Enable version guessing: Nessie-backed tables may not have
        // version-hint.text, so DuckDB needs to glob the metadata directory
        // to find the latest metadata file.
        await runSQL(dbInstance, "SET unsafe_enable_version_guessing = true;");
        icebergExtensionAvailable = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already loaded")) {
          icebergExtensionAvailable = true;
        } else {
          console.warn("[Iceberg API] iceberg extension not available:", e);
          icebergExtensionAvailable = false;
        }
      }

      extensionsInstalled = true;
    }

    // Disable HTTP metadata caching so DuckDB always re-fetches remote files
    // (Iceberg snapshots, Parquet data) instead of serving stale cached content.
    await runSQL(dbInstance, "SET enable_http_metadata_cache=false;");

    return dbInstance;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (
      msg.includes("Cannot find module") ||
      msg.includes("MODULE_NOT_FOUND")
    ) {
      initError = "DuckDB is not installed. Run: npm install duckdb";
    } else if (!initError) {
      initError = `Failed to initialize DuckDB: ${msg}`;
    }

    throw new Error(initError || msg);
  }
}

// ============================================================
// DuckDB Helpers (Promisified)
// ============================================================

function runSQL(db: any, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function querySQL(db: any, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: any[]) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build s3:// glob patterns for the common layout:
 *   s3://<bucket>/<namespace>/<table>/data/*.parquet
 * (matches files visible in MinIO console like …/ues/data/ues.parquet)
 */
function s3BucketNamespaceTableDataPatterns(
  s3BucketName: string | undefined,
  namespace: string | undefined,
  table: string | undefined,
): string[] {
  if (!s3BucketName?.trim() || !namespace?.trim() || !table?.trim()) {
    return [];
  }
  let root = s3BucketName.trim();
  if (!root.startsWith("s3://")) {
    root = `s3://${root.replace(/^\/+/, "")}`;
  }
  root = root.replace(/\/+$/, "");
  const ns = namespace.trim();
  const tbl = table.trim();
  return [
    `${root}/${ns}/${tbl}/data/**/*.parquet`,
    `${root}/${ns}/${tbl}/data/*.parquet`,
    `${root}/${ns}/${tbl}/data/*/*.parquet`,
  ];
}

/** DuckDB httpfs needs a non-empty s3_region; env overrides server default. */
function duckdbDefaultS3Region(): string {
  return (
    process.env.AWS_DEFAULT_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "us-east-1"
  );
}

/**
 * Serialize DuckDB results for JSON response.
 * Handles BigInt conversion and other non-JSON-safe types.
 */
function serializeForJSON(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return Number(obj);
  if (obj instanceof Date) return obj.toISOString();
  if (Buffer.isBuffer(obj)) return obj.toString("base64");
  if (Array.isArray(obj)) return obj.map(serializeForJSON);
  if (typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key] = serializeForJSON(obj[key]);
    }
    return result;
  }
  return obj;
}

// ============================================================
// Iceberg REST Catalog API Helpers
// ============================================================

/**
 * Make a GET request to the Iceberg REST Catalog API.
 * The catalog follows the Iceberg REST Catalog spec (used by Nessie, etc.)
 */
async function catalogFetch(catalogUri: string, path: string): Promise<any> {
  const base = catalogUri.replace(/\/+$/, "");
  const url = `${base}/v1/${path}`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let errorText = "";
    try {
      errorText = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Catalog API error: HTTP ${response.status} - ${errorText}`,
    );
  }

  return response.json();
}

/**
 * Get the catalog prefix from the catalog config.
 * Nessie uses a prefix (typically the branch name, e.g., "main").
 */
async function getCatalogPrefix(catalogUri: string): Promise<string> {
  try {
    const config = await catalogFetch(catalogUri, "config");
    const prefix = config?.overrides?.prefix || config?.defaults?.prefix || "";
    return prefix ? `${prefix}/` : "";
  } catch {
    // If config endpoint fails, try without prefix
    return "";
  }
}

function isGlueCatalog(req: IcebergRequest): boolean {
  return req.catalogType === "glue";
}

function resolveGlueRegion(req: IcebergRequest): string {
  return req.glueRegion?.trim() || duckdbDefaultS3Region();
}

function resolveGlueEndpoint(region: string): string {
  const domain = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `https://glue.${region}.${domain}`;
}

function createGlueClient(req: IcebergRequest): GlueClient {
  const region = resolveGlueRegion(req);
  const ak = req.accessKey?.trim();
  const sk = req.secretKey?.trim();
  return new GlueClient({
    region,
    // Avoid global AWS endpoint_url / AWS_ENDPOINT_URL settings meant for
    // MinIO from redirecting Glue API calls to an S3-compatible endpoint.
    endpoint: resolveGlueEndpoint(region),
    ...(ak && sk
      ? { credentials: { accessKeyId: ak, secretAccessKey: sk } }
      : {}),
  });
}

/** First non-empty string among Glue Table.Parameters keys (Iceberg uses mixed casing). */
function glueParameterString(
  params: Record<string, string> | undefined,
  keys: string[],
): string | undefined {
  if (!params) return undefined;
  for (const k of keys) {
    const v = params[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Maps Glue `GetTable` output to the same JSON shape as Iceberg REST `GET .../tables/{table}`
 * so Glue and REST share `executeDuckDbIcebergQuery` (parity with PyIceberg + DuckDB in
 * `client/examples/example_query_tables.py` cmd_query).
 */
async function fetchGlueTableRestShape(req: IcebergRequest): Promise<any> {
  const client = createGlueClient(req);
  const out = await client.send(
    new GetTableCommand({
      DatabaseName: req.namespace!.trim(),
      Name: req.table!.trim(),
    }),
  );
  const t = out.Table;
  if (!t) {
    throw new Error("Glue table not found");
  }
  const params = t.Parameters ?? {};
  const metaLoc = glueParameterString(params, [
    "metadata_location",
    "METADATA_LOCATION",
    "metadata.location",
  ]);
  const sd = t.StorageDescriptor;
  let loc = sd?.Location?.trim() || undefined;
  const trimmedMeta =
    typeof metaLoc === "string" && metaLoc.trim() ? metaLoc.trim() : undefined;
  if (!loc && trimmedMeta) {
    // Iceberg metadata JSON path → table root (…/metadata/v1.metadata.json or …/metadata/)
    loc = trimmedMeta.replace(/\/metadata\/[^/]+$/, "").replace(/\/+$/, "");
  }

  return {
    metadata: {
      location: loc,
      "format-version": 2,
      schemas: [],
      properties: params,
    },
    "metadata-location": trimmedMeta,
  };
}

/**
 * Load Iceberg table metadata from REST catalog or Glue (same logical table as PyIceberg `load_table`).
 */
async function loadIcebergTableMetadata(req: IcebergRequest): Promise<any> {
  if (isGlueCatalog(req)) {
    return fetchGlueTableRestShape(req);
  }
  const prefix = await getCatalogPrefix(req.catalogUri!);
  return catalogFetch(
    req.catalogUri!,
    `${prefix}namespaces/${encodeURIComponent(req.namespace!.trim())}/tables/${encodeURIComponent(req.table!.trim())}`,
  );
}

// ============================================================
// Action Handlers
// ============================================================

/**
 * Test connection to the catalog server.
 */
async function handleTestConnection(req: IcebergRequest) {
  if (isGlueCatalog(req)) {
    try {
      const client = createGlueClient(req);
      await client.send(new GetDatabasesCommand({ MaxResults: 1 }));
      return Response.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Response.json(
        { success: false, error: `Cannot reach AWS Glue: ${msg}` },
        { status: 502 },
      );
    }
  }

  try {
    const config = await catalogFetch(req.catalogUri!, "config");
    return Response.json({
      success: true,
      config,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json(
      { success: false, error: `Cannot connect to catalog: ${msg}` },
      { status: 502 },
    );
  }
}

/**
 * List namespaces (databases) from the Iceberg catalog.
 */
async function handleListNamespaces(req: IcebergRequest) {
  if (isGlueCatalog(req)) {
    try {
      const client = createGlueClient(req);
      const namespaces: string[] = [];
      let nextToken: string | undefined;
      do {
        const page = await client.send(
          new GetDatabasesCommand({ NextToken: nextToken }),
        );
        for (const db of page.DatabaseList ?? []) {
          if (db.Name) namespaces.push(db.Name);
        }
        nextToken = page.NextToken;
      } while (nextToken);
      return Response.json({ namespaces });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Response.json(
        { error: `Glue list databases failed: ${msg}` },
        { status: 502 },
      );
    }
  }

  const prefix = await getCatalogPrefix(req.catalogUri!);
  const data = await catalogFetch(req.catalogUri!, `${prefix}namespaces`);

  // Response format: { namespaces: [["ns1"], ["ns2"]] }
  const namespaces = (data.namespaces || []).map((ns: string[]) =>
    ns.join("."),
  );

  return Response.json({ namespaces });
}

/**
 * List tables in a namespace from the Iceberg catalog.
 * Namespace must be non-empty (use listDatabasesAndTables to browse everything).
 */
async function handleListTables(req: IcebergRequest) {
  if (!req.namespace?.trim()) {
    return Response.json({ error: "namespace is required" }, { status: 400 });
  }

  if (isGlueCatalog(req)) {
    try {
      const client = createGlueClient(req);
      const tables: string[] = [];
      let nextToken: string | undefined;
      do {
        const page = await client.send(
          new GetTablesCommand({
            DatabaseName: req.namespace.trim(),
            NextToken: nextToken,
          }),
        );
        for (const tbl of page.TableList ?? []) {
          if (tbl.Name) tables.push(tbl.Name);
        }
        nextToken = page.NextToken;
      } while (nextToken);
      return Response.json({ tables });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Response.json(
        { error: `Glue list tables failed: ${msg}` },
        { status: 502 },
      );
    }
  }

  const prefix = await getCatalogPrefix(req.catalogUri!);
  const data = await catalogFetch(
    req.catalogUri!,
    `${prefix}namespaces/${encodeURIComponent(req.namespace.trim())}/tables`,
  );

  // Response format: { identifiers: [{ namespace: ["ns"], name: "table" }] }
  const tables = (data.identifiers || []).map((id: any) => id.name);

  return Response.json({ tables });
}

/**
 * List every namespace and its tables (PyIceberg: list_namespaces + list_tables per ns).
 */
async function handleListDatabasesAndTables(req: IcebergRequest) {
  if (isGlueCatalog(req)) {
    try {
      const client = createGlueClient(req);
      const nsNames: string[] = [];
      let dbToken: string | undefined;
      do {
        const page = await client.send(
          new GetDatabasesCommand({ NextToken: dbToken }),
        );
        for (const db of page.DatabaseList ?? []) {
          if (db.Name) nsNames.push(db.Name);
        }
        dbToken = page.NextToken;
      } while (dbToken);

      const databases: { namespace: string; tables: string[] }[] = [];
      for (const ns of nsNames) {
        try {
          const tables: string[] = [];
          let tblToken: string | undefined;
          do {
            const tpage = await client.send(
              new GetTablesCommand({
                DatabaseName: ns,
                NextToken: tblToken,
              }),
            );
            for (const tbl of tpage.TableList ?? []) {
              if (tbl.Name) tables.push(tbl.Name);
            }
            tblToken = tpage.NextToken;
          } while (tblToken);
          databases.push({ namespace: ns, tables });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          databases.push({ namespace: ns, tables: [] });
          console.warn(
            `[Iceberg API] Glue list tables failed for database "${ns}": ${msg}`,
          );
        }
      }
      return Response.json({ databases });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Response.json(
        { error: `Glue browse failed: ${msg}` },
        { status: 502 },
      );
    }
  }

  const prefix = await getCatalogPrefix(req.catalogUri!);
  const nsData = await catalogFetch(req.catalogUri!, `${prefix}namespaces`);

  const namespaceJoins = (nsData.namespaces || []).map((ns: string[]) =>
    ns.join("."),
  );

  const databases: { namespace: string; tables: string[] }[] = [];

  for (const ns of namespaceJoins) {
    try {
      const data = await catalogFetch(
        req.catalogUri!,
        `${prefix}namespaces/${encodeURIComponent(ns)}/tables`,
      );
      const tables = (data.identifiers || []).map((id: any) => id.name);
      databases.push({ namespace: ns, tables });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      databases.push({ namespace: ns, tables: [] });
      console.warn(
        `[Iceberg API] list tables failed for namespace "${ns}": ${msg}`,
      );
    }
  }

  return Response.json({ databases });
}

/**
 * Describe a table (schema and metadata) from the Iceberg catalog.
 */
async function handleDescribeTable(req: IcebergRequest) {
  if (!req.namespace || !req.table) {
    return Response.json(
      { error: "namespace and table are required" },
      { status: 400 },
    );
  }

  if (isGlueCatalog(req)) {
    try {
      const client = createGlueClient(req);
      const out = await client.send(
        new GetTableCommand({
          DatabaseName: req.namespace.trim(),
          Name: req.table.trim(),
        }),
      );
      const t = out.Table;
      if (!t) {
        return Response.json({ error: "Table not found" }, { status: 404 });
      }
      const params = t.Parameters ?? {};
      const metaLoc =
        (params.metadata_location as string | undefined) ||
        (params.METADATA_LOCATION as string | undefined);
      const sd = t.StorageDescriptor;
      const cols = sd?.Columns ?? [];
      return Response.json({
        metadataLocation: metaLoc,
        location: sd?.Location,
        schema: {
          type: "struct",
          fields: cols.map((c, i) => ({
            id: i,
            name: c.Name,
            type: c.Type,
            required: false,
          })),
        },
        formatVersion: undefined,
        properties: params,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("EntityNotFoundException") ||
        msg.includes("NotFoundException")
      ) {
        return Response.json({ error: "Table not found" }, { status: 404 });
      }
      return Response.json(
        { error: `Glue describe table failed: ${msg}` },
        { status: 500 },
      );
    }
  }

  const prefix = await getCatalogPrefix(req.catalogUri!);
  const tableData = await catalogFetch(
    req.catalogUri!,
    `${prefix}namespaces/${encodeURIComponent(req.namespace)}/tables/${encodeURIComponent(req.table)}`,
  );

  const metadata = tableData?.metadata;
  const currentSchemaId = metadata?.["current-schema-id"] ?? 0;
  const schemas = metadata?.schemas || [];
  const currentSchema =
    schemas.find((s: any) => s["schema-id"] === currentSchemaId) || schemas[0];

  return Response.json({
    metadataLocation: tableData["metadata-location"],
    location: metadata?.location,
    schema: currentSchema,
    formatVersion: metadata?.["format-version"],
    properties: metadata?.properties,
  });
}

/**
 * Resolve catalog metadata, then run the shared DuckDB pipeline (REST and Glue).
 *
 * Mirrors `example_query_tables.py`: PyIceberg `load_table` / Glue catalog vs REST —
 * then DuckDB reads Parquet via the same stages as {@link executeDuckDbIcebergQuery}.
 */
async function handleQueryTable(req: IcebergRequest) {
  if (!req.namespace || !req.table) {
    return Response.json(
      { error: "namespace and table are required" },
      { status: 400 },
    );
  }

  let tableMetadata: any;
  try {
    tableMetadata = await loadIcebergTableMetadata(req);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // 404 = table not found, which is normal for optional tables
    if (
      msg.includes("404") ||
      msg.includes("EntityNotFoundException") ||
      msg.includes("NotFoundException") ||
      msg.includes("Glue table not found")
    ) {
      return Response.json({
        data: [],
        rows: 0,
        columns: [],
        error: `Table not found: ${req.namespace}.${req.table}`,
      });
    }

    return Response.json(
      { error: `Failed to load table metadata: ${msg}` },
      { status: 500 },
    );
  }

  const tableLocation = tableMetadata?.metadata?.location as string | undefined;
  const metadataLocation = tableMetadata?.["metadata-location"] as
    | string
    | undefined;

  if (!tableLocation && !metadataLocation) {
    return Response.json(
      { error: "Could not determine table location from catalog metadata" },
      { status: 500 },
    );
  }

  return executeDuckDbIcebergQuery(req, tableLocation, metadataLocation);
}

/**
 * Shared DuckDB execution for REST and Glue Iceberg tables.
 *
 * Same strategy as `example_query_tables.py` cmd_query:
 * iceberg_metadata / manifest paths → parquet_scan ([files]), then iceberg_scan,
 * then S3 layout fallbacks. Glue uses the same steps once {@link fetchGlueTableRestShape}
 * supplies metadata.location / metadata-location compatible with REST.
 */
async function executeDuckDbIcebergQuery(
  req: IcebergRequest,
  tableLocation: string | undefined,
  metadataLocation: string | undefined,
): Promise<Response> {
  try {
    const db = await initDuckDB();

    // Configure S3 credentials for this query (matches Python SET s3_* before parquet_scan)
    if (req.accessKey) {
      await runSQL(
        db,
        `SET s3_access_key_id='${escapeSqlString(req.accessKey)}';`,
      );
    }
    if (req.secretKey) {
      await runSQL(
        db,
        `SET s3_secret_access_key='${escapeSqlString(req.secretKey)}';`,
      );
    }
    if (req.s3Endpoint) {
      const endpoint = req.s3Endpoint.replace(/^https?:\/\//, "");
      await runSQL(db, `SET s3_endpoint='${escapeSqlString(endpoint)}';`);
      await runSQL(db, "SET s3_use_ssl=false;");
      await runSQL(db, "SET s3_url_style='path';");
    } else {
      // DuckDB settings persist on the cached in-memory DB. Reset MinIO-specific
      // S3 settings before querying real AWS S3.
      for (const setting of ["s3_endpoint", "s3_use_ssl", "s3_url_style"]) {
        try {
          await runSQL(db, `RESET ${setting};`);
        } catch {
          // Older DuckDB builds may not support RESET for every setting.
        }
      }
    }

    const s3Region = isGlueCatalog(req)
      ? resolveGlueRegion(req)
      : duckdbDefaultS3Region();
    await runSQL(db, `SET s3_region='${escapeSqlString(s3Region)}';`);

    // Ensure version guessing is enabled (Nessie tables lack version-hint.text)
    try {
      await runSQL(db, "SET unsafe_enable_version_guessing = true;");
    } catch {
      // Ignore if already set or not supported
    }

    const columns =
      req.columns && req.columns.length > 0 ? req.columns.join(", ") : "*";
    const whereClause = req.where ? ` WHERE ${req.where}` : "";
    const limitClause =
      req.limit != null
        ? ` LIMIT ${Math.max(0, Math.floor(Number(req.limit)))}`
        : "";

    let rows: any[];

    // Prefer manifest-driven file list (same idea as PyIceberg scan.plan_files → parquet_scan).
    try {
      rows = await queryViaManifestParquetFiles(
        db,
        tableLocation,
        columns,
        whereClause,
        limitClause,
      );
    } catch {
      rows = [];
    }

    if (rows.length === 0 && icebergExtensionAvailable && tableLocation) {
      try {
        const sql = `SELECT ${columns} FROM iceberg_scan('${escapeSqlString(tableLocation)}')${whereClause}${limitClause}`;
        rows = await querySQL(db, sql);

        if (rows.length === 0) {
          try {
            const fallbackRows = await queryWithFallbacks(
              db,
              tableLocation,
              metadataLocation,
              req.table!,
              columns,
              whereClause,
              limitClause,
              { s3BucketName: req.s3BucketName, namespace: req.namespace },
            );
            if (fallbackRows.length > 0) {
              rows = fallbackRows;
            }
          } catch {
            // keep 0 rows
          }
        }
      } catch (icebergError) {
        console.warn(
          "[Iceberg API] iceberg_scan failed, trying fallbacks:",
          icebergError,
        );
        rows = await queryWithFallbacks(
          db,
          tableLocation,
          metadataLocation,
          req.table!,
          columns,
          whereClause,
          limitClause,
          { s3BucketName: req.s3BucketName, namespace: req.namespace },
        );
      }
    } else if (rows.length === 0) {
      rows = await queryWithFallbacks(
        db,
        tableLocation,
        metadataLocation,
        req.table!,
        columns,
        whereClause,
        limitClause,
        { s3BucketName: req.s3BucketName, namespace: req.namespace },
      );
    }

    // If manifest returned partial data, try glob fallback for more complete results
    if (rows.length > 0) {
      try {
        const globRows = await queryWithFallbacks(
          db,
          tableLocation,
          metadataLocation,
          req.table!,
          columns,
          whereClause,
          limitClause,
          { s3BucketName: req.s3BucketName, namespace: req.namespace },
        );
        if (globRows.length > rows.length) rows = globRows;
      } catch {
        /* keep existing rows */
      }
    }

    const serializedRows = serializeForJSON(rows);

    return Response.json({
      data: serializedRows,
      rows: serializedRows.length,
      columns: serializedRows.length > 0 ? Object.keys(serializedRows[0]) : [],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Iceberg API] DuckDB query failed: ${msg}`);

    return Response.json({ error: `Query failed: ${msg}` }, { status: 500 });
  }
}

/**
 * Query using data file paths from the current Iceberg snapshot manifest
 * (PyIceberg: table.scan().plan_files() → parquet_scan([paths])).
 */
async function queryViaManifestParquetFiles(
  db: any,
  tableLocation: string | undefined,
  columns: string,
  whereClause: string,
  limitClause: string,
): Promise<any[]> {
  if (!icebergExtensionAvailable || !tableLocation) {
    return [];
  }

  const metaRows = await querySQL(
    db,
    `SELECT file_path FROM iceberg_metadata('${escapeSqlString(tableLocation)}') WHERE manifest_content = 'DATA' AND status IN ('ADDED', 'EXISTING') AND file_format = 'PARQUET'`,
  );
  const filePaths = metaRows.map((r: any) => r.file_path).filter(Boolean);
  if (filePaths.length === 0) {
    return [];
  }

  const fileList = filePaths
    .map((p: string) => `'${escapeSqlString(p)}'`)
    .join(", ");
  const sql = `SELECT ${columns} FROM parquet_scan([${fileList}], union_by_name = true)${whereClause}${limitClause}`;
  return querySQL(db, sql);
}

/**
 * Fallback strategy when iceberg_scan fails:
 * 1. Try iceberg_metadata() to extract actual data file paths, then parquet_scan those
 * 2. Try parquet_scan with various glob patterns on the table directory
 * 3. Try parquet_scan on the parent directory's setup/<table>.parquet pattern
 * 4. Try s3://<bucket>/<namespace>/<table>/data/ when catalog metadata points elsewhere
 */
async function queryWithFallbacks(
  db: any,
  tableLocation: string | undefined,
  metadataLocation: string | undefined,
  tableName: string,
  columns: string,
  whereClause: string,
  limitClause: string,
  catalogHint?: { s3BucketName?: string; namespace?: string },
): Promise<any[]> {
  // Determine the table root from location or metadata-location
  let tableRoot: string;

  if (tableLocation) {
    tableRoot = tableLocation.replace(/\/+$/, "");
  } else if (metadataLocation) {
    // Derive table root from metadata location
    // metadata-location: bucket/path/metadata/00001.metadata.json
    // table root: bucket/path
    tableRoot = metadataLocation.replace(/\/metadata\/[^/]+$/, "");
  } else {
    throw new Error("Could not determine data file location");
  }

  // Prefer explicit bucket layout when Iceberg metadata points at a different prefix
  // than the actual Parquet export (common when data is under bucket/namespace/table/data/).
  const patterns: string[] = [
    ...s3BucketNamespaceTableDataPatterns(
      catalogHint?.s3BucketName,
      catalogHint?.namespace,
      tableName,
    ),
    `${tableRoot}/data/*.parquet`,
    `${tableRoot}/*.parquet`,
    `${tableRoot}/data/*/*.parquet`,
    `${tableRoot}/data/**/*.parquet`,
  ];

  // Also try parent directory patterns (e.g., setup/<table>.parquet)
  const parentDir = tableRoot.replace(/\/[^/]+$/, "");
  if (parentDir !== tableRoot) {
    patterns.push(
      `${parentDir}/setup/${tableName}.parquet`,
      `${parentDir}/${tableName}.parquet`,
      `${parentDir}/setup/*.parquet`,
    );
  }

  for (const pattern of patterns) {
    try {
      const sql = `SELECT ${columns} FROM parquet_scan('${escapeSqlString(pattern)}', union_by_name = true)${whereClause}${limitClause}`;
      const rows = await querySQL(db, sql);
      if (rows.length > 0) {
        return rows;
      }
    } catch {
      // Pattern didn't match, try next
      continue;
    }
  }
  return [];
}

// ============================================================
// Route Handlers
// ============================================================

async function handleRequest(request: Request) {
  try {
    const bodyRaw = (await request.json()) as IcebergRequest;
    const s3BucketName =
      bodyRaw.s3BucketName?.trim() || bodyRaw.warehouse?.trim();
    const body: IcebergRequest = {
      ...bodyRaw,
      ...(s3BucketName ? { s3BucketName } : {}),
    };

    if (!body.action) {
      return Response.json({ error: "action is required" }, { status: 400 });
    }

    const catalogType = body.catalogType ?? "rest";

    if (catalogType === "glue") {
      body.catalogType = "glue";
      body.glueRegion = body.glueRegion?.trim() || duckdbDefaultS3Region();
    } else {
      body.catalogType = "rest";
      const uri = body.catalogUri?.trim();
      if (!uri) {
        return Response.json(
          { error: "catalogUri is required for REST catalog" },
          { status: 400 },
        );
      }
      body.catalogUri = uri;

      try {
        new URL(uri);
      } catch {
        return Response.json(
          { error: "Invalid catalogUri format" },
          { status: 400 },
        );
      }

      if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
        return Response.json(
          { error: "Only HTTP and HTTPS protocols are allowed" },
          { status: 400 },
        );
      }
    }

    switch (body.action) {
      case "testConnection":
        return await handleTestConnection(body);
      case "listNamespaces":
        return await handleListNamespaces(body);
      case "listTables":
        return await handleListTables(body);
      case "listDatabasesAndTables":
        return await handleListDatabasesAndTables(body);
      case "describeTable":
        return await handleDescribeTable(body);
      case "queryTable":
        return await handleQueryTable(body);
      default:
        return Response.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Iceberg API] Request processing failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return handleOptions();

  if (request.method === "GET") {
    return Response.json({
      message: "Iceberg Catalog API - use POST requests",
      actions: [
        "testConnection",
        "listNamespaces",
        "listTables",
        "listDatabasesAndTables",
        "describeTable",
        "queryTable",
      ],
    });
  }

  return handleRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return handleOptions();
  return handleRequest(request);
}
