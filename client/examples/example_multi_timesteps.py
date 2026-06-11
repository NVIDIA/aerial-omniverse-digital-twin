#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Digital Twin Client Python Example - Multi Time Steps

This example demonstrates how to compute CIR for MULTIPLE time steps (slots)
in a single batch allocation using the Python bindings.

Key features demonstrated:
1. Allocate GPU memory for multiple time steps using broadcast style
2. Compute CIR for multiple slots at once using SlotIndices([0, 1, 2])
3. Access CIR results using:
   - to_numpy(allocation, slot_idx, ru_idx, data_type) for individual access
   - to_numpy_all_cir(allocation) for all data as nested dicts
   - angle outputs returned as float32 arrays with trailing size-2 axis:
     [..., 2] == (azimuth, zenith)
4. Export results to Parquet files on S3 (ExportResults RPC)
5. Clear exported results (ClearExportedResults RPC)

Note: This example uses Slot/Symbols mode (Mode 1).
      For single time step examples, see example_client.py
"""

import sys
import yaml
import numpy as np
from pathlib import Path
import argparse

# Import the C++ client bindings
try:
    import dt_client
    from dt_client import SlotIndex, SlotIndices, TimeStepIndex, TimeStepIndices
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
            output_file="", # empty output_file means return the string
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
        client.start(yaml_content)
        print("✅ Scenario started successfully!")
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

    # Define test configuration for MULTI TIME STEPS
    ru_indices = [0, 1] if num_rus >= 2 else [0]
    if num_rus >= 2:
        ue_indices_per_ru = [[0, 1, 2], [0, 1, 2]] if num_ues >= 3 else [[0], [0]]
    else:
        ue_indices_per_ru = [[0, 1, 2]] if num_ues >= 3 else [[0]]
    is_full_antenna_pair = False
    num_time_steps = 3  # Request 3 time steps
    
    # allocate_cirs_memory supports two styles:
    #
    # Style 1 (Broadcast): Same config for all time steps
    #   allocate_cirs_memory(ru_indices, ue_indices_per_ru, is_full_antenna_pair, num_time_steps)
    #   - ru_indices: List[int]
    #   - ue_indices_per_ru: List[List[int]]
    #   - num_time_steps: int (optional, default=1)
    #
    # Style 2 (Per-time-step): Variable config per time step
    #   allocate_cirs_memory(ru_indices_per_ts, ue_indices_per_ts, is_full_antenna_pair)
    #   - ru_indices_per_ts: List[List[int]]
    #   - ue_indices_per_ts: List[List[List[int]]]
    #   - num_time_steps: inferred from list length
    
    print(f"\nConfiguration (broadcast style for {num_time_steps} time steps):")
    print(f"  Num time steps: {num_time_steps}")
    print(f"  RU indices: {ru_indices}")
    print(f"  UE indices per RU: {ue_indices_per_ru}")
    print(f"  Full antenna pair: {is_full_antenna_pair}")
    
    try:
        # Step 1: Allocate GPU memory for CIR using broadcast style
        print("\nStep 1: Allocating GPU memory for CIR (broadcast style)...")
        cir_allocation = client.allocate_cirs_memory(
            ru_indices, ue_indices_per_ru, is_full_antenna_pair, num_time_steps
        )
        
        # cir_allocation is now a CIRAllocation object with properties and methods
        print(f"✅ Allocated CIR batch memory for {cir_allocation.num_time_steps} time steps")
        print(f"  Total buffer sizes: values={cir_allocation.total_values_bytes} bytes, "
              f"delays={cir_allocation.total_delays_bytes} bytes")
        
        # Display per-time-step shapes using object properties
        for ts_idx, (ts_values_shapes, ts_delays_shapes) in enumerate(
                zip(cir_allocation.values_shapes_per_ts, cir_allocation.delays_shapes_per_ts)):
            print(f"  Time step {ts_idx}:")
            for ru_pos, (cir_shape, delay_shape) in enumerate(zip(ts_values_shapes, ts_delays_shapes)):
                ru_idx = cir_allocation.ru_indices_per_ts[ts_idx][ru_pos]
                print(f"    RU {ru_idx}: CIR value shape: {cir_shape['dimensions']}, "
                      f"delay shape: {delay_shape['dimensions']}")
        
        # Step 2: Compute CIR for MULTIPLE slots
        # Mode 1: Slot/Symbols - Use SlotIndices for multiple slots
        slots_to_compute = [0, 1, 2]  # Compute CIR for slots 0, 1, 2
        print(f"\nStep 2: Computing CIR for slots {slots_to_compute}...")
        client.get_cirs(
            cir_allocation,
            batch_index=0,
            temporal_index=SlotIndices(slots_to_compute)
            # For single slot: temporal_index=SlotIndex(0)
            # For Mode 2 (Duration/Interval), use: temporal_index=TimeStepIndices([...])
        )
        
        print(f"✅ CIR computed successfully for {len(cir_allocation.temporal_indices)} slots")
        print(f"  Computed slot indices: {cir_allocation.temporal_indices}")
        
        # Step 3: Access CIR data as numpy arrays
        # 
        # Two options for accessing CIR data:
        #
        # Option A: to_numpy(allocation, slot_idx, ru_idx, data_type)
        #   - Retrieves a single CIR array for a specific slot and RU
        #   - data_type: "values" (default), "delays",
        #                "angles_of_departure", or "angles_of_arrival"
        #   - More memory efficient when you only need specific data
        #
        # Option B: to_numpy_all_cir(allocation)
        #   - Retrieves ALL CIR data as nested dicts: {slot: {ru: ndarray}}
        #   - Convenient when you need to process all data
        #
        print("\nStep 3: Accessing CIR data as numpy arrays...")
        
        # --- Option A: Access individual CIR using to_numpy ---
        print("\n  Option A: Using to_numpy(allocation, slot_idx, ru_idx)")
        slot_idx = cir_allocation.temporal_indices[0]  # First computed slot
        ru_idx = ru_indices[0]                          # First RU
        
        # Get CIR tensors for a specific slot and RU.
        # Angle outputs are float32 arrays whose final dimension is size 2:
        #   [..., 0] = azimuth
        #   [..., 1] = zenith
        #
        # Example calls:
        #   client.to_numpy(cir_allocation, slot_idx, ru_idx, "values")
        #   client.to_numpy(cir_allocation, slot_idx, ru_idx, "delays")
        #   client.to_numpy(cir_allocation, slot_idx, ru_idx, "angles_of_departure")
        #   client.to_numpy(cir_allocation, slot_idx, ru_idx, "angles_of_arrival")
        cir_values = client.to_numpy(cir_allocation, slot_idx, ru_idx, "values")
        cir_delays = client.to_numpy(cir_allocation, slot_idx, ru_idx, "delays")
        cir_aod = client.to_numpy(
            cir_allocation, slot_idx, ru_idx, "angles_of_departure"
        )
        cir_aoa = client.to_numpy(
            cir_allocation, slot_idx, ru_idx, "angles_of_arrival"
        )
        
        print(f"    📊 Slot {slot_idx}, RU {ru_idx}:")
        print(f"      CIR values: shape={cir_values.shape}, dtype={cir_values.dtype}")
        print(f"      CIR delays: shape={cir_delays.shape}, dtype={cir_delays.dtype}")
        print(f"      CIR AOD: shape={cir_aod.shape}, dtype={cir_aod.dtype}")
        print(f"      CIR AOA: shape={cir_aoa.shape}, dtype={cir_aoa.dtype}")
        if cir_aod.size > 0:
            print(f"      First AOD pair [azimuth, zenith]: {cir_aod.reshape(-1, 2)[0]}")
        if cir_aoa.size > 0:
            print(f"      First AOA pair [azimuth, zenith]: {cir_aoa.reshape(-1, 2)[0]}")
        
        # --- Option B: Access all CIR data using to_numpy_all_cir ---
        print("\n  Option B: Using to_numpy_all_cir(allocation)")
        cir = client.to_numpy_all_cir(cir_allocation)
        values = cir['values']  # {slot_idx: {ru_idx: ndarray}}
        delays = cir['delays']  # {slot_idx: {ru_idx: ndarray}}
        angles_of_departure = cir['angles_of_departure']  # {slot_idx: {ru_idx: ndarray[..., 2]}}
        angles_of_arrival = cir['angles_of_arrival']      # {slot_idx: {ru_idx: ndarray[..., 2]}}
        
        # Iterate through all computed slots and RUs
        for slot_idx in cir_allocation.temporal_indices:
            for ru_idx in ru_indices:
                cir_values = values[slot_idx][ru_idx]
                cir_delays = delays[slot_idx][ru_idx]
                cir_aod = angles_of_departure[slot_idx][ru_idx]
                cir_aoa = angles_of_arrival[slot_idx][ru_idx]
                
                print(f"\n    📊 Slot {slot_idx}, RU {ru_idx}:")
                print(f"      CIR values: shape={cir_values.shape}, dtype={cir_values.dtype}")
                print(f"      CIR delays: shape={cir_delays.shape}, dtype={cir_delays.dtype}")
                print(f"      CIR AOD: shape={cir_aod.shape}, dtype={cir_aod.dtype}")
                print(f"      CIR AOA: shape={cir_aoa.shape}, dtype={cir_aoa.dtype}")
                
                # Print sample values
                if cir_values.size > 0:
                    flat_values = cir_values.flatten()
                    print(f"      Sample values (first 3): {flat_values[:3]}")
                if cir_delays.size > 0:
                    flat_delays = cir_delays.flatten()
                    print(f"      Sample delays (first 3): {flat_delays[:3]}")
                if cir_aod.size > 0:
                    flat_aod = cir_aod.reshape(-1, 2)
                    print(f"      Sample AODs (first 3): {flat_aod[:3]}")
                if cir_aoa.size > 0:
                    flat_aoa = cir_aoa.reshape(-1, 2)
                    print(f"      Sample AOAs (first 3): {flat_aoa[:3]}")
        
        print("\n✅ CIR data accessed as numpy arrays")
        
        # Step 4: Deallocate CIR memory
        print("\nStep 4: Deallocating CIR GPU memory...")
        client.deallocate_cirs_memory(cir_allocation)
        print("✅ CIR memory deallocated successfully")
        
    except RuntimeError as e:
        print(f"❌ CIR operation failed: {e}")

    # ================================================================
    # Test 4: Export Results to Parquet (on-demand)
    # ================================================================
    print("\n" + "=" * 60)
    print("Test 4: Export Results to Parquet files on S3")
    print("=" * 60)

    print("\nExporting CIR results for the computed slots...")
    try:
        # Export tables to parquet on S3 for the computed slots
        export_result = client.export_results()
        print(f"✅ Export done: {export_result['files_exported']} files, "
              f"{export_result['total_rows']} rows in "
              f"{export_result['elapsed_seconds']:.2f}s")
    except RuntimeError as e:
        print(f"❌ Export failed: {e}")

    # To clear exported data afterwards:
    # Note: restarting the scenario (Start) also clears data for the same sim_id.
    #     client.clear_exported_results()
    
    client.stop_server_log_streaming()
    
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Digital Twin Client Python Example")
    parser.add_argument("--server_address", type=str, default="localhost:50051", help="Server address")
    parser.add_argument("--import_option", type=str, default="string", choices=["file", "string"], help="Import option")
    
    parser.add_argument("--scene", type=str, default="test_data/maps/tokyo", help="Scene URL (relative to assets home or full omniverse URL)")
    default_assets = str(Path(__file__).parent / "example_client_assets.yml")
    parser.add_argument("--asset_config", type=str, default=default_assets, help="Asset config file path")

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

