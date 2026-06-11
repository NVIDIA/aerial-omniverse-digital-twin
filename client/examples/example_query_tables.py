#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Query Simulation Result Tables -- Example Script

Browse and query simulation results stored in Iceberg tables.
Supports REST (e.g. Nessie) and AWS Glue catalog types.

Quick start (local Nessie + MinIO -- defaults match docker compose):

    # List all databases and tables
    python3 example_query_tables.py list

    # List tables in a specific database
    python3 example_query_tables.py list --database default

    # Show schema, snapshots, and data files for a table
    python3 example_query_tables.py describe default.cirs

    # Query first 10 rows (default limit)
    python3 example_query_tables.py query default.cirs

    # Query with a row limit
    python3 example_query_tables.py query default.cirs --limit 20

    # Query specific columns only
    python3 example_query_tables.py query default.cirs --columns ue_id,ru_id,delay_ns

Custom catalog URI:

    python3 example_query_tables.py \
        --catalog-uri http://localhost:19120/iceberg \
        list

    python3 example_query_tables.py \
        --catalog-uri http://localhost:19120/iceberg \
        query default.cirs --limit 5

AWS Glue catalog:

    python3 example_query_tables.py --catalog-type glue --aws-region us-east-1 list
    python3 example_query_tables.py --catalog-type glue --aws-region us-east-1 \
        query default.cirs

Credentials:

    # For the default worker MinIO deployment
    AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
        python3 example_query_tables.py query default.cirs

    # Or pass credentials explicitly
    python3 example_query_tables.py \
        --s3-access-key minioadmin \
        --s3-secret-key minioadmin \
        query default.cirs

Help:

    python3 example_query_tables.py --help
    python3 example_query_tables.py query --help

Dependencies:
    pip install "pyiceberg[pyarrow]" duckdb pandas
    pip install "pyiceberg[glue]"  # for AWS Glue
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any, List, Optional, Sequence
from urllib.parse import urlparse


# ---------------------------------------------------------------------------
# Catalog connection
# ---------------------------------------------------------------------------

def connect_catalog(
    catalog_type: str,
    catalog_uri: Optional[str],
    aws_region: Optional[str] = None,
    s3_access_key: Optional[str] = None,
    s3_secret_key: Optional[str] = None,
):
    """Build and return a PyIceberg catalog.

    For REST catalogs, warehouse and S3 file I/O settings are owned by the
    catalog service and returned through the catalog configuration.
    """
    from pyiceberg.catalog import load_catalog

    if catalog_type == "rest":
        props = {"type": "rest", "uri": catalog_uri}
    elif catalog_type == "glue":
        props = {"type": "glue"}
        if aws_region:
            props["region_name"] = aws_region
            props["s3.region"] = aws_region
    else:
        print(f"Error: Unsupported catalog type '{catalog_type}'")
        print("  Supported types: rest, glue")
        sys.exit(1)

    if s3_access_key and s3_secret_key:
        # Credentials are still client-side: the catalog points at the object
        # store, but PyIceberg needs permission to read metadata and data files.
        props["s3.access-key-id"] = s3_access_key
        props["s3.secret-access-key"] = s3_secret_key
        props["client.access-key-id"] = s3_access_key
        props["client.secret-access-key"] = s3_secret_key

    label = catalog_uri if catalog_type == "rest" else f"AWS Glue ({aws_region})"
    print(f"Connecting to {catalog_type.upper()} catalog at {label} ...")

    catalog = load_catalog("default", **props)
    print()
    return catalog


def _extract_s3_bucket(uri: Optional[str]) -> Optional[str]:
    """Return the bucket from an s3:// URI, if present."""
    if not uri:
        return None

    parsed = urlparse(uri)
    if parsed.scheme in ("s3", "s3a", "s3n") and parsed.netloc:
        return parsed.netloc
    return None


def _properties_from(obj: Any) -> dict:
    """Best-effort extraction of PyIceberg property dictionaries."""
    for attr in ("properties", "_properties"):
        props = getattr(obj, attr, None)
        if isinstance(props, dict):
            return props
    return {}


def _resolved_s3_endpoint(catalog: Any, table: Any) -> Optional[str]:
    """Return the resolved S3 endpoint if PyIceberg exposes it."""
    candidates = (
        table,
        getattr(table, "io", None),
        getattr(table, "_io", None),
        catalog,
    )
    endpoint_keys = (
        "s3.endpoint",
        "s3.endpoint-url",
        "s3.endpoint_url",
        "client.endpoint",
        "client.endpoint-url",
        "client.endpoint_url",
    )

    for candidate in candidates:
        if candidate is None:
            continue
        props = _properties_from(candidate)
        for key in endpoint_keys:
            endpoint = props.get(key)
            if endpoint:
                return str(endpoint)
    return None


def _format_endpoint(
    endpoint: Optional[str],
    catalog_type: str,
    aws_region: Optional[str],
) -> str:
    """Return a human-readable endpoint description."""
    if endpoint:
        return endpoint
    if catalog_type == "glue":
        return f"AWS S3 regional endpoint ({aws_region or 'default region'})"
    return "(not exposed by catalog)"


def _sql_literal(value: str) -> str:
    """Return a SQL string literal."""
    return "'" + value.replace("'", "''") + "'"


def _configure_duckdb_s3(
    conn: Any,
    endpoint: Optional[str],
    aws_region: Optional[str],
    s3_access_key: Optional[str],
    s3_secret_key: Optional[str],
) -> None:
    """Configure DuckDB's S3 client from catalog-derived settings."""
    conn.execute("INSTALL httpfs; LOAD httpfs;")

    if s3_access_key:
        conn.execute(f"SET s3_access_key_id={_sql_literal(s3_access_key)}")
    if s3_secret_key:
        conn.execute(f"SET s3_secret_access_key={_sql_literal(s3_secret_key)}")
    if aws_region:
        conn.execute(f"SET s3_region={_sql_literal(aws_region)}")

    if endpoint:
        endpoint_stripped = endpoint.replace("http://", "").replace("https://", "")
        use_ssl = "true" if endpoint.startswith("https://") else "false"
        conn.execute(f"SET s3_endpoint={_sql_literal(endpoint_stripped)}")
        conn.execute(f"SET s3_use_ssl={use_ssl}")
        conn.execute("SET s3_url_style='path'")
    elif not s3_access_key and not s3_secret_key:
        # For AWS S3, let DuckDB use the normal AWS credential chain
        # (~/.aws/credentials, env vars, instance roles, etc.).
        conn.execute(
            """
            CREATE OR REPLACE SECRET aws_credentials (
                TYPE s3,
                PROVIDER credential_chain
            )
            """
        )


def _print_storage_target(
    catalog: Any,
    table: Any,
    files: Sequence[str],
    catalog_type: str,
    aws_region: Optional[str],
) -> None:
    """Print the catalog-resolved object-store target for this table."""
    bucket = _extract_s3_bucket(table.location())
    if not bucket and files:
        bucket = _extract_s3_bucket(files[0])

    endpoint = _resolved_s3_endpoint(catalog, table)

    print("Storage:")
    print(f"  Bucket:   {bucket or '(not an S3 table location)'}")
    print(f"  Endpoint: {_format_endpoint(endpoint, catalog_type, aws_region)}")


# ---------------------------------------------------------------------------
# Subcommand: list
# ---------------------------------------------------------------------------

def cmd_list(catalog, database: Optional[str] = None) -> None:
    """List databases (namespaces) and their tables."""

    try:
        if database:
            namespaces = [tuple(database.split("."))]
        else:
            namespaces = catalog.list_namespaces()
    except Exception as e:
        print(f"Error listing namespaces: {e}")
        return

    if not namespaces:
        print("(no databases found)")
        return

    print("Databases and Tables")
    print("-" * 40)

    total_tables = 0
    for ns in namespaces:
        ns_name = ".".join(ns)
        try:
            tables = catalog.list_tables(ns)
        except Exception as e:
            print(f"{ns_name}  (error: {e})")
            continue

        print(ns_name)
        if not tables:
            print("  (no tables)")
        for table_id in tables:
            table_name = table_id[-1]  # short name within the namespace
            info = _table_summary(catalog, ".".join(table_id))
            print(f"  {table_name:<24s} {info}")
            total_tables += 1
        print()

    print(f"Total: {total_tables} table(s) in {len(namespaces)} database(s)")


def _table_summary(catalog, full_name: str) -> str:
    """Return a short one-line summary for a table (row count + snapshots)."""
    try:
        table = catalog.load_table(full_name)
        snapshots = list(table.snapshots())
        snap_count = len(snapshots)

        if snap_count == 0:
            return "0 rows    0 snapshots"

        try:
            scan = table.scan()
            row_count = len(scan.to_pandas())
        except Exception:
            row_count = "?"

        snap_label = "snapshot" if snap_count == 1 else "snapshots"
        return f"{row_count:>8} rows    {snap_count} {snap_label}"
    except FileNotFoundError:
        return "(stale metadata)"
    except Exception as e:
        return f"(error: {e})"


# ---------------------------------------------------------------------------
# Subcommand: describe
# ---------------------------------------------------------------------------

def cmd_describe(catalog, table_name: str) -> None:
    """Show schema, location, snapshots, and data files for a table."""

    try:
        table = catalog.load_table(table_name)
    except Exception as e:
        print(f"Error: Cannot load table '{table_name}': {e}")
        return

    print(f"Table: {table_name}")
    print(f"Location: {table.location()}")

    # -- Schema --
    fields = table.schema().fields
    print(f"\nSchema ({len(fields)} columns)")

    name_width = max(len(f.name) for f in fields)
    type_width = max(len(str(f.field_type)) for f in fields)
    fmt = f"  {{:<{name_width}s}}  {{:<{type_width}s}}  {{}}"

    print(fmt.format("Name", "Type", "Nullable"))
    print(fmt.format("-" * name_width, "-" * type_width, "-" * 8))
    for field in fields:
        nullable = "yes" if field.optional else "no"
        print(fmt.format(field.name, str(field.field_type), nullable))

    # -- Snapshots --
    snapshots = list(table.snapshots())
    total_snaps = len(snapshots)
    show_snaps = 5

    if total_snaps == 0:
        print("\nSnapshots: (none)")
    else:
        header = f"\nSnapshots (latest {min(show_snaps, total_snaps)} of {total_snaps})"
        print(header)
        for snap in snapshots[-show_snaps:]:
            ts = datetime.fromtimestamp(snap.timestamp_ms / 1000, tz=timezone.utc)
            ts_str = ts.strftime("%Y-%m-%d %H:%M:%S UTC")
            print(f"  #{snap.snapshot_id}  {ts_str}")

    # -- Data files --
    print("\nData Files (current snapshot)")
    try:
        scan = table.scan()
        files = list(scan.plan_files())
        if not files:
            print("  (no data files)")
        else:
            show_files = 10
            for f in files[:show_files]:
                print(f"  {f.file.file_path}")
            if len(files) > show_files:
                print(f"  ... and {len(files) - show_files} more")
    except Exception as e:
        print(f"  Error scanning files: {e}")

    print()


# ---------------------------------------------------------------------------
# Subcommand: query
# ---------------------------------------------------------------------------

def cmd_query(
    catalog,
    table_name: str,
    limit: int = 10,
    columns: Optional[List[str]] = None,
    catalog_type: str = "rest",
    aws_region: Optional[str] = None,
    s3_access_key: Optional[str] = None,
    s3_secret_key: Optional[str] = None,
) -> None:
    """Query table rows using DuckDB and display the result."""

    try:
        import duckdb
    except ImportError:
        print("Error: duckdb is required for querying.")
        print("  Install with: pip install duckdb")
        return

    # -- Load table via PyIceberg --
    try:
        table = catalog.load_table(table_name)
    except Exception as e:
        print(f"Error: Cannot load table '{table_name}': {e}")
        return

    try:
        snapshot = table.current_snapshot()
        if snapshot is None:
            print(f"Table '{table_name}' has no data (no snapshots).")
            return
    except FileNotFoundError:
        print(f"Error: Table '{table_name}' has stale metadata (S3 files missing).")
        print("  The underlying parquet files may have been deleted.")
        return

    # -- Plan scan to discover parquet files --
    scan_kwargs = {}
    if columns:
        scan_kwargs["selected_fields"] = tuple(columns)

    scan = table.scan(**scan_kwargs)
    try:
        files = [task.file.file_path for task in scan.plan_files()]
    except Exception as e:
        print(f"Error: Cannot plan table scan for '{table_name}': {e}")
        print("  If this is a MinIO-backed catalog, provide object-store credentials:")
        print("    AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \\")
        print(f"        python3 {os.path.basename(__file__)} query {table_name}")
        print("  Or use --s3-access-key / --s3-secret-key.")
        return

    if not files:
        print(f"Table '{table_name}' has no data files.")
        return

    # -- Build header --
    col_info = f", columns: {', '.join(columns)}" if columns else ""
    endpoint = _resolved_s3_endpoint(catalog, table)
    print(f"Query: {table_name} (limit {limit}{col_info})")
    _print_storage_target(catalog, table, files, catalog_type, aws_region)
    print(f"Data files: {len(files)} parquet file(s)")
    print()

    # -- Execute query through DuckDB --
    conn = duckdb.connect()
    try:
        _configure_duckdb_s3(
            conn,
            endpoint=endpoint,
            aws_region=aws_region,
            s3_access_key=s3_access_key,
            s3_secret_key=s3_secret_key,
        )

        files_str = ", ".join(_sql_literal(f) for f in files)
        select_cols = ", ".join(columns) if columns else "*"
        query = f"SELECT {select_cols} FROM parquet_scan([{files_str}]) LIMIT {limit}"
        df = conn.execute(query).fetchdf()
    except Exception as e:
        print(f"Error: DuckDB query failed: {e}")
        print("  Check object-store credentials if the error is Forbidden/AccessDenied.")
        return

    if df.empty:
        print("(no rows returned)")
        return

    # -- Count total rows for the footer --
    try:
        count_query = f"SELECT COUNT(*) FROM parquet_scan([{files_str}])"
        total_rows = conn.execute(count_query).fetchone()[0]
    except Exception:
        total_rows = None

    # -- Display results --
    print(df.to_string(index=False))
    print()

    total_cols = len(table.schema().fields)
    showing_cols = len(df.columns)
    col_note = (
        f" | {showing_cols} of {total_cols} columns"
        if columns
        else f" | {showing_cols} columns"
    )
    if total_rows is not None:
        print(f"Showing {len(df)} of {total_rows:,} rows{col_note}")
        if len(df) < total_rows:
            print(f"Use --limit to see more rows, e.g. --limit {min(total_rows, limit * 5)}")
    else:
        print(f"Showing {len(df)} rows{col_note}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

QUICK_START = """\
Query Simulation Result Tables
================================
Browse and query simulation results (CIRs, CFRs, raypaths, etc.).

Quick start (local Nessie + MinIO):
  python3 example_query_tables.py list
  python3 example_query_tables.py describe default.cirs
  python3 example_query_tables.py query default.cirs --limit 5

AWS Glue:
  python3 example_query_tables.py --catalog-type glue --aws-region us-east-1 list

Use --help on any subcommand for details:
  python3 example_query_tables.py query --help
"""


def build_parser() -> argparse.ArgumentParser:
    # -- Top-level parser with global connection flags --
    parser = argparse.ArgumentParser(
        prog="example_query_tables.py",
        description="Browse and query simulation result tables (REST or Glue catalogs).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  python3 example_query_tables.py list
  python3 example_query_tables.py --catalog-uri http://localhost:19120/iceberg list
  python3 example_query_tables.py describe default.cirs
  python3 example_query_tables.py query default.cirs --limit 5
  python3 example_query_tables.py --catalog-type glue --aws-region us-east-1 list""",
    )

    cat_group = parser.add_argument_group("Catalog")
    cat_group.add_argument(
        "--catalog-type",
        choices=["rest", "glue"],
        default="rest",
        help="Catalog type (default: rest)",
    )
    cat_group.add_argument(
        "--catalog-uri",
        default="http://nessie:19120/iceberg",
        help="REST catalog endpoint (default: http://nessie:19120/iceberg)",
    )

    cat_group.add_argument(
        "--aws-region",
        default="us-east-1",
        help="AWS region for Glue catalogs (default: us-east-1)",
    )
    cat_group.add_argument(
        "--s3-access-key",
        default=os.environ.get("AWS_ACCESS_KEY_ID", ""),
        help="Object-store access key (defaults to AWS_ACCESS_KEY_ID)",
    )
    cat_group.add_argument(
        "--s3-secret-key",
        default=os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
        help="Object-store secret key (defaults to AWS_SECRET_ACCESS_KEY)",
    )

    subparsers = parser.add_subparsers(dest="command")

    # -- list --
    subparsers.add_parser(
        "list",
        help="List databases and tables in the catalog",
    ).add_argument(
        "--database",
        default=None,
        help="Show tables in this database only (e.g. 'default')",
    )

    # -- describe --
    subparsers.add_parser(
        "describe",
        help="Show schema and metadata for a table",
    ).add_argument(
        "table",
        help="Table name in database.table format (e.g. default.cirs)",
    )

    # -- query --
    p_query = subparsers.add_parser(
        "query",
        help="Query rows from a table using DuckDB",
    )
    p_query.add_argument(
        "table",
        help="Table name in database.table format (e.g. default.cirs)",
    )
    p_query.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Maximum number of rows to return (default: 10)",
    )
    p_query.add_argument(
        "--columns",
        default=None,
        help="Comma-separated column names to select (e.g. ue_id,cir,t_start)",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        print(QUICK_START)
        parser.print_usage()
        return 0

    if bool(args.s3_access_key) != bool(args.s3_secret_key):
        print("Error: provide both --s3-access-key and --s3-secret-key, or neither.")
        return 1

    # -- Connect to catalog --
    try:
        catalog = connect_catalog(
            catalog_type=args.catalog_type,
            catalog_uri=args.catalog_uri,
            aws_region=args.aws_region,
            s3_access_key=args.s3_access_key,
            s3_secret_key=args.s3_secret_key,
        )
    except ImportError as e:
        print(f"Error: Missing dependency -- {e}")
        print("\nInstall required packages:")
        print("  pip install 'pyiceberg[pyarrow]' duckdb pandas")
        print("  pip install 'pyiceberg[glue]'   # for AWS Glue")
        return 1
    except Exception as e:
        print(f"Error: Failed to connect to catalog: {e}")
        return 1

    # -- Dispatch subcommand --
    try:
        if args.command == "list":
            cmd_list(catalog, database=args.database)

        elif args.command == "describe":
            cmd_describe(catalog, table_name=args.table)

        elif args.command == "query":
            columns = [c.strip() for c in args.columns.split(",")] if args.columns else None
            cmd_query(
                catalog,
                table_name=args.table,
                limit=args.limit,
                columns=columns,
                catalog_type=args.catalog_type,
                aws_region=args.aws_region,
                s3_access_key=args.s3_access_key,
                s3_secret_key=args.s3_secret_key,
            )

    except Exception as e:
        print(f"Error: {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
