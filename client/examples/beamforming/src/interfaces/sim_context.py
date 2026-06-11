# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Simulation context types for beamforming."""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import List, Optional

from examples.beamforming.src.core.constants import DEFAULT_POSITION_M
from examples.beamforming.src.interfaces.panel import AntennaPanelSpecs


@dataclass
class Position3D:
    x: float = DEFAULT_POSITION_M
    y: float = DEFAULT_POSITION_M
    z: float = DEFAULT_POSITION_M


@dataclass
class RuInfoLight:
    """RU metadata used for codebook materialization."""

    tx_id: int = 0
    carrier_freq: float = 0.0
    loc_antenna: list = field(default_factory=list)
    position: Position3D = field(default_factory=Position3D)


@dataclass
class SimContextLight:
    """Minimal simulation context for beamforming."""

    panels: List[AntennaPanelSpecs] = field(default_factory=list)
    ru_ids: List[int] = field(default_factory=list)
    ue_ids: List[int] = field(default_factory=list)
    ru_infos: List[RuInfoLight] = field(default_factory=list)
    carrier_freq_hz: float = 0.0
    wavelength: float = 0.0
    iceberg_config: Optional[SimpleNamespace] = None
    s3_config: Optional[SimpleNamespace] = None
