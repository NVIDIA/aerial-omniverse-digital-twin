#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Generate an example YAML configuration using the _config Python bindings.

This script demonstrates the full config builder API. It is structured to
match the Quick Start guide in the documentation, with commented-out lines
showing every available API so users can discover them.

Run standalone:
    python example_client_yaml_config.py --output-file output.yml

Or import as a module:
    from example_client_yaml_config import gen_example_yaml_string, S3Args
"""

import sys
import logging
import argparse
import pathlib
from dataclasses import dataclass
from typing import Optional, Tuple

# Configure logging only if it hasn't been configured already.
# This makes the script reusable as a module in larger applications.
if not logging.getLogger().hasHandlers():
    logging.basicConfig(level=logging.INFO)

try:
    from _config import (
        SimConfig,
        SimMode,          # EM, RAN
        DBTable,          # CIRS, CFRS, RAYPATHS, TELEMETRY
        Panel,
        Nodes,
        DiffusionModel,   # LAMBERTIAN, DIRECTIONAL
        AntennaElement,   # Isotropic, InfinitesimalDipole, HalfwaveDipole,
                          # RecMicrostripPatch, ThreeGPP38901, PolarizedIsotropic
        Position,
        S3Config,
        GeoTargets,       # BLDG, VEG
        GPXSource,        # GPX source configuration for UE mobility
    )
    from omegaconf import OmegaConf
except ImportError as e:
    logging.error(f"Import error: {e}")
    logging.error("Make sure config module is built and in PYTHONPATH")
    sys.exit(1)

@dataclass
class S3Args:
    """S3 connection arguments (shared across parquet export, GIS, etc.)."""
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_provider: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""


@dataclass
class IcebergArgs:
    """Iceberg catalog arguments for parquet export."""
    iceberg_catalog_type: str = ""
    iceberg_uri: str = ""


def gen_example_yaml_string(
    scene: str,
    asset_config: str,
    s3: S3Args,
    sim_id: str = "test_dt_db",
    output_file: str = "",
    iceberg: Optional[IcebergArgs] = None,
) -> Tuple[str, int]:
    """Generate example YAML string and return it and exit code.

    Args:
        scene: Scene URL (S3 key prefix or local path).
        asset_config: Path to assets.yml (required).
        s3: S3 connection settings. If provided, sets db.s3_config and
            enables parquet export.
        iceberg: Iceberg catalog settings for parquet export (optional).
        sim_id: Simulation ID (used as DB name and identifier).
        output_file: Output file path. Empty = return YAML string.

    Returns:
        Tuple[str, int]: YAML string and exit code (0 for success, -1 for error)
    """
    # =================================================================
    # 1. Create configuration builder
    # =================================================================
    logging.info(f"Creating SimConfig from {asset_config}...")
    config = SimConfig(scene, SimMode.EM, asset_config)
    # config = SimConfig(scene, SimMode.RAN, asset_config)  # RAN mode

    # =================================================================
    # 2. Set simulation identity and DB connection
    # =================================================================
    config.set_simulation_id(sim_id)
    config.set_db(db_host="clickhouse", db_port=9000, db_author="aerial")

    # =================================================================
    # 3. Configure S3 storage (required)
    # =================================================================
    s3_config = S3Config(
        bucket=s3.s3_bucket,
        provider=s3.s3_provider,
        endpoint_url=s3.s3_endpoint,
        access_key=s3.s3_access_key,
        secret_key=s3.s3_secret_key,
    )
    config.set_s3_config(s3_config)

    # =================================================================
    # 4. Set simulation parameters
    # =================================================================
    logging.info("Configuring simulation parameters...")
    config.set_num_batches(1)
    config.set_timeline(slots_per_batch=12, realizations_per_slot=1)
    # config.set_timeline(duration=1.0, interval=0.1)  # Duration/Interval mode (EM only)
    config.set_seed(10)

    # Tables to persist in the DB
    config.add_tables_to_db(DBTable.CIRS)
    config.add_tables_to_db(DBTable.CFRS)
    config.add_tables_to_db(DBTable.RAYPATHS)
    # config.add_tables_to_db(DBTable.TELEMETRY)  # RAN mode only
    # config.add_table_option("raypaths", "full")

    # =================================================================
    # 5. Enable Parquet export
    # =================================================================
    if s3:
        s3_config = S3Config(
            bucket=s3.s3_bucket,
            provider=s3.s3_provider,
            endpoint_url=s3.s3_endpoint,
            access_key=s3.s3_access_key,
            secret_key=s3.s3_secret_key,
        )

        # Set global S3 config (e.g. for GIS map storage)
        config.set_s3_config(s3_config)

        # Parquet export may use the same S3 config
        config.enable_parquet_export(timesteps_per_file=100)
        config.add_parquet_s3_config(s3_config)
        # config.add_parquet_s3_config(s3_config, nodes=["node1"], use_ssl=False)
        if iceberg and iceberg.iceberg_catalog_type:
            config.set_parquet_iceberg(
                catalog_type=iceberg.iceberg_catalog_type,
                catalog_uri=iceberg.iceberg_uri,
            )
        # config.disable_parquet_export()  # disable after enabling

    # =================================================================
    # 6. Ray tracing model
    # =================================================================
    config.set_ray_tracing_model(DiffusionModel.DIRECTIONAL, 5, 500, 500)
    # config.set_ray_tracing_model(DiffusionModel.LAMBERTIAN, 5, 500, 500)

    # config.enable_wideband()  # auto-enabled when adding DBTable.CFRS

    # =================================================================
    # 7. Create panels
    # =================================================================
    logging.info("Creating panels...")

    # RU panel (ThreeGPP antenna, 3.6 GHz)
    ru_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.ThreeGPP38901],
        frequency_mhz=3600,
        vertical_spacing=0.5,
        vertical_num=1,
        horizontal_spacing=0.5,
        horizontal_num=2,
        dual_polarized=True,
        roll_first=0,
        roll_second=90,
    )
    config.set_default_panel_ru(ru_panel)

    # UE panel (Infinitesimal Dipole)
    ue_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.InfinitesimalDipole],
        frequency_mhz=3600,
        vertical_spacing=0.5,
        vertical_num=2,
        horizontal_spacing=0.5,
        horizontal_num=1,
        dual_polarized=True,
        roll_first=-45,
        roll_second=45,
    )
    config.set_default_panel_ue(ue_panel)

    # String-based panel creation:
    # panel = Panel.create_panel([Panel.THREE_GPP_38901], 3600)
    # panel = Panel.create_panel(["isotropic"], 3600)
    # File-based panel:
    # panel = Panel.create_panel_from_file("path/to/custom_panel.csv")
    # Additional panel (auto-assigns ID):
    # config.add_panel(extra_panel)

    # =================================================================
    # 8. Create DU
    # =================================================================
    logging.info("Creating DU...")
    du = Nodes.create_du(du_id=1, frequency_mhz=3600, scs_khz=30.0)
    du.set_position(Position.cartesian(0, 0, 100))
    # du.set_fft_size(4096)
    # du.set_max_channel_bandwidth(100.0)
    # du.set_num_antennas(4)  # normally auto-derived from default RU panel
    config.add_du(du)

    # =================================================================
    # 9. Create RUs
    # =================================================================
    logging.info("Creating RUs...")
    ru1 = Nodes.create_ru(ru_id=1, frequency_mhz=3600, radiated_power_dbm=43.0, du_id=du.id())
    ru1.set_position(Position.georef(35.66350010610868, 139.74530874157455))
    ru1.set_height(2.5)
    ru1.set_mech_azimuth(0.0)
    ru1.set_mech_tilt(0.0)
    # ru1.assign_panel(custom_panel)  # override default panel for this RU
    config.add_ru(ru1)

    ru2 = Nodes.create_ru(ru_id=2, frequency_mhz=3600, radiated_power_dbm=43.0, du_id=du.id())
    ru2.set_position(Position.georef(35.66286378983765, 139.74606210562007))
    # ru2.set_position(Position.cartesian(210.7167578125, 496.0301953125)) # Cartesian based pos
    config.add_ru(ru2)

    # =================================================================
    # 10. Create UEs
    # =================================================================
    logging.info("Creating UEs...")
    ue1 = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    ue1.add_waypoint(Position.georef(35.66376818087683, 139.7459968717682))
    ue1.add_waypoint(Position.georef(35.663622296081414, 139.74622811587614))
    ue1.add_waypoint(Position.georef(35.66362516562424, 139.74653110368598))
    # ue1.add_waypoint(Position.georef(35.66376818087683, 139.7459968717682, 10.0)) # 3D waypoint
    # ue1.add_waypoint(pos, speed=1.0, pause_duration=0.0, azimuth_offset=0.0)
    # ue1.assign_panel(custom_panel)  # override default panel for this UE
    # ue1.set_bler_target(0.1)
    # ue1.set_manual(True)
    config.add_ue(ue1)

    # =================================================================
    # Create UEs from GPX file
    # =================================================================
    # use_pathfinding=True means interpolation of route between waypoints is enabled
    # config.add_ues_from_gpx("path/to/route.gpx", ue_ids=[1], use_pathfinding=True)
    # create 3 UEs to equally share the same GPX file (each UE will have a different waypoint)
    # config.add_ues_from_gpx("path/to/route.gpx", ue_ids=[1, 2, 3], use_pathfinding=True)
    # use_pathfinding=False means exact locations from waypoints, required for calibration
    # config.add_ues_from_gpx("path/to/route.gpx", ue_ids=[1], use_pathfinding=False)

    ue2 = Nodes.create_ue(ue_id=2, radiated_power_dbm=26.0)
    ue2.add_waypoint(Position.cartesian(150.2060449, 99.5086621, 0))
    config.add_ue(ue2)

    # Post-add mutation:
    # config.get_ue(1).set_radiated_power(20.0)
    # config.get_ue(1).clear_waypoints()
    # config.get_ru(1).set_radiated_power(40.0)
    # config.remove_ue(2)
    # config.clear_waypoints(ue_id=1)

    # GPX-driven UEs:
    # config.add_ues_from_gpx("path/to/route.gpx", ue_ids=[10, 11], use_pathfinding=True)

    # =================================================================
    # 11. Procedural UEs and urban mobility
    # =================================================================
    logging.info("Configuring spawn zone and procedural UEs...")
    config.add_spawn_zone([
        Position.georef(35.659246045102776, 139.7447971347694),
        Position.georef(35.658433940152484, 139.7464869752049),
        Position.georef(35.659584050861596, 139.74790935897965),
        Position.georef(35.660768917135265, 139.74561467296084),
    ])
    config.set_num_procedural_ues(1)
    config.set_perc_indoor_procedural_ues(0.0)
    # config.set_ue_speed(min_speed=1.0, max_speed=5.0)
    # config.enable_urban_mobility(vehicles=50)

    # =================================================================
    # 12. Vegetation (optional)
    # =================================================================
    config.enable_vegetation()  # auto-derive GeoJSON path from scene URL
    # config.enable_vegetation("path/to/vegetation.geojson")

    # =================================================================
    # 13. Material calibration (optional)
    # =================================================================
    # config.add_material_definition("path/to/definitions.json", GeoTargets.BLDG)
    # config.add_material_assignment("path/to/assignments.json", GeoTargets.BLDG)
    # config.add_material_definition("path/to/veg_defs.json", GeoTargets.VEG)
    # config.add_material_assignment("path/to/veg_assigns.json", GeoTargets.VEG)

    # =================================================================
    # 14. Building RF attributes (optional)
    # =================================================================
    # config.set_bldg_exterior_attr(
    #     activate_rf=True, activate_diffraction=True, activate_diffusion=True,
    #     activate_transmission=True, diffuse_surface_element_area=1.0,
    #     building_ids=[],  # empty = all buildings
    # )
    # config.set_bldg_interior_attr(
    #     activate_rf=True, activate_diffraction=True,
    #     activate_transmission=True, building_ids=["bldg_01"],
    # )

    # =================================================================
    # 15. Bulk attribute updates (advanced)
    # =================================================================
    # config.set_ues_height(height_m=1.5)              # all UEs
    # config.set_ues_height(height_m=1.5, ids=[1, 2])  # specific UEs
    # config.set_ues_power(radiated_power_dbm=23.0)
    # config.set_rus_power(radiated_power_dbm=40.0)

    # =================================================================
    # 16. Export as YAML
    # =================================================================
    logging.info("Generating configuration...")
    try:
        config_dict = config.to_dict()

        if not output_file:
            yaml_string = OmegaConf.to_yaml(config_dict)
            logging.info("Configuration saved to string")
            return yaml_string, 0
        else:
            OmegaConf.save(config_dict, output_file)
            logging.info(f"Configuration saved to {output_file}")
            return "", 0

    except Exception as e:
        logging.error(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return "", -1

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Python bindings")
    parser.add_argument("--scene", type=str, default="test_data/maps/tokyo", help="Scene URL (S3 key prefix or local path)")

    default_assets = str(pathlib.Path(__file__).parent / "example_client_assets.yml")
    parser.add_argument("--asset-config", type=str, default=default_assets, help="Asset config file path")

    default_output = str(pathlib.Path(__file__).parent / "example_generated_YAML_config.yml")
    parser.add_argument("--output-file", type=str, default=default_output, help="Output file path")

    parser.add_argument("--sim-id", type=str, default="example_sim", help="Simulation ID")

    args = parser.parse_args()
    print(f"Generating YAML config with args: {args}")

    yaml_string, exit_code = gen_example_yaml_string(
        scene=args.scene, 
        asset_config=args.asset_config, 
        sim_id=args.sim_id, 
        output_file=args.output_file, 
        s3=S3Args(
            s3_endpoint="http://minio:9000",
            s3_bucket="aerial-data",
            s3_provider="minio",
            s3_access_key="minioadmin",
            s3_secret_key="minioadmin",
        ),
        iceberg=IcebergArgs(
            iceberg_catalog_type="rest",
            iceberg_uri="http://nessie:19120/iceberg",
        ))     
    if exit_code != 0:
        logging.error(f"Error: {yaml_string}")
        sys.exit(exit_code)
    else:
        logging.info(f"Configuration saved to {args.output_file}")
        print(yaml_string)
    sys.exit(0)
