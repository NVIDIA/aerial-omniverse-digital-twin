#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Digital Twin Client - Calibration Example

This example demonstrates how to:
1. Load the base simulation scenario
2. Run full simulation to populate DB/exported tables
3. Reload the same scenario with calibration settings
4. Run calibration

This is the simplest way to run calibration via the DT server.
"""

import sys
import argparse
from pathlib import Path

# Import the C++ client bindings
try:
    import dt_client
except ImportError:
    print("Error: dt_client module not found. Make sure the Python bindings are built and installed.")
    print("Build with: cd build && make && make install")
    sys.exit(1)

from example_client_calibration_yaml_config import (
    gen_example_yaml_string,
    S3Args,
    IcebergArgs,
)


def print_scenario_status(client: object) -> int:
    """Print current scenario status."""
    try:
        status = client.get_status()
        print(f"\n📊 Scenario Status:")
        print(f"  Scenario loaded: {status['scenario_loaded']}")
        print(f"  Number of RUs: {status['num_rus']}")
        print(f"  Number of UEs: {status['num_ues']}")
        print(f"  Total batches: {status['total_batches']}")
        
        if status['is_slot_symbol_mode']:
            print(f"  Temporal Mode: Slot/Symbols")
            print(f"  Slots per batch: {status['num_slots_or_timesteps_per_batch']}")
        else:
            print(f"  Temporal Mode: Duration/Interval")
            print(f"  Time steps per batch: {status['num_slots_or_timesteps_per_batch']}")

        if not status['scenario_loaded']:
            print(f"❌ Scenario not loaded. Call client.start_server_log_streaming() and check dt_server.log for server-side errors.")
            return 1
    except RuntimeError as e:
        print(f"❌ Failed to get status: {e}")
        return 1
    return 0


def start_scenario(client: object, yaml_content: str, description: str) -> int:
    """Start a scenario and print status."""
    try:
        if not client.start(yaml_content):
            print(f"❌ Failed to start {description}. Check dt_server.log for server-side errors.")
            return 1
        print(f"✅ {description} loaded successfully!")
    except RuntimeError as e:
        print(f"❌ Failed to start {description}: {e}")
        return 1
    return print_scenario_status(client)


def main(args: argparse.Namespace) -> int:
    server_address = args.server_address

    print(f"Connecting to Digital Twin server at {server_address}")
    
    # Create client
    client = dt_client.DigitalTwinClient(server_address)
    
    # Start streaming server logs to a local file (non-blocking)
    client.start_server_log_streaming("dt_server.log", "INFO")
    print("Server log streaming started -> dt_server.log")
    
    s3_args = S3Args(
        s3_endpoint=args.s3_endpoint,
        s3_bucket=args.s3_bucket,
        s3_provider=args.s3_provider,
        s3_access_key=args.s3_access_key,
        s3_secret_key=args.s3_secret_key,
    )
    iceberg_args = IcebergArgs(
        iceberg_catalog_type=args.iceberg_catalog_type,
        iceberg_uri=args.iceberg_uri,
    )

    # ================================================================
    # Step 1: Load Simulation Scenario
    # ================================================================
    print("\n" + "=" * 60)
    print("Step 1: Load Simulation Scenario")
    print("=" * 60)

    # Save the Step 1 simulation YAML so the calibration YAML can later build on
    # the exact setup that was simulated in Step 1.
    simulation_yaml_file = "/tmp/simulation_yaml.yaml"

    simulation_yaml_content, ret = gen_example_yaml_string(
        scene=args.scene,
        asset_config=args.asset_config,
        s3=s3_args,
        iceberg=iceberg_args,
        run_calibration=False,
        output_file=simulation_yaml_file,
    )
    if ret != 0:
        print(f"Error: Failed to generate simulation YAML string: {simulation_yaml_content}")
        return 1
    print(f"Generated simulation YAML config ({len(simulation_yaml_content)} bytes)")

    if start_scenario(client, simulation_yaml_content, "Simulation scenario") != 0:
        return 1
    
    # ================================================================
    # Step 2: Run Full Simulation
    # ================================================================
    print("\n" + "=" * 60)
    print("Step 2: Run Full Simulation")
    print("=" * 60)
    
    print("\n🚀 Starting full simulation...")
    print("   (This may take a while depending on scenario complexity)")
    
    try:
        result = client.run_full_simulation()
        
        print(f"\n✅ Full simulation completed!")
        print(f"  Time steps completed: {result['time_steps_completed']}")
        print(f"  Total time: {result['total_time_seconds']:.2f} seconds")
        
    except RuntimeError as e:
        print(f"❌ Simulation failed: {e}")
        return 1
    
    # ================================================================
    # Step 3: Load Calibration Scenario
    # ================================================================
    print("\n" + "=" * 60)
    print("Step 3: Load Calibration Scenario")
    print("=" * 60)

    # Reload the saved simulation YAML and add calibration-specific settings.
    calibration_yaml_content, ret = gen_example_yaml_string(
        scene=args.scene,
        asset_config=args.asset_config,
        s3=s3_args,
        iceberg=iceberg_args,
        run_calibration=True,
        calibration_output_folder="test_calibration_run/output",
        simulation_yaml_file=simulation_yaml_file,
    )
    if ret != 0:
        print(f"Error: Failed to generate calibration YAML string: {calibration_yaml_content}")
        return 1
    print(f"Generated calibration YAML config ({len(calibration_yaml_content)} bytes)")

    if start_scenario(client, calibration_yaml_content, "Calibration scenario") != 0:
        return 1

    # ================================================================
    # Step 4: Run Calibration
    # ================================================================
    print("\n" + "=" * 60)
    print("Step 4: Run Calibration")
    print("=" * 60)
    
    print("\n🚀 Starting calibration...")
    print("   (This may take a while depending on scenario complexity)")
    
    try:
        result = client.run_calibration()
        
        print(f"\n✅ Calibration completed!")
        print(f"  Final stage: {result['stage']}")
        print(f"  Total time: {result['total_time_seconds']:.2f} seconds")
        print(f"  Message: {result['message']}")
        
    except RuntimeError as e:
        print(f"❌ Calibration failed: {e}")
        return 1
    
    print("\n" + "=" * 60)
    print("✅ Calibration example completed!")
    print("=" * 60)
    
    client.stop_server_log_streaming()

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Digital Twin Client - Calibration Example",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run generated simulation + calibration YAML configs
  python example_calibration.py --server_address localhost:50051

  # Run with a specific scene
  python example_calibration.py --scene test_data/maps/hels
        """,
    )
    parser.add_argument(
        "--server_address", 
        type=str, 
        default="localhost:50051", 
        help="Server address (default: localhost:50051)",
    )
    # Options for string generation
    parser.add_argument(
        "--scene", 
        type=str, 
        default="test_data/maps/hels",
        help="Scene URL (relative to assets home or full omniverse URL)"
    )
    default_assets = str(Path(__file__).parent / "example_client_assets.yml")
    parser.add_argument(
        "--asset_config", 
        type=str, 
        default=default_assets, 
        help="Asset config file path"
    )
    parser.add_argument("--s3_endpoint", type=str, default="", help="S3 endpoint URL. Required for MinIO; leave empty for AWS.")
    parser.add_argument("--s3_bucket", type=str, default="aerial-data", help="S3 bucket name")
    parser.add_argument("--s3_provider", type=str, default=None, choices=["minio", "aws"], help="S3 provider. Defaults to 'minio' if --s3_endpoint is set, otherwise 'aws'.")
    parser.add_argument("--s3_access_key", type=str, default="", help="S3 access key (MinIO only)")
    parser.add_argument("--s3_secret_key", type=str, default="", help="S3 secret key (MinIO only)")
    parser.add_argument("--iceberg_uri", type=str, default="http://nessie:19120/iceberg", help="Iceberg catalog URI. Needs to be running and reachable.")
    parser.add_argument("--iceberg_catalog_type", type=str, default="rest", choices=["sql", "rest", "glue"], help="Iceberg catalog type")
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
