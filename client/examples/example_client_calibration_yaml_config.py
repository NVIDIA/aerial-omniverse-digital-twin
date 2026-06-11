#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Generate example YAML configurations for the calibration workflow.

The calibration workflow uses the same base scenario twice:
1. Run the base simulation YAML to populate DB/exported tables.
2. Run the calibration YAML, which adds calibration settings to that scenario.
"""

import argparse
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

try:
    from _config import (
        SimConfig,
        SimMode,
        DBTable,
        Panel,
        Nodes,
        DiffusionModel,
        AntennaElement,
        Position,
        S3Config,
        GPXSource,
    )
    from omegaconf import OmegaConf
except ImportError as e:
    logging.error(f"Import error: {e}")
    logging.error("Make sure config module is built and in PYTHONPATH")
    raise


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
    sim_id: str = "test_calibration_db",
    output_file: str = "",
    iceberg: Optional[IcebergArgs] = None,
    run_calibration: bool = False,
    calibration_output_folder: str = "",
    simulation_yaml_file: str = "",
) -> Tuple[str, int]:
    """Generate simulation or calibration YAML and return it and exit code.

    Args:
        scene: Scene URL (S3 key prefix or local path).
        asset_config: Path to assets.yml (required).
        s3: S3 connection settings.
        sim_id: Simulation ID (used as DB name and identifier).
        output_file: Output file path. Empty = return YAML string.
        iceberg: Iceberg catalog settings for parquet export (optional).
        run_calibration: If true, add calibration settings to the scenario.
        calibration_output_folder: Output S3 folder key for calibration artifacts.
        simulation_yaml_file: Base simulation YAML file to import for calibration.

    Returns:
        Tuple[str, int]: YAML string and exit code (0 for success, -1 for error).
    """
    if run_calibration and not calibration_output_folder:
        return "calibration_output_folder is required", -1
    if run_calibration and not simulation_yaml_file:
        return "simulation_yaml_file is required", -1

    try:
        # First run, build the base simulation YAML from scene/assets.
        if run_calibration == False:
            logging.info(f"Creating SimConfig from {asset_config}...")
            config = SimConfig(scene, SimMode.EM, asset_config)
            config.set_simulation_id(sim_id)
            config.set_db(db_host="clickhouse", db_port=9000, db_author="aerial")

            # Configure S3 and parquet export so the simulation run exports the
            # tables that calibration later reads back.
            s3_config = S3Config(
                bucket=s3.s3_bucket,
                provider=s3.s3_provider,
                endpoint_url=s3.s3_endpoint,
                access_key=s3.s3_access_key,
                secret_key=s3.s3_secret_key,
            )
            config.set_s3_config(s3_config)
            config.enable_parquet_export(timesteps_per_file=100)
            config.add_parquet_s3_config(s3_config)
            if iceberg and iceberg.iceberg_catalog_type:
                config.set_parquet_iceberg(
                    catalog_type=iceberg.iceberg_catalog_type,
                    catalog_uri=iceberg.iceberg_uri,
                )

            config.set_seed(42)
            config.add_tables_to_db(DBTable.CIRS)
            config.add_tables_to_db(DBTable.CFRS)
            config.add_tables_to_db(DBTable.RAYPATHS)  # REQUIRED for calibration
            config.add_table_option("raypaths", "full")
            config.set_ray_tracing_model(DiffusionModel.DIRECTIONAL)

            ue_panel = Panel.create_panel(
                antenna_elements=[AntennaElement.HalfwaveDipole],
                frequency_mhz=3619,
                horizontal_num=1,
                dual_polarized=False,
            )
            config.set_default_panel_ue(ue_panel)

            ru_panel = Panel.create_panel(
                antenna_elements=[AntennaElement.ThreeGPP38901],
                frequency_mhz=3619,
                horizontal_num=1,
                dual_polarized=False,
            )
            config.set_default_panel_ru(ru_panel)

            # Network nodes.
            du = Nodes.create_du(du_id=1, frequency_mhz=3619, scs_khz=60.0)
            du.set_position(Position.cartesian(0.0, 0.0, 0.0))
            du.set_fft_size(256)
            du.set_num_antennas(1)
            config.add_du(du)

            ru1 = Nodes.create_ru(
                ru_id=1,
                frequency_mhz=3619,
            )
            ru1.set_position(Position.cartesian(-13390.0, -4090.0, 3275.0))
            ru1.set_height(1.5)
            ru1.set_mech_azimuth(280.0)
            ru1.set_mech_tilt(5.0)
            ru1.assign_panel(ru_panel)
            config.add_ru(ru1)

            ru2 = Nodes.create_ru(
                ru_id=2,
                frequency_mhz=3619,
            )
            ru2.set_position(Position.cartesian(3420.0, 3980.0, 3025.0))
            ru2.set_height(1.5)
            ru2.set_mech_azimuth(195.0)
            ru2.set_mech_tilt(5.0)
            ru2.assign_panel(ru_panel)
            config.add_ru(ru2)

            ue1 = Nodes.create_ue(ue_id=1)
            gpx = GPXSource()
            # S3 object path in the configured bucket.
            gpx.src = "s3/path/to/example/gpx/route.gpx"
            gpx.usePathfinding = False
            ue1.set_gpx_source(gpx)
            ue1.assign_panel(ue_panel)
            config.add_ue(ue1)

            # Calibration uses the DB mobility from the simulation run.
            config.set_ue_speed(1.5, 1.5)
            config.enable_vegetation(f"{scene}/vegetation.geojson")
            config.set_bldg_exterior_attr(
                activate_rf=True,
                activate_diffraction=True,
                activate_diffusion=True,
                activate_transmission=True,
                diffuse_surface_element_area=15.0,
            )
        
        else: # run_calibration == True

            # Calibration run, starts from the exact simulation YAML used for the base simulation run, 
            # and add calibration settings to it.
            logging.info(f"Creating SimConfig by importing from {simulation_yaml_file}...")
            config = SimConfig.from_yaml_file(simulation_yaml_file)
            # Choose what calibration should optimize. This example calibrates
            # UE orientation/settings only.
            config.set_calibration_targets(
                materials=False,
                veg_materials=False,
                rus=False,
                rus_beams=False,
                ues=True,
            )
            # Add measured links used as calibration references. Each entry
            # points to an S3 object path for one RU/UE pair in the scenario.
            config.add_calibration_measurement(
                ru_id=1,
                ue_id=1,
                measurement_file=(
                    "s3/path/to/example/measurements/"
                    "ru1_ue1_with_beams_filled.csv"
                ),
            )
            config.add_calibration_measurement(
                ru_id=2,
                ue_id=1,
                measurement_file=(
                    "s3/path/to/example/measurements/"
                    "ru2_ue1_with_beams_filled.csv"
                ),
            )

            # Select which time indices from the scenario are used.
            config.set_calibration_timeline(start=0, step=1, end=640)

            # Required output folder key under the configured S3 bucket.
            config.set_calibration_output(calibration_output_folder)

        config_dict = config.to_dict()
        yaml_string = OmegaConf.to_yaml(config_dict)
        if output_file:
            OmegaConf.save(config_dict, output_file)
            logging.info(f"Configuration saved to {output_file}")
        else:
            logging.info("Configuration saved to string")
        return yaml_string, 0
    except Exception as e:  # pylint: disable=broad-exception-caught
        logging.error(f"Error generating YAML: {e}")
        return "", -1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate calibration YAML config")
    parser.add_argument(
        "--server_address",
        type=str,
        default="",
        help="Ignored; accepted for CLI parity with run examples.",
    )
    parser.add_argument("--scene", type=str, default="test_data/maps/hels")
    default_assets = str(Path(__file__).parent / "example_client_assets.yml")
    parser.add_argument("--asset-config", "--asset_config", type=str, default=default_assets)
    parser.add_argument("--output-file", "--output_file", type=str, default="")
    parser.add_argument("--sim-id", "--sim_id", type=str, default="example_calibration")
    parser.add_argument(
        "--calibration-output-folder",
        "--calibration_output_folder",
        type=str,
        required=True,
    )
    parser.add_argument(
        "--simulation-yaml-file",
        type=str,
        default="",
    )
    parser.add_argument("--s3-endpoint", "--s3_endpoint", type=str, default="http://minio:9000")
    parser.add_argument("--s3-bucket", "--s3_bucket", type=str, default="aerial-data")
    parser.add_argument("--s3-provider", "--s3_provider", type=str, default="minio")
    parser.add_argument("--s3-access-key", "--s3_access_key", type=str, default="minioadmin")
    parser.add_argument("--s3-secret-key", "--s3_secret_key", type=str, default="minioadmin")
    parser.add_argument(
        "--iceberg-uri",
        type=str,
        default="http://nessie:19120/iceberg",
    )
    parser.add_argument(
        "--iceberg-catalog-type",
        type=str,
        default="rest",
        choices=["rest", "glue"],
    )
    args = parser.parse_args()

    yaml_string, exit_code = gen_example_yaml_string(
        scene=args.scene,
        asset_config=args.asset_config,
        sim_id=args.sim_id,
        output_file=args.output_file,
        iceberg=IcebergArgs(
            iceberg_catalog_type=args.iceberg_catalog_type,
            iceberg_uri=args.iceberg_uri,
        ),
        calibration_output_folder=args.calibration_output_folder,
        run_calibration=True,
        simulation_yaml_file=args.simulation_yaml_file,
        s3=S3Args(
            s3_endpoint=args.s3_endpoint,
            s3_bucket=args.s3_bucket,
            s3_provider=args.s3_provider,
            s3_access_key=args.s3_access_key,
            s3_secret_key=args.s3_secret_key,
        ),
    )
    if yaml_string:
        print(yaml_string)
    raise SystemExit(exit_code)
