# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Parse beamforming codebook CSV text."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np

from examples.beamforming.src.core.constants import (
    CODEBOOK_BEAM_FIXED_COLUMNS,
    CODEBOOK_BEAM_HEADER_PREFIX,
    CODEBOOK_COMPLEX_PAIR_SIZE,
    CODEBOOK_HEADER_DUAL_POLARIZED,
    CODEBOOK_HEADER_FREQUENCY_HZ,
    CODEBOOK_HEADER_HORIZONTAL_ELEMENTS,
    CODEBOOK_HEADER_HORIZONTAL_SPACING,
    CODEBOOK_HEADER_VERTICAL_ELEMENTS,
    CODEBOOK_HEADER_VERTICAL_SPACING,
    CODEBOOK_REQUIRED_HEADER_KEYS,
    CODEBOOK_SECTION_MARKER,
    DUAL_POLARIZATION_COUNT,
    SINGLE_POLARIZATION_COUNT,
)


@dataclass(frozen=True)
class BeamformingCodebookCSV:
    """Parsed beamforming codebook metadata."""

    horizontal_num: int
    vertical_num: int
    dual_polarized: bool
    horizontal_spacing: float
    vertical_spacing: float
    frequency_hz: float
    beams: List[Tuple[int, float, float]] = field(default_factory=list)

    @property
    def num_antennas(self) -> int:
        pol_count = (
            DUAL_POLARIZATION_COUNT
            if self.dual_polarized
            else SINGLE_POLARIZATION_COUNT
        )
        return self.horizontal_num * self.vertical_num * pol_count


def _parse_header_kv(line: str) -> Tuple[str, str]:
    """Split a header key/value line."""
    parts = line.strip().split(None, 1)
    if len(parts) != 2:
        raise ValueError(f"malformed header line: {line!r}")
    return parts[0], parts[1]


def _parse_codebook_csv_lines(
    lines: Iterable[str],
    source_label: str,
) -> Tuple[BeamformingCodebookCSV, np.ndarray]:
    """Parse codebook CSV lines into header metadata and complex weights."""
    header: dict = {}
    beams: List[Tuple[int, float, float]] = []
    weight_rows: List[List[complex]] = []
    beam_header_seen = False
    ant_cols_expected: int = -1

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line == CODEBOOK_SECTION_MARKER:
            continue
        if line.startswith(CODEBOOK_BEAM_HEADER_PREFIX):
            cols = [c.strip() for c in line.split(",")]
            ant_cols_expected = max(0, len(cols) - CODEBOOK_BEAM_FIXED_COLUMNS)
            beam_header_seen = True
            continue

        if not beam_header_seen:
            key, val = _parse_header_kv(line)
            header[key] = val
            continue

        parts = [c.strip() for c in line.split(",")]
        if len(parts) < CODEBOOK_BEAM_FIXED_COLUMNS:
            raise ValueError(
                f"beam row needs at least {CODEBOOK_BEAM_FIXED_COLUMNS} "
                f"columns: {line!r}"
            )
        beam_idx = int(parts[0])
        tilt_deg = float(parts[1])
        azimuth_deg = float(parts[2])
        ant_vals = parts[CODEBOOK_BEAM_FIXED_COLUMNS:]
        got_ant_cols = len(ant_vals)
        if ant_cols_expected >= 0 and got_ant_cols != ant_cols_expected:
            raise ValueError(
                f"beam row {beam_idx}: {got_ant_cols} antenna columns, "
                f"header declares {ant_cols_expected}"
            )
        if got_ant_cols % CODEBOOK_COMPLEX_PAIR_SIZE != 0:
            raise ValueError(
                f"beam row {beam_idx}: antenna columns ({got_ant_cols}) "
                f"must be even (re/im pairs)"
            )
        beams.append((beam_idx, tilt_deg, azimuth_deg))
        row_weights = []
        for k in range(0, got_ant_cols, CODEBOOK_COMPLEX_PAIR_SIZE):
            re = float(ant_vals[k])
            im = float(ant_vals[k + 1])
            row_weights.append(complex(re, im))
        weight_rows.append(row_weights)

    missing = [k for k in CODEBOOK_REQUIRED_HEADER_KEYS if k not in header]
    if missing:
        raise ValueError(
            f"codebook CSV {source_label} missing required header keys: "
            f"{missing}"
        )
    if not beams:
        raise ValueError(f"codebook CSV {source_label} has no beam rows")

    codebook = BeamformingCodebookCSV(
        horizontal_num=int(header[CODEBOOK_HEADER_HORIZONTAL_ELEMENTS]),
        vertical_num=int(header[CODEBOOK_HEADER_VERTICAL_ELEMENTS]),
        dual_polarized=bool(int(header[CODEBOOK_HEADER_DUAL_POLARIZED])),
        horizontal_spacing=float(header[CODEBOOK_HEADER_HORIZONTAL_SPACING]),
        vertical_spacing=float(header[CODEBOOK_HEADER_VERTICAL_SPACING]),
        frequency_hz=float(header[CODEBOOK_HEADER_FREQUENCY_HZ]),
        beams=beams,
    )

    if (
        ant_cols_expected >= 0
        and (ant_cols_expected // CODEBOOK_COMPLEX_PAIR_SIZE)
        != codebook.num_antennas
    ):
        raise ValueError(
            f"codebook CSV {source_label}: Ant_* pair count "
            f"{ant_cols_expected // CODEBOOK_COMPLEX_PAIR_SIZE} "
            f"!= H*V*(2 if dual_pol else 1) = {codebook.num_antennas} "
            f"(H={codebook.horizontal_num}, V={codebook.vertical_num}, "
            f"dual_pol={codebook.dual_polarized})"
        )

    weights = np.array(weight_rows, dtype=np.complex64)
    return codebook, weights



def parse_codebook_csv_text_with_weights(
    csv_text: str,
    source_label: str,
) -> Tuple[BeamformingCodebookCSV, np.ndarray]:
    """Parse codebook CSV text and weights."""
    return _parse_codebook_csv_lines(csv_text.splitlines(), source_label)


def parse_codebook_csv_text_from_weights(
    csv_text: str,
    source_label: str,
    n_ant: int,
    ru_id: int,
) -> Tuple[np.ndarray, List[Tuple[int, float, float]]]:
    """Parse ``csv_from_weights`` text for one RU."""
    cb, weights = parse_codebook_csv_text_with_weights(csv_text, source_label)
    if cb.num_antennas != n_ant:
        raise RuntimeError(
            f"[codebook CSV] ru_id={ru_id}: CSV declares "
            f"n_ant={cb.num_antennas}, "
            f"but SSR reports n_ant={n_ant} ({source_label})"
        )
    return weights, list(cb.beams)
