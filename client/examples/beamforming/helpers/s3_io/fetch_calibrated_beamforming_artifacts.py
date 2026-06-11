#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Fetch local beamforming inputs from S3."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from os import write
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import yaml

from examples.beamforming.src.io.s3_codebook_loader import (
    YamlMapping,
    build_codebook_s3_prefix,
    get_s3_text_object,
    list_s3_keys,
    select_optional_codebook_key,
)


def _print_stderr(message: str) -> None:
    write(2, f"{message}\n".encode("utf-8"))

CALIBRATED_SIM_CONFIG_FILENAME = "sim_config_calibrated.yml"


@dataclass(frozen=True)
class FetchedArtifacts:
    """Downloaded beamforming artifact paths."""

    codebook_path: Path | None = None
    sim_config_path: Path | None = None
    measurement_csv_paths: list[Path] = field(default_factory=list)


def _namespace_from_mapping(mapping: YamlMapping) -> SimpleNamespace:
    """Expose mapping keys through attribute access."""
    return SimpleNamespace(**mapping)


def _load_raw_yaml(path: Path) -> YamlMapping:
    """Load a YAML file as a mapping."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"YAML root must be a mapping: {path}")
    return cast(YamlMapping, raw)


def _s3_config_from_raw_yaml(raw_yaml: YamlMapping) -> SimpleNamespace:
    """Read the first S3 config from YAML."""
    db = raw_yaml.get("db", {})
    if not isinstance(db, dict):
        raise ValueError("Missing db mapping in YAML")
    parquet_export = db.get("parquet_export", {})
    if not isinstance(parquet_export, dict):
        raise ValueError("Missing db.parquet_export mapping in YAML")
    s3_configs = parquet_export.get("s3_configs", [])
    if not isinstance(s3_configs, list) or not s3_configs:
        raise ValueError("Missing db.parquet_export.s3_configs[0]")
    s3_config = s3_configs[0]
    if not isinstance(s3_config, dict):
        raise ValueError("db.parquet_export.s3_configs[0] must be a mapping")
    bucket = s3_config.get("bucket")
    if not isinstance(bucket, str) or not bucket.strip():
        raise ValueError("Missing db.parquet_export.s3_configs[0].bucket")
    return _namespace_from_mapping(s3_config)


def measurement_csv_keys_from_raw_yaml(raw_yaml: YamlMapping) -> list[str]:
    """Read measurement CSV keys from YAML."""
    cal = raw_yaml.get("cal", {})
    if not isinstance(cal, dict):
        raise ValueError("Missing cal mapping in YAML")
    measurements = cal.get("measurements", [])
    if not isinstance(measurements, list) or not measurements:
        raise ValueError("Missing cal.measurements entries")

    measurement_keys: list[str] = []
    for index, measurement in enumerate(measurements):
        if not isinstance(measurement, dict):
            raise ValueError(f"cal.measurements[{index}] must be a mapping")
        measurement_file = measurement.get("measurement_file")
        if not isinstance(measurement_file, str) or not measurement_file.strip():
            raise ValueError(
                f"Missing cal.measurements[{index}].measurement_file"
            )
        measurement_keys.append(measurement_file.strip().lstrip("/"))
    return measurement_keys


def calibrated_sim_config_key_from_raw_yaml(raw_yaml: YamlMapping) -> str:
    """Build the calibrated simulation YAML key."""
    cal = raw_yaml.get("cal", {})
    if not isinstance(cal, dict):
        raise ValueError("Missing cal mapping in YAML")
    output = cal.get("output", {})
    if not isinstance(output, dict):
        raise ValueError("Missing cal.output mapping in YAML")
    folder_key = output.get("folder_key")
    if not isinstance(folder_key, str) or not folder_key.strip():
        raise ValueError("Missing cal.output.folder_key")
    return f"{folder_key.strip().strip('/')}/{CALIBRATED_SIM_CONFIG_FILENAME}"


def _write_text_from_s3(
    s3_config: SimpleNamespace,
    object_key: str,
    output_dir: Path,
) -> Path:
    """Download one text object into the output directory."""
    output_path = output_dir / Path(object_key).name
    output_path.write_text(
        get_s3_text_object(s3_config, object_key),
        encoding="utf-8",
    )
    return output_path


def fetch_artifacts(args: argparse.Namespace) -> FetchedArtifacts:
    """Fetch the sim YAML, optional codebook, and measurements."""
    raw_yaml = _load_raw_yaml(args.cal_yaml)
    s3_config = _s3_config_from_raw_yaml(raw_yaml)
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    codebook_path: Path | None = None
    codebook_key: str | None = None
    try:
        codebook_prefix = build_codebook_s3_prefix(raw_yaml)
    except ValueError as exc:
        _print_stderr(f"WARNING: optional codebook CSV not fetched: {exc}")
    else:
        try:
            codebook_keys = list_s3_keys(s3_config, codebook_prefix)
            codebook_key = select_optional_codebook_key(
                codebook_keys,
                codebook_prefix,
            )
            if codebook_key is not None:
                codebook_path = _write_text_from_s3(
                    s3_config,
                    codebook_key,
                    output_dir,
                )
        except OSError as exc:
            _print_stderr(f"WARNING: optional codebook CSV not fetched: {exc}")

    sim_config_key = calibrated_sim_config_key_from_raw_yaml(raw_yaml)
    sim_config_path = _write_text_from_s3(s3_config, sim_config_key, output_dir)

    measurement_keys = measurement_csv_keys_from_raw_yaml(raw_yaml)
    measurement_csv_paths = [
        _write_text_from_s3(s3_config, measurement_key, output_dir)
        for measurement_key in measurement_keys
    ]

    if codebook_path is not None:
        print(f"Codebook: s3://{s3_config.bucket}/{codebook_key} -> {codebook_path}")
    else:
        _print_stderr("WARNING: no optional codebook CSV fetched")

    print(
        f"Calibrated sim config: s3://{s3_config.bucket}/{sim_config_key} -> "
        f"{sim_config_path}"
    )

    for measurement_key, measurement_csv_path in zip(
        measurement_keys,
        measurement_csv_paths,
    ):
        print(
            f"Measurement CSV: s3://{s3_config.bucket}/{measurement_key} -> "
            f"{measurement_csv_path}"
        )

    return FetchedArtifacts(
        codebook_path=codebook_path,
        sim_config_path=sim_config_path,
        measurement_csv_paths=measurement_csv_paths,
    )


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description=(
            "Fetch calibrated sim config YAML, optional calibrated codebook CSV, "
            "and all measurement CSVs referenced by cal.measurements in S3."
        ),
    )
    parser.add_argument(
        "--cal-yaml",
        type=Path,
        required=True,
        help="Calibration YAML with cal.output.folder_key and S3 settings.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Local directory where fetched beamforming artifacts are written.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    try:
        fetch_artifacts(parse_args(argv))
    except (OSError, ValueError) as exc:
        _print_stderr(f"ERROR: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
