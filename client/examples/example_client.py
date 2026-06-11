#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Digital Twin Client Python Example - Mode 1 (Slot/Symbols)

This example demonstrates how to use the Python bindings for the Digital Twin C++ client
with slot-based temporal indexing (Mode 1: Slot/Symbols).

It shows how to:
1. Load a scenario from YAML
2. Query RU and UE positions using SlotIndex
3. Allocate GPU memory and compute channel matrices
4. Allocate GPU memory and compute CIR results

Note: This example is for scenarios configured with Slot/Symbols mode.
      For Duration/Interval mode, see example_client_timestep.py
"""

import sys
import yaml
import numpy as np
from pathlib import Path
import argparse

# Import the C++ client bindings
try:
    import dt_client
    from dt_client import SlotIndex, TimeStepIndex
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


def load_yaml_from_dict(config_dict: dict) -> str:
    """Convert Python dict to YAML string."""
    return yaml.dump(config_dict)


def main(args: argparse.Namespace):
    # Server address
    server_address = args.server_address
    import_option = args.import_option


    print(f"Connecting to Digital Twin server at {server_address}")

    # Create client
    client = dt_client.DigitalTwinClient(server_address)

    # Start streaming server logs to a local file (non-blocking)
    client.start_server_log_streaming("dt_server.log", "INFO")
    print("Server log streaming started -> dt_server.log")

    # ================================================================
    # Test 0: Start Scenario
    # ================================================================
    print("\n" + "=" * 60)
    print("Test 0: Start Scenario")
    print("=" * 60)

    # Option 1: Load from YAML file
    if import_option == "file":
        yaml_file = args.yaml_file
        if not Path(yaml_file).exists():
            print(f"Error: YAML file not found: {yaml_file}")
            print("Please provide a valid YAML file path")
            return 1
        yaml_content = load_yaml_file(yaml_file)
        print(f"Loaded YAML file: {yaml_file} ({len(yaml_content)} bytes)")
    # Option 2: Create YAML programmatically to get YAML string (alternative)
    elif import_option == "string":
        yaml_content, ret = gen_example_yaml_string(
            scene=args.scene,
            asset_config=args.asset_config,
            sim_id=args.sim_id,
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
        print(f"Generated YAML string: {yaml_content} ({len(yaml_content)} bytes)")

    # Start scenario
    try:
        success = client.start(yaml_content)
        if success:
            print("✅ Scenario started successfully!")
        else:
            print("❌ Failed to start scenario")
            return 1
    except RuntimeError as e:
        print(f"❌ Failed to start scenario: {e}")
        return 1

    # Get scenario status
    try:
        status = client.get_status()
        print(f"\n📊 Status:")
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

        num_rus = status['num_rus']
        num_ues = status['num_ues']

        if status['scenario_loaded'] == False:
            print(f"❌ Scenario not loaded. Call client.start_server_log_streaming() and check dt_server.log for server-side errors.")
            return 1
    except RuntimeError as e:
        print(f"❌ Failed to get status: {e}")
        return 1

    # ================================================================
    # Test 1: RU Position Requests
    # ================================================================
    print("\n" + "=" * 60)
    print("Test 1: RU Position Requests")
    print("=" * 60)

    try:
        ru_positions = client.get_ru_positions()
        print(f"\n✅ Retrieved {len(ru_positions)} RU positions:")
        for i, pos in enumerate(ru_positions):
            print(f"  RU {i}: ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})")
    except RuntimeError as e:
        print(f"❌ Failed to get RU positions: {e}")

    # ================================================================
    # Test 2: UE Position Requests (mobility)
    # ================================================================
    print("\n" + "=" * 60)
    print("Test 2: UE Position Requests (Mobility)")
    print("=" * 60)

    test_slots = [0, 5, 10]
    for slot in test_slots:
        try:
            # Mode 1: Slot/Symbols - Use SlotIndex for discrete slot-based temporal indexing
            ue_positions = client.get_ue_positions(
                batch_index=0,
                temporal_index=SlotIndex(slot)
            )
            # For Mode 2 (Duration/Interval), use:
            # time_step = slot
            # ue_positions = client.get_ue_positions(
            #     batch_index=0,
            #     temporal_index=TimeStepIndex(time_step)
            # )

            print(f"\n✅ Slot {slot}: Retrieved {len(ue_positions)} UE positions:")
            for i, pos in enumerate(ue_positions[:3]):  # Show first 3 UEs
                print(f"  UE {i}: ({pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f})")
        except RuntimeError as e:
            print(f"❌ Failed to get UE positions for slot {slot}: {e}")

    # ================================================================
    # Test 3: CIR Operations with GPU Access
    # ================================================================
    print("\n" + "=" * 60)
    print("Test 3: CIR (Channel Impulse Response) Operations")
    print("=" * 60)

    # Define test configuration
    ru_indices = [0, 1] if num_rus >= 2 else [0]
    if num_rus >= 2:
        ue_indices_per_ru = [[0, 1, 2, 3], [0, 1, 2, 3]] if num_ues >= 4 else [[0], [0]]
    else:
        ue_indices_per_ru = [[0, 1, 2, 3]] if num_ues >= 4 else [[0]]
    is_full_antenna_pair = True

    print(f"\nConfiguration:")
    print(f"  RU indices: {ru_indices}")
    print(f"  UE indices per RU: {ue_indices_per_ru}")
    print(f"  Full antenna pair: {is_full_antenna_pair}")

    try:
        # Step 1: Allocate GPU memory for CIR
        print("\nStep 1: Allocating GPU memory for CIR...")
        cir_allocation = client.allocate_cirs_memory(
            ru_indices, ue_indices_per_ru, is_full_antenna_pair
        )

        print(f"✅ Allocated CIR memory for {cir_allocation.num_time_steps} time step(s)")
        print(f"  Total values bytes: {cir_allocation.total_values_bytes}")
        print(f"  Total delays bytes: {cir_allocation.total_delays_bytes}")
        print(f"  RU indices: {cir_allocation.ru_indices_per_ts[0]}")

        # Step 2: Compute CIR for slot 0
        # Mode 1: Slot/Symbols - Use SlotIndex for discrete slot-based temporal indexing
        print("\nStep 2: Computing CIR for slot 0...")
        client.get_cirs(
            cir_allocation,
            batch_index=0,
            temporal_index=SlotIndex(5)
            # For Mode 2 (Duration/Interval), use: temporal_index=TimeStepIndex(time_step)
        )

        print(f"✅ CIR computed successfully for temporal indices: {cir_allocation.temporal_indices}")

        # Step 3: Access GPU memory and copy data to numpy using new API
        print("\nStep 3: Accessing GPU memory and copying data to numpy...")
        temporal_idx = 5  # The slot we computed
        for ru_idx in ru_indices:
            print(f"\n  📊 Processing RU {ru_idx}:")

            # New API: directly copy to numpy with correct offsets per RU
            values = client.to_numpy(cir_allocation, temporal_idx, ru_idx, "values")
            delays = client.to_numpy(cir_allocation, temporal_idx, ru_idx, "delays")
            print(f"    CIR Values shape: {values.shape}, dtype: {values.dtype}")
            print(f"    Delays shape: {delays.shape}, dtype: {delays.dtype}")

            # Print sample values (first 5 elements)
            print(f"\n    Sample CIR Values (first 5):")
            flat_cir = values.flatten()
            for j in range(min(5, len(flat_cir))):
                print(f"      [{j}] {flat_cir[j]:.6e}")

            print(f"\n    Sample Delays (first 5):")
            flat_delays = delays.flatten()
            for j in range(min(5, len(flat_delays))):
                print(f"      [{j}] {flat_delays[j]:.6e} s")

            # Print statistics
            print(f"\n    CIR Value Statistics:")
            print(f"      Mean magnitude: {np.abs(flat_cir).mean():.6e}")
            print(f"      Max magnitude: {np.abs(flat_cir).max():.6e}")
            print(f"      Min magnitude: {np.abs(flat_cir).min():.6e}")

            print(f"\n    Delay Statistics:")
            print(f"      Mean: {flat_delays.mean():.6e} s")
            print(f"      Max: {flat_delays.max():.6e} s")
            print(f"      Min: {flat_delays.min():.6e} s")

        print("\n✅ GPU memory accessed and data copied to numpy")

        # Step 4: Deallocate CIR memory
        print("\nStep 4: Deallocating CIR GPU memory...")
        client.deallocate_cirs_memory(cir_allocation)
        print("✅ CIR memory deallocated successfully")

    except RuntimeError as e:
        print(f"❌ CIR operation failed: {e}")

    # Stop log streaming
    client.stop_server_log_streaming()

    print("\n" + "=" * 60)
    print("✅ All tests completed successfully!")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Digital Twin Client Python Example")
    parser.add_argument("--server_address", type=str, default="localhost:50051", help="Server address")
    parser.add_argument("--import_option", type=str, default="string", choices=["file", "string"], help="Import option")

    parser.add_argument("--scene", type=str, default="test_data/maps/tokyo", help="Scene URL (relative to assets home or full omniverse URL)")
    default_assets = str(Path(__file__).parent / "example_client_assets.yml")
    parser.add_argument("--asset_config", type=str, default=default_assets, help="Asset config file path")
    parser.add_argument("--sim_id", type=str, default="test_dt_db", help="Simulation ID")

    default_yaml = str(Path(__file__).parent.parent / "tests" / "assets" / "TC_2RU_4UE_4T4R_1sym.yml")
    parser.add_argument("--yaml_file", type=str, default=default_yaml, help="YAML file path")

    parser.add_argument("--s3_endpoint", type=str, default="", help="S3 endpoint URL. Required for MinIO; leave empty for AWS.")
    parser.add_argument("--s3_bucket", type=str, default="aerial-data", help="S3 bucket name")
    parser.add_argument("--s3_provider", type=str, default=None, choices=["minio", "aws"], help="S3 provider. Defaults to 'minio' if --s3_endpoint is set, otherwise 'aws'.")
    parser.add_argument("--s3_access_key", type=str, default="", help="S3 access key (MinIO only)")
    parser.add_argument("--s3_secret_key", type=str, default="", help="S3 secret key (MinIO only)")
    parser.add_argument("--iceberg_uri", type=str, default="http://nessie:19120/iceberg", help="Iceberg catalog URI. Needs to be running and reachable.")
    parser.add_argument("--iceberg_catalog_type", type=str, default="rest", choices=["sql", "rest", "glue"], help="Iceberg catalog type")
    args = parser.parse_args()

    # Auto-detect provider: minio if an endpoint is given, aws otherwise
    if args.s3_provider is None:
        args.s3_provider = "minio" if args.s3_endpoint else "aws"

    # Apply MinIO credential defaults when not explicitly provided
    if args.s3_provider == "minio":
        if not args.s3_endpoint:
            args.s3_endpoint = "http://minio:9000"
        if not args.s3_access_key:
            args.s3_access_key = "minioadmin"
        if not args.s3_secret_key:
            args.s3_secret_key = "minioadmin"

    sys.exit(main(args))

