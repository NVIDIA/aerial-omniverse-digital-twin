# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Run the standalone beamforming pipeline from YAML to RSRP JSON."""
# pyright: reportMissingImports=false

import argparse
import logging
import sys
from pathlib import Path

from examples.beamforming.src.core.beamforming_pipeline_core import (
    compute_beamformed_cfrs,
    rectangular_array_locations,
)
from examples.beamforming.src.core.constants import (
    BEAMFORMED_RSRP_OUTPUT_FILENAME,
)
from examples.beamforming.src.io.beamforming_pipeline_io import (
    ensure_output_dir,
    export_beamformed_tensor_to_json,
    fetch_cfrs_from_iceberg,
    parse_and_validate_sim_for_beamforming,
)
from examples.beamforming.src.io.data_fetcher import (
    fetch_raypath_tx_positions_from_iceberg,
    log_position_extraction,
)

logger = logging.getLogger(__name__)

def run_beamforming_pipeline(
    sim_config_yaml_str: str,
    output_dir: str,
) -> str:
    """Run parsing, CFR fetch, beamforming, and JSON export."""
    logger.info("=" * 80)
    logger.info("BEAMFORMING PIPELINE START")
    logger.info("=" * 80)

    ensure_output_dir(output_dir)

    config = parse_and_validate_sim_for_beamforming(
        sim_config_yaml_str,
        codebook_dir=output_dir,
    )

    first_panel = config["panels"][0]
    wavelength = float(config["wavelength"])

    spacing_y_wl = (first_panel.antenna_spacing_horz / 100.0) / wavelength
    spacing_z_wl = (first_panel.antenna_spacing_vert / 100.0) / wavelength
    antenna_locations = rectangular_array_locations(
        Ny=first_panel.num_loc_antenna_horz,
        Nz=first_panel.num_loc_antenna_vert,
        spacing_y=spacing_y_wl,
        spacing_z=spacing_z_wl,
        wavelength=wavelength,
        center_at_origin=True,
    )
    expected_tx_counts = {
        int(ru_id): int(antenna_locations.shape[0])
        for ru_id in config["ru_ids"]
    }
    try:
        raypath_tx_positions_by_ru = fetch_raypath_tx_positions_from_iceberg(
            iceberg_config=config["iceberg_config"],
            ru_ids=config["ru_ids"],
            expected_tx_counts=expected_tx_counts,
            time_range=None,
            s3_config=config["s3_config"],
        )
    except Exception as exc:
        raypath_tx_positions_by_ru = {}
        logger.warning(
            "Raypath position double-check skipped: %s",
            exc,
        )

    ru_info_by_id = {
        int(ru_info.tx_id): ru_info
        for ru_info in config["sim_ctx"].ru_infos
    }
    for ru_id in config["ru_ids"]:
        ru_info = ru_info_by_id.get(int(ru_id))
        center_position = (
            float(getattr(getattr(ru_info, "position", None), "x", 0.0)),
            float(getattr(getattr(ru_info, "position", None), "y", 0.0)),
            float(getattr(getattr(ru_info, "position", None), "z", 0.0)),
        )
        log_position_extraction(
            antenna_locations=antenna_locations,
            panel_name=first_panel.panel_name,
            ru_id=int(ru_id),
            center_position=center_position,
            raypath_tx_positions=raypath_tx_positions_by_ru.get(int(ru_id), []),
            wavelength_m=wavelength,
        )

    logger.debug(
        "Generated antenna locations from panel specs "
        "(panel %s):",
        first_panel.panel_name,
    )
    logger.debug(
        "  Shape: %s", antenna_locations.shape
    )
    logger.debug(
        "  Y-range: [%.4f, %.4f] m",
        antenna_locations[:, 1].min(),
        antenna_locations[:, 1].max(),
    )
    logger.debug(
        "  Z-range: [%.4f, %.4f] m",
        antenna_locations[:, 2].min(),
        antenna_locations[:, 2].max(),
    )

    cfr_data = fetch_cfrs_from_iceberg(
        iceberg_config=config["iceberg_config"],
        s3_config=config["s3_config"],
        ru_ids=config["ru_ids"],
        ue_ids=config["ue_ids"],
        time_range=None,
    )

    (
        beamformed_tensor,
        ru_id_to_idx,
        ue_id_to_idx,
        beam_id_to_idx,
    ) = compute_beamformed_cfrs(
        cfr_data=cfr_data,
        codebook=config["codebook"],
        ru_ids=config["ru_ids"],
        ue_ids=config["ue_ids"],
        per_ru_weights=config.get(
            "per_ru_weights_tensor"
        ),
    )

    output_path = export_beamformed_tensor_to_json(
        beamformed_tensor=beamformed_tensor,
        ru_id_to_idx=ru_id_to_idx,
        ue_id_to_idx=ue_id_to_idx,
        beam_id_to_idx=beam_id_to_idx,
        output_dir=output_dir,
        output_filename=BEAMFORMED_RSRP_OUTPUT_FILENAME,
    )

    return output_path

def main():
    """Run the beamforming CLI."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    parser = argparse.ArgumentParser(
        description=(
            "Beamforming CFR pipeline (standalone). "
            "Pass a fetched simulation YAML and an output folder."
        ),
    )

    parser.add_argument(
        "--sim-yaml",
        "--cal-yaml",
        dest="sim_yaml",
        type=str,
        required=True,
        help=(
            "Path to fetched simulation YAML "
            "(legacy alias: --cal-yaml)"
        ),
    )

    parser.add_argument(
        "--output-folder",
        type=str,
        required=True,
        help="Folder where beamformed_rsrp.json is written",
    )
    
    args = parser.parse_args()

    yaml_path = Path(args.sim_yaml)
    if not yaml_path.exists():
        logger.error(
            "Simulation YAML file not found: %s", yaml_path
        )
        return 1

    yaml_str = yaml_path.read_text()

    output_dir = str(Path(args.output_folder).resolve())
    logger.info(
        "Output directory: %s", output_dir
    )

    try:
        output_path = run_beamforming_pipeline(
            sim_config_yaml_str=yaml_str,
            output_dir=output_dir,
        )

        logger.info(
            "Beamformed CFRs saved to: %s", output_path
        )

        out_p = Path(output_path)
        analysis_path = out_p.with_name(
            f"{out_p.stem}_beam_analysis.json"
        )

        return 0

    except Exception as e:
        banner = "!" * 80
        err_type = type(e).__name__
        logger.exception(
            "\n%s\n"
            "BEAMFORMING PIPELINE FAILED\n"
            "%s\n"
            "  Error type : %s\n"
            "  Message    : %s\n"
            "  YAML       : %s\n"
            "  Output dir : %s\n"
            "%s",
            banner,
            banner,
            err_type,
            e,
            yaml_path,
            output_dir,
            banner,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
