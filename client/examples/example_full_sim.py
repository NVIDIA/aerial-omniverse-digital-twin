#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Digital Twin Client - Full Simulation Example

This example demonstrates how to:
1. Load a scenario from YAML
2. Run the full simulation (all batches, all time steps)
3. Query results from the database after completion

This is the simplest way to run a complete simulation via the DT server.
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

from example_client_yaml_config import gen_example_yaml_string, S3Args, IcebergArgs


def load_yaml_file(yaml_path: str) -> str:
    """Load YAML file and return content as string."""
    with open(yaml_path, 'r') as f:
        yaml_content = f.read()
    return yaml_content


def main(args: argparse.Namespace) -> int:
    server_address = args.server_address
    import_option = args.import_option

    print(f"Connecting to Digital Twin server at {server_address}")
    
    # Create client
    client = dt_client.DigitalTwinClient(server_address)
    
    # Start streaming server logs to a local file (non-blocking)
    client.start_server_log_streaming("dt_server.log", "INFO")
    print("Server log streaming started -> dt_server.log")
    
    # ================================================================
    # Step 1: Load Scenario
    # ================================================================
    print("\n" + "=" * 60)
    print("Step 1: Load Scenario")
    print("=" * 60)
    
    # Load YAML configuration
    if import_option == "file":
        yaml_file = args.yaml_file
        if not Path(yaml_file).exists():
            print(f"Error: YAML file not found: {yaml_file}")
            return 1
        yaml_content = load_yaml_file(yaml_file)
        print(f"Loaded YAML file: {yaml_file} ({len(yaml_content)} bytes)")
    elif import_option == "string":
        yaml_content, ret = gen_example_yaml_string(
            scene=args.scene,
            asset_config=args.asset_config,
            output_file="",
            s3=S3Args(
                s3_endpoint=args.s3_endpoint,
                s3_bucket=args.s3_bucket,
                s3_provider=args.s3_provider,
                s3_access_key=args.s3_access_key,
                s3_secret_key=args.s3_secret_key,
            ),
            iceberg=IcebergArgs(
                iceberg_catalog_type=args.iceberg_catalog_type,
                iceberg_uri=args.iceberg_uri,
            ),
        )
        if ret != 0:
            print(f"Error: Failed to generate YAML string: {yaml_content}")
            return 1
        print(f"Generated YAML config ({len(yaml_content)} bytes)")
    
    # Start scenario
    try:
        client.start(yaml_content)
        print("✅ Scenario loaded successfully!")
    except RuntimeError as e:
        print(f"❌ Failed to start scenario: {e}")
        return 1
    
    # Get scenario status
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
    
    print("\n" + "=" * 60)
    print("✅ Full simulation example completed!")
    print("=" * 60)
    print("\nResults have been written to the database.")
    print("You can query CFRs, CIRs, and ray paths from the database tables.")
    
    client.stop_server_log_streaming()
    
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Digital Twin Client - Full Simulation Example",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run with generated YAML config
  python example_full_sim.py --server_address localhost:50051

  # Run with custom YAML file
  python example_full_sim.py --import_option file --yaml_file my_scenario.yaml

  # Run with specific scene
  python example_full_sim.py --scene test_data/maps/tokyo
        """
    )
    parser.add_argument(
        "--server_address", 
        type=str, 
        default="localhost:50051", 
        help="Server address (default: localhost:50051)"
    )
    parser.add_argument(
        "--import_option", 
        type=str, 
        default="string", 
        choices=["file", "string"], 
        help="Import option: 'file' to load from YAML file, 'string' to generate programmatically"
    )
    
    # Options for string generation
    parser.add_argument(
        "--scene", 
        type=str, 
        default="test_data/maps/tokyo", 
        help="Scene URL (relative to assets home or full omniverse URL)"
    )
    default_assets = str(Path(__file__).parent / "example_client_assets.yml")
    parser.add_argument(
        "--asset_config", 
        type=str, 
        default=default_assets, 
        help="Asset config file path"
    )

    # Options for file import
    default_yaml = str(Path(__file__).parent.parent / "tests" / "assets" / "TC_2RU_4UE_4T4R_1sym.yml")
    parser.add_argument(
        "--yaml_file", 
        type=str, 
        default=default_yaml, 
        help="YAML file path (used when --import_option file)"
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

