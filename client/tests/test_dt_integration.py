# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Integration tests for the Digital Twin Client library (dt_client).

Requires a running DT server. Set DT_SERVER_ADDRESS=<host>:<port> before running.

Usage:
  DT_SERVER_ADDRESS=worker:50051 pytest client/tests/test_dt_integration.py -v -s

Use the E2E script (in the worker repo) which handles server setup automatically:
  ./tests/dt_e2e/run_e2e_dt_tests.sh
"""
import argparse
import logging
import os
import sys
from pathlib import Path

import numpy as np
import pytest
import yaml

import dt_client
from dt_client import SlotIndex, SlotIndices, TimeStepIndex, TimeStepIndices

_THIS_DIR = Path(__file__).parent
_EXAMPLES_DIR = _THIS_DIR.parent / "examples"
_EXAMPLE_ASSET_CONFIG = _EXAMPLES_DIR / "example_client_assets.yml"


# ============================================================================
# Client session helper
# ============================================================================

class ClientSessionHelper:
    """Manages a single DT client + scenario. Create once, share across tests,
    release explicitly so the server slot is free for example scripts."""

    def __init__(self):
        self.client = None
        self.status = None
        self._timestep_mode = None  # "slot" or "interval"

    def connect(self):
        address = os.environ.get("DT_SERVER_ADDRESS")
        if not address:
            pytest.skip("DT_SERVER_ADDRESS not set")
        if self.client is not None:
            self.release()
        self.client = dt_client.DigitalTwinClient(address, force=True)
        return self.client

    def ensure_scenario(self, yaml_content: str, mode: str):
        """Connect and load the scenario only if the mode changed or the session was released."""
        if self.client is not None and self._timestep_mode == mode:
            return
        self.connect()
        logging.info(f"[CLIENT] Starting scenario in {mode.upper()} mode...")
        if not self.client.start(yaml_content):
            pytest.fail(
                "client.start() returned False. Scenario failed to load on the server. "
                "Check server logs for errors."
            )
        self.status = self.client.get_status()
        self.status['_timestep_mode'] = mode
        self._timestep_mode = mode
        logging.info(
            f"[CLIENT] Scenario started: is_slot_symbol_mode={self.status.get('is_slot_symbol_mode')}, "
            f"num_slots_or_timesteps_per_batch={self.status.get('num_slots_or_timesteps_per_batch')}"
        )

    def release(self):
        """Destroy the client so the server slot is free."""
        self.client = None
        self.status = None
        self._timestep_mode = None


session = ClientSessionHelper()


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture(scope="module")
def test_yaml_path() -> Path:
    """Path to the integration test scenario YAML.

    When running run_e2e_dt_tests.sh, DT_YAML_PATH points to the mounted
    read-only YAML used by the E2E run. Falls back to client/tests/assets/
    for manual use.
    """
    env_path = os.environ.get("DT_YAML_PATH")
    path = Path(env_path) if env_path else _THIS_DIR / "assets" / "TC_2RU_4UE_4T4R_1sym.yml"
    if not path.exists():
        pytest.skip(f"Test YAML not found: {path}")
    return path


@pytest.fixture(scope="module", params=["slot", "interval"])
def test_yaml_content(request, test_yaml_path) -> tuple[str, str]:
    """Parameterized fixture returning (yaml_content, mode) for slot and interval modes."""
    mode = request.param

    with open(test_yaml_path, 'r') as f:
        config = yaml.safe_load(f)

    scenario_updates = config.get('sim', {}).get('Scenario', {}).get('update', [])
    if scenario_updates:
        scenario_attrs = scenario_updates[0].get('attributes', {})

        if mode == "interval":
            scenario_attrs.pop('sim_slots_per_batch', None)
            scenario_attrs.pop('sim_samples_per_slot', None)
            scenario_attrs['sim_duration'] = 1
            scenario_attrs['sim_interval'] = 0.1
            scenario_attrs['sim_is_full'] = False
            scenario_attrs['sim_simulation_mode'] = 0  # 0 = duration/interval, 1 = slot/symbol
            logging.info("[CLIENT] Configured YAML for INTERVAL mode (duration=1s, interval=0.1s)")
        else:
            logging.info(f"[CLIENT] Using YAML in SLOT mode (slots_per_batch={scenario_attrs.get('sim_slots_per_batch', 'N/A')})")

    return yaml.dump(config), mode


@pytest.fixture(autouse=True)
def test_header(request):
    """Print a header/footer for each test."""
    test_name = request.node.name
    test_class = request.node.parent.name if hasattr(request.node, 'parent') else ""
    logging.info("\n" + "=" * 80)
    logging.info(f"[TEST] {test_class}::{test_name}" if test_class and test_class != test_name else f"[TEST] {test_name}")
    yield
    logging.info(f"[TEST] ✓ Completed: {test_name}")
    logging.info("=" * 80)


@pytest.fixture(autouse=True, scope="module")
def _init_scenario(test_yaml_content):
    """Ensure the session has a running scenario for this module parameterization."""
    yaml_content, mode = test_yaml_content
    session.ensure_scenario(yaml_content, mode)


# ============================================================================
# Helpers
# ============================================================================

def get_temporal_index(index: int, is_slot_mode: bool):
    return SlotIndex(index) if is_slot_mode else TimeStepIndex(index)


def get_temporal_indices(indices: list, is_slot_mode: bool):
    return SlotIndices(indices) if is_slot_mode else TimeStepIndices(indices)


# ============================================================================
# Test Cases
# ============================================================================

class TestDTServerConnection:
    """Test basic server connection."""

    def test_client_can_connect(self):
        """Test that client can connect to the server."""
        assert session.client is not None


class TestScenarioManagement:
    """Test scenario loading and status."""

    def test_start_scenario(self):
        assert session.status is not None
        assert session.status.get("scenario_loaded") is True

    def test_get_status(self):
        status = session.status
        assert isinstance(status, dict)
        assert "scenario_loaded" in status
        assert "num_rus" in status
        assert "num_ues" in status
        assert "total_batches" in status
        assert "is_slot_symbol_mode" in status
        assert "num_slots_or_timesteps_per_batch" in status
        assert status["scenario_loaded"] is True
        assert status["num_rus"] > 0
        assert status["num_ues"] > 0


class TestRUPositions:
    """Test RU position queries."""

    def test_get_ru_positions(self):
        ru_positions = session.client.get_ru_positions()
        assert len(ru_positions) == session.status["num_rus"]
        for pos in ru_positions:
            assert len(pos) == 3
            assert all(isinstance(coord, (int, float)) for coord in pos)


class TestUEPositions:
    """Test UE position queries."""

    def test_get_ue_positions_index_0(self):
        is_slot_mode = session.status['is_slot_symbol_mode']
        ue_positions = session.client.get_ue_positions(
            batch_index=0, temporal_index=get_temporal_index(0, is_slot_mode)
        )
        assert len(ue_positions) == session.status["num_ues"]
        for pos in ue_positions:
            assert len(pos) == 3
            assert all(isinstance(coord, (int, float)) for coord in pos)

    def test_get_ue_positions_multiple_indices(self):
        is_slot_mode = session.status['is_slot_symbol_mode']
        for idx in [0, 5, 9]:
            ue_positions = session.client.get_ue_positions(
                batch_index=0, temporal_index=get_temporal_index(idx, is_slot_mode)
            )
            assert len(ue_positions) == session.status["num_ues"]


class TestMultiTimeStepCIR:
    """Test multi time step CIR operations."""

    def test_multi_timestep_broadcast_style(self):
        """Test CIR allocation and computation for multiple time steps (broadcast style)."""
        client = session.client
        num_rus = session.status["num_rus"]
        num_ues = session.status["num_ues"]
        is_slot_mode = session.status['is_slot_symbol_mode']
        mode_name = "slot" if is_slot_mode else "interval"

        ru_indices = [0, 1] if num_rus >= 2 else [0]
        ue_indices_per_ru = [[0, 1, 2]] * len(ru_indices) if num_ues >= 3 else [[0]] * len(ru_indices)
        num_time_steps = 3

        cir_allocation = client.allocate_cirs_memory(
            ru_indices, ue_indices_per_ru, False, num_time_steps
        )
        assert cir_allocation.num_time_steps == num_time_steps
        assert len(cir_allocation.ru_indices_per_ts) == num_time_steps
        assert cir_allocation.total_values_bytes > 0
        assert cir_allocation.total_delays_bytes > 0

        try:
            indices_to_compute = [0, 2, 4] if not is_slot_mode else [2, 5, 7]
            temporal_indices = get_temporal_indices(indices_to_compute, is_slot_mode)
            client.get_cirs(cir_allocation, batch_index=0, temporal_index=temporal_indices)

            assert len(cir_allocation.temporal_indices) == len(indices_to_compute)
            assert cir_allocation.temporal_indices == indices_to_compute

            for temporal_idx in cir_allocation.temporal_indices:
                for ru_idx in ru_indices:
                    values = client.to_numpy(cir_allocation, temporal_idx, ru_idx, "values")
                    delays = client.to_numpy(cir_allocation, temporal_idx, ru_idx, "delays")
                    assert len(values.shape) == 9, f"CIR values should have 9 dims for {mode_name} {temporal_idx}, RU {ru_idx}"
                    assert len(delays.shape) == 7, f"CIR delays should have 7 dims for {mode_name} {temporal_idx}, RU {ru_idx}"
                    assert np.any(np.abs(values[..., 0]) > 0), "CIR values first tap should be non-zero"
                    assert np.any(delays[..., 0] != 0), "CIR delays first tap should be non-zero"

            cir_data = client.to_numpy_all_cir(cir_allocation)
            assert 'values' in cir_data and 'delays' in cir_data
            for temporal_idx in cir_allocation.temporal_indices:
                assert temporal_idx in cir_data['values']
                assert temporal_idx in cir_data['delays']
                for ru_idx in ru_indices:
                    assert ru_idx in cir_data['values'][temporal_idx]
                    assert ru_idx in cir_data['delays'][temporal_idx]
                    v = cir_data['values'][temporal_idx][ru_idx]
                    d = cir_data['delays'][temporal_idx][ru_idx]
                    assert len(v.shape) == 9 and len(d.shape) == 7
                    assert np.any(np.abs(v[..., 0]) > 0)
        finally:
            client.deallocate_cirs_memory(cir_allocation)

    def test_multi_timestep_per_ts_style(self):
        """Test CIR allocation with per-time-step configuration."""
        client = session.client
        num_rus = session.status["num_rus"]
        num_ues = session.status["num_ues"]
        is_slot_mode = session.status['is_slot_symbol_mode']

        if num_rus < 2 or num_ues < 3:
            pytest.skip("Need at least 2 RUs and 3 UEs for per-time-step test")

        ru_indices_per_ts = [[0, 1], [0, 1], [0, 1]]
        ue_indices_per_ts = [[[0, 1], [0, 2]], [[0, 1, 2], [1]], [[0], [0, 1, 2]]]

        cir_allocation = client.allocate_cirs_memory(ru_indices_per_ts, ue_indices_per_ts, False)
        num_time_steps = len(ru_indices_per_ts)
        assert cir_allocation.num_time_steps == num_time_steps

        try:
            indices_to_compute = [0, 2, 4] if not is_slot_mode else [0, 3, 6]
            temporal_indices = get_temporal_indices(indices_to_compute, is_slot_mode)
            client.get_cirs(cir_allocation, batch_index=0, temporal_index=temporal_indices)
            assert cir_allocation.temporal_indices == indices_to_compute

            cir_data = client.to_numpy_all_cir(cir_allocation)
            for ts_pos, temporal_idx in enumerate(indices_to_compute):
                assert temporal_idx in cir_data['values']
                assert temporal_idx in cir_data['delays']
                for ru_idx in ru_indices_per_ts[ts_pos]:
                    v = cir_data['values'][temporal_idx][ru_idx]
                    d = cir_data['delays'][temporal_idx][ru_idx]
                    assert len(v.shape) == 9 and len(d.shape) == 7
                    assert np.any(np.abs(v[..., 0]) > 0)
        finally:
            client.deallocate_cirs_memory(cir_allocation)


class TestErrorHandling:
    """Test error handling and edge cases."""

    def test_start_invalid_yaml(self, test_yaml_content):
        result = session.client.start("this is not: valid: yaml: content:")
        assert result is False, "Expected start() to return False for invalid YAML"
        yaml_content, _mode = test_yaml_content
        assert session.client.start(yaml_content) is True, "Failed to restore valid scenario"

    def test_get_ue_positions_invalid_temporal_index(self):
        is_slot_mode = session.status['is_slot_symbol_mode']
        with pytest.raises(RuntimeError):
            session.client.get_ue_positions(
                batch_index=0, temporal_index=get_temporal_index(9999, is_slot_mode)
            )


class TestClientWorkflow:
    """Test end-to-end client workflow."""

    def test_example_client_workflow(self, test_yaml_content):
        """Test end-to-end client workflow against a running server."""
        yaml_content, mode = test_yaml_content
        session.ensure_scenario(yaml_content, mode)
        client = session.client
        status = session.status
        assert status['scenario_loaded'] is True

        num_rus = status['num_rus']
        num_ues = status['num_ues']
        is_slot_mode = status['is_slot_symbol_mode']

        ru_positions = client.get_ru_positions()
        assert len(ru_positions) == num_rus
        for pos in ru_positions:
            assert len(pos) == 3

        for idx in ([0, 5] if is_slot_mode else [0, 3]):
            ue_positions = client.get_ue_positions(
                batch_index=0, temporal_index=get_temporal_index(idx, is_slot_mode)
            )
            assert len(ue_positions) == num_ues

        ru_indices = [0, 1] if num_rus >= 2 else [0]
        ue_indices_per_ru = [[0, 1, 2]] * len(ru_indices) if num_ues >= 3 else [[0]] * len(ru_indices)
        cir_allocation = client.allocate_cirs_memory(ru_indices, ue_indices_per_ru, False)
        try:
            client.get_cirs(
                cir_allocation, batch_index=0,
                temporal_index=get_temporal_index(0, is_slot_mode)
            )
            for ru_idx in ru_indices:
                values = client.to_numpy(cir_allocation, 0, ru_idx, "values")
                delays = client.to_numpy(cir_allocation, 0, ru_idx, "delays")
                assert values.size > 0 and delays.size > 0
        finally:
            client.deallocate_cirs_memory(cir_allocation)


class TestExampleScripts:
    """Test example scripts. These create their own client, so no started_scenario needed."""

    def test_gen_example_yaml_string(self):
        """Test gen_example_yaml_string from the examples directory."""
        sys.path.insert(0, str(_EXAMPLES_DIR))
        try:
            from example_client_yaml_config import gen_example_yaml_string, S3Args
        except ImportError as e:
            pytest.fail(f"Failed to import gen_example_yaml_string: {e}")

        s3 = S3Args(
            s3_endpoint=os.environ.get("S3_ENDPOINT", "http://minio:9000"),
            s3_bucket="aerial-data",
            s3_provider="minio",
            s3_access_key="minioadmin",
            s3_secret_key="minioadmin",
        )
        yaml_content, ret = gen_example_yaml_string(
            scene="plateau/tokyo_small.usd",
            asset_config=str(_EXAMPLE_ASSET_CONFIG),
            output_file="",
            s3=s3,
        )
        assert ret == 0
        assert isinstance(yaml_content, str) and len(yaml_content) > 0
        assert 'simulation' in yaml_content.lower() or 'scenario' in yaml_content.lower()

    def test_example_client_script_with_file(self, test_yaml_path):
        """Test running example_client.py with file import option."""
        server_address = os.environ.get("DT_SERVER_ADDRESS")
        if not server_address:
            pytest.skip("DT_SERVER_ADDRESS not set")
        session.release()
        sys.path.insert(0, str(_EXAMPLES_DIR))
        try:
            from example_client import main
        except ImportError as e:
            pytest.fail(f"Failed to import example_client: {e}")

        args = argparse.Namespace(
            server_address=server_address,
            import_option="file",
            yaml_file=str(test_yaml_path),
            scene="NA",
            asset_config=str(_EXAMPLE_ASSET_CONFIG),
        )
        result = main(args)
        assert result == 0, "example_client.py with file option should return 0"

    def test_example_client_script_with_string(self):
        """Test running example_client.py with string import option."""
        server_address = os.environ.get("DT_SERVER_ADDRESS")
        if not server_address:
            pytest.skip("DT_SERVER_ADDRESS not set")
        session.release()
        sys.path.insert(0, str(_EXAMPLES_DIR))
        try:
            from example_client import main
        except ImportError as e:
            pytest.fail(f"Failed to import example_client: {e}")

        args = argparse.Namespace(
            server_address=server_address,
            import_option="string",
            yaml_file="",
            scene="test_data/maps/tokyo",
            asset_config=str(_EXAMPLE_ASSET_CONFIG),
            sim_id="cicd_test_dt_db",
            s3_provider="minio",
            s3_endpoint=os.environ.get("S3_ENDPOINT", "http://minio:9000"),
            s3_bucket="aerial-data",
            s3_access_key="minioadmin",
            s3_secret_key="minioadmin",
            iceberg_catalog_type="rest",
            iceberg_uri=os.environ.get("NESSIE_URI", "http://nessie:19120/iceberg"),
        )
        result = main(args)
        assert result == 0, "example_client.py with string option should return 0"

    def test_example_full_sim_script(self, test_yaml_path):
        """Test running example_full_sim.py with file import option."""
        server_address = os.environ.get("DT_SERVER_ADDRESS")
        if not server_address:
            pytest.skip("DT_SERVER_ADDRESS not set")
        session.release()
        sys.path.insert(0, str(_EXAMPLES_DIR))
        try:
            from example_full_sim import main
        except ImportError as e:
            pytest.fail(f"Failed to import example_full_sim: {e}")

        args = argparse.Namespace(
            server_address=server_address,
            import_option="string",
            yaml_file="",
            scene="test_data/maps/tokyo",
            asset_config=str(_EXAMPLE_ASSET_CONFIG),
            s3_provider="minio",
            s3_endpoint=os.environ.get("S3_ENDPOINT", "http://minio:9000"),
            s3_bucket="aerial-data",
            s3_access_key="minioadmin",
            s3_secret_key="minioadmin",
            iceberg_catalog_type="rest",
            iceberg_uri=os.environ.get("NESSIE_URI", "http://nessie:19120/iceberg"),
        )
        result = main(args)
        assert result == 0, "example_full_sim.py should return 0"

    def test_example_multi_timesteps_script(self, test_yaml_path):
        """Test running example_multi_timesteps.py with string import option."""
        server_address = os.environ.get("DT_SERVER_ADDRESS")
        if not server_address:
            pytest.skip("DT_SERVER_ADDRESS not set")
        session.release()
        sys.path.insert(0, str(_EXAMPLES_DIR))
        try:
            from example_multi_timesteps import main
        except ImportError as e:
            pytest.fail(f"Failed to import example_multi_timesteps: {e}")

        args = argparse.Namespace(
            server_address=server_address,
            import_option="string",
            yaml_file="",
            scene="test_data/maps/tokyo",
            asset_config=str(_EXAMPLE_ASSET_CONFIG),
            s3_provider="minio",
            s3_endpoint=os.environ.get("S3_ENDPOINT", "http://minio:9000"),
            s3_bucket="aerial-data",
            s3_access_key="minioadmin",
            s3_secret_key="minioadmin",
            iceberg_catalog_type="rest",
            iceberg_uri=os.environ.get("NESSIE_URI", "http://nessie:19120/iceberg"),
        )
        result = main(args)
        assert result == 0, "example_multi_timesteps.py should return 0"


class TestRemoteUcxPath:
    """Optional developer smoke test for REMOTE (UCX) data path.

    The normal REMOTE path uses gRPC. Run this only when the server was started
    with AODT_FORCE_UCX=1 or AODT_REMOTE_TRANSPORT=ucx.
    """

    def test_cir_via_ucx_remote_mode(self, test_yaml_content):
        """CIR allocate, compute, to_numpy over REMOTE (UCX); assert mode and data."""
        if not (
            os.environ.get("AODT_FORCE_UCX")
            or os.environ.get("AODT_REMOTE_TRANSPORT") == "ucx"
        ):
            pytest.skip("UCX remote backend not enabled")

        yaml_content, mode = test_yaml_content
        if mode == "interval":
            pytest.skip("UCX path is mode-independent; tested under [slot]")

        address = os.environ.get("DT_SERVER_ADDRESS")
        if not address:
            pytest.skip("DT_SERVER_ADDRESS not set")
        client = dt_client.DigitalTwinClient(address, force=True)
        start_ok = client.start(yaml_content)
        if not start_ok:
            pytest.fail("client.start() returned False for UCX test")

        status = client.get_status()
        assert status.get("scenario_loaded"), "Scenario not loaded"
        assert client.transport_mode == "REMOTE", (
            f"Expected REMOTE transport; got {client.transport_mode}"
        )

        num_rus = status["num_rus"]
        num_ues = status["num_ues"]
        is_slot_mode = status["is_slot_symbol_mode"]

        ru_indices = [0, 1] if num_rus >= 2 else [0]
        ue_indices_per_ru = [[0, 1, 2]] * len(ru_indices) if num_ues >= 3 else [[0]] * len(ru_indices)
        num_time_steps = 3
        indices_to_compute = [2, 5, 7] if is_slot_mode else [0, 2, 4]
        temporal_indices = get_temporal_indices(indices_to_compute, is_slot_mode)

        cir_allocation = client.allocate_cirs_memory(
            ru_indices, ue_indices_per_ru, False, num_time_steps
        )
        try:
            client.get_cirs(cir_allocation, batch_index=0, temporal_index=temporal_indices)
            assert cir_allocation.temporal_indices == indices_to_compute

            for temporal_idx in cir_allocation.temporal_indices:
                for ru_idx in ru_indices:
                    values = client.to_numpy(cir_allocation, temporal_idx, ru_idx, "values")
                    delays = client.to_numpy(cir_allocation, temporal_idx, ru_idx, "delays")
                    assert len(values.shape) == 9
                    assert len(delays.shape) == 7
                    assert np.any(np.abs(values[..., 0]) > 0)
                    assert np.any(delays[..., 0] != 0)

            cir_data = client.to_numpy_all_cir(cir_allocation)
            assert "values" in cir_data and "delays" in cir_data
            for temporal_idx in cir_allocation.temporal_indices:
                for ru_idx in ru_indices:
                    v = cir_data["values"][temporal_idx][ru_idx]
                    d = cir_data["delays"][temporal_idx][ru_idx]
                    assert len(v.shape) == 9 and len(d.shape) == 7
                    assert np.any(np.abs(v[..., 0]) > 0)
                    assert np.any(d[..., 0] != 0)
        finally:
            client.deallocate_cirs_memory(cir_allocation)
