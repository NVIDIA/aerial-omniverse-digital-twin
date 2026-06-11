#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Digital Twin Client - PrepareMap Example with Terraform Config

OSM map generation with elevation enabled and a partial TerraformConfig
override. Demonstrates how to tune individual HARMONIZE_PARAMS fields
(building-base influence, post-terraform smoothing, etc.) from the client
without specifying every field — any field left as None falls back to
asim_gis defaults.

Usage:
    python example_prepare_map_terraform.py --s3_endpoint http://10.152.138.172:9002
"""

import sys
import argparse

try:
    import dt_client
    from dt_client import OSMTask, TerraformConfig
    from _config import S3Config
except ImportError:
    print("Error: dt_client or _config module not found.")
    print("Make sure the Python bindings are built and installed.")
    sys.exit(1)


def main(args: argparse.Namespace):
    print(f"Connecting to Digital Twin server at {args.server_address}")

    client = dt_client.DigitalTwinClient(args.server_address)
    client.start_server_log_streaming("dt_server.log", "INFO")

    try:
        s3 = S3Config(
            bucket=args.s3_bucket,
            provider=args.s3_provider,
            endpoint_url=args.s3_endpoint,
            access_key=args.s3_access_key,
            secret_key=args.s3_secret_key,
        )

        # Override a small subset of HARMONIZE_PARAMS
        tc = TerraformConfig(
            base_influence_sigma=75.0,
            terraform_smooth_iters=7,
        )

        task = OSMTask(
            output_folder_key=args.output_folder_key,
            coords=(args.min_lon, args.min_lat, args.max_lon, args.max_lat),
            include_elevation=True,
            terraform_config=tc,
        )

        print(f"\nPreparing OSM map (with terraform config) -> s3://{args.s3_bucket}/{args.output_folder_key}")
        print("(streaming heartbeats will appear below while the workflow runs)\n")

        try:
            result = client.prepare_map(task, s3)
            print()  # newline after spinner
            if result["success"]:
                print(f"Map ready: {result['s3_url']}")
            else:
                print(f"Failed: {result['message']}")
                return 1
        except RuntimeError as e:
            print(f"\nError: {e}")
            return 1
    finally:
        client.stop_server_log_streaming()

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PrepareMap (OSM + TerraformConfig) Example")
    parser.add_argument("--server_address", type=str, default="localhost:50051")
    parser.add_argument("--output_folder_key", type=str, default="demo_gis/test_osm_terraform.usd")

    # S3
    parser.add_argument("--s3_endpoint", type=str, default="", help="S3 endpoint URL. Required for MinIO; leave empty for AWS.")
    parser.add_argument("--s3_bucket", type=str, default="aerial-data")
    parser.add_argument("--s3_provider", type=str, default=None, choices=["minio", "aws"], help="S3 provider. Defaults to 'minio' if --s3_endpoint is set, otherwise 'aws'.")
    parser.add_argument("--s3_access_key", type=str, default="")
    parser.add_argument("--s3_secret_key", type=str, default="")

    # OSM bounds
    parser.add_argument("--min_lon", type=float, default=-122.34)
    parser.add_argument("--min_lat", type=float, default=47.60)
    parser.add_argument("--max_lon", type=float, default=-122.33)
    parser.add_argument("--max_lat", type=float, default=47.61)

    args = parser.parse_args()

    if args.s3_provider is None:
        args.s3_provider = "minio" if args.s3_endpoint else "aws"

    if args.s3_provider == "minio":
        if not args.s3_endpoint:
            args.s3_endpoint = "http://minio:9000"
        if not args.s3_access_key:
            args.s3_access_key = "minioadmin"
        if not args.s3_secret_key:
            args.s3_secret_key = "minioadmin"

    sys.exit(main(args))
