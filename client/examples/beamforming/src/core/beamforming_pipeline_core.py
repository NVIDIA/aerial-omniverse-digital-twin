# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Core geometry, codebook, and beamforming routines."""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np

from examples.beamforming.src.io.codebook_csv_loader import (
    parse_codebook_csv_text_from_weights,
)

logger = logging.getLogger(__name__)


def rectangular_array_locations(
    Ny: int,
    Nz: int,
    spacing_y: float,
    spacing_z: float,
    wavelength: float,
    center_at_origin: bool = True,
) -> np.ndarray:
    """Build yz-plane antenna locations in local column-major order."""
    N_antennas = Ny * Nz
    antenna_locations = np.zeros((N_antennas, 3), dtype=np.float32)

    # Convert spacing from wavelengths to meters
    dy_meters = spacing_y * wavelength
    dz_meters = spacing_z * wavelength

    idx = 0
    for hor_idx in range(Ny):
        for ver_idx in range(Nz):
            if center_at_origin:
                y_pos = (hor_idx - (Ny - 1) / 2.0) * dy_meters
                z_pos = (ver_idx - (Nz - 1) / 2.0) * dz_meters
            else:
                y_pos = hor_idx * dy_meters
                z_pos = ver_idx * dz_meters

            antenna_locations[idx] = np.array([0.0, y_pos, z_pos])
            idx += 1

    return antenna_locations


def ru_info_for_ru_id(ssr, ru_id: int):
    for ri in ssr.ru_infos:
        if int(ri.tx_id) == int(ru_id):
            return ri
    raise RuntimeError(f"No SSR TXInfo for ru_id={ru_id}")


def build_per_ru_codebook_weights_from_csv_text(
    ru_ids_sorted: List[int],
    codebook_csv_text: str,
    codebook_source_label: str,
    ssr,
) -> Tuple[
    List[Tuple[int, float, float]],
    np.ndarray,
    List[int],
    Dict[int, List[Tuple[int, float, float]]],
]:
    """Build a per-RU weight stack from shared calibrated codebook CSV text."""
    weight_rows = []
    per_ru_codebook_angles: Dict[int, List[Tuple[int, float, float]]] = {}
    for ru_id in ru_ids_sorted:
        ru_info = ru_info_for_ru_id(ssr, ru_id)
        n_ant = len(ru_info.loc_antenna)
        mat, csv_angles = parse_codebook_csv_text_from_weights(
            codebook_csv_text,
            codebook_source_label,
            n_ant,
            ru_id,
        )
        per_ru_codebook_angles[int(ru_id)] = list(csv_angles)
        weight_rows.append(mat)

    ref_shape = weight_rows[0].shape
    for i, weights in enumerate(weight_rows):
        if weights.shape != ref_shape:
            raise RuntimeError(
                f"Per-RU codebook shape mismatch: RU index {i} has "
                f"{weights.shape}, expected {ref_shape}"
            )

    codebook: Optional[List[Tuple[int, float, float]]] = None
    for ru_id in ru_ids_sorted:
        angles_ru = per_ru_codebook_angles.get(int(ru_id))
        if angles_ru:
            codebook = list(angles_ru)
            break
    if codebook is None:
        n_beams = int(ref_shape[0])
        codebook = [(beam_idx, 0.0, 0.0) for beam_idx in range(n_beams)]

    stacked = np.stack(weight_rows, axis=0)
    beam_ids = [beam[0] for beam in codebook]
    logger.debug(
        "Per-RU weights materialized from %s: stack shape %s "
        "(tx, beams, ant)",
        codebook_source_label,
        tuple(stacked.shape),
    )
    return codebook, stacked, beam_ids, per_ru_codebook_angles


def compute_beamformed_cfrs(
    cfr_data: Dict[Tuple[int, int], np.ndarray],
    codebook: List[Tuple[int, float, float]],
    ru_ids: List[int],
    ue_ids: List[int],
    per_ru_weights: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, Dict[int, int], Dict[int, int], Dict[int, int]]:
    """Compute beamformed CFRs for every RU, UE, and beam."""
    if per_ru_weights is None and not codebook:
        codebook = [(0, 0.0, 0.0)]

    ru_id_to_idx = {ru_id: idx for idx, ru_id in enumerate(sorted(ru_ids))}
    ue_id_to_idx = {ue_id: idx for idx, ue_id in enumerate(sorted(ue_ids))}
    beam_id_to_idx = {beam_id: idx for idx, (beam_id, _, _) in enumerate(codebook)}

    N_tx = len(ru_ids)
    N_UEs = len(ue_ids)
    N_beams = len(codebook)

    sample_cfr = next(iter(cfr_data.values()), None)
    if sample_cfr is None:
        raise ValueError("cfr_data is empty: no CFR samples available")
    N_time, N_tx_antennas, N_ue_antennas, N_freq = sample_cfr.shape

    cfr_tensor = np.zeros(
        (N_tx, N_tx_antennas, N_UEs, N_ue_antennas, N_time, N_freq),
        dtype=sample_cfr.dtype,
    )

    for (ru_id, ue_id), cfrs in cfr_data.items():
        ru_idx = ru_id_to_idx[ru_id]
        ue_idx = ue_id_to_idx[ue_id]
        cfrs_reordered = np.transpose(cfrs, (1, 2, 0, 3))
        cfr_tensor[ru_idx, :, ue_idx, :, :, :] = cfrs_reordered

    if per_ru_weights is None:
        if N_tx_antennas < 1 or N_ue_antennas < 1:
            raise RuntimeError(
                "raw element-0/0 fallback requires at least one TX and RX antenna"
            )
        beamformed_all = cfr_tensor[:, 0, :, 0, :, :][
            :,
            :,
            np.newaxis,
            :,
            :,
            np.newaxis,
        ]
        return beamformed_all, ru_id_to_idx, ue_id_to_idx, beam_id_to_idx

    all_weights = per_ru_weights
    if all_weights.shape[0] != N_tx or all_weights.shape[1] != N_beams:
        raise RuntimeError(
            f"per-RU weights shape {tuple(all_weights.shape)} incompatible with "
            f"{N_tx} RUs and {N_beams} beams"
        )

    all_weights = all_weights.astype(cfr_tensor.dtype)

    if all_weights.ndim == 3:
        if all_weights.shape[2] != N_tx_antennas:
            raise RuntimeError(
                f"per-RU weights N_ant {all_weights.shape[2]} != CFR N_tx_antennas "
                f"{N_tx_antennas}"
            )
        beamformed_all = np.einsum("tba,taurif->turifb", all_weights, cfr_tensor)
    elif all_weights.ndim == 2:
        if all_weights.shape[1] != N_tx_antennas:
            raise RuntimeError(
                f"weights N_ant {all_weights.shape[1]} != CFR N_tx_antennas "
                f"{N_tx_antennas}"
            )
        beamformed_all = np.einsum("ba,taurif->turifb", all_weights, cfr_tensor)
    else:
        raise RuntimeError(f"unexpected beamforming weight tensor ndim={all_weights.ndim}")

    return beamformed_all, ru_id_to_idx, ue_id_to_idx, beam_id_to_idx
