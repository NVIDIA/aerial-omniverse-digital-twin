# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import argparse
import importlib
import sys
import types
from pathlib import Path

import numpy as np
import yaml


CLIENT_DIR = Path(__file__).resolve().parents[1]
EXAMPLES_DIR = CLIENT_DIR / "examples"


class FakeTemporalIndex:
    def __init__(self, value):
        self.value = value


class FakeDigitalTwinClient:
    instances = []

    def __init__(self, server_address, force=False):
        self.server_address = server_address
        self.force = force
        self.calls = []
        self.started_yaml = None
        FakeDigitalTwinClient.instances.append(self)

    def start_server_log_streaming(self, log_file_path, min_level):
        self.calls.append(("start_server_log_streaming", log_file_path, min_level))
        return True

    def start(self, yaml_content):
        self.calls.append(("start", yaml_content))
        self.started_yaml = yaml_content
        return True

    def get_status(self):
        self.calls.append(("get_status",))
        return {
            "scenario_loaded": True,
            "num_rus": 2,
            "num_ues": 4,
            "total_batches": 1,
            "is_slot_symbol_mode": True,
            "num_slots_or_timesteps_per_batch": 12,
        }

    def get_ru_positions(self):
        self.calls.append(("get_ru_positions",))
        return [[0.0, 1.0, 2.0], [10.0, 11.0, 12.0]]

    def get_ue_positions(self, batch_index, temporal_index):
        self.calls.append(("get_ue_positions", batch_index, temporal_index.value))
        return [
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0],
            [2.0, 2.0, 2.0],
            [3.0, 3.0, 3.0],
        ]

    def allocate_cirs_memory(
        self, ru_indices, ue_indices_per_ru, is_full_antenna_pair, num_time_steps=None
    ):
        self.calls.append(
            (
                "allocate_cirs_memory",
                list(ru_indices),
                [list(indices) for indices in ue_indices_per_ru],
                is_full_antenna_pair,
                num_time_steps,
            )
        )
        return types.SimpleNamespace(
            num_time_steps=1,
            total_values_bytes=128,
            total_delays_bytes=64,
            ru_indices_per_ts=[list(ru_indices)],
            temporal_indices=[],
        )

    def get_cirs(self, allocation, batch_index, temporal_index):
        self.calls.append(("get_cirs", batch_index, temporal_index.value))
        allocation.temporal_indices = [temporal_index.value]

    def to_numpy(self, allocation, temporal_idx, ru_idx, data_type):
        self.calls.append(("to_numpy", temporal_idx, ru_idx, data_type))
        if data_type == "values":
            return np.ones((1, 1, 1, 1, 1, 1, 1, 1, 2), dtype=np.complex64)
        if data_type == "delays":
            return np.ones((1, 1, 1, 1, 1, 1, 2), dtype=np.float32)
        if data_type in ("angles_of_departure", "angles_of_arrival"):
            return np.ones((1, 1, 1, 1, 1, 1, 2, 2), dtype=np.float32)
        raise ValueError(f"Unknown CIR data_type: {data_type}")

    def to_numpy_all_cir(self, allocation):
        self.calls.append(("to_numpy_all_cir",))
        slot = allocation.temporal_indices[0] if allocation.temporal_indices else 0
        ru = allocation.ru_indices_per_ts[0][0] if allocation.ru_indices_per_ts else 0
        return {
            "values": {slot: {ru: np.ones((1, 1, 1, 1, 1, 1, 1, 1, 2), dtype=np.complex64)}},
            "delays": {slot: {ru: np.ones((1, 1, 1, 1, 1, 1, 2), dtype=np.float32)}},
            "angles_of_departure": {slot: {ru: np.ones((1, 1, 1, 1, 1, 1, 2, 2), dtype=np.float32)}},
            "angles_of_arrival": {slot: {ru: np.ones((1, 1, 1, 1, 1, 1, 2, 2), dtype=np.float32)}},
        }

    def deallocate_cirs_memory(self, allocation):
        self.calls.append(("deallocate_cirs_memory", tuple(allocation.temporal_indices)))

    def stop_server_log_streaming(self):
        self.calls.append(("stop_server_log_streaming",))


def install_fake_dt_client(monkeypatch):
    FakeDigitalTwinClient.instances = []
    fake_module = types.ModuleType("dt_client")
    fake_module.DigitalTwinClient = FakeDigitalTwinClient
    fake_module.SlotIndex = FakeTemporalIndex
    fake_module.SlotIndices = list
    fake_module.TimeStepIndex = FakeTemporalIndex
    fake_module.TimeStepIndices = list
    monkeypatch.setitem(sys.modules, "dt_client", fake_module)
    return fake_module


def import_example_module(monkeypatch, module_name):
    monkeypatch.syspath_prepend(str(EXAMPLES_DIR))
    sys.modules.pop(module_name, None)
    return importlib.import_module(module_name)


def build_example_client_args(tmp_path):
    yaml_file = tmp_path / "scenario.yml"
    yaml_file.write_text("sim:\n  Scenario: {}\n", encoding="utf-8")
    return argparse.Namespace(
        server_address="127.0.0.1:50051",
        import_option="file",
        yaml_file=str(yaml_file),
        scene="unused",
        asset_config=str(EXAMPLES_DIR / "example_client_assets.yml"),
        sim_id="standalone-test",
        s3_endpoint="",
        s3_bucket="aerial-data",
        s3_provider="minio",
        s3_access_key="minioadmin",
        s3_secret_key="minioadmin",
        iceberg_uri="",
        iceberg_catalog_type="rest",
    )


def test_gen_example_yaml_string_returns_expected_sections(monkeypatch):
    install_fake_dt_client(monkeypatch)
    module = import_example_module(monkeypatch, "example_client_yaml_config")

    yaml_content, ret = module.gen_example_yaml_string(
        scene="plateau/tokyo_small.usd",
        asset_config=str(EXAMPLES_DIR / "example_client_assets.yml"),
        output_file="",
        s3=module.S3Args(
            s3_endpoint="http://localhost:9002",
            s3_bucket="aerial-data",
            s3_provider="minio",
            s3_access_key="minioadmin",
            s3_secret_key="minioadmin",
        ),
        iceberg=module.IcebergArgs(),
    )

    assert ret == 0
    assert yaml_content
    assert "sim:" in yaml_content
    assert "db:" in yaml_content
    parsed = yaml.safe_load(yaml_content)
    assert isinstance(parsed, dict)
    assert "sim" in parsed
    assert "db" in parsed


def test_example_client_load_yaml_file_reads_content(monkeypatch, tmp_path):
    install_fake_dt_client(monkeypatch)
    module = import_example_module(monkeypatch, "example_client")
    yaml_file = tmp_path / "sample.yml"
    yaml_file.write_text("hello: world\n", encoding="utf-8")

    assert module.load_yaml_file(str(yaml_file)) == "hello: world\n"


def test_example_client_main_runs_offline_with_fake_client(monkeypatch, tmp_path):
    install_fake_dt_client(monkeypatch)
    module = import_example_module(monkeypatch, "example_client")
    args = build_example_client_args(tmp_path)

    result = module.main(args)

    assert result == 0
    assert FakeDigitalTwinClient.instances
    client = FakeDigitalTwinClient.instances[-1]
    assert client.server_address == args.server_address
    assert client.started_yaml == Path(args.yaml_file).read_text(encoding="utf-8")
    assert ("get_status",) in client.calls
    assert ("get_ru_positions",) in client.calls
    assert ("get_ue_positions", 0, 0) in client.calls
    assert ("get_ue_positions", 0, 5) in client.calls
    assert ("get_ue_positions", 0, 10) in client.calls
    assert ("get_cirs", 0, 5) in client.calls
    assert ("to_numpy", 5, 0, "values") in client.calls
    assert ("to_numpy", 5, 0, "delays") in client.calls
    assert ("to_numpy", 5, 1, "values") in client.calls
    assert ("to_numpy", 5, 1, "delays") in client.calls
    assert ("stop_server_log_streaming",) in client.calls
    assert ("deallocate_cirs_memory", (5,)) in client.calls


def test_integration_example_client_string_uses_example_assets_without_server(monkeypatch):
    install_fake_dt_client(monkeypatch)
    monkeypatch.syspath_prepend(str(CLIENT_DIR / "tests"))
    monkeypatch.setenv("DT_SERVER_ADDRESS", "127.0.0.1:50051")
    sys.modules.pop("test_dt_integration", None)
    sys.modules.pop("example_client", None)
    sys.modules.pop("example_client_yaml_config", None)

    integration_module = importlib.import_module("test_dt_integration")
    integration_module.TestExampleScripts().test_example_client_script_with_string()

    asset_config = EXAMPLES_DIR / "example_client_assets.yml"
    assets = yaml.safe_load(asset_config.read_text(encoding="utf-8"))
    started_yaml = FakeDigitalTwinClient.instances[-1].started_yaml
    for asset_path in assets.values():
        assert asset_path in started_yaml


def test_to_numpy_angles_returns_correct_shape(monkeypatch):
    """to_numpy with angle data types returns float32 arrays with trailing dim 2."""
    install_fake_dt_client(monkeypatch)

    client = FakeDigitalTwinClient("127.0.0.1:50051")
    alloc = client.allocate_cirs_memory([0], [[0, 1]], True, 1)
    client.get_cirs(alloc, 0, FakeTemporalIndex(0))

    aod = client.to_numpy(alloc, 0, 0, "angles_of_departure")
    aoa = client.to_numpy(alloc, 0, 0, "angles_of_arrival")

    assert aod.dtype == np.float32
    assert aoa.dtype == np.float32
    assert aod.shape[-1] == 2, "AOD last dim should be 2 (azimuth, zenith)"
    assert aoa.shape[-1] == 2, "AOA last dim should be 2 (azimuth, zenith)"

    assert ("to_numpy", 0, 0, "angles_of_departure") in client.calls
    assert ("to_numpy", 0, 0, "angles_of_arrival") in client.calls


def test_to_numpy_all_cir_includes_angles(monkeypatch):
    """to_numpy_all_cir returns dict with angles_of_departure and angles_of_arrival keys."""
    install_fake_dt_client(monkeypatch)

    client = FakeDigitalTwinClient("127.0.0.1:50051")
    alloc = client.allocate_cirs_memory([0], [[0]], True, 1)
    client.get_cirs(alloc, 0, FakeTemporalIndex(0))

    cir = client.to_numpy_all_cir(alloc)

    assert "values" in cir
    assert "delays" in cir
    assert "angles_of_departure" in cir
    assert "angles_of_arrival" in cir

    slot = alloc.temporal_indices[0]
    ru = alloc.ru_indices_per_ts[0][0]
    aod = cir["angles_of_departure"][slot][ru]
    aoa = cir["angles_of_arrival"][slot][ru]
    assert aod.dtype == np.float32
    assert aoa.dtype == np.float32
    assert aod.shape[-1] == 2
    assert aoa.shape[-1] == 2
