#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Plot selected beam RSRP against measurements."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from os import write
from pathlib import Path
from typing import cast

import matplotlib.pyplot as plt

from examples.beamforming.src.core.constants import (
    OUTPUT_BEAM_PREFIX,
    OUTPUT_RSRP_DBM_KEY,
    OUTPUT_TIME_ARRAY_KEY,
)

NumericSeries = Sequence[float]
BeamPayloadValue = Sequence[str | int | float | bool | None]
BeamPayload = Mapping[str, BeamPayloadValue]
BeamMap = Mapping[str, BeamPayload]
UeMap = Mapping[str, BeamMap]
BeamformedJson = Mapping[str, UeMap]


@dataclass(frozen=True)
class MeasurementTrace:
    """Measurement power and selected beam IDs."""

    times: list[int]
    target_rsrp: list[float]
    beam_ids: list[int]


def _print_stderr(message: str) -> None:
    write(2, f"{message}\n".encode("utf-8"))


def load_beamformed_json(input_json: Path) -> BeamformedJson:
    """Load beamformed RSRP JSON."""
    if not input_json.is_file():
        raise FileNotFoundError(f"Beamformed JSON not found: {input_json}")

    with input_json.open("r", encoding="utf-8") as file_obj:
        loaded_data = json.load(file_obj)

    if not isinstance(loaded_data, dict):
        raise ValueError(
            f"Beamformed JSON root must be an object: {input_json}"
        )

    return cast(BeamformedJson, loaded_data)


def build_selected_output_path(output_dir: Path, ru_key: str, ue_key: str) -> Path:
    """Build the selected-beam PNG path."""
    file_stem = f"{ru_key}_{ue_key}_selected_beam_power_timeseries".lower()
    return output_dir / f"{file_stem}.png"


def load_measurement_trace(measurement_csv: Path) -> MeasurementTrace:
    """Load power and selected beam IDs from CSV."""
    if not measurement_csv.is_file():
        raise FileNotFoundError(f"Measurement beam CSV not found: {measurement_csv}")

    with measurement_csv.open("r", encoding="utf-8", newline="") as file_obj:
        reader = csv.DictReader(file_obj)
        fieldnames = reader.fieldnames
        if fieldnames is None:
            raise ValueError(f"{measurement_csv}: CSV header is missing")
        if "time" not in fieldnames:
            raise ValueError(f"{measurement_csv}: missing required time column")

        power_columns = [
            fieldname for fieldname in fieldnames if fieldname.startswith("Power_PCI_")
        ]
        if len(power_columns) != 1:
            raise ValueError(
                f"{measurement_csv}: expected exactly one Power_PCI_* "
                f"column, found {len(power_columns)}"
            )
        beam_columns = [
            fieldname
            for fieldname in fieldnames
            if fieldname.startswith("beam_idx_PCI_")
        ]
        if len(beam_columns) != 1:
            raise ValueError(
                f"{measurement_csv}: expected exactly one beam_idx_PCI_* "
                f"column, found {len(beam_columns)}"
            )

        times: list[int] = []
        target_rsrp: list[float] = []
        beam_ids: list[int] = []
        power_column = power_columns[0]
        beam_column = beam_columns[0]
        for row_number, row in enumerate(reader, start=2):
            try:
                times.append(int(row["time"]))
                target_rsrp.append(float(row[power_column]))
                beam_ids.append(int(row[beam_column]))
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"{measurement_csv}: invalid target power or beam id at "
                    f"row {row_number}"
                ) from exc

    if not times:
        raise ValueError(f"{measurement_csv}: no measurement rows found")
    return MeasurementTrace(times=times, target_rsrp=target_rsrp, beam_ids=beam_ids)


def plot_selected_beam_curve(
    ru_key: str,
    ue_key: str,
    beams: BeamMap,
    measurement_trace: MeasurementTrace,
    output_dir: Path,
) -> Path:
    """Plot measured power against selected beamformed output."""
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = build_selected_output_path(output_dir, ru_key, ue_key)
    selected_times, target_rsrp, selected_rsrp = _selected_beam_trace(
        ru_key,
        ue_key,
        beams,
        measurement_trace,
    )

    figure, axis = plt.subplots(figsize=(10.0, 6.0))
    try:
        axis.plot(
            selected_times,
            target_rsrp,
            linestyle="-",
            linewidth=1.8,
            label="actual_target_csv",
        )
        axis.plot(
            selected_times,
            selected_rsrp,
            linestyle="-",
            linewidth=1.8,
            label="beamformed_output",
        )
        axis.set_title(f"Beam RSRP Timeseries - {ru_key} / {ue_key}")
        axis.set_xlabel("time_array")
        axis.set_ylabel("RSRP (dBm)")
        axis.grid(True, alpha=0.3)
        axis.legend()
        figure.tight_layout()
        figure.savefig(output_path)
    finally:
        plt.close(figure)

    return output_path


def plot_all_ru_ue_pairs(
    beamformed_data: BeamformedJson,
    output_dir: Path,
    measurements_beams_dir: Path,
) -> list[Path]:
    """Save RSRP plots for every RU/UE pair."""
    output_paths: list[Path] = []
    for ru_key, ue_map in beamformed_data.items():
        if not isinstance(ue_map, Mapping):
            raise ValueError(f"{ru_key}: UE map must be an object")
        for ue_key, beams in ue_map.items():
            if not isinstance(beams, Mapping):
                raise ValueError(
                    f"{ru_key}/{ue_key}: beam map must be an object"
                )
            measurement_csv = _measurement_csv_path(
                measurements_beams_dir,
                ru_key,
                ue_key,
            )
            measurement_trace = load_measurement_trace(measurement_csv)
            output_paths.append(
                plot_selected_beam_curve(
                    ru_key,
                    ue_key,
                    beams,
                    measurement_trace,
                    output_dir,
                )
            )
    return output_paths


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description=(
            "Plot actual target CSV power against selected beamformed output "
            "from beamformed_rsrp.json. One PNG is written per RU/UE pair."
        ),
    )
    parser.add_argument(
        "--input-json",
        type=Path,
        required=True,
        help="Path to beamformed_rsrp.json from the beamforming pipeline.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Directory where RU/UE beam RSRP PNG files are written.",
    )
    parser.add_argument(
        "--measurements-beams-dir",
        type=Path,
        required=True,
        help="Directory containing ruN_ueM_with_beams_filled.csv files.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point."""
    args = parse_args(argv)
    try:
        beamformed_data = load_beamformed_json(args.input_json)
        output_paths = plot_all_ru_ue_pairs(
            beamformed_data,
            args.output_dir,
            args.measurements_beams_dir,
        )
    except (FileNotFoundError, ValueError) as exc:
        _print_stderr(f"ERROR: {exc}")
        return 1

    for output_path in output_paths:
        print(output_path)
    return 0


def _selected_beam_trace(
    ru_key: str,
    ue_key: str,
    beams: BeamMap,
    measurement_trace: MeasurementTrace,
) -> tuple[list[int], list[float], list[float]]:
    """Align measured and selected beamformed samples."""
    if not beams:
        raise ValueError(f"{ru_key}/{ue_key}: no beams found")
    output_time_array = _first_beam_time_array(beams)
    measurement_by_time = _measurement_trace_by_time(
        ru_key,
        ue_key,
        measurement_trace,
    )
    time_to_rsrp_by_beam = _build_time_to_rsrp_by_beam(ru_key, ue_key, beams)
    fallback_beam_key = _beam_0_fallback_key(beams)
    selected_times: list[int] = []
    target_rsrp: list[float] = []
    selected_rsrp: list[float] = []
    for time_value in output_time_array:
        measurement_sample = measurement_by_time.get(time_value)
        if measurement_sample is None:
            raise ValueError(
                f"{ru_key}/{ue_key}: measurement CSV missing time {time_value}"
            )
        target_sample, beam_id = measurement_sample
        beam_key = f"{OUTPUT_BEAM_PREFIX}{beam_id}"
        if beam_key not in time_to_rsrp_by_beam and fallback_beam_key is not None:
            beam_key = fallback_beam_key
        if beam_key not in time_to_rsrp_by_beam:
            raise ValueError(
                f"{ru_key}/{ue_key}: selected beam {beam_key} not found"
            )
        time_to_rsrp = time_to_rsrp_by_beam[beam_key]
        if time_value not in time_to_rsrp:
            raise ValueError(
                f"{ru_key}/{ue_key}/{beam_key}: selected time "
                f"{time_value} not found"
            )
        selected_times.append(time_value)
        target_rsrp.append(target_sample)
        selected_rsrp.append(time_to_rsrp[time_value])
    return selected_times, target_rsrp, selected_rsrp


def _measurement_trace_by_time(
    ru_key: str,
    ue_key: str,
    measurement_trace: MeasurementTrace,
) -> dict[int, tuple[float, int]]:
    """Index measurement samples by time."""
    if not (
        len(measurement_trace.times)
        == len(measurement_trace.target_rsrp)
        == len(measurement_trace.beam_ids)
    ):
        raise ValueError(f"{ru_key}/{ue_key}: measurement trace dimensions differ")

    measurement_by_time: dict[int, tuple[float, int]] = {}
    for time_value, target_rsrp, beam_id in zip(
        measurement_trace.times,
        measurement_trace.target_rsrp,
        measurement_trace.beam_ids,
    ):
        if time_value in measurement_by_time:
            raise ValueError(
                f"{ru_key}/{ue_key}: duplicate measurement time {time_value}"
            )
        measurement_by_time[time_value] = (target_rsrp, beam_id)
    return measurement_by_time


def _build_time_to_rsrp_by_beam(
    ru_key: str,
    ue_key: str,
    beams: BeamMap,
) -> dict[str, dict[int, float]]:
    """Index RSRP samples by beam and time."""
    time_to_rsrp_by_beam: dict[str, dict[int, float]] = {}
    for beam_key, beam_payload in beams.items():
        time_array = _beam_time_array(beam_payload)
        rsrp_dbm = _beam_numeric_series(
            beam_payload,
            OUTPUT_RSRP_DBM_KEY,
            ru_key,
            ue_key,
            beam_key,
        )
        if len(time_array) != len(rsrp_dbm):
            raise ValueError(
                f"{ru_key}/{ue_key}/{beam_key}: time_array length "
                f"{len(time_array)} does not match RSRP time dimension "
                f"{len(rsrp_dbm)}"
            )
        duplicate_times = [
            time_value
            for time_value, count in Counter(time_array).items()
            if count > 1
        ]
        if duplicate_times:
            raise ValueError(
                f"{ru_key}/{ue_key}/{beam_key}: duplicate time_array values "
                f"{duplicate_times}"
            )
        time_to_rsrp_by_beam[beam_key] = dict(zip(time_array, rsrp_dbm))
    return time_to_rsrp_by_beam


def _first_beam_time_array(beams: BeamMap) -> Sequence[int]:
    """Return the first exported beam time axis."""
    for beam_payload in beams.values():
        return _beam_time_array(beam_payload)
    raise ValueError("no beams found")


def _beam_time_array(beam_payload: BeamPayload) -> Sequence[int]:
    """Read the integer time axis from a beam payload."""
    value = beam_payload.get(OUTPUT_TIME_ARRAY_KEY)
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(
            f"Beam payload field {OUTPUT_TIME_ARRAY_KEY!r} must be a sequence"
        )
    for time_value in value:
        if not isinstance(time_value, int) or isinstance(time_value, bool):
            raise ValueError("time_array must contain only integers")
    return cast(Sequence[int], value)


def _beam_numeric_series(
    beam_payload: BeamPayload,
    key: str,
    ru_key: str,
    ue_key: str,
    beam_key: str,
) -> NumericSeries:
    """Read a numeric series from a beam payload."""
    value = beam_payload.get(key)
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(f"Beam payload field {key!r} must be a sequence")
    for sample in value:
        if not isinstance(sample, (int, float)) or isinstance(sample, bool):
            raise ValueError(
                f"{ru_key}/{ue_key}/{beam_key}: {key} must contain only numbers"
            )
    return cast(NumericSeries, value)


def _beam_0_fallback_key(beams: BeamMap) -> str | None:
    """Return BEAM_0 only for the raw no-codebook fallback output."""
    fallback_key = f"{OUTPUT_BEAM_PREFIX}0"
    if len(beams) == 1 and fallback_key in beams:
        return fallback_key
    return None


def _measurement_csv_path(
    measurements_beams_dir: Path,
    ru_key: str,
    ue_key: str,
) -> Path:
    """Build the expected measurement CSV path."""
    return (
        measurements_beams_dir
        / f"{_measurement_csv_token(ru_key)}_"
        f"{_measurement_csv_token(ue_key)}_with_beams_filled.csv"
    )


def _measurement_csv_token(key: str) -> str:
    """Convert exported JSON keys to measurement tokens."""
    return key.lower().replace("_", "")


if __name__ == "__main__":
    raise SystemExit(main())
