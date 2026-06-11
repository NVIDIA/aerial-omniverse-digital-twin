# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Antenna panel specs and local indexing helpers."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from examples.beamforming.src.core.constants import (
    DUAL_POLARIZATION_COUNT,
    SINGLE_POLARIZATION_COUNT,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AntennaPanelSpecs:
    """Panel geometry in local coordinates."""

    panel_name: str
    num_loc_antenna_horz: int
    num_loc_antenna_vert: int
    antenna_spacing_horz: float  # cm
    antenna_spacing_vert: float  # cm
    reference_freq: float  # Hz
    dual_polarized: bool

    @property
    def Ny(self) -> int:
        return self.num_loc_antenna_horz

    @property
    def Nz(self) -> int:
        return self.num_loc_antenna_vert

    @property
    def num_antennas(self) -> int:
        pol_count = (
            DUAL_POLARIZATION_COUNT
            if self.dual_polarized
            else SINGLE_POLARIZATION_COUNT
        )
        return self.Ny * self.Nz * pol_count


# ------------------------------------------------------------------
# Centralized antenna indexing convention (column-major)
#   flat_idx = (hor_idx * n_ver + ver_idx) * num_pol + pol_idx
# ------------------------------------------------------------------

def antenna_coords_to_flat_index(
    hor_idx: int,
    ver_idx: int,
    pol_idx: int,
    n_hor: int,
    n_ver: int,
    num_pol: int,
) -> int:
    """Convert (hor, ver, pol) to flat index (column-major)."""
    return (hor_idx * n_ver + ver_idx) * num_pol + pol_idx


def get_ant_idx_from_coords(panel, ant_coords) -> Optional[int]:
    """Map antenna coordinates to a flat panel index."""
    n_hor = panel.num_loc_antenna_horz
    n_ver = panel.num_loc_antenna_vert
    num_pol = (
        DUAL_POLARIZATION_COUNT
        if panel.dual_polarized
        else SINGLE_POLARIZATION_COUNT
    )

    if len(ant_coords) == 3:
        return antenna_coords_to_flat_index(
            ant_coords[0], ant_coords[1], ant_coords[2],
            n_hor, n_ver, num_pol,
        )
    if len(ant_coords) == 2:
        return antenna_coords_to_flat_index(
            ant_coords[0], ant_coords[1], 0,
            n_hor, n_ver, num_pol,
        )
    logger.error(
        "Antenna coordinates %s are not valid for panel %s",
        ant_coords,
        panel.panel_name,
    )
    return None
