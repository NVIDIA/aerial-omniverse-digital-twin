# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Pipeline I/O for parsing YAML, fetching CFRs, and exporting JSON."""

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from examples.beamforming.src.core.constants import (
    BYTES_PER_MIB,
    DBM_REFERENCE_WATT,
    DEFAULT_PREVIEW_ITEM_COUNT,
    HZ_PER_GHZ,
    LOG_EPSILON,
    LOG_SEPARATOR_WIDTH,
    MM_PER_METER,
    OUTPUT_BEAM_PREFIX,
    OUTPUT_RSRP_DBM_KEY,
    OUTPUT_RU_PREFIX,
    OUTPUT_TIME_ARRAY_KEY,
    OUTPUT_UE_PREFIX,
    SPEED_OF_LIGHT_APPROX_M_PER_S,
)
from examples.beamforming.src.io.sim_context_fetcher import fetch_sim_context_light

from examples.beamforming.src.core.beamforming_pipeline_core import (
    build_per_ru_codebook_weights_from_csv_text,
)
from examples.beamforming.src.io.data_fetcher import (
    fetch_all_ru_ue_pairs,
)

logger = logging.getLogger(__name__)

CODEBOOK_FILENAME_SUFFIX = "_codebook.csv"


@dataclass(frozen=True)
class LoadedCodebook:
    """Codebook CSV loaded from the local output folder."""

    source_label: str
    text: str


def ensure_output_dir(output_dir: str) -> Path:
    """Create and validate the output directory."""
    path = Path(output_dir).expanduser()
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError(
            f"Cannot create output directory {path}: {exc}"
        ) from exc
    resolved = path.resolve()
    if not os.access(resolved, os.W_OK):
        raise RuntimeError(f"Output directory is not writable: {resolved}")
    logger.info("Output directory ready: %s", resolved)
    return resolved


def parse_and_validate_sim_for_beamforming(
    sim_config_yaml_str: str,
    codebook_dir: str | Path | None = None,
) -> dict:
    """Parse YAML and materialize the beamforming config.

    Args:
        sim_config_yaml_str: Simulation YAML content to parse.
        codebook_dir: Optional directory to scan for a local calibrated codebook.
    """
    logger.info("=" * LOG_SEPARATOR_WIDTH)
    logger.info("MODULE 1: Input/Parsing/Validation")
    logger.info("=" * LOG_SEPARATOR_WIDTH)

    _n_chars = len(sim_config_yaml_str)
    logger.debug(
        "Parsing YAML configuration with lightweight fetcher (%d chars, %.2f MiB)...",
        _n_chars,
        _n_chars / BYTES_PER_MIB,
    )
    _t_parse = time.perf_counter()
    sim_ctx = fetch_sim_context_light(sim_config_yaml_str)
    logger.debug(
        "YAML -> SimContextLight finished in %.2fs",
        time.perf_counter() - _t_parse,
    )

    ru_ids = sim_ctx.ru_ids
    ue_ids = sim_ctx.ue_ids
    panels = sim_ctx.panels

    logger.debug("Found %d RUs: %s", len(ru_ids), ru_ids)
    logger.debug("Found %d UEs: %s", len(ue_ids), ue_ids)

    logger.debug("Extracting beamforming codebook...")

    s3_config = sim_ctx.s3_config
    if s3_config is None:
        raise RuntimeError(
            "No S3 configuration found. Add db.parquet_export.s3_configs[0]."
        )

    calibrated_codebook = (
        _load_optional_local_calibrated_codebook(codebook_dir)
        if codebook_dir is not None
        else None
    )

    if calibrated_codebook is None:
        logger.warning(
            "Beamforming: no local calibrated codebook found; using raw "
            "element-0/0 fallback"
        )
    else:
        logger.debug(
            "Beamforming: calibrated codebook %s applied to %d RU(s)",
            calibrated_codebook.source_label,
            len(ru_ids),
        )
    logger.debug("Built %d antenna panel objects (lightweight)", len(panels))

    first_panel = panels[0]
    carrier_freq_hz = first_panel.reference_freq
    wavelength = SPEED_OF_LIGHT_APPROX_M_PER_S / carrier_freq_hz

    logger.debug("Carrier frequency: %.2f GHz", carrier_freq_hz / HZ_PER_GHZ)
    logger.debug("Wavelength: %.2f mm", wavelength * MM_PER_METER)

    if calibrated_codebook is None:
        codebook = [(0, 0.0, 0.0)]
        per_ru_weights_tensor = None
        beam_ids = [0]
        per_ru_codebook_angles = {}
    else:
        (
            codebook,
            per_ru_weights_tensor,
            beam_ids,
            per_ru_codebook_angles,
        ) = build_per_ru_codebook_weights_from_csv_text(
            sorted(ru_ids),
            calibrated_codebook.text,
            calibrated_codebook.source_label,
            sim_ctx,
        )
    logger.debug("Codebook (representative): %d beams", len(codebook))
    for bid, theta, phi in codebook[:DEFAULT_PREVIEW_ITEM_COUNT]:
        logger.debug("  Beam %s: theta=%s deg, phi=%s deg", bid, theta, phi)
    if len(codebook) > DEFAULT_PREVIEW_ITEM_COUNT:
        logger.debug(
            "  ... and %d more beams", len(codebook) - DEFAULT_PREVIEW_ITEM_COUNT
        )

    iceberg_config = sim_ctx.iceberg_config
    if s3_config:
        logger.debug(
            "S3 endpoint: %s",
            getattr(s3_config, "endpoint_url", "AWS (default)"),
        )
        logger.debug("S3 bucket: %s", getattr(s3_config, "bucket", "N/A"))

    n_ant = panels[0].num_antennas if panels else 0
    logger.info("=" * LOG_SEPARATOR_WIDTH)
    logger.info("Validation Summary:")
    logger.info("  Codebook: %d beams", len(codebook))
    logger.info("  RUs: %d", len(ru_ids))
    logger.info("  UEs: %d", len(ue_ids))
    logger.info("  Time range: all available")
    logger.info("  Antenna elements per panel: %d", n_ant)
    logger.info(
        "  Iceberg catalog: %s",
        getattr(iceberg_config, "catalog_uri", "N/A"),
    )
    logger.info("=" * LOG_SEPARATOR_WIDTH)

    return {
        "sim_ctx": sim_ctx,
        "panels": panels,
        "ru_ids": ru_ids,
        "ue_ids": ue_ids,
        "codebook": codebook,
        "beam_ids": beam_ids,
        "wavelength": wavelength,
        "iceberg_config": iceberg_config,
        "s3_config": s3_config,
        "codebook_dir": codebook_dir,
        "per_ru_weights_tensor": per_ru_weights_tensor,
        "per_ru_codebook_angles": per_ru_codebook_angles,
    }


def _load_optional_local_calibrated_codebook(
    codebook_dir: str | Path,
) -> LoadedCodebook | None:
    """Load one local calibrated codebook CSV if present."""
    resolved_dir = Path(codebook_dir).expanduser().resolve()
    matches = sorted(resolved_dir.glob(f"*{CODEBOOK_FILENAME_SUFFIX}"))
    if not matches:
        return None
    if len(matches) != 1:
        raise ValueError(
            f"Expected at most one local *{CODEBOOK_FILENAME_SUFFIX} in "
            f"{resolved_dir}, found {len(matches)}: {matches}"
        )

    codebook_path = matches[0]
    return LoadedCodebook(
        source_label=str(codebook_path),
        text=codebook_path.read_text(encoding="utf-8"),
    )


def fetch_cfrs_from_iceberg(
    iceberg_config,
    s3_config,
    ru_ids: List[int],
    ue_ids: List[int],
    time_range: Optional[Tuple[int, int]],
) -> Dict[Tuple[int, int], np.ndarray]:
    """Fetch CFR arrays for all RU/UE pairs."""
    logger.info("=" * LOG_SEPARATOR_WIDTH)
    logger.info("MODULE 2: Importing from DB (Iceberg)")
    logger.info("=" * LOG_SEPARATOR_WIDTH)

    cfr_data = fetch_all_ru_ue_pairs(
        iceberg_config=iceberg_config,
        ru_ids=ru_ids,
        ue_ids=ue_ids,
        time_range=time_range,
        s3_config=s3_config,
    )

    logger.info("=" * LOG_SEPARATOR_WIDTH)
    logger.info("Fetch Summary: %d RU-UE pairs loaded", len(cfr_data))
    logger.info("=" * LOG_SEPARATOR_WIDTH)

    return cfr_data


def export_beamformed_tensor_to_json(
    beamformed_tensor: np.ndarray,
    ru_id_to_idx: Dict[int, int],
    ue_id_to_idx: Dict[int, int],
    beam_id_to_idx: Dict[int, int],
    output_dir: str,
    output_filename: str,
) -> str:
    """Export per-time RSRP as nested RU/UE/beam JSON."""
    logger.info("=" * LOG_SEPARATOR_WIDTH)
    logger.info("MODULE 4: Output Handler (JSON Export)")
    logger.info("=" * LOG_SEPARATOR_WIDTH)

    idx_to_ru_id = {idx: ru_id for ru_id, idx in ru_id_to_idx.items()}
    idx_to_ue_id = {idx: ue_id for ue_id, idx in ue_id_to_idx.items()}
    idx_to_beam_id = {idx: beam_id for beam_id, idx in beam_id_to_idx.items()}

    output_dict: dict = {}

    N_tx, N_UEs, N_ue_antennas, N_time, N_freq, N_beams = beamformed_tensor.shape

    for ru_idx in range(N_tx):
        ru_id = idx_to_ru_id[ru_idx]
        ru_key = f"{OUTPUT_RU_PREFIX}{ru_id}"
        output_dict[ru_key] = {}

        for ue_idx in range(N_UEs):
            ue_id = idx_to_ue_id[ue_idx]
            ue_key = f"{OUTPUT_UE_PREFIX}{ue_id}"
            output_dict[ru_key][ue_key] = {}

            for beam_idx in range(N_beams):
                beam_id = idx_to_beam_id[beam_idx]

                cfrs = beamformed_tensor[ru_idx, ue_idx, :, :, :, beam_idx]
                cfrs_avg = cfrs.mean(axis=0)
                rsrp_linear = np.mean(np.abs(cfrs_avg) ** 2, axis=1)
                rsrp_dbm = 10.0 * np.log10(
                    np.maximum(rsrp_linear / DBM_REFERENCE_WATT, LOG_EPSILON)
                )

                beam_key = f"{OUTPUT_BEAM_PREFIX}{beam_id}"
                output_dict[ru_key][ue_key][beam_key] = {
                    OUTPUT_TIME_ARRAY_KEY: list(range(N_time)),
                    OUTPUT_RSRP_DBM_KEY: rsrp_dbm.tolist(),
                }

    output_path = Path(output_dir) / output_filename
    output_path.parent.mkdir(parents=True, exist_ok=True)

    logger.debug("Writing JSON to: %s", output_path)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_dict, f, indent=2)

    file_size_mb = output_path.stat().st_size / BYTES_PER_MIB

    logger.info("=" * LOG_SEPARATOR_WIDTH)
    logger.info("JSON Export Summary:")
    logger.info("  File: %s", output_path)
    logger.info("  Size: %.2f MB", file_size_mb)
    logger.info("  Structure: %d RUs x %d UEs x %d Beams", N_tx, N_UEs, N_beams)
    logger.info("  Averaged over %d RX antennas", N_ue_antennas)
    logger.info("=" * LOG_SEPARATOR_WIDTH)

    return str(output_path.absolute())
