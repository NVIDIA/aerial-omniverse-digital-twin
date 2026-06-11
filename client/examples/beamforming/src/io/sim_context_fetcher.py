# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Parse beamforming context from simulation YAML."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Dict, List, Optional, Union, cast

import yaml

from examples.beamforming.src.core.constants import (
    DEFAULT_DUAL_POLARIZED,
    DEFAULT_PANEL_ELEMENT_COUNT,
    DEFAULT_PANEL_SPACING_MM,
    DEFAULT_POSITION_M,
    DEFAULT_REFERENCE_FREQ_MHZ,
    HZ_PER_MHZ,
    MM_PER_CM,
    SPEED_OF_LIGHT_EXACT_M_PER_S,
)
from examples.beamforming.src.interfaces import (
    AntennaPanelSpecs,
    Position3D,
    RuInfoLight,
    SimContextLight,
)

logger = logging.getLogger(__name__)

YamlScalar = Union[str, int, float, bool, None]
YamlKey = YamlScalar
YamlValue = Union[YamlScalar, List["YamlValue"], Dict[str, "YamlValue"]]
YamlDict = Dict[str, YamlValue]


def fetch_sim_context_light(sim_yaml_str: str) -> SimContextLight:
    """Extract the minimal beamforming context from simulation YAML."""
    loaded_yaml = yaml.safe_load(sim_yaml_str)
    if not isinstance(loaded_yaml, dict):
        raise RuntimeError(
            f"Simulation YAML must be a dict at top level, got {type(loaded_yaml)}"
        )
    raw = cast(YamlDict, loaded_yaml)

    sim = raw.get("sim")
    if not sim or not isinstance(sim, dict):
        raise RuntimeError("No 'sim' section found in simulation YAML")

    # --- RU / UE IDs ---
    rus_section = sim.get("RUs", {})
    ru_add = rus_section.get("add", [])
    ru_ids = [int(ru["id"]) for ru in ru_add if "id" in ru]
    if not ru_ids:
        raise RuntimeError("No RUs found in YAML (sim.RUs.add)")

    ues_section = sim.get("UEs", {})
    ue_add = ues_section.get("add", [])
    ue_ids = [int(ue["id"]) for ue in ue_add if "id" in ue]
    if not ue_ids:
        raise RuntimeError("No UEs found in YAML (sim.UEs.add)")

    # --- Panels ---
    panels_section = sim.get("Panels", {})
    panel_add = panels_section.get("add", [])
    panel_updates = panels_section.get("update", [])
    ru_updates = rus_section.get("update", [])

    ru_panel_ids = set()
    for ru_spec in ru_add:
        rid = ru_spec.get("id")
        for update_group in ru_updates:
            if rid in update_group.get("ids", []):
                panel_type = update_group.get("attributes", {}).get(
                    "aerial_gnb_panel_type"
                )
                if panel_type:
                    ru_panel_ids.add(panel_type)
                break

    if not ru_panel_ids:
        raise RuntimeError("Could not determine panel type(s) for RUs")

    panels: List[AntennaPanelSpecs] = []
    for panel_spec in panel_add:
        panel_id = panel_spec.get("id")
        if panel_id not in ru_panel_ids:
            continue

        panel_attrs: Optional[dict] = None
        for update_group in panel_updates:
            if panel_id in update_group.get("ids", []):
                panel_attrs = update_group.get("attributes")
                break

        if not panel_attrs:
            raise RuntimeError(f"No attributes found for panel {panel_id}")

        panels.append(
            AntennaPanelSpecs(
                panel_name=str(panel_id),
                num_loc_antenna_horz=int(
                    panel_attrs.get("num_loc_antenna_horz", DEFAULT_PANEL_ELEMENT_COUNT)
                ),
                num_loc_antenna_vert=int(
                    panel_attrs.get("num_loc_antenna_vert", DEFAULT_PANEL_ELEMENT_COUNT)
                ),
                antenna_spacing_horz=float(
                    panel_attrs.get("antenna_spacing_horz_mm", DEFAULT_PANEL_SPACING_MM)
                )
                / MM_PER_CM,
                antenna_spacing_vert=float(
                    panel_attrs.get("antenna_spacing_vert_mm", DEFAULT_PANEL_SPACING_MM)
                )
                / MM_PER_CM,
                reference_freq=float(
                    panel_attrs.get("reference_freq_mhz", DEFAULT_REFERENCE_FREQ_MHZ)
                )
                * HZ_PER_MHZ,
                dual_polarized=bool(
                    panel_attrs.get("dual_polarized", DEFAULT_DUAL_POLARIZED)
                ),
            )
        )

    if not panels:
        raise RuntimeError("No panels created from configuration")

    carrier_freq_hz = panels[0].reference_freq
    wavelength = SPEED_OF_LIGHT_EXACT_M_PER_S / carrier_freq_hz

    # --- RU infos (per-RU antenna positions + carrier freq) ---
    panel_attrs_by_id: Dict[YamlKey, YamlDict] = {}
    for update_group in panel_updates:
        attrs = update_group.get("attributes")
        if attrs:
            for pid in update_group.get("ids", []):
                panel_attrs_by_id[pid] = attrs

    ru_infos: List[RuInfoLight] = []
    for ru_spec in ru_add:
        rid = int(ru_spec["id"])
        ru_attrs: Optional[dict] = None
        panel_type = None
        for update_group in ru_updates:
            if rid in update_group.get("ids", []):
                ru_attrs = update_group.get("attributes", {})
                panel_type = ru_attrs.get("aerial_gnb_panel_type")
                break
        if ru_attrs is None or panel_type is None:
            continue

        p_attrs = panel_attrs_by_id.get(panel_type)
        if p_attrs is None:
            continue

        raw_position = ru_spec.get("position", {})
        raw_pos = raw_position.get("pos", {}) if isinstance(raw_position, dict) else {}
        position = Position3D(
            x=float(raw_pos.get("x", DEFAULT_POSITION_M)),
            y=float(raw_pos.get("y", DEFAULT_POSITION_M)),
            z=float(raw_pos.get("z", DEFAULT_POSITION_M)),
        )

        freq_mhz = float(
            ru_attrs.get("aerial_gnb_carrier_freq", DEFAULT_REFERENCE_FREQ_MHZ)
        )
        nh = int(p_attrs.get("num_loc_antenna_horz", DEFAULT_PANEL_ELEMENT_COUNT))
        nv = int(p_attrs.get("num_loc_antenna_vert", DEFAULT_PANEL_ELEMENT_COUNT))
        spacing_h_cm = (
            float(p_attrs.get("antenna_spacing_horz_mm", DEFAULT_PANEL_SPACING_MM))
            / MM_PER_CM
        )
        spacing_v_cm = (
            float(p_attrs.get("antenna_spacing_vert_mm", DEFAULT_PANEL_SPACING_MM))
            / MM_PER_CM
        )

        loc_antenna = [
            Position3D(
                x=DEFAULT_POSITION_M,
                y=ih * spacing_h_cm,
                z=iv * spacing_v_cm,
            )
            for iv in range(nv)
            for ih in range(nh)
        ]
        ru_infos.append(
            RuInfoLight(
                tx_id=rid,
                carrier_freq=freq_mhz * HZ_PER_MHZ,
                loc_antenna=loc_antenna,
                position=position,
            )
        )

    # --- DB / Iceberg ---
    db = raw.get("db", {})
    parquet_export = db.get("parquet_export", {})
    iceberg_config = parquet_export.get("iceberg")
    s3_configs = parquet_export.get("s3_configs", [])
    s3_config = s3_configs[0] if s3_configs else None

    if not iceberg_config:
        raise RuntimeError(
            "No Iceberg configuration found. Add 'db.parquet_export.iceberg' section."
        )

    # Convert nested dicts into namespace-like objects for attribute access
    iceberg_config = _DictNamespace(iceberg_config)
    if s3_config is not None:
        s3_config = _DictNamespace(s3_config)

    return SimContextLight(
        panels=panels,
        ru_ids=ru_ids,
        ue_ids=ue_ids,
        ru_infos=ru_infos,
        carrier_freq_hz=carrier_freq_hz,
        wavelength=wavelength,
        iceberg_config=iceberg_config,
        s3_config=s3_config,
    )


class _DictNamespace(SimpleNamespace):
    """Expose nested dict keys through attribute access."""

    def __init__(self, d: YamlDict):
        for k, v in d.items():
            if isinstance(v, dict):
                v = _DictNamespace(v)
            elif isinstance(v, list):
                v = [_DictNamespace(i) if isinstance(i, dict) else i for i in v]
            object.__setattr__(self, k, v)

    def __repr__(self) -> str:
        return f"_DictNamespace({vars(self)})"
