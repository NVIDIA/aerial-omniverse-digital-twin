#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Drop Simulation Result Database -- Example Script

Safely drop an Iceberg database and its S3 database folder. The script is a
dry run by default: it previews catalog tables, the resolved S3 prefix, and the
number of objects that would be deleted. Add --execute after reviewing it.

Quick start (REST catalog + S3-compatible storage):

    # Dry run: preview cleanup for database "default"
    AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \\
        python3 example_drop_database.py \\
            --catalog-uri http://localhost:19120/iceberg \\
            default

    # Delete S3 data, then drop catalog tables and the database
    AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \\
        python3 example_drop_database.py \\
            --catalog-uri http://localhost:19120/iceberg \\
            default --execute

    # Non-interactive execution for automation
    AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \\
        python3 example_drop_database.py \\
            --catalog-uri http://localhost:19120/iceberg \\
            default --execute --yes

AWS Glue:

    python3 example_drop_database.py --catalog-type glue --aws-region us-east-1 default

Dependencies:
    pip install "pyiceberg[pyarrow]" boto3
    pip install "pyiceberg[glue]"  # for AWS Glue
"""

import argparse
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlparse


QUICK_START = """\
Drop Simulation Result Database
===============================
Drop an Iceberg database and delete its database folder from S3.

REST catalog dry-run preview:
  AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \\
      python3 example_drop_database.py \\
          --catalog-uri http://localhost:19120/iceberg \\
          default

REST catalog execution after review:
  AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \\
      python3 example_drop_database.py \\
          --catalog-uri http://localhost:19120/iceberg \\
          default --execute

AWS Glue:
  python3 example_drop_database.py --catalog-type glue --aws-region us-east-1 default

Use --help for catalog and credential options.
"""


@dataclass
class S3Prefix:
    """Database folder to delete from S3."""

    bucket: str
    key_prefix: str
    uri: str


@dataclass
class ObjectSummary:
    """Object count and total bytes under one S3 prefix."""

    count: int = 0
    bytes: int = 0
    error: Optional[str] = None


@dataclass
class TableDropPlan:
    """Drop plan details for one catalog table."""

    table_name: str
    table_location: str
    endpoint: Optional[str]
    s3_prefix: Optional[S3Prefix]
    object_summary: ObjectSummary


def main() -> int:
    args = build_parser().parse_args()
    if not args.database:
        print(QUICK_START)
        return 0

    if bool(args.s3_access_key) != bool(args.s3_secret_key):
        print("Error: provide both --s3-access-key and --s3-secret-key, or neither.")
        return 1
    if args.catalog_type == "rest" and not args.catalog_uri:
        print("Error: --catalog-uri is required for REST catalogs.")
        return 1

    try:
        database = ".".join(_parse_namespace(args.database))
        catalog = connect_catalog(
            catalog_type=args.catalog_type,
            catalog_uri=args.catalog_uri,
            aws_region=args.aws_region,
            s3_access_key=args.s3_access_key,
            s3_secret_key=args.s3_secret_key,
        )
        plan = build_drop_plan(
            catalog=catalog,
            database=database,
            catalog_type=args.catalog_type,
            aws_region=args.aws_region,
            s3_access_key=args.s3_access_key,
            s3_secret_key=args.s3_secret_key,
        )
    except ImportError as e:
        print(f"Error: Missing dependency -- {e}")
        print("Install with: pip install 'pyiceberg[pyarrow]' boto3")
        print("For AWS Glue also install: pip install 'pyiceberg[glue]'")
        return 1
    except Exception as e:
        print(f"Error: Failed to prepare drop plan for '{args.database}': {e}")
        return 1

    print_drop_plan(
        database=database,
        plan=plan,
        execute=args.execute,
        catalog_type=args.catalog_type,
        aws_region=args.aws_region,
    )

    if not args.execute:
        print("\nDry run only. Add --execute to perform the deletion after reviewing the plan.")
        return 0

    errors = _validate_plan_for_execution(plan)
    if errors:
        print("\nError: Refusing to execute because S3 deletion cannot be verified:")
        for error in errors:
            print(f"  - {error}")
        return 1

    if not _confirm_database_drop(database, assume_yes=args.yes):
        print("Aborted.")
        return 1

    try:
        print()
        execute_drop_plan(
            catalog=catalog,
            database=database,
            plan=plan,
            aws_region=args.aws_region,
            s3_access_key=args.s3_access_key,
            s3_secret_key=args.s3_secret_key,
        )
    except Exception as e:
        print(f"Error: Drop failed: {e}")
        return 1

    print(f"\nDatabase '{database}' was dropped, including S3 table data.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="example_drop_database.py",
        description=(
            "Drop an Iceberg database and delete its database folder from S3 "
            "(REST or Glue catalogs)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  python3 example_drop_database.py --catalog-uri http://localhost:19120/iceberg default
  python3 example_drop_database.py --catalog-uri http://localhost:19120/iceberg default --execute
  python3 example_drop_database.py --catalog-uri http://localhost:19120/iceberg default --execute --yes
  python3 example_drop_database.py --catalog-type glue --aws-region us-east-1 default""",
    )

    catalog = parser.add_argument_group("Catalog")
    catalog.add_argument(
        "--catalog-type",
        choices=["rest", "glue"],
        default="rest",
        help="Catalog type (default: rest)",
    )
    catalog.add_argument(
        "--catalog-uri",
        default=None,
        help="REST catalog endpoint (required when --catalog-type=rest)",
    )
    catalog.add_argument(
        "--aws-region",
        default="us-east-1",
        help="AWS region for Glue catalogs or S3 access (default: us-east-1)",
    )
    catalog.add_argument(
        "--s3-access-key",
        default=os.environ.get("AWS_ACCESS_KEY_ID", ""),
        help="Object-store access key (defaults to AWS_ACCESS_KEY_ID)",
    )
    catalog.add_argument(
        "--s3-secret-key",
        default=os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
        help="Object-store secret key (defaults to AWS_SECRET_ACCESS_KEY)",
    )

    parser.add_argument("database", nargs="?", help="Database to drop, e.g. default")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually delete S3 objects and drop catalog metadata",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation prompt when --execute is set",
    )
    return parser


def connect_catalog(
    catalog_type: str,
    catalog_uri: Optional[str],
    aws_region: Optional[str] = None,
    s3_access_key: Optional[str] = None,
    s3_secret_key: Optional[str] = None,
):
    """Build a PyIceberg catalog connection."""
    from pyiceberg.catalog import load_catalog

    if catalog_type == "rest":
        props = {"type": "rest", "uri": catalog_uri}
        label = catalog_uri
    elif catalog_type == "glue":
        props = {"type": "glue"}
        label = f"AWS Glue ({aws_region})"
        if aws_region:
            props["region_name"] = aws_region
            props["s3.region"] = aws_region
    else:
        raise ValueError(f"unsupported catalog type: {catalog_type}")

    if s3_access_key and s3_secret_key:
        props.update(
            {
                "s3.access-key-id": s3_access_key,
                "s3.secret-access-key": s3_secret_key,
                "client.access-key-id": s3_access_key,
                "client.secret-access-key": s3_secret_key,
            }
        )

    print(f"Connecting to {catalog_type.upper()} catalog at {label} ...\n")
    return load_catalog("default", **props)


def build_drop_plan(
    catalog: Any,
    database: str,
    catalog_type: str,
    aws_region: Optional[str],
    s3_access_key: Optional[str],
    s3_secret_key: Optional[str],
) -> List[TableDropPlan]:
    """Inspect catalog tables and resolve the S3 database folder to delete."""
    namespace = _parse_namespace(database)
    if not _namespace_exists(catalog, namespace):
        raise ValueError(f"Database '{database}' does not exist in the catalog.")

    plan: List[TableDropPlan] = []

    for table_id in catalog.list_tables(namespace):
        table_name = _identifier_to_str(table_id)
        table = catalog.load_table(table_name)
        endpoint = _resolved_s3_endpoint(catalog, table)
        prefix = _resolve_database_s3_prefix(table, namespace)
        summary = _summarize_prefix_for_plan(
            prefix=prefix,
            database=database,
            endpoint=endpoint,
            aws_region=aws_region,
            s3_access_key=s3_access_key,
            s3_secret_key=s3_secret_key,
        )
        plan.append(
            TableDropPlan(
                table_name=table_name,
                table_location=table.location(),
                endpoint=endpoint,
                s3_prefix=prefix,
                object_summary=summary,
            )
        )

    return plan


def print_drop_plan(
    database: str,
    plan: List[TableDropPlan],
    execute: bool,
    catalog_type: str,
    aws_region: Optional[str],
) -> None:
    """Show exactly what the script will delete."""
    mode = "EXECUTE" if execute else "DRY RUN"
    print(f"{mode}: Drop database '{database}'")
    print("=" * (len(mode) + len(database) + 17))

    if not plan:
        print("\nTables: (none)")
        print("\nCatalog actions:")
        print(f"  Drop database: {database}")
        return

    print(f"\nTables: {len(plan)}")
    for table in plan:
        print(f"\nTable: {table.table_name}")
        print(f"  Location: {table.table_location}")
        print(f"  Endpoint: {_format_endpoint(table.endpoint, catalog_type, aws_region)}")
        print(f"  DB S3 prefix: {table.s3_prefix.uri if table.s3_prefix else '(not resolved)'}")

    print("\nDatabase S3 prefixes:")
    total_objects, total_bytes, counted_all = _print_prefix_summaries(plan)

    if counted_all and total_objects == 0:
        print(
            "\nS3 objects to delete: 0 (0 bytes; "
            "all resolved prefixes may be already deleted or empty)"
        )
    elif counted_all:
        print(f"\nS3 objects to delete: {total_objects:,} ({total_bytes:,} bytes)")
    else:
        print("\nS3 objects to delete: unknown (see table errors above)")

    print("\nCatalog actions:")
    for table in plan:
        print(f"  Drop table:    {table.table_name}")
    print(f"  Drop database: {database}")


def execute_drop_plan(
    catalog: Any,
    database: str,
    plan: List[TableDropPlan],
    aws_region: Optional[str],
    s3_access_key: Optional[str],
    s3_secret_key: Optional[str],
) -> None:
    """Delete S3 database folders first, then remove catalog metadata."""
    for table in _unique_prefix_tables(plan):
        if not table.s3_prefix:
            raise RuntimeError(f"{table.table_name}: missing S3 prefix")
        print(f"Deleting S3 objects under {table.s3_prefix.uri} ...")
        deleted = _delete_s3_prefix(
            prefix=table.s3_prefix,
            endpoint=table.endpoint,
            aws_region=aws_region,
            s3_access_key=s3_access_key,
            s3_secret_key=s3_secret_key,
        )
        print(f"  Deleted {deleted:,} object(s)")

    print()
    for table in plan:
        print(f"Dropping catalog table {table.table_name} ...")
        catalog.drop_table(table.table_name)

    print(f"Dropping database {database} ...")
    catalog.drop_namespace(_parse_namespace(database))


# ---------------------------------------------------------------------------
# Helper functions below keep the example self-contained.
# ---------------------------------------------------------------------------

def _summarize_prefix_for_plan(
    prefix: Optional[S3Prefix],
    database: str,
    endpoint: Optional[str],
    aws_region: Optional[str],
    s3_access_key: Optional[str],
    s3_secret_key: Optional[str],
) -> ObjectSummary:
    if prefix is None:
        return ObjectSummary(error=f"cannot resolve S3 database folder named '{database}'")
    if not prefix.key_prefix:
        return ObjectSummary(error="database folder points at the S3 bucket root")
    return _summarize_s3_prefix(
        prefix=prefix,
        endpoint=endpoint,
        aws_region=aws_region,
        s3_access_key=s3_access_key,
        s3_secret_key=s3_secret_key,
    )


def _print_prefix_summaries(plan: List[TableDropPlan]) -> Tuple[int, int, bool]:
    total_objects = 0
    total_bytes = 0
    counted_all = True
    unique_tables = _unique_prefix_tables(plan)

    if not unique_tables:
        print("  (none resolved)")
        return 0, 0, False

    for table in unique_tables:
        summary = table.object_summary
        if summary.error:
            counted_all = False
            print(f"  {table.s3_prefix.uri}: unknown ({summary.error})")
            continue

        total_objects += summary.count
        total_bytes += summary.bytes
        note = (
            " (no objects found; prefix may be already deleted or empty)"
            if summary.count == 0
            else ""
        )
        print(
            f"  {table.s3_prefix.uri}: {summary.count:,} object(s), "
            f"{summary.bytes:,} bytes{note}"
        )

    return total_objects, total_bytes, counted_all


def _validate_plan_for_execution(plan: List[TableDropPlan]) -> List[str]:
    errors: List[str] = []
    for table in plan:
        if table.s3_prefix is None:
            errors.append(
                f"{table.table_name}: cannot resolve S3 database folder "
                f"({table.table_location})"
            )
        if table.object_summary.error:
            errors.append(
                f"{table.table_name}: cannot list S3 objects "
                f"({table.object_summary.error})"
            )
    return errors


def _confirm_database_drop(database: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    print("\nThis will permanently delete S3 objects and catalog metadata.")
    return input(f"Type the database name '{database}' to continue: ") == database


def _parse_namespace(database: str) -> Tuple[str, ...]:
    parts = tuple(part.strip() for part in database.split(".") if part.strip())
    if not parts:
        raise ValueError("database name cannot be empty")
    return parts


def _namespace_exists(catalog: Any, namespace: Tuple[str, ...]) -> bool:
    return namespace in catalog.list_namespaces()


def _identifier_to_str(identifier: Sequence[str]) -> str:
    return ".".join(str(part) for part in identifier)


def _resolve_database_s3_prefix(table: Any, namespace: Tuple[str, ...]) -> Optional[S3Prefix]:
    """Resolve the DB folder from table location, with file paths as fallback."""
    prefix = _database_s3_prefix(table.location(), namespace)
    if prefix:
        return prefix

    for task in table.scan().plan_files():
        prefix = _database_s3_prefix(str(task.file.file_path), namespace)
        if prefix:
            return prefix
    return None


def _database_s3_prefix(uri: str, namespace: Tuple[str, ...]) -> Optional[S3Prefix]:
    """Return the database-level S3 prefix for a table or data-file URI.

    The URI may point to a table directory or an individual parquet file inside
    the database folder. This function finds the namespace path segment and
    trims the URI back to that folder. For example, namespace ("default",) and
    s3://bucket/default/cirs/data/part-000.parquet resolves to
    s3://bucket/default/.
    """
    parsed = urlparse(uri)
    if parsed.scheme not in ("s3", "s3a", "s3n") or not parsed.netloc:
        return None

    segments = [segment for segment in parsed.path.strip("/").split("/") if segment]
    for candidate in _namespace_path_candidates(namespace):
        width = len(candidate)
        for start in range(0, len(segments) - width + 1):
            if tuple(segments[start:start + width]) == candidate:
                key_prefix = "/".join(segments[:start + width]) + "/"
                return S3Prefix(
                    bucket=parsed.netloc,
                    key_prefix=key_prefix,
                    uri=f"s3://{parsed.netloc}/{key_prefix}",
                )
    return None


def _namespace_path_candidates(namespace: Tuple[str, ...]) -> List[Tuple[str, ...]]:
    candidates = [namespace]
    dotted = (".".join(namespace),)
    if dotted not in candidates:
        candidates.append(dotted)
    return candidates


def _unique_prefix_tables(plan: List[TableDropPlan]) -> List[TableDropPlan]:
    unique: List[TableDropPlan] = []
    seen = set()
    for table in plan:
        if table.s3_prefix is None:
            continue
        key = (table.s3_prefix.bucket, table.s3_prefix.key_prefix)
        if key not in seen:
            seen.add(key)
            unique.append(table)
    return unique


def _summarize_s3_prefix(
    prefix: S3Prefix,
    endpoint: Optional[str],
    aws_region: Optional[str],
    s3_access_key: Optional[str],
    s3_secret_key: Optional[str],
) -> ObjectSummary:
    summary = ObjectSummary()
    try:
        client = _create_s3_client(endpoint, aws_region, s3_access_key, s3_secret_key)
        pages = client.get_paginator("list_objects_v2").paginate(
            Bucket=prefix.bucket,
            Prefix=prefix.key_prefix,
        )
        for page in pages:
            for obj in page.get("Contents", []):
                summary.count += 1
                summary.bytes += int(obj.get("Size", 0))
    except Exception as e:
        summary.error = str(e)
    return summary


def _delete_s3_prefix(
    prefix: S3Prefix,
    endpoint: Optional[str],
    aws_region: Optional[str],
    s3_access_key: Optional[str],
    s3_secret_key: Optional[str],
) -> int:
    client = _create_s3_client(endpoint, aws_region, s3_access_key, s3_secret_key)
    deleted = 0
    pages = client.get_paginator("list_objects_v2").paginate(
        Bucket=prefix.bucket,
        Prefix=prefix.key_prefix,
    )

    for page in pages:
        objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
        for chunk in _chunks(objects, 1000):
            response = client.delete_objects(
                Bucket=prefix.bucket,
                Delete={"Objects": chunk, "Quiet": True},
            )
            errors = response.get("Errors", [])
            if errors:
                first = errors[0]
                key = first.get("Key", "(unknown key)")
                message = first.get("Message", first)
                raise RuntimeError(f"failed to delete {key}: {message}")
            deleted += len(chunk)

    return deleted


def _create_s3_client(
    endpoint: Optional[str],
    aws_region: Optional[str],
    s3_access_key: Optional[str],
    s3_secret_key: Optional[str],
):
    try:
        import boto3
        from botocore.config import Config
    except ImportError as e:
        raise RuntimeError("boto3 is required. Install with: pip install boto3") from e

    kwargs: Dict[str, Any] = {
        "service_name": "s3",
        "region_name": aws_region or "us-east-1",
    }
    if endpoint:
        kwargs["endpoint_url"] = endpoint
        kwargs["config"] = Config(s3={"addressing_style": "path"})
    if s3_access_key and s3_secret_key:
        kwargs["aws_access_key_id"] = s3_access_key
        kwargs["aws_secret_access_key"] = s3_secret_key
    return boto3.client(**kwargs)


def _chunks(items: List[Dict[str, str]], size: int) -> Iterable[List[Dict[str, str]]]:
    for offset in range(0, len(items), size):
        yield items[offset:offset + size]


def _resolved_s3_endpoint(catalog: Any, table: Any) -> Optional[str]:
    keys = (
        "s3.endpoint",
        "s3.endpoint-url",
        "s3.endpoint_url",
        "client.endpoint",
        "client.endpoint-url",
        "client.endpoint_url",
    )
    candidates = (table, getattr(table, "io", None), getattr(table, "_io", None), catalog)
    for candidate in candidates:
        props = _properties_from(candidate)
        for key in keys:
            if props.get(key):
                return str(props[key])
    return None


def _properties_from(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    for attr in ("properties", "_properties"):
        props = getattr(obj, attr, None)
        if isinstance(props, dict):
            return props
    return {}


def _format_endpoint(
    endpoint: Optional[str],
    catalog_type: str,
    aws_region: Optional[str],
) -> str:
    if endpoint:
        return endpoint
    if catalog_type == "glue":
        return f"AWS S3 regional endpoint ({aws_region or 'default region'})"
    return "(not exposed by catalog)"


if __name__ == "__main__":
    sys.exit(main())
