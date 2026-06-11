# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# pylint: disable=too-many-lines

"""Comprehensive tests for aodt.config Python bindings."""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional
import tempfile
import pytest
from omegaconf import OmegaConf
import logging
import sys
import importlib.util

try:
    from _config import (  # type: ignore[attr-defined]
        SimConfig,
        AntennaElement,
        DBTable,
        DiffusionModel,
        GeoTargets,
        Position,
        SimMode,
        Panel,
        Nodes,
        S3Config,
        GPXSource,
    )
except ImportError as e:
    logging.error(f"Import error: {e}")
    logging.error("Make sure config module is built and in PYTHONPATH")
    sys.exit(1)

DEFAULT_SCENE = "test_data/maps/tokyo"


# ==============================================================================
# Helpers — create temp config files for SimConfig constructor
# ==============================================================================


def _assets_yml_text(
    du: str = "assets_1_5/du.json",
    ru: str = "assets_1_5/gnb.json",
    ue: str = "assets_1_5/ue.json",
    materials: str = "assets_1_5/materials.json",
    scatterers: str = "assets_1_5/car_small.json",
    vegetation_materials: str = "assets_1_5/vegetation_materials.json",
    vegetation_assets: str = "assets_1_5/street_tree.json",
    scenario: str = "assets_1_5/scenario.json",
    panels: str = "assets_1_5/panel.json",
) -> str:
    """Create assets.yml fixture text with standard asset paths."""
    return (
        f"du: {du}\n"
        f"ru: {ru}\n"
        f"ue: {ue}\n"
        f"materials: {materials}\n"
        f"scatterers: {scatterers}\n"
        f"vegetation_materials: {vegetation_materials}\n"
        f"vegetation_assets: {vegetation_assets}\n"
        f"scenario: {scenario}\n"
        f"panels: {panels}\n"
    )


def _create_tmp_assets_yml(directory: Path) -> Path:
    """Create a temporary assets.yml with standard asset paths (no home prefix)."""
    assets_file = directory / "assets.yml"
    assets_file.write_text(_assets_yml_text())
    return assets_file


_SHARED_ASSETS_DIR = tempfile.mkdtemp()
_SHARED_ASSETS_YML = str(_create_tmp_assets_yml(Path(_SHARED_ASSETS_DIR)))


def _make_config(
    scene: str = DEFAULT_SCENE,
    mode: SimMode = SimMode.EM,
    asset_config: str = _SHARED_ASSETS_YML,
    tmp_path: Optional[Path] = None,
) -> SimConfig:
    """Create a SimConfig with simulation ID pre-set for testing.

    If asset_config is empty and tmp_path is provided, creates a temporary assets.yml.
    """
    if not asset_config and tmp_path:
        asset_config = str(_create_tmp_assets_yml(tmp_path))
    config = SimConfig(scene, mode, asset_config)
    config.set_simulation_id("test")
    config.set_s3_config(_make_s3_config())
    return config


def _make_s3_config(
    bucket: str = "parquet-export-test",
    provider: str = "minio",
    endpoint_url: str = "http://localhost:9002",
    access_key: str = "",
    secret_key: str = "",
    region: str = "us-east-1",
) -> S3Config:
    """Create an S3Config for config/parquet tests."""
    return S3Config(
        bucket=bucket,
        provider=provider,
        endpoint_url=endpoint_url,
        access_key=access_key,
        secret_key=secret_key,
        region=region,
    )


def _write_import_yaml(tmp_path: Path, data: dict, name: str = "import.yml") -> Path:
    """Write a YAML fixture consumed by SimConfig.from_yaml_file."""
    path = tmp_path / name
    OmegaConf.save(config=data, f=str(path))
    return path


def _minimal_import_yaml_string_with_residual_attr(
    section: str, add_id: int, residual_key: str, residual_value_quoted: str
) -> str:
    """Render a minimal full YAML manually so quoting style is preserved.
    OmegaConf.save reformats scalars and may strip explicit quotes.

    `section` must not be 'DUs' or 'UEs': the template hardcodes empty
    blocks for those, so passing them would emit duplicate top-level keys
    (yaml-cpp would silently use the second one and the residual fixture
    would not take effect)."""
    if section in ("DUs", "UEs"):
        raise ValueError(
            f"section={section!r} collides with hardcoded empty block in template"
        )
    return f"""\
db:
  sim_id: imported_sim
  db_host: clickhouse
  db_port: 9000
  s3_config:
    bucket: maps
    endpoint_url: http://localhost:9002
    provider: minio
    region: us-east-1
gis:
  scene:
    scene_url: maps/imported_scene
  vegetation:
    active: false
    geojson: []
sim:
  Scenario:
    default: assets/scenario.json
    update:
      - attributes:
          sim_is_full: false
          sim_simulation_mode: 0
          sim_batches: 1
          sim_duration: 1.0
          sim_interval: 1.0
          sim_enable_wideband: false
          sim_em_diffuse_type: 0
          sim_em_interactions: 5
          sim_em_max_num_paths_per_ant_pair: 500
          sim_em_rays: 500
          sim_em_fast_mode: false
  DUs:
    default: assets/du.json
    add: []
    update: []
  {section}:
    default: assets/x.json
    add:
      - id: {add_id}
    update:
      - ids: [{add_id}]
        attributes:
          {residual_key}: {residual_value_quoted}
  UEs:
    default: assets/ue.json
    add: []
    update: []
  Materials:
    default: assets/materials.json
  VegetationMaterials:
    default: assets/vegetation_materials.json
  Scatterers:
    default: assets/scatterers.json
"""


def _normalize_yaml_import_tree(value: object, path: tuple[str, ...] = ()) -> object:
    """Normalize order-insensitive YAML sections for semantic comparison."""
    if isinstance(value, dict):
        return {
            key: _normalize_yaml_import_tree(val, path + (str(key),))
            for key, val in sorted(value.items())
        }
    if isinstance(value, list):
        normalized = [_normalize_yaml_import_tree(item, path) for item in value]
        last = path[-1] if path else ""
        if last == "opt_in_tables":
            return sorted(normalized, key=repr)
        if last == "add" and all(isinstance(item, dict) and "id" in item for item in normalized):
            return sorted(normalized, key=lambda item: repr(item["id"]))
        # NOTE: do NOT sort `update` lists. Update order is semantically
        # meaningful (later wins per spec). Sorting here would mask order
        # regressions in the importer. See Implementer Pitfall #3.
        if last == "s3_configs" and all(isinstance(item, dict) for item in normalized):
            return sorted(
                normalized,
                key=lambda item: (
                    repr(item.get("bucket", "")),
                    repr(item.get("endpoint_url", "")),
                    repr(item.get("nodes", [])),
                ),
            )
        return normalized
    return value


def _find_update_by_ids(section: dict, ids: list) -> dict:
    for update in section.get("update", []):
        if update.get("ids") == ids:
            return update["attributes"]
    raise AssertionError(f"Could not find update group with ids={ids}")


def _has_update_attr(section: dict, ids: list, key: str, value: object) -> bool:
    return any(
        update.get("ids") == ids and update.get("attributes", {}).get(key) == value
        for update in section.get("update", [])
    )


def _minimal_import_tree() -> dict:
    """Small complete YAML tree with required top-level sections."""
    return {
        "db": {
            "sim_id": "imported_sim",
            "db_host": "clickhouse",
            "db_port": 9000,
            "s3_config": {
                "bucket": "maps",
                "endpoint_url": "http://localhost:9002",
                "provider": "minio",
                "region": "us-east-1",
            },
        },
        "gis": {
            "scene": {"scene_url": "maps/imported_scene"},
            "vegetation": {"active": False, "geojson": []},
        },
        "sim": {
            "Scenario": {
                "default": "assets/scenario.json",
                "update": [
                    {
                        "attributes": {
                            "sim_is_full": False,
                            "sim_simulation_mode": 0,
                            "sim_batches": 1,
                            "sim_duration": 1.0,
                            "sim_interval": 1.0,
                            "sim_enable_wideband": False,
                            "sim_em_diffuse_type": 0,
                            "sim_em_interactions": 5,
                            "sim_em_max_num_paths_per_ant_pair": 500,
                            "sim_em_rays": 500,
                            "sim_em_fast_mode": False,
                        }
                    }
                ],
            },
            "DUs": {"default": "assets/du.json", "add": [], "update": []},
            "RUs": {"default": "assets/gnb.json", "add": [], "update": []},
            "UEs": {"default": "assets/ue.json", "add": [], "update": []},
            "Materials": {"default": "assets/materials.json"},
            "VegetationMaterials": {"default": "assets/vegetation_materials.json"},
            "Scatterers": {"default": "assets/scatterers.json"},
        },
    }


# ==============================================================================
# Test 1: Unit Tests (Python version of test_aodt_config.cpp)
# ==============================================================================


def _make_serialized_ue_waypoint_pos(position: Position) -> dict:
    """Serialize one UE waypoint and return its pos map."""
    config = _make_config()
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(ue_panel)
    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    ue.add_waypoint(position)
    config.add_ue(ue)
    return config.to_dict()["sim"]["UEs"]["add"][0]["waypoints"][0]["pos"]


@dataclass
class PositionSerializationTestCase:  # type: ignore[misc]
    """Test case for Position serialization."""

    name: str
    create_position: Callable[[], Position]
    expected_pos: Dict[str, float]


POSITION_SERIALIZATION_TEST_CASES = [
    PositionSerializationTestCase(
        name="georef_2d_lat_lon",
        create_position=lambda: Position.georef(35.66, 139.74),
        expected_pos={"lat": 35.66, "lon": 139.74},
    ),
    PositionSerializationTestCase(
        name="georef_3d_alt",
        create_position=lambda: Position.georef(35.66, 139.74, alt=10.0),
        expected_pos={"lat": 35.66, "lon": 139.74, "alt": 10.0},
    ),
    PositionSerializationTestCase(
        name="georef_3d_zero_alt",
        create_position=lambda: Position.georef(35.66, 139.74, alt=0.0),
        expected_pos={"lat": 35.66, "lon": 139.74, "alt": 0.0},
    ),
    PositionSerializationTestCase(
        name="cartesian_2d_xy",
        create_position=lambda: Position.cartesian(1.0, 2.0),
        expected_pos={"x": 1.0, "y": 2.0},
    ),
    PositionSerializationTestCase(
        name="cartesian_3d_xyz",
        create_position=lambda: Position.cartesian(1.0, 2.0, 3.0),
        expected_pos={"x": 1.0, "y": 2.0, "z": 3.0},
    ),
]


@pytest.mark.parametrize(
    "test_case",
    POSITION_SERIALIZATION_TEST_CASES,
    ids=[tc.name for tc in POSITION_SERIALIZATION_TEST_CASES],
)
def test_position_serializes_expected_keys(
    test_case: PositionSerializationTestCase,
) -> None:
    """Test Position emits only the expected coordinate keys."""
    pos = _make_serialized_ue_waypoint_pos(test_case.create_position())

    assert set(pos.keys()) == set(test_case.expected_pos.keys())
    for key, expected_value in test_case.expected_pos.items():
        assert pos[key] == pytest.approx(expected_value)


@dataclass
class PositionUnavailableApiTestCase:  # type: ignore[misc]
    """Test case for removed Position Python API attributes."""

    name: str
    attr_name: str


POSITION_UNAVAILABLE_API_TEST_CASES = [
    PositionUnavailableApiTestCase(name=attr_name, attr_name=attr_name)
    for attr_name in (
        "lat",
        "lon",
        "alt",
        "x",
        "y",
        "z",
        "dim",
        "is_georef",
        "is_cartesian",
    )
]


@pytest.mark.parametrize(
    "test_case",
    POSITION_UNAVAILABLE_API_TEST_CASES,
    ids=[tc.name for tc in POSITION_UNAVAILABLE_API_TEST_CASES],
)
def test_position_python_api_omits_removed_attributes(
    test_case: PositionUnavailableApiTestCase,
) -> None:
    """Test Position omits field/method access from the Python API."""
    pos = Position.georef(35.66, 139.74)

    assert not hasattr(pos, test_case.attr_name)


@dataclass
class PositionConstructorUnavailableTestCase:  # type: ignore[misc]
    """Test case for unavailable Position constructors."""

    name: str
    create_position: Callable[[], Position]


POSITION_CONSTRUCTOR_UNAVAILABLE_TEST_CASES = [
    PositionConstructorUnavailableTestCase(
        name="default_constructor",
        create_position=lambda: Position(),
    ),
]


@pytest.mark.parametrize(
    "test_case",
    POSITION_CONSTRUCTOR_UNAVAILABLE_TEST_CASES,
    ids=[tc.name for tc in POSITION_CONSTRUCTOR_UNAVAILABLE_TEST_CASES],
)
def test_position_python_constructor_unavailable(
    test_case: PositionConstructorUnavailableTestCase,
) -> None:
    """Test Position cannot be constructed directly from Python."""
    with pytest.raises(TypeError):
        test_case.create_position()


@dataclass
class RUPositionSerializationTestCase:  # type: ignore[misc]
    """Test case for RU Position serialization."""

    name: str
    create_position: Callable[[], Position]
    expected_pos: Dict[str, float]


RU_POSITION_SERIALIZATION_TEST_CASES = [
    RUPositionSerializationTestCase(
        name="ru_3d_georef_position",
        create_position=lambda: Position.georef(35.66, 139.74, alt=5.0),
        expected_pos={"lat": 35.66, "lon": 139.74, "alt": 5.0},
    ),
]


@pytest.mark.parametrize(
    "test_case",
    RU_POSITION_SERIALIZATION_TEST_CASES,
    ids=[tc.name for tc in RU_POSITION_SERIALIZATION_TEST_CASES],
)
def test_ru_position_serializes_expected_keys(
    test_case: RUPositionSerializationTestCase,
) -> None:
    """Test RU position emits only the expected coordinate keys."""
    config = _make_config()
    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ru(ru_panel)
    du = Nodes.create_du(du_id=1, frequency_mhz=3600.0)
    du.set_position(Position.cartesian(0, 0, 100))
    ru = Nodes.create_ru(ru_id=1, frequency_mhz=3600.0, du_id=1)
    ru.set_position(test_case.create_position())
    config.add_du(du)
    config.add_ru(ru)

    pos = config.to_dict()["sim"]["RUs"]["add"][0]["position"]["pos"]

    assert set(pos.keys()) == set(test_case.expected_pos.keys())
    for key, expected_value in test_case.expected_pos.items():
        assert pos[key] == pytest.approx(expected_value)


@dataclass
class PanelTestCase:  # type: ignore[misc]
    """Test case for Panel creation."""

    name: str
    antenna_elements: List[AntennaElement]
    frequency: float
    vertical_num: int
    horizontal_num: int
    dual_polarized: bool
    expected_antennas: int


PANEL_TEST_CASES = [
    PanelTestCase(
        name="single_pol_2x1",
        antenna_elements=[AntennaElement.Isotropic],
        frequency=3600,
        vertical_num=2,
        horizontal_num=1,
        dual_polarized=False,
        expected_antennas=2,  # 2 * 1 * 1
    ),
    PanelTestCase(
        name="dual_pol_2x2",
        antenna_elements=[AntennaElement.ThreeGPP38901],
        frequency=3600,
        vertical_num=2,
        horizontal_num=2,
        dual_polarized=True,
        expected_antennas=8,  # 2 * 2 * 2
    ),
    PanelTestCase(
        name="dual_pol_1x2",
        antenna_elements=[AntennaElement.InfinitesimalDipole],
        frequency=3600,
        vertical_num=1,
        horizontal_num=2,
        dual_polarized=True,
        expected_antennas=4,  # 1 * 2 * 2
    ),
]


@pytest.mark.parametrize(
    "test_case", PANEL_TEST_CASES, ids=[tc.name for tc in PANEL_TEST_CASES]
)
def test_panel_num_antennas(test_case: PanelTestCase) -> None:
    """Test Panel antenna calculation."""
    panel = Panel.create_panel(
        antenna_elements=test_case.antenna_elements,
        frequency_mhz=test_case.frequency,
        vertical_spacing=0.5,
        vertical_num=test_case.vertical_num,
        horizontal_spacing=0.5,
        horizontal_num=test_case.horizontal_num,
        dual_polarized=test_case.dual_polarized,
        roll_first=0.0,
        roll_second=90.0,
    )

    assert panel.frequency == test_case.frequency
    assert panel.num_antennas == test_case.expected_antennas
    assert panel.vertical_num_elements == test_case.vertical_num
    assert panel.horizontal_num_elements == test_case.horizontal_num
    assert panel.dual_polarized == test_case.dual_polarized


def test_du_setters() -> None:
    """Test DU setters and properties."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    ru_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.Isotropic],
        frequency_mhz=3600,
        vertical_spacing=0.5,
        vertical_num=1,
        horizontal_spacing=0.5,
        horizontal_num=2,
        dual_polarized=True,
        roll_first=0.0,
        roll_second=90.0,
    )
    config.set_default_panel_ru(ru_panel)  # Assigns panel_02

    du = Nodes.create_du(du_id=1, frequency_mhz=3600, scs_khz=30.0)
    assert du.id() == 1
    assert du.frequency() == 3600

    du.set_position(Position.cartesian(0, 0, 100))
    du.set_fft_size(4096)
    du.set_max_channel_bandwidth(100.0)

    # Verify setters worked (position is verifiable via subsequent operations)
    config.add_du(du)


def test_ru_setters() -> None:
    """Test RU setters and properties."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    ru_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.Isotropic],
        frequency_mhz=3600,
        vertical_spacing=0.5,
        vertical_num=1,
        horizontal_spacing=0.5,
        horizontal_num=2,
        dual_polarized=True,
        roll_first=0.0,
        roll_second=90.0,
    )
    config.set_default_panel_ru(ru_panel)  # Assigns panel_02

    du = Nodes.create_du(du_id=1, frequency_mhz=3600, scs_khz=30.0)
    du.set_position(Position.cartesian(0, 0, 100))
    config.add_du(du)

    ru = Nodes.create_ru(ru_id=1, frequency_mhz=3600, radiated_power_dbm=43.0, du_id=1)
    assert ru.id() == 1
    assert ru.frequency() == 3600
    assert ru.du_id() == 1

    ru.set_position(Position.georef(35.66, 139.74))
    ru.set_height(2.5)
    ru.set_mech_azimuth(0.0)
    ru.set_mech_tilt(0.0)

    config.add_ru(ru)


def test_ru_ue_former_hardcoded_fields_are_editable_and_emitted() -> None:
    config = _make_config()
    panel_ru = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ru(panel_ru)
    panel_ue = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(panel_ue)

    du = Nodes.create_du(du_id=1, frequency_mhz=3600)
    du.set_position(Position.cartesian(0, 0, 10))
    config.add_du(du)

    ru = Nodes.create_ru(ru_id=1, frequency_mhz=3600, du_id=1)
    ru.set_position(Position.georef(35.0, 139.0))
    ru.set_du_manual_assign(False)
    config.add_ru(ru)

    ue = Nodes.create_ue(ue_id=1)
    ue.add_waypoint(Position.georef(35.0, 139.0))
    ue.set_initial_mech_azimuth(12.5)
    ue.set_mech_tilt(6.5)
    config.add_ue(ue)

    d = config.to_dict()
    ru_attrs = d["sim"]["RUs"]["update"][0]["attributes"]
    ue_attrs = d["sim"]["UEs"]["update"][0]["attributes"]
    assert ru_attrs["aerial_gnb_du_manual_assign"] is False
    assert ue_attrs["aerial_ue_initial_mech_azimuth"] == 12.5
    assert ue_attrs["aerial_ue_mech_tilt"] == 6.5


def test_ue_waypoints() -> None:
    """Test UE waypoint addition."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    ue_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.Isotropic],
        frequency_mhz=3600,
    )
    config.set_default_panel_ue(ue_panel)

    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    assert ue.id() == 1
    assert len(ue.waypoints()) == 0

    ue.add_waypoint(Position.georef(35.66, 139.74))
    ue.add_waypoint(Position.georef(35.67, 139.75))

    assert len(ue.waypoints()) == 2

    config.add_ue(ue)


def test_ue_waypoints_with_params() -> None:
    """Test UE waypoint addition with speed, pause, and azimuth."""
    config = _make_config()
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(ue_panel)

    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    ue.add_waypoint(
        Position.georef(35.66, 139.74),
        speed=1.5,
        pause_duration=2.0,
        azimuth_offset=45.0,
    )
    ue.add_waypoint(Position.georef(35.67, 139.75))  # defaults

    assert len(ue.waypoints()) == 2
    wp0 = ue.waypoints()[0]
    assert wp0.speed == 1.5
    assert wp0.pauseDuration == 2.0
    assert wp0.azimuthOffset == 45.0
    assert not hasattr(wp0, "arrivalTime")

    wp1 = ue.waypoints()[1]
    assert wp1.speed == 0.0
    assert wp1.pauseDuration == 0.0
    assert wp1.azimuthOffset == 0.0
    assert not hasattr(wp1, "arrivalTime")

    config.add_ue(ue)

    config_dict = config.to_dict()
    waypoints = config_dict["sim"]["UEs"]["add"][0]["waypoints"]
    assert len(waypoints) == 2
    assert waypoints[0]["speed"] == 1.5
    assert waypoints[0]["pause_duration"] == 2.0
    assert waypoints[0]["azimuth_offset"] == 45.0
    assert "arrival_time" not in waypoints[0]
    assert waypoints[0]["pos"]["lat"] == 35.66
    assert waypoints[0]["pos"]["lon"] == 139.74
    assert waypoints[1]["speed"] == 0.0
    assert "arrival_time" not in waypoints[1]


def test_ue_add_waypoint_rejects_removed_arrival_time_keyword() -> None:
    """arrival_time is no longer part of the public add_waypoint API."""
    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)

    with pytest.raises(TypeError):
        ue.add_waypoint(
            Position.georef(35.66, 139.74),
            arrival_time=10.0,
        )


@dataclass
class UEWaypointSerializationTestCase:  # type: ignore[misc]
    """Test case for UE waypoint serialization."""

    name: str
    create_waypoints: Callable[[], List[Position]]
    expected_positions: List[Dict[str, float]]


TEST_CASES_UE_WAYPOINT_SERIALIZATION = [
    UEWaypointSerializationTestCase(
        name="georef_3d_alt",
        create_waypoints=lambda: [
            Position.georef(35.66, 139.74, alt=10.0),
            Position.georef(35.67, 139.75, alt=12.0),
        ],
        expected_positions=[
            {"lat": 35.66, "lon": 139.74, "alt": 10.0},
            {"lat": 35.67, "lon": 139.75, "alt": 12.0},
        ],
    ),
    UEWaypointSerializationTestCase(
        name="cartesian_3d_xyz",
        create_waypoints=lambda: [
            Position.cartesian(1.0, 2.0, 3.0),
            Position.cartesian(4.0, 5.0, 6.0),
        ],
        expected_positions=[
            {"x": 1.0, "y": 2.0, "z": 3.0},
            {"x": 4.0, "y": 5.0, "z": 6.0},
        ],
    ),
    UEWaypointSerializationTestCase(
        name="cartesian_2d_xy",
        create_waypoints=lambda: [
            Position.cartesian(1.0, 2.0),
            Position.cartesian(3.0, 4.0),
        ],
        expected_positions=[
            {"x": 1.0, "y": 2.0},
            {"x": 3.0, "y": 4.0},
        ],
    ),
]


@dataclass
class UEWaypointDimMismatchTestCase:  # type: ignore[misc]
    """Test case for UE waypoint dimension mismatch rejection."""

    name: str
    ue_id: int
    create_first_position: Callable[[], Position]
    create_rejected_position: Callable[[], Position]
    expected_existing_dim: int
    expected_rejected_dim: int


TEST_CASES_UE_WAYPOINT_DIM_MISMATCH = [
    UEWaypointDimMismatchTestCase(
        name="georef_2d_then_3d",
        ue_id=7,
        create_first_position=lambda: Position.georef(35.66, 139.74),
        create_rejected_position=lambda: Position.georef(35.67, 139.75, alt=10.0),
        expected_existing_dim=2,
        expected_rejected_dim=3,
    ),
]


@pytest.mark.parametrize(
    "test_case",
    TEST_CASES_UE_WAYPOINT_SERIALIZATION,
    ids=[tc.name for tc in TEST_CASES_UE_WAYPOINT_SERIALIZATION],
)
def test_ue_waypoints_serialize_dim_and_keys(
    test_case: UEWaypointSerializationTestCase,
) -> None:
    """Test UE waypoints track dimension and serialize expected coordinate keys."""
    config = _make_config()
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(ue_panel)
    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)

    for waypoint in test_case.create_waypoints():
        ue.add_waypoint(waypoint)

    assert len(ue.waypoints()) == len(test_case.expected_positions)

    config.add_ue(ue)
    d = config.to_dict()
    waypoints = d["sim"]["UEs"]["add"][0]["waypoints"]
    assert len(waypoints) == len(test_case.expected_positions)

    for waypoint, expected_pos in zip(waypoints, test_case.expected_positions):
        assert set(waypoint.keys()) == {
            "pos",
            "speed",
            "pause_duration",
            "azimuth_offset",
        }
        pos = waypoint["pos"]
        assert set(pos.keys()) == set(expected_pos.keys())
        for key, expected_value in expected_pos.items():
            assert pos[key] == pytest.approx(expected_value)


@pytest.mark.parametrize(
    "test_case",
    TEST_CASES_UE_WAYPOINT_DIM_MISMATCH,
    ids=[tc.name for tc in TEST_CASES_UE_WAYPOINT_DIM_MISMATCH],
)
def test_ue_waypoints_dim_mismatch_rejected(
    test_case: UEWaypointDimMismatchTestCase,
) -> None:
    """Test UE rejects mixed 2D/3D waypoint dimensions."""
    ue = Nodes.create_ue(ue_id=test_case.ue_id)
    ue.add_waypoint(test_case.create_first_position())

    with pytest.raises(ValueError) as exc_info:
        ue.add_waypoint(test_case.create_rejected_position())

    message = str(exc_info.value)
    assert str(test_case.ue_id) in message
    assert str(test_case.expected_existing_dim) in message
    assert str(test_case.expected_rejected_dim) in message


@dataclass
class UEUnavailableApiTestCase:  # type: ignore[misc]
    """Test case for removed UE Python API attributes."""

    name: str
    attr_name: str


UE_UNAVAILABLE_API_TEST_CASES = [
    UEUnavailableApiTestCase(name=attr_name, attr_name=attr_name)
    for attr_name in ("wp_dim",)
]


@pytest.mark.parametrize(
    "test_case",
    UE_UNAVAILABLE_API_TEST_CASES,
    ids=[tc.name for tc in UE_UNAVAILABLE_API_TEST_CASES],
)
def test_ue_python_api_omits_removed_attributes(
    test_case: UEUnavailableApiTestCase,
) -> None:
    """Test UE omits field/method access from the Python API."""
    ue = Nodes.create_ue(ue_id=1)

    assert not hasattr(ue, test_case.attr_name)


def test_add_ues_from_gpx() -> None:
    """Test bulk GPX UE creation via add_ues_from_gpx."""
    config = _make_config()
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(ue_panel)
    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ru(ru_panel)

    du = Nodes.create_du(du_id=1, frequency_mhz=3600)
    du.set_position(Position.cartesian(0, 0, 100))
    config.add_du(du)

    ru = Nodes.create_ru(ru_id=1, frequency_mhz=3600, du_id=1)
    ru.set_position(Position.georef(35.66, 139.74))
    config.add_ru(ru)

    config.add_ues_from_gpx("/path/to/route.gpx", [1, 2, 3], use_pathfinding=True)

    # Verify UEs were created
    config_dict = config.to_dict()
    ues_add = config_dict["sim"]["UEs"]["add"]
    assert len(ues_add) == 3

    # Each UE should have gpx, not waypoints
    for ue_add in ues_add:
        assert "gpx" in ue_add
        assert ue_add["gpx"]["src"] == "/path/to/route.gpx"
        assert ue_add["gpx"]["use_pathfinding"] is True
        assert "waypoints" not in ue_add  # GPX UEs don't have manual waypoints

    # Post-add customization via get_ue
    ue1 = config.get_ue(1)
    ue1.set_radiated_power(30.0)
    assert ue1.radiated_power_dbm() == 30.0


def test_add_ues_from_gpx_errors() -> None:
    """Test add_ues_from_gpx validation."""
    config = _make_config()
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(panel)

    # Empty GPX source
    with pytest.raises(ValueError, match="GPX source path must not be empty"):
        config.add_ues_from_gpx("", [1])

    # Empty UE ID list
    with pytest.raises(ValueError, match="UE ID list must not be empty"):
        config.add_ues_from_gpx("/path.gpx", [])

    # Duplicate IDs in list
    with pytest.raises(ValueError, match="Duplicate UE IDs"):
        config.add_ues_from_gpx("/path.gpx", [1, 1])

    # Conflict with existing UE
    ue = Nodes.create_ue(ue_id=5)
    ue.add_waypoint(Position.georef(1, 1))
    config.add_ue(ue)
    with pytest.raises(RuntimeError, match="UE with ID 5 already exists"):
        config.add_ues_from_gpx("/path.gpx", [5, 6])


def test_get_du_ru_panel() -> None:
    """Test mutable accessor methods get_du, get_ru, get_panel."""
    config = _make_config()

    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ru(ru_panel)
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(ue_panel)

    du = Nodes.create_du(du_id=1, frequency_mhz=3600)
    du.set_position(Position.cartesian(0, 0, 100))
    config.add_du(du)

    ru = Nodes.create_ru(ru_id=1, frequency_mhz=3600, du_id=1)
    ru.set_position(Position.georef(35.66, 139.74))
    config.add_ru(ru)

    ue = Nodes.create_ue(ue_id=1)
    ue.add_waypoint(Position.georef(1, 1))
    config.add_ue(ue)

    # Mutate via accessor
    config.get_du(1).set_fft_size(2048)
    config.get_ru(1).set_radiated_power(50.0)
    config.get_ue(1).set_radiated_power(30.0)

    # Verify changes reflected in output
    config_dict = config.to_dict()
    du_attrs = config_dict["sim"]["DUs"]["update"][0]["attributes"]
    assert du_attrs["aerial_du_fft_size"] == 2048

    ru_attrs = config_dict["sim"]["RUs"]["update"][0]["attributes"]
    assert ru_attrs["aerial_gnb_radiated_power"] == 50.0

    ue_attrs = config_dict["sim"]["UEs"]["update"][0]["attributes"]
    assert ue_attrs["aerial_ue_radiated_power"] == 30.0

    # Test accessor for non-existent ID
    with pytest.raises(RuntimeError, match="UE with ID 999 not found"):
        config.get_ue(999)
    with pytest.raises(RuntimeError, match="RU with ID 999 not found"):
        config.get_ru(999)
    with pytest.raises(RuntimeError, match="DU with ID 999 not found"):
        config.get_du(999)
    with pytest.raises(RuntimeError, match="Panel with ID 999 not found"):
        config.get_panel(999)


def test_ue_with_gpx_source() -> None:
    """Test UE creation with GPX source instead of waypoints."""
    config = _make_config()
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(panel)

    ue = Nodes.create_ue(ue_id=1)
    gpx = GPXSource()
    gpx.src = "/path/to/route.gpx"
    gpx.usePathfinding = False
    ue.set_gpx_source(gpx)

    assert ue.has_gpx()
    assert ue.gpx_source().src == "/path/to/route.gpx"
    assert ue.gpx_source().usePathfinding is False

    config.add_ue(ue)  # Should succeed — GPX counts as valid

    config_dict = config.to_dict()
    ue_add = config_dict["sim"]["UEs"]["add"][0]
    assert "gpx" in ue_add
    assert ue_add["gpx"]["src"] == "/path/to/route.gpx"
    assert ue_add["gpx"]["use_pathfinding"] is False
    assert "waypoints" not in ue_add


@dataclass
class ValidationTestCase:
    """Test case for validation errors."""

    name: str
    test_func: str  # Function to test
    should_raise: bool
    exception_type: type


def test_validation_ru_without_panel() -> None:
    """Test that RU creation fails without default panel set."""
    with pytest.raises(
        RuntimeError, match=r"Panel ID '2' not found. Add the panel first"
    ):
        config = _make_config(DEFAULT_SCENE, SimMode.EM)
        # Don't set default panel
        ru = Nodes.create_ru(ru_id=1)
        config.add_ru(ru)  # Should throw


def test_validation_ue_without_waypoints() -> None:
    """Test that UE addition fails without waypoints."""
    with pytest.raises(RuntimeError, match="at least one waypoint"):
        config = _make_config(DEFAULT_SCENE, SimMode.EM)
        panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
        config.set_default_panel_ue(panel)
        ue = Nodes.create_ue(ue_id=1)
        config.add_ue(ue)  # Should throw - no waypoints


def test_validation_du_without_panel() -> None:
    """Test that DU creation fails without default RU panel."""
    with pytest.raises(RuntimeError, match="Default RU panel.*not found"):
        config = _make_config(DEFAULT_SCENE, SimMode.EM)
        # Don't set default panel
        du = Nodes.create_du(du_id=1)
        config.add_du(du)  # Should throw


# ==============================================================================
# Test 2: Asset Loading Tests (Python version of test_asset_loading.cpp)
# ==============================================================================


@dataclass
class AssetLoadingTestCase:
    """Test case for asset loading."""

    name: str
    asset_path: Optional[str]
    should_succeed: bool


ASSET_LOADING_TEST_CASES = [
    AssetLoadingTestCase(
        name="load_from_assets_yml",
        asset_path="assets.yml",
        should_succeed=True,
    ),
    AssetLoadingTestCase(
        name="empty_path_raises",
        asset_path="",
        should_succeed=False,
    ),
]


@pytest.mark.parametrize(
    "test_case",
    ASSET_LOADING_TEST_CASES,
    ids=[tc.name for tc in ASSET_LOADING_TEST_CASES],
)
def test_asset_loading(test_case: AssetLoadingTestCase, tmp_path: Path) -> None:
    """Test asset loading — assets.yml is required, empty path raises."""
    if test_case.asset_path == "assets.yml":
        assets_file = _create_tmp_assets_yml(tmp_path)
        asset_path = str(assets_file)
    else:
        asset_path = test_case.asset_path

    if test_case.should_succeed:
        config = SimConfig(DEFAULT_SCENE, SimMode.EM, asset_path)
        assert config is not None
    else:
        with pytest.raises(RuntimeError):
            SimConfig(DEFAULT_SCENE, SimMode.EM, asset_path)


def test_asset_loading_rejects_missing_vegetation_assets(tmp_path: Path) -> None:
    """assets.yml must include the required vegetation_assets scalar key."""
    assets_file = tmp_path / "assets_missing_vegetation_assets.yml"
    assets_file.write_text(
        "du: assets_1_5/du.json\n"
        "ru: assets_1_5/gnb.json\n"
        "ue: assets_1_5/ue.json\n"
        "materials: assets_1_5/materials.json\n"
        "scatterers: assets_1_5/car_small.json\n"
        "vegetation_materials: assets_1_5/vegetation_materials.json\n"
        "scenario: assets_1_5/scenario.json\n"
        "panels: assets_1_5/panel.json\n"
    )

    with pytest.raises(RuntimeError, match="vegetation_assets"):
        SimConfig(DEFAULT_SCENE, SimMode.EM, str(assets_file))


@pytest.mark.parametrize(
    "asset_key",
    [
        "du",
        "ru",
        "ue",
        "materials",
        "scatterers",
        "vegetation_materials",
        "vegetation_assets",
        "scenario",
        "panels",
    ],
)
def test_asset_loading_rejects_non_json_asset_paths(
    asset_key: str, tmp_path: Path
) -> None:
    """All asset file entries must point at .json files."""
    non_json_asset_path = "assets_1_5/not_json.txt"
    assets_yml_by_invalid_key = {
        "du": _assets_yml_text(du=non_json_asset_path),
        "ru": _assets_yml_text(ru=non_json_asset_path),
        "ue": _assets_yml_text(ue=non_json_asset_path),
        "materials": _assets_yml_text(materials=non_json_asset_path),
        "scatterers": _assets_yml_text(scatterers=non_json_asset_path),
        "vegetation_materials": _assets_yml_text(
            vegetation_materials=non_json_asset_path
        ),
        "vegetation_assets": _assets_yml_text(vegetation_assets=non_json_asset_path),
        "scenario": _assets_yml_text(scenario=non_json_asset_path),
        "panels": _assets_yml_text(panels=non_json_asset_path),
    }
    assets_file = tmp_path / "assets_non_json.yml"
    assets_file.write_text(assets_yml_by_invalid_key[asset_key])

    with pytest.raises(RuntimeError, match=rf"{asset_key}.*\.json"):
        SimConfig(DEFAULT_SCENE, SimMode.EM, str(assets_file))


def test_asset_paths_written_as_is(tmp_path: Path) -> None:
    """Asset paths from assets.yml are used as-is — no home prefix prepended."""
    assets_file = _create_tmp_assets_yml(tmp_path)
    config = SimConfig(DEFAULT_SCENE, SimMode.EM, str(assets_file))
    config.set_simulation_id("test")
    config.set_s3_config(_make_s3_config())
    d = config.to_dict()
    assert d["sim"]["DUs"]["default"] == "assets_1_5/du.json"
    assert d["sim"]["RUs"]["default"] == "assets_1_5/gnb.json"
    assert d["sim"]["Scatterers"]["default"] == "assets_1_5/car_small.json"


def test_scene_url_used_as_is(tmp_path: Path) -> None:
    """Scene URL is stored exactly as provided — no prefix prepending."""
    config = _make_config(scene="test_data/maps/tokyo", tmp_path=tmp_path)
    d = config.to_dict()
    assert d["gis"]["scene"]["scene_url"] == "test_data/maps/tokyo"


def test_scene_url_local_path_as_is(tmp_path: Path) -> None:
    """Local absolute scene path is stored as-is."""
    scene = "/local/test_data/maps/tokyo/sim/master.usd"
    config = _make_config(scene, tmp_path=tmp_path)
    config_dict = config.to_dict()
    assert config_dict["gis"]["scene"]["scene_url"] == scene


def test_from_yaml_file_public_factory_exists(tmp_path: Path) -> None:
    """SimConfig.from_yaml_file should load a complete YAML file without assets.yml."""
    path = _write_import_yaml(tmp_path, _minimal_import_tree())

    cfg = SimConfig.from_yaml_file(str(path))

    out = cfg.to_dict()
    assert out["db"]["sim_id"] == "imported_sim"
    assert out["gis"]["scene"]["scene_url"] == "maps/imported_scene"
    assert out["sim"]["Scenario"]["default"] == "assets/scenario.json"


def test_from_yaml_file_missing_file_raises(tmp_path: Path) -> None:
    """Missing import file should raise a useful error."""
    missing = tmp_path / "missing.yml"

    with pytest.raises(RuntimeError, match="Failed to open YAML file"):
        SimConfig.from_yaml_file(str(missing))


def test_from_yaml_file_rejects_missing_required_root_sections(tmp_path: Path) -> None:
    path = _write_import_yaml(tmp_path, {"db": {}}, "missing_sections.yml")

    with pytest.raises(RuntimeError, match="required top-level section 'sim'"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_non_map_root(tmp_path: Path) -> None:
    path = tmp_path / "list_root.yml"
    path.write_text("- not\n- a\n- map\n")

    with pytest.raises(RuntimeError, match=r"Expected map at \$"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_imports_db_full_shape_and_clears_missing_defaults(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["db"].update(
        {
            "sim_id": "db_import",
            "db_host": "db.example",
            "db_port": 19000,
            "db_author": "importer",
            "db_notes": "loaded from YAML",
            "opt_in_tables": ["cirs", "telemetry"],
            "s3_config": {
                "bucket": "global-bucket",
                "endpoint_url": "http://minio:9000",
                "provider": "minio",
                "region": "us-west-2",
                "access_key": "ak",
                "secret_key": "sk",
            },
            "parquet_export": {
                "max_workers": 4,
                "compression": "snappy",
                "timesteps_per_file": 32,
                "verify_exports": False,
                "s3_configs": [
                    {
                        "bucket": "parquet-bucket",
                        "endpoint_url": "http://parquet:9000",
                        "provider": "minio",
                        "region": "us-east-2",
                        "access_key": "pak",
                        "secret_key": "psk",
                        "nodes": ["node-a", "node-b"],
                        "use_ssl": True,
                    }
                ],
                "iceberg": {
                    "catalog_type": "rest",
                    "catalog_uri": "http://iceberg:8181",
                    "catalog_name": "prod",
                    "aws_region": "us-east-2",
                    "nessie_ref": "main",
                },
            },
        }
    )
    data["db"].pop("opt_in_tables_options", None)
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path)).to_dict()

    assert cfg["db"]["sim_id"] == "db_import"
    assert cfg["db"]["db_host"] == "db.example"
    assert cfg["db"]["db_port"] == 19000
    assert cfg["db"]["db_author"] == "importer"
    assert cfg["db"]["db_notes"] == "loaded from YAML"
    assert sorted(cfg["db"]["opt_in_tables"]) == ["cirs", "telemetry"]
    assert "opt_in_tables_options" not in cfg["db"]
    assert cfg["db"]["s3_config"]["bucket"] == "global-bucket"
    assert cfg["db"]["s3_config"]["access_key"] == "ak"
    assert cfg["db"]["parquet_export"]["max_workers"] == 4
    assert cfg["db"]["parquet_export"]["compression"] == "snappy"
    assert cfg["db"]["parquet_export"]["timesteps_per_file"] == 32
    assert cfg["db"]["parquet_export"]["verify_exports"] is False
    assert cfg["db"]["parquet_export"]["s3_configs"][0]["nodes"] == ["node-a", "node-b"]
    assert cfg["db"]["parquet_export"]["iceberg"]["catalog_type"] == "rest"


def test_from_yaml_file_defaults_missing_global_s3_region(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["db"]["s3_config"].pop("region")
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()

    assert out["db"]["s3_config"]["region"] == "us-east-1"


def test_from_yaml_file_defaults_missing_parquet_s3_region_and_nodes(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    data["db"]["parquet_export"] = {
        "max_workers": 2,
        "compression": "zstd",
        "timesteps_per_file": 100,
        "verify_exports": True,
        "s3_configs": [
            {
                "bucket": "parquet-bucket",
                "endpoint_url": "http://parquet:9000",
                "provider": "minio",
            }
        ]
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()
    s3 = out["db"]["parquet_export"]["s3_configs"][0]

    assert s3["region"] == "us-east-1"
    assert s3["nodes"] == ["node1"]
    assert s3["use_ssl"] is False


def test_from_yaml_file_defaults_missing_parquet_export_scalars(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    data["db"]["parquet_export"] = {
        "s3_configs": [
            {
                "bucket": "parquet-bucket",
                "endpoint_url": "http://parquet:9000",
                "provider": "minio",
                "region": "us-east-1",
                "nodes": ["node1"],
                "use_ssl": False,
            }
        ]
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()
    parquet = out["db"]["parquet_export"]

    assert parquet["max_workers"] == 2
    assert parquet["compression"] == "zstd"
    assert parquet["timesteps_per_file"] == 100
    assert parquet["verify_exports"] is True


def test_from_yaml_file_rejects_parquet_export_without_s3_configs(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    data["db"]["parquet_export"] = {
        "max_workers": 2,
        "compression": "zstd",
        "timesteps_per_file": 100,
        "verify_exports": True,
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="parquet_export.s3_configs"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_imports_gis_scene_vegetation_spawn_and_bbox(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["gis"] = {
        "scene": {"scene_url": "maps/ginza"},
        "vegetation": {
            "active": True,
            "vegetation_asset_path": ["assets/street_tree.json"],
            "geojson": ["maps/ginza/veg.geojson"],
        },
        "spawn_zone": {
            "points_ccw": [
                {"lat": 35.0, "lon": 139.0},
                {"lat": 35.1, "lon": 139.0},
                {"lat": 35.1, "lon": 139.1},
            ]
        },
        "bbox_window": [
            {"x": 0.0, "y": 0.0},
            {"x": 10.0, "y": 20.0},
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path)).to_dict()

    assert cfg["gis"]["scene"]["scene_url"] == "maps/ginza"
    assert cfg["gis"]["vegetation"]["active"] is True
    assert cfg["gis"]["vegetation"]["vegetation_asset_path"] == [
        "assets/street_tree.json"
    ]
    assert cfg["gis"]["vegetation"]["geojson"] == ["maps/ginza/veg.geojson"]
    assert len(cfg["gis"]["spawn_zone"]["points_ccw"]) == 3
    assert cfg["gis"]["bbox_window"] == [{"x": 0.0, "y": 0.0}, {"x": 10.0, "y": 20.0}]


@pytest.mark.parametrize(
    ("field_path", "value"),
    [
        ("spawn_zone", {"points_ccw": [{"lat": 35.0, "lon": 139.0, "alt": 1.0}]}),
        ("bbox_window", [{"x": 0.0, "y": 0.0, "z": 1.0}]),
    ],
    ids=["spawn_zone_3d_alt", "bbox_window_3d_z"],
)
def test_from_yaml_file_rejects_3d_gis_2d_only_fields(tmp_path: Path, field_path: str, value: object) -> None:
    data = _minimal_import_tree()
    data["gis"][field_path] = value
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="must be 2D"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_position_mixing_georef_and_cartesian_keys(tmp_path: Path) -> None:
    """A position map containing both lat/lon and x/y must be rejected,
    not silently take one family while discarding the other."""
    data = _minimal_import_tree()
    data["gis"]["spawn_zone"] = {
        "points_ccw": [
            {"lat": 35.0, "lon": 139.0, "x": 0.0, "y": 0.0},
        ]
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="mixes georef .* and cartesian"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_multiple_vegetation_geojson_entries_for_v1(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["gis"]["vegetation"] = {
        "active": True,
        "geojson": ["a.geojson", "b.geojson"],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="vegetation.geojson supports at most one entry"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_multiple_vegetation_asset_path_entries_for_v1(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    data["gis"]["vegetation"] = {
        "active": True,
        "vegetation_asset_path": ["assets/tree_a.json", "assets/tree_b.json"],
        "geojson": ["maps/imported_scene/sim/vegetation.geojson"],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(
        RuntimeError,
        match="vegetation_asset_path supports at most one entry",
    ):
        SimConfig.from_yaml_file(str(path))


@pytest.mark.parametrize(
    "vegetation_asset_path",
    ["assets/tree.txt", ""],
    ids=["txt_file", "empty_path"],
)
def test_from_yaml_file_rejects_non_json_vegetation_asset_path(
    vegetation_asset_path: str,
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    data["gis"]["vegetation"] = {
        "active": True,
        "vegetation_asset_path": [vegetation_asset_path],
        "geojson": ["maps/imported_scene/sim/vegetation.geojson"],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match=r"vegetation_asset_path.*\.json"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_preserves_inactive_vegetation_asset_path(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    data["gis"]["vegetation"] = {
        "active": False,
        "vegetation_asset_path": ["assets/street_tree.json"],
        "geojson": [],
    }
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path)).to_dict()

    assert cfg["gis"]["vegetation"]["active"] is False
    assert cfg["gis"]["vegetation"]["vegetation_asset_path"] == [
        "assets/street_tree.json"
    ]


def test_from_yaml_file_rejects_active_vegetation_without_asset_path(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    data["gis"]["vegetation"] = {
        "active": True,
        "geojson": ["maps/imported_scene/sim/vegetation.geojson"],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="no vegetation asset path"):
        SimConfig.from_yaml_file(str(path)).to_dict()


def test_from_yaml_file_imports_scenario_and_infers_mode_from_sim_is_full(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    attrs = data["sim"]["Scenario"]["update"][0]["attributes"]
    attrs.update(
        {
            "sim_is_full": False,
            "sim_simulation_mode": 1,
            "sim_batches": 3,
            "sim_slots_per_batch": 2,
            "sim_samples_per_slot": 14,
            "sim_is_seeded": True,
            "sim_seed": 123,
            "sim_enable_wideband": True,
            "sim_em_fast_mode": True,
            "custom_scenario_key": "keep-me",
        }
    )
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path))
    cfg.set_timeline(duration=2.0, interval=0.5)
    out = cfg.to_dict()

    scenario_updates = out["sim"]["Scenario"]["update"]
    typed_attrs = scenario_updates[0]["attributes"]
    assert typed_attrs["sim_is_full"] is False
    assert typed_attrs["sim_simulation_mode"] == 0
    assert typed_attrs["sim_duration"] == 2.0
    assert typed_attrs["sim_interval"] == 0.5
    assert typed_attrs["sim_is_seeded"] is True
    assert typed_attrs["sim_seed"] == 123
    assert any(
        upd["attributes"].get("custom_scenario_key") == "keep-me"
        for upd in scenario_updates[1:]
    )


def test_from_yaml_file_rejects_invalid_scenario_simulation_mode(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    attrs = data["sim"]["Scenario"]["update"][0]["attributes"]
    attrs["sim_simulation_mode"] = 2
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="sim_simulation_mode"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_invalid_scenario_batches(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    attrs = data["sim"]["Scenario"]["update"][0]["attributes"]
    attrs["sim_batches"] = 0
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="sim_batches"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_full_sim_with_duration_timeline(
    tmp_path: Path,
) -> None:
    data = _minimal_import_tree()
    attrs = data["sim"]["Scenario"]["update"][0]["attributes"]
    attrs["sim_is_full"] = True
    attrs["sim_simulation_mode"] = 0
    attrs["sim_duration"] = 1.0
    attrs["sim_interval"] = 1.0
    attrs.pop("sim_slots_per_batch", None)
    attrs.pop("sim_samples_per_slot", None)
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="sim_is_full"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_imports_spec_and_file_panels_and_next_id(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [
            {"id": 3},
            {"id": 7, "panel_file": "custom_panel.csv"},
        ],
        "update": [
            {
                "ids": [3],
                "attributes": {
                    "antenna_names": ["isotropic"],
                    "reference_freq_mhz": 3600.0,
                    "antenna_spacing_vert_mm": 42.0,
                    "num_loc_antenna_vert": 1,
                    "antenna_spacing_horz_mm": 43.0,
                    "num_loc_antenna_horz": 2,
                    "dual_polarized": True,
                    "antenna_roll_angle_first_polz_degree": 1.0,
                    "antenna_roll_angle_second_polz_degree": 91.0,
                    "panel_custom": "raw",
                },
            }
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path))
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    cfg.add_panel(panel)
    out = cfg.to_dict()

    panel_add = sorted(out["sim"]["Panels"]["add"], key=lambda p: p["id"])
    assert [p["id"] for p in panel_add] == [3, 7, 8]
    assert panel_add[1]["panel_file"] == "custom_panel.csv"

    assert any(
        upd.get("ids") == [3]
        and upd["attributes"].get("antenna_spacing_vert_mm") == 42.0
        for upd in out["sim"]["Panels"]["update"]
    )
    assert any(
        upd["attributes"].get("panel_custom") == "raw"
        for upd in out["sim"]["Panels"]["update"]
    )


def test_from_yaml_file_splits_mixed_spec_and_file_panel_update_group(
    tmp_path: Path,
) -> None:
    """An update group covering both a spec-based and a file-based panel must
    split: known attrs hydrate the spec panel into typed state and emit via
    the typed update path; ALL attrs (known + unknown) for the file panel
    flow into a residual update group, since the emitter skips file-panel
    update emit (sim_config.hpp:1283-1285). See Implementer Pitfall #2."""
    data = _minimal_import_tree()
    panel_attrs = {
        "antenna_names": ["isotropic"],
        "reference_freq_mhz": 7000.0,
        "antenna_spacing_vert_mm": 99.0,
        "num_loc_antenna_vert": 1,
        "antenna_spacing_horz_mm": 41.0,
        "num_loc_antenna_horz": 2,
        "dual_polarized": True,
        "antenna_roll_angle_first_polz_degree": 0.0,
        "antenna_roll_angle_second_polz_degree": 90.0,
        "panel_extra_attr": "preserve-me",  # unknown
    }
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [
            {"id": 4},  # spec-based
            {"id": 5, "panel_file": "custom_panel.csv"},  # file-based
        ],
        "update": [{"ids": [4, 5], "attributes": panel_attrs}],
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()
    panel_updates = out["sim"]["Panels"].get("update", [])

    # Spec panel 4: known attrs hydrate to typed state and emit via typed
    # path (id-only group). The unknown `panel_extra_attr` survives as
    # residual on group ids covering 4 (alone or shared).
    spec_typed = [
        upd for upd in panel_updates
        if upd.get("ids") == [4]
        and upd["attributes"].get("antenna_spacing_vert_mm") == 99.0
        and upd["attributes"].get("reference_freq_mhz") == 7000.0
    ]
    assert len(spec_typed) >= 1, panel_updates
    assert any(
        4 in (upd.get("ids") or [])
        and upd["attributes"].get("panel_extra_attr") == "preserve-me"
        for upd in panel_updates
    )

    # File panel 5: ALL attrs (known + unknown) survive as residual,
    # because the emitter never emits a typed update for file panels.
    file_residual = [
        upd for upd in panel_updates
        if 5 in (upd.get("ids") or [])
        and upd["attributes"].get("antenna_spacing_vert_mm") == 99.0
        and upd["attributes"].get("reference_freq_mhz") == 7000.0
        and upd["attributes"].get("panel_extra_attr") == "preserve-me"
    ]
    assert len(file_residual) >= 1, panel_updates


def test_from_yaml_file_preserves_known_attrs_for_file_based_panels(tmp_path: Path) -> None:
    """File-based panels: emitter skips their update emit, so the importer
    must NOT consume known attrs into typed state — they must round-trip via
    residual update groups. See Implementer Pitfall #2."""
    data = _minimal_import_tree()
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [{"id": 11, "panel_file": "custom_panel.csv"}],
        "update": [
            {
                "ids": [11],
                "attributes": {
                    "reference_freq_mhz": 7000.0,
                    "antenna_spacing_vert_mm": 99.0,
                    "panel_extra_server_attr": "keep-too",
                },
            }
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()

    panel_updates = out["sim"]["Panels"].get("update", [])
    assert any(
        upd.get("ids") == [11]
        and upd["attributes"].get("reference_freq_mhz") == 7000.0
        and upd["attributes"].get("antenna_spacing_vert_mm") == 99.0
        and upd["attributes"].get("panel_extra_server_attr") == "keep-too"
        for upd in panel_updates
    )


def test_from_yaml_file_wildcard_panel_update_uses_concrete_file_ids_with_mixed_buckets(
    tmp_path: Path,
) -> None:
    """A wildcard update over a container with both spec and file panels
    must NOT re-emit the file-residual as ['*'] — that would let the file
    residual's known attrs reapply to spec panels on re-import (shadowing
    API mutations). The file residual must use concrete file panel ids."""
    data = _minimal_import_tree()
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [
            {"id": 4},  # spec-based
            {"id": 5, "panel_file": "custom_panel.csv"},  # file-based
        ],
        "update": [
            {
                "ids": ["*"],
                "attributes": {
                    "reference_freq_mhz": 6000.0,
                    "antenna_spacing_vert_mm": 50.0,
                    "panel_unknown_attr": "future-applicable",
                },
            }
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()
    panel_updates = out["sim"]["Panels"].get("update", [])

    # The file residual MUST use concrete fileIds, not ["*"], so its known
    # attrs are scoped to the file panel and cannot shadow spec panel 4
    # on re-import.
    file_residuals = [
        upd for upd in panel_updates
        if upd.get("ids") == [5]
        and upd["attributes"].get("reference_freq_mhz") == 6000.0
    ]
    assert len(file_residuals) == 1, panel_updates

    # Spec panel 4 emits its known attrs through the typed update path.
    spec_typed = [
        upd for upd in panel_updates
        if upd.get("ids") == [4]
        and upd["attributes"].get("reference_freq_mhz") == 6000.0
    ]
    assert len(spec_typed) >= 1, panel_updates

    # No wildcard update group should still carry the known attr
    # `reference_freq_mhz`.
    for upd in panel_updates:
        if upd.get("ids") == ["*"]:
            assert "reference_freq_mhz" not in upd.get("attributes", {}), upd


def test_from_yaml_file_imports_du_ru_ue_known_attrs_waypoints_gpx_and_mutates(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [{"id": 1}, {"id": 2}],
        "update": [
            {
                "ids": [1, 2],
                "attributes": {
                    "antenna_names": ["isotropic"],
                    "reference_freq_mhz": 3600.0,
                    "antenna_spacing_vert_mm": 41.0,
                    "num_loc_antenna_vert": 1,
                    "antenna_spacing_horz_mm": 41.0,
                    "num_loc_antenna_horz": 2,
                    "dual_polarized": True,
                    "antenna_roll_angle_first_polz_degree": 0.0,
                    "antenna_roll_angle_second_polz_degree": 90.0,
                },
            }
        ],
    }
    data["sim"]["DUs"] = {
        "default": "assets/du.json",
        "add": [{"id": 1, "position": {"pos": {"x": 0.0, "y": 0.0, "z": 10.0}}}],
        "update": [
            {
                "ids": [1],
                "attributes": {
                    "aerial_du_reference_freq": 3600.0,
                    "aerial_du_num_antennas": 4,
                    "aerial_du_fft_size": 2048,
                    "aerial_du_subcarrier_spacing": 15.0,
                    "aerial_du_max_channel_bandwidth": 80.0,
                    "du_custom": "keep-du",
                },
            }
        ],
    }
    data["sim"]["RUs"] = {
        "default": "assets/gnb.json",
        "add": [{"id": 5, "position": {"pos": {"lat": 35.0, "lon": 139.0}}}],
        "update": [
            {
                "ids": [5],
                "attributes": {
                    "aerial_gnb_carrier_freq": 3600.0,
                    "aerial_gnb_panel_type": 2,
                    "aerial_gnb_radiated_power": 45.0,
                    "aerial_gnb_du_id": 1,
                    "aerial_gnb_du_manual_assign": False,
                    "aerial_gnb_height": 12.0,
                    "aerial_gnb_mech_azimuth": 30.0,
                    "aerial_gnb_mech_tilt": 5.0,
                    "ru_custom": "keep-ru",
                },
            }
        ],
    }
    data["sim"]["UEs"] = {
        "default": "assets/ue.json",
        "add": [
            {
                "id": 9,
                "waypoints": [
                    {
                        "pos": {"lat": 35.0, "lon": 139.0},
                        "speed": 1.0,
                        "pause_duration": 2.0,
                        "azimuth_offset": 3.0,
                        "arrival_time": 4.0,
                    }
                ],
            },
            {"id": 10, "gpx": {"src": "routes/a.gpx", "use_pathfinding": False}},
        ],
        "update": [
            {
                "ids": [9, 10],
                "attributes": {
                    "aerial_ue_panel_type": 1,
                    "aerial_ue_radiated_power": 27.0,
                    "aerial_ue_manual": True,
                    "aerial_ue_bler_target": 0.2,
                    "aerial_ue_initial_mech_azimuth": 11.0,
                    "aerial_ue_mech_tilt": 7.0,
                    "ue_custom": "keep-ue",
                },
            }
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path))
    cfg.get_ru(5).set_radiated_power(50.0)
    cfg.get_ue(9).set_radiated_power(31.0)
    out = cfg.to_dict()

    ru_attrs = out["sim"]["RUs"]["update"][0]["attributes"]
    assert ru_attrs["aerial_gnb_radiated_power"] == 50.0
    assert ru_attrs["aerial_gnb_du_manual_assign"] is False
    assert any(upd["attributes"].get("ru_custom") == "keep-ru" for upd in out["sim"]["RUs"]["update"])

    ue_updates = out["sim"]["UEs"]["update"]
    assert any(upd["attributes"].get("aerial_ue_radiated_power") == 31.0 for upd in ue_updates)
    assert any(upd["attributes"].get("aerial_ue_initial_mech_azimuth") == 11.0 for upd in ue_updates)
    assert any(upd["attributes"].get("ue_custom") == "keep-ue" for upd in ue_updates)
    assert any(add.get("gpx", {}).get("src") == "routes/a.gpx" for add in out["sim"]["UEs"]["add"])

    # Waypoint sub-fields must round-trip; this guards against any
    # field-mapping bug in waypoint parsing (e.g., pause_duration vs
    # azimuth_offset swap) that the typed-attrs assertions wouldn't catch.
    # Legacy `arrival_time` in the input is accepted on import but silently
    # dropped on re-emission.
    ue9_add = next(add for add in out["sim"]["UEs"]["add"] if add.get("id") == 9)
    wp = ue9_add["waypoints"][0]
    assert wp["speed"] == 1.0
    assert wp["pause_duration"] == 2.0
    assert wp["azimuth_offset"] == 3.0
    assert "arrival_time" not in wp


def test_from_yaml_file_collapses_wildcard_known_keys_but_preserves_unknown(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["sim"]["Panels"] = {"default": "assets/panels.json", "add": [{"id": 1}], "update": []}
    data["sim"]["UEs"] = {
        "default": "assets/ue.json",
        "add": [
            {"id": 1, "waypoints": [{"pos": {"lat": 35.0, "lon": 139.0}}]},
            {"id": 2, "waypoints": [{"pos": {"lat": 35.1, "lon": 139.1}}]},
        ],
        "update": [
            {
                "ids": ["*"],
                "attributes": {
                    "aerial_ue_radiated_power": 33.0,
                    "unknown_future_key": "still-wildcard",
                },
            }
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path))
    cfg.get_ue(1).set_radiated_power(29.0)
    out = cfg.to_dict()

    known_wildcards = [
        upd for upd in out["sim"]["UEs"]["update"]
        if upd.get("ids") == ["*"] and "aerial_ue_radiated_power" in upd.get("attributes", {})
    ]
    assert known_wildcards == []
    assert any(
        upd.get("ids") == ["*"] and upd["attributes"].get("unknown_future_key") == "still-wildcard"
        for upd in out["sim"]["UEs"]["update"]
    )
    assert any(
        upd.get("ids") == [1] and upd["attributes"].get("aerial_ue_radiated_power") == 29.0
        for upd in out["sim"]["UEs"]["update"]
    )


def test_from_yaml_file_accepts_empty_add_for_typed_sections(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["sim"]["Panels"] = {"default": "assets/panels.json", "add": [], "update": []}
    data["sim"]["DUs"] = {"default": "assets/du.json", "add": [], "update": []}
    data["sim"]["RUs"] = {"default": "assets/gnb.json", "add": [], "update": []}
    data["sim"]["UEs"] = {"default": "assets/ue.json", "add": [], "update": []}
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()

    assert "add" not in out["sim"]["DUs"]
    assert "add" not in out["sim"]["RUs"]
    assert "add" not in out["sim"]["UEs"]


def test_from_yaml_file_imports_materials_vegetation_materials_and_building_updates(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["sim"]["Materials"] = {
        "default": "assets/materials.json",
        "calibration": {
            "definition": ["defs/material_defs.json"],
            "assignment": ["defs/material_assignments.json"],
        },
        "update": [
            {"ids": ["*"], "attributes": {"mat_global": True}},
            {"ids": ["concrete"], "attributes": {"scattering_coeff": 0.5}},
        ],
    }
    data["sim"]["VegetationMaterials"] = {
        "default": "assets/vegetation_materials.json",
        "calibration": {"definition": ["defs/veg_defs.json"], "assignment": []},
        "update": [
            {"ids": ["leaves"], "attributes": {"scattering_coeff": 0.3}},
        ],
    }
    data["sim"]["BldgExterior"] = {
        "update": [
            {"ids": ["*"], "attributes": {"AerialRFMesh": True}},
            {"ids": ["bldg-1"], "attributes": {"AerialRFdS": 0.25}},
        ]
    }
    data["sim"]["BldgInterior"] = {
        "update": [
            {"ids": ["*"], "attributes": {"AerialRFTransmission": False}},
        ]
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()

    assert out["sim"]["Materials"]["calibration"]["definition"] == ["defs/material_defs.json"]
    assert out["sim"]["Materials"]["update"][0]["ids"] == ["*"]
    assert out["sim"]["Materials"]["update"][0]["attributes"]["mat_global"] is True
    assert out["sim"]["VegetationMaterials"]["calibration"]["definition"] == ["defs/veg_defs.json"]
    assert out["sim"]["BldgExterior"]["update"][0]["ids"] == ["*"]
    assert out["sim"]["BldgExterior"]["update"][1]["ids"] == ["bldg-1"]
    assert out["sim"]["BldgInterior"]["update"][0]["ids"] == ["*"]


@pytest.mark.parametrize("section", ["Materials", "VegetationMaterials", "BldgExterior", "BldgInterior"])
@pytest.mark.parametrize(
    "add_value",
    [
        pytest.param([], id="empty_add_list"),
        pytest.param([{"id": "x"}], id="non_empty_add_list"),
    ],
)
def test_from_yaml_file_rejects_add_blocks_for_raw_only_sections(
    tmp_path: Path, section: str, add_value: list
) -> None:
    data = _minimal_import_tree()
    # Explicitly populate the section with the required `default` (where the
    # spec demands one) plus the offending `add` key, instead of relying on
    # _minimal_import_tree() shape. This isolates what the test asserts:
    # the add-rejection fires regardless of whether `default` is also
    # present, and won't degrade to a missing-key error if the minimal tree
    # ever changes.
    if section in ("Materials", "VegetationMaterials"):
        data["sim"][section] = {
            "default": "assets/placeholder.json",
            "add": add_value,
        }
    else:
        data["sim"].setdefault(section, {})
        data["sim"][section]["add"] = add_value
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match=f"{section}.*does not support add"):
        SimConfig.from_yaml_file(str(path))


@pytest.mark.parametrize(
    "scatterers_extra",
    [
        pytest.param({"add": [{"id": "x"}]}, id="add_block"),
        pytest.param({"update": [{"ids": ["*"], "attributes": {"k": "v"}}]}, id="update_block"),
    ],
)
def test_from_yaml_file_rejects_scatterers_add_or_update(
    tmp_path: Path, scatterers_extra: dict
) -> None:
    """Scatterers is default-only in the supported YAML shape; add/update must
    be rejected, not silently dropped. See Implementer Pitfall #8."""
    data = _minimal_import_tree()
    data["sim"]["Scatterers"] = {"default": "assets/scatterers.json", **scatterers_extra}
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="Scatterers does not support"):
        SimConfig.from_yaml_file(str(path))


@pytest.mark.parametrize("section", ["DUs", "RUs", "UEs"])
def test_from_yaml_file_rejects_duplicate_add_ids(tmp_path: Path, section: str) -> None:
    data = _minimal_import_tree()
    data["sim"][section] = {
        "default": "assets/x.json",
        "add": [{"id": 1}, {"id": 1}],
        "update": [],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="duplicate"):
        SimConfig.from_yaml_file(str(path))


@pytest.mark.parametrize("section", ["DUs", "RUs", "UEs"])
def test_from_yaml_file_rejects_mixed_wildcard_and_concrete_ids(
    tmp_path: Path, section: str
) -> None:
    data = _minimal_import_tree()
    data["sim"][section] = {
        "default": "assets/x.json",
        "add": [{"id": 1}],
        "update": [{"ids": [1, "*"], "attributes": {}}],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="wildcard"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_update_group_missing_ids(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["sim"]["RUs"] = {
        "default": "assets/gnb.json",
        "add": [],
        "update": [{"attributes": {"aerial_gnb_carrier_freq": 3600.0}}],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="ids"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_non_map_update_group(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["sim"]["RUs"] = {
        "default": "assets/gnb.json",
        "add": [],
        "update": ["not-a-map"],
    }
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match=r"\$.sim.RUs.update"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_rejects_explicit_null_for_required_scalar(tmp_path: Path) -> None:
    data = _minimal_import_tree()
    data["db"]["sim_id"] = None
    path = _write_import_yaml(tmp_path, data)

    with pytest.raises(RuntimeError, match="sim_id"):
        SimConfig.from_yaml_file(str(path))


def test_from_yaml_file_accepts_int_for_double_field(tmp_path: Path) -> None:
    """An unquoted YAML literal `3600` is parsed as int64; the importer must
    coerce it to double for `reference_freq_mhz`. See Implementer Pitfall #6."""
    data = _minimal_import_tree()
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [{"id": 1}],
        "update": [
            {
                "ids": [1],
                "attributes": {
                    "antenna_names": ["isotropic"],
                    "reference_freq_mhz": 3600,
                    "antenna_spacing_vert_mm": 41,
                    "num_loc_antenna_vert": 1,
                    "antenna_spacing_horz_mm": 41,
                    "num_loc_antenna_horz": 2,
                    "dual_polarized": True,
                    "antenna_roll_angle_first_polz_degree": 0,
                    "antenna_roll_angle_second_polz_degree": 90,
                },
            }
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()
    panel_attrs = out["sim"]["Panels"]["update"][0]["attributes"]
    assert panel_attrs["reference_freq_mhz"] == 3600.0
    # Pitfall #6 is specifically about C++ int64→double coercion. Verify the
    # binding emits a Python float, not int — value-only equality (`== 3600.0`)
    # would silently pass for a Python int too.
    assert isinstance(panel_attrs["reference_freq_mhz"], float)


def test_from_yaml_file_preserves_quoted_string_in_residual(tmp_path: Path) -> None:
    """Quoted YAML scalars must stay strings even when they look numeric or
    boolean. See Implementer Pitfall #5. Write the YAML by hand so that the
    quoting style is preserved (OmegaConf may reformat scalars)."""
    yaml_text = (
        _minimal_import_yaml_string_with_residual_attr(
            section="RUs",
            add_id=5,
            residual_key="server_opaque_token",
            residual_value_quoted='"00123"',
        )
    )
    path = tmp_path / "quoted_residual.yml"
    path.write_text(yaml_text)

    out = SimConfig.from_yaml_file(str(path)).to_dict()
    ru_updates = out["sim"]["RUs"]["update"]
    assert any(
        upd["attributes"].get("server_opaque_token") == "00123"
        for upd in ru_updates
    ), ru_updates


def test_from_yaml_file_later_update_group_wins_for_duplicate_known_key(
    tmp_path: Path,
) -> None:
    """Spec: if the same known key appears in multiple update groups for the
    same object, later YAML update groups win (Task 7, Implementation Notes).
    Verify directly: two update groups for RU id 5 set
    `aerial_gnb_radiated_power` to different values; the second value must
    survive on emit."""
    data = _minimal_import_tree()
    panel_attrs = {
        "antenna_names": ["isotropic"],
        "reference_freq_mhz": 3600.0,
        "antenna_spacing_vert_mm": 41.0,
        "num_loc_antenna_vert": 1,
        "antenna_spacing_horz_mm": 41.0,
        "num_loc_antenna_horz": 2,
        "dual_polarized": True,
        "antenna_roll_angle_first_polz_degree": 0.0,
        "antenna_roll_angle_second_polz_degree": 90.0,
    }
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [{"id": 2}],
        "update": [{"ids": [2], "attributes": panel_attrs}],
    }
    data["sim"]["DUs"] = {
        "default": "assets/du.json",
        "add": [{"id": 1, "position": {"pos": {"x": 0.0, "y": 0.0, "z": 10.0}}}],
        "update": [
            {
                "ids": [1],
                "attributes": {
                    "aerial_du_reference_freq": 3600.0,
                    "aerial_du_num_antennas": 4,
                    "aerial_du_fft_size": 2048,
                    "aerial_du_subcarrier_spacing": 30.0,
                    "aerial_du_max_channel_bandwidth": 80.0,
                },
            }
        ],
    }
    data["sim"]["RUs"] = {
        "default": "assets/gnb.json",
        "add": [{"id": 5, "position": {"pos": {"lat": 35.0, "lon": 139.0}}}],
        "update": [
            {
                "ids": [5],
                "attributes": {
                    "aerial_gnb_carrier_freq": 3600.0,
                    "aerial_gnb_panel_type": 2,
                    "aerial_gnb_radiated_power": 40.0,  # earlier
                    "aerial_gnb_du_id": 1,
                },
            },
            {
                "ids": [5],
                "attributes": {
                    "aerial_gnb_radiated_power": 47.0,  # later — wins
                },
            },
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    out = SimConfig.from_yaml_file(str(path)).to_dict()

    ru_updates = out["sim"]["RUs"]["update"]
    typed_5 = [
        upd for upd in ru_updates
        if upd.get("ids") == [5]
        and "aerial_gnb_radiated_power" in upd.get("attributes", {})
    ]
    assert len(typed_5) == 1, ru_updates
    assert typed_5[0]["attributes"]["aerial_gnb_radiated_power"] == 47.0


def test_from_yaml_file_drops_orphan_known_keys_for_unmatched_update_ids(
    tmp_path: Path,
) -> None:
    """An update group referencing IDs not present in add[] must NOT preserve
    its known keys as residual — they would shadow later API additions on
    emit. See Implementer Pitfall #7.

    Fixture must satisfy `addRU` prerequisites (sim_config.hpp:480-491):
    panel id 2 (the default `m_defaultPanelRU`) with matching frequency and
    matching antenna count, plus DU id 1.
    """
    data = _minimal_import_tree()
    panel_attrs = {
        "antenna_names": ["isotropic"],
        "reference_freq_mhz": 3600.0,
        "antenna_spacing_vert_mm": 41.0,
        "num_loc_antenna_vert": 1,
        "antenna_spacing_horz_mm": 41.0,
        "num_loc_antenna_horz": 2,
        "dual_polarized": True,
        "antenna_roll_angle_first_polz_degree": 0.0,
        "antenna_roll_angle_second_polz_degree": 90.0,
    }  # 1 * 2 * 2 (dual pol) = 4 antennas, matches DU's defaultNumAntennasDU=4
    data["sim"]["Panels"] = {
        "default": "assets/panels.json",
        "add": [{"id": 2}],
        "update": [{"ids": [2], "attributes": panel_attrs}],
    }
    data["sim"]["DUs"] = {
        "default": "assets/du.json",
        "add": [{"id": 1, "position": {"pos": {"x": 0.0, "y": 0.0, "z": 10.0}}}],
        "update": [
            {
                "ids": [1],
                "attributes": {
                    "aerial_du_reference_freq": 3600.0,
                    "aerial_du_num_antennas": 4,
                    "aerial_du_fft_size": 2048,
                    "aerial_du_subcarrier_spacing": 30.0,
                    "aerial_du_max_channel_bandwidth": 80.0,
                },
            }
        ],
    }
    data["sim"]["RUs"] = {
        "default": "assets/gnb.json",
        "add": [],
        "update": [
            {
                "ids": [99],
                "attributes": {
                    "aerial_gnb_radiated_power": 50.0,
                    "ru_extra_unknown": "preserve-me",
                },
            }
        ],
    }
    path = _write_import_yaml(tmp_path, data)

    cfg = SimConfig.from_yaml_file(str(path))
    cfg.add_ru(Nodes.create_ru(99, 3600, 27.0, du_id=1))
    out = cfg.to_dict()

    ru_updates = out["sim"]["RUs"]["update"]
    typed_99 = [upd for upd in ru_updates if upd.get("ids") == [99]
                and "aerial_gnb_radiated_power" in upd.get("attributes", {})]
    assert len(typed_99) == 1
    assert typed_99[0]["attributes"]["aerial_gnb_radiated_power"] == 27.0
    assert any(
        upd.get("ids") == [99]
        and upd["attributes"].get("ru_extra_unknown") == "preserve-me"
        for upd in ru_updates
    )


def test_from_yaml_file_generated_full_config_imports_mutates_and_reemits(tmp_path: Path) -> None:
    original = _make_config()

    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    original.set_default_panel_ru(ru_panel)
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    original.set_default_panel_ue(ue_panel)
    extra_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    original.add_panel(extra_panel)

    original.set_db("db.host", 9001, "author", "notes")
    original.add_tables_to_db(DBTable.CIRS)
    original.add_table_option("cirs", "full")
    original.set_ray_tracing_model(DiffusionModel.DIRECTIONAL, 7, 600, 700, True)
    original.enable_parquet_export(timesteps_per_file=16, compression="zstd", max_workers=3)
    original.add_parquet_s3_config(_make_s3_config(bucket="parquet"), nodes=["node-1"], use_ssl=False)
    original.set_parquet_iceberg(catalog_type="rest", catalog_uri="http://iceberg", catalog_name="default")
    original.enable_vegetation("maps/tokyo/veg.geojson")
    original.add_spawn_zone([Position.georef(35.0, 139.0), Position.georef(35.1, 139.0), Position.georef(35.1, 139.1)])
    original.set_bbox_window([Position.georef(35.0, 139.0), Position.georef(35.2, 139.2)])

    du = Nodes.create_du(1, 3600)
    du.set_position(Position.cartesian(0, 0, 10))
    original.add_du(du)
    ru = Nodes.create_ru(1, 3600, 43.0, 1)
    ru.set_position(Position.georef(35.0, 139.0))
    original.add_ru(ru)
    ue = Nodes.create_ue(1, 26.0)
    ue.add_waypoint(Position.georef(35.0, 139.0))
    original.add_ue(ue)
    original.set_attributes("UEs", [1], {"future_server_attr": "keep"})

    path = _write_import_yaml(tmp_path, original.to_dict(), "generated.yml")
    imported = SimConfig.from_yaml_file(str(path))
    imported.get_ru(1).set_radiated_power(51.0)
    imported.get_ue(1).set_radiated_power(32.0)
    imported.add_ru(Nodes.create_ru(2, 3600, 44.0, 1))
    ue2 = Nodes.create_ue(2, 28.0)
    ue2.add_waypoint(Position.georef(35.2, 139.2))
    imported.add_ue(ue2)

    out = imported.to_dict()

    assert out["db"]["sim_id"] == "test"
    assert out["gis"]["scene"]["scene_url"] == DEFAULT_SCENE
    assert _has_update_attr(out["sim"]["RUs"], [1], "aerial_gnb_radiated_power", 51.0)
    assert _has_update_attr(out["sim"]["UEs"], [1], "aerial_ue_radiated_power", 32.0)
    assert _has_update_attr(out["sim"]["UEs"], [1], "future_server_attr", "keep")
    assert any(add["id"] == 2 for add in out["sim"]["RUs"]["add"])
    assert any(add["id"] == 2 for add in out["sim"]["UEs"]["add"])
    # Explicitly assert parquet + GIS preservation; the round-trip equality
    # below would silently false-pass if the importer dropped these from both
    # sides of the comparison.
    assert out["db"]["parquet_export"]["timesteps_per_file"] == 16
    assert out["gis"]["spawn_zone"] is not None
    assert out["gis"]["bbox_window"] is not None
    # DU update passthrough is exercised by import via _find_update_by_ids.
    du_attrs = _find_update_by_ids(out["sim"]["DUs"], [1])
    assert du_attrs.get("aerial_du_reference_freq") == 3600.0

    emit1_path = _write_import_yaml(tmp_path, out, "generated_emit1.yml")
    emit2 = SimConfig.from_yaml_file(str(emit1_path)).to_dict()
    assert _normalize_yaml_import_tree(out) == _normalize_yaml_import_tree(emit2)


def _load_example_yaml_module():
    """Load the example_client_yaml_config module.
    
    Load by file path inside the specific test/helper to be independent of CWD and PYTHONPATH.
    """
    module_path = Path(__file__).parents[1] / "examples" / "example_client_yaml_config.py"
    spec = importlib.util.spec_from_file_location("_example_client_yaml_config", module_path)
    assert spec is not None and spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_from_yaml_file_double_round_trips_generated_example(tmp_path: Path) -> None:
    example = _load_example_yaml_module()
    yaml_string, code = example.gen_example_yaml_string(
        scene="maps/tokyo",
        asset_config=str(Path(__file__).parents[1] / "examples" / "example_client_assets.yml"),
        s3=example.S3Args(
            s3_endpoint="http://minio:9000",
            s3_bucket="aerial-data",
            s3_provider="minio",
            s3_access_key="minioadmin",
            s3_secret_key="minioadmin",
        ),
        sim_id="example_sim",
        output_file="",
        iceberg=example.IcebergArgs(
            iceberg_catalog_type="rest",
            iceberg_uri="http://nessie:19120/iceberg",
        ),
    )
    assert code == 0

    source = tmp_path / "example.yml"
    source.write_text(yaml_string)

    imported = SimConfig.from_yaml_file(str(source))
    emit1 = imported.to_dict()
    emit1_path = _write_import_yaml(tmp_path, emit1, "example_emit1.yml")

    emit2 = SimConfig.from_yaml_file(str(emit1_path)).to_dict()

    assert _normalize_yaml_import_tree(emit1) == _normalize_yaml_import_tree(emit2)


# ==============================================================================
# Test 3: Full Integration Test (Generate + Validate YAML)
# ==============================================================================


@dataclass
class FullIntegrationTestCase:  # type: ignore[misc] # pylint: disable=too-many-instance-attributes
    """Test case for full integration testing."""

    name: str
    mode: SimMode
    num_batches: int
    num_panels: int
    num_dus: int
    num_rus: int
    num_ues: int
    duration: Optional[float]
    interval: Optional[float]
    slots_per_batch: Optional[int]
    use_seed: bool


FULL_INTEGRATION_TEST_CASES = [
    FullIntegrationTestCase(
        name="em_mode_single_network",
        mode=SimMode.EM,
        num_batches=1,
        num_panels=2,
        num_dus=1,
        num_rus=1,
        num_ues=1,
        duration=10.0,
        interval=0.1,
        slots_per_batch=None,
        use_seed=True,
    ),
    FullIntegrationTestCase(
        name="em_mode_multi_ue",
        mode=SimMode.EM,
        num_batches=2,
        num_panels=2,
        num_dus=1,
        num_rus=2,
        num_ues=3,
        duration=5.0,
        interval=0.05,
        slots_per_batch=None,
        use_seed=False,
    ),
]


@pytest.mark.parametrize(
    "test_case",
    FULL_INTEGRATION_TEST_CASES,
    ids=[tc.name for tc in FULL_INTEGRATION_TEST_CASES],
)
def test_full_integration(  # noqa: C901, E501 # pylint: disable=too-many-branches, too-many-statements # type: ignore[misc]
    test_case: FullIntegrationTestCase, tmp_path: Path
) -> None:
    """
    Full integration test: Create config, generate YAML, validate structure.

    Steps:
    1. Create SimConfig and configure
    2. Create network elements (panels, DUs, RUs, UEs)
    3. Generate YAML to tmpdir
    4. Load with OmegaConf
    5. Validate Dict structure
    """
    # Step 1: Create and configure
    output_file = tmp_path / "test_config.yml"

    config = _make_config(DEFAULT_SCENE, test_case.mode)
    config.set_num_batches(test_case.num_batches)

    if test_case.mode == SimMode.EM:
        config.set_timeline(
            duration=test_case.duration,
            interval=test_case.interval,
            slots_per_batch=None,
            realizations_per_slot=None,
        )
    else:
        config.set_timeline(
            duration=None,
            interval=None,
            slots_per_batch=test_case.slots_per_batch,
            realizations_per_slot=1,
        )

    if test_case.use_seed:
        config.set_seed(100)

    config.add_tables_to_db(DBTable.CIRS)
    config.add_tables_to_db(DBTable.CFRS)

    # Step 2: Create network elements
    panels = []
    for _ in range(test_case.num_panels):
        panel = Panel.create_panel(
            antenna_elements=[AntennaElement.Isotropic], frequency_mhz=3600
        )
        panels.append(panel)

    if len(panels) >= 2:
        config.set_default_panel_ru(panels[1])
        config.set_default_panel_ue(panels[0])

    # Create DUs
    for i in range(test_case.num_dus):
        du = Nodes.create_du(du_id=i + 1, frequency_mhz=3600, scs_khz=30.0)
        du.set_position(Position.cartesian(0, 0, 100 + i * 10))
        config.add_du(du)

    # Create RUs
    for i in range(test_case.num_rus):
        ru = Nodes.create_ru(
            ru_id=i + 1, frequency_mhz=3600, radiated_power_dbm=43.0, du_id=1
        )
        ru.set_position(Position.georef(35.66 + i * 0.001, 139.74 + i * 0.001))
        ru.set_height(2.5 + i)
        config.add_ru(ru)

    # Create UEs
    for i in range(test_case.num_ues):
        ue = Nodes.create_ue(ue_id=i + 1, radiated_power_dbm=26.0)
        ue.add_waypoint(Position.georef(35.66 + i * 0.01, 139.74 + i * 0.01))
        ue.add_waypoint(Position.georef(35.67 + i * 0.01, 139.75 + i * 0.01))
        config.add_ue(ue)

    # Step 3: Generate YAML
    config_dict = config.to_dict()
    OmegaConf.save(config_dict, str(output_file))

    assert output_file.exists()

    # Step 4: Load with OmegaConf
    loaded_config = dict(OmegaConf.load(str(output_file)))

    # Step 5: Validate structure
    # Check top-level keys
    assert "db" in loaded_config
    assert "sim" in loaded_config

    # Check db section
    db_section = dict(loaded_config["db"])
    assert "sim_id" in db_section

    if test_case.use_seed:
        assert "opt_in_tables" in db_section
        assert "cirs" in db_section["opt_in_tables"]
        assert "cfrs" in db_section["opt_in_tables"]
        assert "raypaths" not in db_section["opt_in_tables"]

    # Check sim section
    sim_section = dict(loaded_config["sim"])
    assert "Scenario" in sim_section
    assert "Panels" in sim_section

    # Check Scenario
    scenario = dict(sim_section["Scenario"])
    assert "update" in scenario
    assert len(scenario["update"]) >= 1

    scenario_attrs = dict(scenario["update"][0]["attributes"])
    assert "sim_batches" in scenario_attrs
    assert scenario_attrs["sim_batches"] == test_case.num_batches

    if test_case.mode == SimMode.EM:
        assert scenario_attrs["sim_is_full"] is False
        assert "sim_duration" in scenario_attrs
        assert "sim_interval" in scenario_attrs
    else:
        assert scenario_attrs["sim_is_full"] is True
        assert "sim_slots_per_batch" in scenario_attrs

    # Check Panels
    if test_case.num_panels > 0:
        panels_section = sim_section["Panels"]
        assert "update" in panels_section
        assert len(panels_section["update"]) == test_case.num_panels

        for panel_update in panels_section["update"]:
            assert "ids" in panel_update
            assert "attributes" in panel_update
            panel_attrs = panel_update["attributes"]
            assert "reference_freq_mhz" in panel_attrs
            assert panel_attrs["reference_freq_mhz"] == 3600

    # Check DUs
    if test_case.num_dus > 0:
        assert "DUs" in sim_section
        dus_section = sim_section["DUs"]
        assert "add" in dus_section
        assert "update" in dus_section
        assert "default" in dus_section

        # Verify each DU has position
        assert len(dus_section["add"]) == test_case.num_dus
        for du_add in dus_section["add"]:
            assert "id" in du_add
            assert "position" in du_add  # Critical: DU must have position
            position = du_add["position"]
            assert "pos" in position
            assert "x" in position["pos"]
            assert "y" in position["pos"]
            assert "z" in position["pos"]

    # Check RUs
    if test_case.num_rus > 0:
        assert "RUs" in sim_section
        rus_section = sim_section["RUs"]
        assert "add" in rus_section
        assert "update" in rus_section

        # Verify each RU has position
        assert len(rus_section["add"]) == test_case.num_rus
        for ru_add in rus_section["add"]:
            assert "id" in ru_add
            assert "position" in ru_add  # Critical: RU must have position
            position = ru_add["position"]
            assert "pos" in position
            assert "lat" in position["pos"]
            assert "lon" in position["pos"]

    # Check UEs
    if test_case.num_ues > 0:
        assert "UEs" in sim_section
        ues_section = sim_section["UEs"]
        assert "add" in ues_section

        # Verify each UE has waypoints
        assert len(ues_section["add"]) == test_case.num_ues
        for ue_add in ues_section["add"]:
            assert "id" in ue_add
            assert "waypoints" in ue_add  # Critical: UE must have waypoints
            waypoints = ue_add["waypoints"]
            assert len(waypoints) >= 2  # At least 2 waypoints


def test_complete_workflow() -> None:
    """
    Test complete workflow matching generate_config.cpp.

    This is the reference test that matches the C++ example exactly.
    """
    config = _make_config()

    # Configure simulation
    config.set_num_batches(1)
    config.set_timeline(duration=10.0, interval=0.1)
    config.set_seed(0)
    config.add_tables_to_db(DBTable.CIRS)
    config.add_tables_to_db(DBTable.CFRS)
    config.enable_wideband()
    config.enable_urban_mobility(50)
    config.set_ray_tracing_model(DiffusionModel.DIRECTIONAL, 5, 500, 500)

    # Create panels
    ru_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.ThreeGPP38901],
        frequency_mhz=3600,
        vertical_spacing=0.5,
        vertical_num=1,
        horizontal_spacing=0.5,
        horizontal_num=2,
        dual_polarized=True,
        roll_first=-45,
        roll_second=45,
    )

    ue_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.InfinitesimalDipole],
        frequency_mhz=3600,
        vertical_spacing=0.5,
        vertical_num=2,
        horizontal_spacing=0.5,
        horizontal_num=1,
        dual_polarized=True,
        roll_first=-45,
        roll_second=45,
    )

    config.set_default_panel_ru(ru_panel)
    config.set_default_panel_ue(ue_panel)

    # Create DU
    du = Nodes.create_du(du_id=1, frequency_mhz=3600, scs_khz=30.0)
    du.set_position(Position.cartesian(0, 0, 100))
    config.add_du(du)

    # Create RU
    ru = Nodes.create_ru(ru_id=1, frequency_mhz=3600, radiated_power_dbm=43.0, du_id=1)
    ru.set_position(Position.georef(35.66356389841298, 139.74686323425487))
    ru.set_height(2.5)
    ru.set_mech_azimuth(0.0)
    ru.set_mech_tilt(0.0)
    config.add_ru(ru)

    # Create UE
    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    ue.add_waypoint(Position.georef(35.66376818087683, 139.7459968717682))
    ue.add_waypoint(Position.georef(35.663622296081414, 139.74622811587614))
    ue.add_waypoint(Position.georef(35.66362516562424, 139.74653110368598))
    config.add_ue(ue)

    # Generate dict and validate
    config_dict = config.to_dict()

    # Validate top-level structure
    assert "db" in config_dict
    assert "sim" in config_dict

    # Validate db section
    assert "opt_in_tables" in config_dict["db"]
    assert "cirs" in config_dict["db"]["opt_in_tables"]
    assert "cfrs" in config_dict["db"]["opt_in_tables"]
    assert "raypaths" not in config_dict["db"]["opt_in_tables"]

    # Validate sim section
    sim = config_dict["sim"]
    assert "Scenario" in sim
    assert "Panels" in sim
    assert "DUs" in sim
    assert "RUs" in sim
    assert "UEs" in sim
    assert "Materials" in sim
    assert "Scatterers" in sim

    # Validate Scenario
    scenario = sim["Scenario"]
    assert "update" in scenario
    scenario_attrs = scenario["update"][0]["attributes"]
    assert scenario_attrs["sim_batches"] == 1
    assert scenario_attrs["sim_is_full"] is False  # EM mode
    assert scenario_attrs["sim_duration"] == 10.0
    assert scenario_attrs["sim_interval"] == 0.1
    assert scenario_attrs["sim_is_seeded"] is True
    assert scenario_attrs["sim_seed"] == 0

    # Validate Panels
    assert len(sim["Panels"]["update"]) == 2

    # Validate DU has position
    du_section = sim["DUs"]
    assert len(du_section["add"]) == 1
    du_add = du_section["add"][0]
    assert du_add["id"] == 1
    assert "position" in du_add
    assert du_add["position"]["pos"]["x"] == 0
    assert du_add["position"]["pos"]["y"] == 0
    assert du_add["position"]["pos"]["z"] == 100

    # Validate RU has position
    ru_section = sim["RUs"]
    assert len(ru_section["add"]) == 1
    ru_add = ru_section["add"][0]
    assert ru_add["id"] == 1
    assert "position" in ru_add
    assert "lat" in ru_add["position"]["pos"]
    assert "lon" in ru_add["position"]["pos"]

    # Validate UE has waypoints
    ue_section = sim["UEs"]
    assert len(ue_section["add"]) == 1
    ue_add = ue_section["add"][0]
    assert ue_add["id"] == 1
    assert "waypoints" in ue_add
    assert len(ue_add["waypoints"]) == 3

    # Verify each waypoint has lat/lon
    for wp in ue_add["waypoints"]:
        assert "pos" in wp
        assert "lat" in wp["pos"]
        assert "lon" in wp["pos"]
        assert "speed" in wp
        assert "pause_duration" in wp
        assert "azimuth_offset" in wp
        assert "arrival_time" not in wp


def test_config_modes() -> None:
    """Test EM vs RAN mode differences."""
    # EM mode
    em_config = _make_config(mode=SimMode.EM)
    em_config.set_timeline(duration=10.0, interval=0.1)
    em_config.set_num_batches(1)

    em_dict = em_config.to_dict()
    em_scenario_attrs = em_dict["sim"]["Scenario"]["update"][0]["attributes"]
    assert em_scenario_attrs["sim_is_full"] is False
    assert em_scenario_attrs["sim_simulation_mode"] == 0
    assert "sim_duration" in em_scenario_attrs

    # RAN mode
    ran_config = _make_config(mode=SimMode.RAN)
    ran_config.set_timeline(slots_per_batch=10, realizations_per_slot=1)
    ran_config.set_num_batches(2)

    ran_dict = ran_config.to_dict()
    ran_scenario_attrs = ran_dict["sim"]["Scenario"]["update"][0]["attributes"]
    assert ran_scenario_attrs["sim_is_full"] is True
    assert ran_scenario_attrs["sim_simulation_mode"] == 1
    assert "sim_slots_per_batch" in ran_scenario_attrs


def test_channel_models() -> None:
    """Test CIRS vs CFRS channel model configuration."""
    # CIRS (narrowband)
    cirs_config = _make_config()
    cirs_config.add_tables_to_db(DBTable.CIRS)
    cirs_dict = cirs_config.to_dict()
    cirs_scenario = cirs_dict["sim"]["Scenario"]["update"][0]["attributes"]
    assert cirs_scenario["sim_enable_wideband"] is False

    # CFRS (wideband)
    cfrs_config = _make_config()
    cfrs_config.add_tables_to_db(DBTable.CFRS)
    cfrs_config.enable_wideband()
    cfrs_dict = cfrs_config.to_dict()
    cfrs_scenario = cfrs_dict["sim"]["Scenario"]["update"][0]["attributes"]
    assert cfrs_scenario["sim_enable_wideband"] is True


def test_procedural_ues_and_urban_mobility() -> None:
    """Test procedural UE and urban mobility configuration."""
    config = _make_config()

    # Configure procedural UEs
    config.set_num_procedural_ues(10)
    config.set_perc_indoor_procedural_ues(30.0)  # 30%

    # Enable urban mobility
    config.enable_urban_mobility(50)

    config_dict = config.to_dict()
    scenario_attrs = config_dict["sim"]["Scenario"]["update"][0]["attributes"]

    assert scenario_attrs["sim_num_procedural_ues"] == 10
    assert (
        scenario_attrs["sim_perc_indoor_procedural_ues"] == 30.0
    ) # [0, 100.0], for percentage, not fraction
    assert scenario_attrs["um_enable_urban_mobility"] is True
    assert scenario_attrs["um_num_vehicles"] == 50
    assert scenario_attrs["sim_enable_dynamic_scattering"] is True

    # Check scatterers default asset path
    assert "Scatterers" in config_dict["sim"]
    assert "default" in config_dict["sim"]["Scatterers"]


def test_vegetation_default_geojson_from_scene_url() -> None:
    """Default vegetation GeoJSON should be derived from scene URL when enabled."""
    config = _make_config()

    # Enable vegetation without explicit path
    config.enable_vegetation()
    cfg = config.to_dict()

    assert "gis" in cfg
    gis = cfg["gis"]
    assert "vegetation" in gis

    vegetation = gis["vegetation"]
    assert vegetation["active"] is True

    geojson_list = vegetation["geojson"]
    # geojson is a list of strings (ConfigVegContainer.geojson: List[str])
    assert isinstance(geojson_list, list)
    assert len(geojson_list) >= 1
    # DEFAULT_SCENE is "test_data/maps/tokyo"
    # With default assets home, the derived path should end with:
    # "test_data/maps/tokyo/sim/autosave_vegetation.geojson"
    assert geojson_list[0].endswith(
        str(Path(DEFAULT_SCENE) / "sim" / "vegetation.geojson")
    )


def test_building_rf_attributes_section() -> None:
    """Test that building RF attributes are emitted for exterior and interior."""
    config = _make_config()

    # Configure exterior and interior RF attributes with default IDs ("*")
    config.set_bldg_exterior_attr(
        activate_rf=True,
        activate_diffraction=True,
        activate_diffusion=False,
        activate_transmission=True,
        diffuse_surface_element_area=0.5,
    )
    config.set_bldg_interior_attr(
        activate_rf=False,
        activate_diffraction=False,
        activate_transmission=False,
    )

    cfg = config.to_dict()
    sim = cfg["sim"]

    # Exterior section
    assert "BldgExterior" in sim
    ext = sim["BldgExterior"]
    assert "update" in ext
    ext_update = ext["update"][0]
    assert "ids" in ext_update
    assert ext_update["ids"] == ["*"]
    ext_attrs = ext_update["attributes"]
    assert ext_attrs["AerialRFMesh"] is True
    assert ext_attrs["AerialRFDiffraction"] is True
    assert ext_attrs["AerialRFDiffuse"] is False
    assert ext_attrs["AerialRFTransmission"] is True
    assert ext_attrs["AerialRFdS"] == 0.5

    # Interior section
    assert "BldgInterior" in sim
    interior = sim["BldgInterior"]
    assert "update" in interior
    int_update = interior["update"][0]
    assert "ids" in int_update
    assert int_update["ids"] == ["*"]
    int_attrs = int_update["attributes"]
    assert int_attrs["AerialRFMesh"] is False
    assert int_attrs["AerialRFDiffraction"] is False
    assert "AerialRFDiffuse" not in int_attrs
    assert int_attrs["AerialRFTransmission"] is False
    assert "AerialRFdS" not in int_attrs


def test_set_attributes_routes_to_bldg_containers() -> None:
    """`set_attributes` with prim_type 'BldgExterior' / 'BldgInterior' must
    route to the corresponding container and appear under sim.BldgExterior /
    sim.BldgInterior 'update' lists, with the given ids and attributes."""
    config = _make_config()

    config.set_attributes(
        prim_type="BldgExterior",
        ids=["bldg_1", "bldg_2"],
        attributes={
            "AerialRFMesh": True,
            "AerialRFTransmission": False,
            "AerialRFdS": 0.25,
        },
    )
    config.set_attributes(
        prim_type="BldgInterior",
        ids=["*"],
        attributes={
            "AerialRFMesh": False,
            "AerialRFDiffraction": False,
        },
    )

    cfg = config.to_dict()
    sim = cfg["sim"]

    # Exterior entry — exactly one update group with our ids and attrs.
    assert "BldgExterior" in sim
    ext_updates = sim["BldgExterior"]["update"]
    assert len(ext_updates) == 1
    assert ext_updates[0]["ids"] == ["bldg_1", "bldg_2"]
    ext_attrs = ext_updates[0]["attributes"]
    assert ext_attrs["AerialRFMesh"] is True
    assert ext_attrs["AerialRFTransmission"] is False
    assert ext_attrs["AerialRFdS"] == 0.25

    # Interior entry — single update group with wildcard ids.
    assert "BldgInterior" in sim
    int_updates = sim["BldgInterior"]["update"]
    assert len(int_updates) == 1
    assert int_updates[0]["ids"] == ["*"]
    int_attrs = int_updates[0]["attributes"]
    assert int_attrs["AerialRFMesh"] is False
    assert int_attrs["AerialRFDiffraction"] is False


def test_bldg_exterior_without_diffuse_area_omits_aerial_rf_ds() -> None:
    """When `diffuse_surface_element_area` is omitted, `AerialRFdS` must NOT
    be emitted in the BldgExterior update group. Other RF attributes emit
    as usual."""
    config = _make_config()

    config.set_bldg_exterior_attr(
        activate_rf=True,
        activate_diffraction=True,
        activate_diffusion=False,
        activate_transmission=True,
    )

    cfg = config.to_dict()
    sim = cfg["sim"]

    assert "BldgExterior" in sim
    ext_updates = sim["BldgExterior"]["update"]
    assert len(ext_updates) == 1
    ext_attrs = ext_updates[0]["attributes"]

    # These four are still emitted.
    assert ext_attrs["AerialRFMesh"] is True
    assert ext_attrs["AerialRFDiffraction"] is True
    assert ext_attrs["AerialRFDiffuse"] is False
    assert ext_attrs["AerialRFTransmission"] is True

    # AerialRFdS must be absent because no area was provided.
    assert "AerialRFdS" not in ext_attrs


def _build_small_network_config() -> SimConfig:
    """Create a small valid network topology for update-group tests."""
    config = _make_config()

    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    ue_panel = Panel.create_panel([AntennaElement.InfinitesimalDipole], 3600)
    config.set_default_panel_ru(ru_panel)
    config.set_default_panel_ue(ue_panel)

    du = Nodes.create_du(du_id=1, frequency_mhz=3600, scs_khz=30.0)
    du.set_position(Position.cartesian(0, 0, 100))
    config.add_du(du)

    ru1 = Nodes.create_ru(ru_id=1, frequency_mhz=3600, radiated_power_dbm=43.0, du_id=1)
    ru1.set_position(Position.cartesian(10, 0, 20))
    config.add_ru(ru1)

    ru2 = Nodes.create_ru(ru_id=2, frequency_mhz=3600, radiated_power_dbm=43.0, du_id=1)
    ru2.set_position(Position.cartesian(20, 0, 20))
    config.add_ru(ru2)

    ue1 = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    ue1.add_waypoint(Position.cartesian(1, 1, 1))
    config.add_ue(ue1)

    ue2 = Nodes.create_ue(ue_id=2, radiated_power_dbm=26.0)
    ue2.add_waypoint(Position.cartesian(2, 2, 2))
    config.add_ue(ue2)
    return config


def test_set_group_updates_emit_wildcard_ids() -> None:
    """New group-update APIs should emit wildcard ids when ids is empty."""
    config = _build_small_network_config()
    config.set_ues_height(1.8)
    config.set_ues_power(24.5)
    config.set_rus_power(39.0)

    cfg = config.to_dict()
    ue_updates = cfg["sim"]["UEs"]["update"]
    ru_updates = cfg["sim"]["RUs"]["update"]

    assert any(
        update["ids"] == ["*"]
        and update["attributes"].get("height_m") == pytest.approx(1.8)
        for update in ue_updates
    )
    assert any(
        update["ids"] == ["*"]
        and update["attributes"].get("aerial_ue_radiated_power") == pytest.approx(24.5)
        for update in ue_updates
    )
    assert any(
        update["ids"] == ["*"]
        and update["attributes"].get("aerial_gnb_radiated_power") == pytest.approx(39.0)
        for update in ru_updates
    )


def test_set_group_updates_emit_explicit_ids() -> None:
    """New group-update APIs should preserve explicit id lists."""
    config = _build_small_network_config()
    config.set_ues_power(23.0, [2])
    config.set_rus_power(40.0, [1, 2])

    cfg = config.to_dict()
    ue_updates = cfg["sim"]["UEs"]["update"]
    ru_updates = cfg["sim"]["RUs"]["update"]

    assert any(
        update["ids"] == [2]
        and update["attributes"].get("aerial_ue_radiated_power") == pytest.approx(23.0)
        for update in ue_updates
    )
    assert any(
        update["ids"] == [1, 2]
        and update["attributes"].get("aerial_gnb_radiated_power") == pytest.approx(40.0)
        for update in ru_updates
    )


def test_set_group_updates_reject_negative_values() -> None:
    """Negative values should raise for grouped UE/RU update APIs."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)

    with pytest.raises(ValueError, match="UE height cannot be negative"):
        config.set_ues_height(-1.0)

    with pytest.raises(ValueError, match="UE radiated power cannot be negative"):
        config.set_ues_power(-1.0)

    with pytest.raises(ValueError, match="RU radiated power cannot be negative"):
        config.set_rus_power(-1.0)


# ==============================================================================
# Test Helpers and Edge Cases
# ==============================================================================


def test_panel_id_assignment() -> None:
    """Test that default panel IDs are assigned correctly."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)

    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)

    config.set_default_panel_ru(ru_panel)
    config.set_default_panel_ue(ue_panel)

    assert ru_panel.id() == 2  # panel_02
    assert ue_panel.id() == 1  # panel_01


def test_empty_config_generates_minimal_yaml(tmp_path: Path) -> None:
    """Test that even an empty config generates valid YAML."""
    config = _make_config()
    output_file = tmp_path / "minimal.yml"

    config_dict = config.to_dict()
    OmegaConf.save(config_dict, str(output_file))

    assert output_file.exists()

    loaded = dict(OmegaConf.load(str(output_file)))
    assert "db" in loaded
    assert "sim" in loaded
    assert "Scenario" in loaded["sim"]
    assert "Materials" in loaded["sim"]


def test_ue_clear_waypoints_and_remove() -> None:
    """Test clearing waypoints and removing a UE."""
    config = _make_config()
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(panel)

    # Create and add UE
    ue = Nodes.create_ue(ue_id=1)
    ue.add_waypoint(Position.georef(1, 1))
    ue.add_waypoint(Position.georef(2, 2))
    config.add_ue(ue)

    # Verify waypoints
    config_dict = config.to_dict()
    assert len(config_dict["sim"]["UEs"]["add"][0]["waypoints"]) == 2

    # Clear waypoints and re-add UE to check
    config.clear_waypoints(1)
    config.remove_ue(1)  # Remove the old UE instance

    ue_after_clear = Nodes.create_ue(ue_id=1)  # Re-create the UE
    ue_after_clear.add_waypoint(Position.georef(3, 3))
    config.add_ue(ue_after_clear)

    config_dict_after_clear = config.to_dict()
    assert len(config_dict_after_clear["sim"]["UEs"]["add"][0]["waypoints"]) == 1
    assert config_dict_after_clear["sim"]["UEs"]["add"][0]["waypoints"][0]["pos"]["lat"] == 3

    # Remove UE
    config.remove_ue(1)
    config_dict_after_remove = config.to_dict()
    # When all UEs are removed, UEs section may not be present
    assert (
        "UEs" not in config_dict_after_remove["sim"]
        or "add" not in config_dict_after_remove["sim"]["UEs"]
    )

    # Test removing non-existent UE (should not throw)
    config.remove_ue(999)

    # Test clearing waypoints for non-existent UE
    with pytest.raises(RuntimeError, match="UE with ID 999 not found"):
        config.clear_waypoints(999)


def test_spawn_zone_add_spawn_zone() -> None:
    """Test add_spawn_zone API with CCW polygon vertices."""
    config = _make_config()

    # Current API: CCW polygon of georeferenced positions
    points = [
        Position.georef(35.663, 139.745),
        Position.georef(35.664, 139.745),
        Position.georef(35.664, 139.746),
        Position.georef(35.663, 139.746),
    ]
    config.add_spawn_zone(points)
    config_dict = config.to_dict()

    # Spawn zone is emitted under gis.spawn_zone
    assert "gis" in config_dict
    assert "spawn_zone" in config_dict["gis"]
    spawn_zone = config_dict["gis"]["spawn_zone"]

    assert "points_ccw" in spawn_zone
    assert len(spawn_zone["points_ccw"]) == 4

    # Verify each point has lat/lon
    for pt in spawn_zone["points_ccw"]:
        assert "lat" in pt
        assert "lon" in pt

    # Verify first point values
    assert spawn_zone["points_ccw"][0]["lat"] == 35.663
    assert spawn_zone["points_ccw"][0]["lon"] == 139.745


@dataclass
class TwoDimOnlyPositionApiTestCase:
    name: str
    api_name: str
    create_points: Callable[[], List[Position]]
    expected_message_fragment: str


TEST_CASES_2D_ONLY_POSITION_APIS = [
    TwoDimOnlyPositionApiTestCase(
        name="add_spawn_zone_rejects_3d_point",
        api_name="add_spawn_zone",
        create_points=lambda: [
            Position.georef(35.663, 139.745),
            Position.georef(35.664, 139.745, alt=10.0),
        ],
        expected_message_fragment="spawn",
    ),
    TwoDimOnlyPositionApiTestCase(
        name="set_bbox_window_rejects_3d_point",
        api_name="set_bbox_window",
        create_points=lambda: [
            Position.georef(35.663, 139.745),
            Position.georef(35.664, 139.746, alt=5.0),
        ],
        expected_message_fragment="bbox",
    ),
]


@pytest.mark.parametrize(
    "test_case",
    TEST_CASES_2D_ONLY_POSITION_APIS,
    ids=[tc.name for tc in TEST_CASES_2D_ONLY_POSITION_APIS],
)
def test_2d_only_position_apis_reject_3d_point(
    test_case: TwoDimOnlyPositionApiTestCase,
) -> None:
    """2D-only SimConfig APIs reject 3D Position values."""
    config = _make_config()
    points = test_case.create_points()
    with pytest.raises(ValueError) as exc_info:
        if test_case.api_name == "add_spawn_zone":
            config.add_spawn_zone(points)
        elif test_case.api_name == "set_bbox_window":
            config.set_bbox_window(points)
        else:
            raise AssertionError(f"unknown API: {test_case.api_name}")
    msg = str(exc_info.value).lower()
    assert "2d" in msg
    assert test_case.expected_message_fragment in msg


def test_enable_vegetation() -> None:
    """enable_vegetation emits active vegetation, GeoJSON, and asset paths."""
    config = _make_config()

    config.enable_vegetation()

    config_dict = config.to_dict()
    vegetation = config_dict["gis"]["vegetation"]

    assert vegetation["active"] is True
    assert vegetation["geojson"] == [
        str(Path(DEFAULT_SCENE) / "sim" / "vegetation.geojson")
    ]
    assert vegetation["vegetation_asset_path"] == [
        "assets_1_5/street_tree.json"
    ]


def test_add_material_definition_bldg() -> None:
    """add_material_definition(BLDG) populates sim.Materials.calibration.definition."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    config.add_material_definition("calibrated.json", GeoTargets.BLDG)
    config.add_material_definition("extra.json", GeoTargets.BLDG)

    d = config.to_dict()
    calib = d["sim"]["Materials"]["calibration"]
    assert calib["definition"] == ["calibrated.json", "extra.json"]
    assert calib["assignment"] == []


def test_add_material_definition_veg() -> None:
    """add_material_definition(VEG) populates sim.VegetationMaterials.calibration.definition."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    config.add_material_definition("veg_calib.json", GeoTargets.VEG)

    d = config.to_dict()
    calib = d["sim"]["VegetationMaterials"]["calibration"]
    assert calib["definition"] == ["veg_calib.json"]
    assert calib["assignment"] == []


def test_add_material_assignment_bldg() -> None:
    """add_material_assignment(BLDG) populates sim.Materials.calibration.assignment."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    config.add_material_assignment("mapping.json", GeoTargets.BLDG)

    d = config.to_dict()
    calib = d["sim"]["Materials"]["calibration"]
    assert calib["assignment"] == ["mapping.json"]
    assert calib["definition"] == []


def test_add_material_assignment_veg() -> None:
    """add_material_assignment(VEG) populates sim.VegetationMaterials.calibration.assignment."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    config.add_material_assignment("veg_mapping.json", GeoTargets.VEG)

    d = config.to_dict()
    calib = d["sim"]["VegetationMaterials"]["calibration"]
    assert calib["assignment"] == ["veg_mapping.json"]


def test_default_key_emitted_not_asset() -> None:
    """Sim sections should emit 'default' key, not 'asset'."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    d = config.to_dict()
    sim = d["sim"]

    # Panels is only emitted when non-empty, so exclude it here.
    for section_name in ["Materials", "VegetationMaterials", "Scatterers",
                         "Scenario", "DUs", "RUs", "UEs"]:
        assert section_name in sim, f"{section_name} missing from sim"
        section = sim[section_name]
        assert "default" in section, f"{section_name} missing 'default' key"
        assert "asset" not in section, f"{section_name} has stale 'asset' key"


def test_no_calibration_when_empty() -> None:
    """calibration sub-section should not appear if no definitions/assignments added."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    d = config.to_dict()
    assert "calibration" not in d["sim"]["Materials"]
    assert "calibration" not in d["sim"]["VegetationMaterials"]


def test_top_level_calibration_api() -> None:
    """Top-level calibration API emits the cal section used by calibration runs."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")

    config.set_calibration_targets(
        materials=False,
        veg_materials=False,
        rus=False,
        rus_beams=False,
        ues=True,
    )
    config.add_calibration_measurement(
        ru_id=1,
        ue_id=1,
        measurement_file="/opt/nvidia/aodt_sim/ru1_ue1.csv",
    )
    config.set_calibration_timeline(start=0, step=1)
    config.set_calibration_output("runs/calibration_example")

    cal = config.to_dict()["cal"]

    assert cal["targets"] == {
        "Materials": False,
        "VegMaterials": False,
        "RUs": False,
        "RUsBeams": False,
        "UEs": True,
    }
    assert cal["measurements"] == [
        {
            "ru_id": 1,
            "ue_id": 1,
            "measurement_file": "/opt/nvidia/aodt_sim/ru1_ue1.csv",
        }
    ]
    assert cal["timeline"] == {"start": 0, "step": 1, "end": None}
    assert cal["output"] == {"folder_key": "runs/calibration_example"}


def test_calibration_details_require_targets_first() -> None:
    """Calibration detail APIs require set_calibration_targets first."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")

    with pytest.raises(RuntimeError, match="setCalibrationTargets"):
        config.add_calibration_measurement(
            ru_id=1,
            ue_id=1,
            measurement_file="/opt/nvidia/aodt_sim/ru1_ue1.csv",
        )


def test_calibration_measurement_required() -> None:
    """Calibration config export requires at least one measurement."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    config.set_calibration_targets(
        materials=False,
        veg_materials=False,
        rus=False,
        rus_beams=False,
        ues=True,
    )
    config.set_calibration_output("runs/calibration_example")

    with pytest.raises(RuntimeError, match="calibration measurement"):
        config.to_dict()


def test_set_attributes_materials_routing() -> None:
    """setAttributes('Materials') and setAttributes('VegetationMaterials') should
    produce update groups in the corresponding sim sections."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.set_simulation_id("test")
    config.set_attributes(
        "Materials", ["concrete"], {"scattering_coeff": 0.5}
    )
    config.set_attributes(
        "VegetationMaterials", ["leaves"], {"scattering_coeff": 0.3}
    )

    d = config.to_dict()
    mat_update = d["sim"]["Materials"]["update"]
    assert len(mat_update) == 1
    assert mat_update[0]["ids"] == ["concrete"]
    assert mat_update[0]["attributes"]["scattering_coeff"] == 0.5

    veg_update = d["sim"]["VegetationMaterials"]["update"]
    assert len(veg_update) == 1
    assert veg_update[0]["ids"] == ["leaves"]
    assert veg_update[0]["attributes"]["scattering_coeff"] == 0.3


def test_enable_vegetation_disabled_by_default() -> None:
    """Vegetation is inactive by default and does not emit asset paths."""
    config = _make_config()

    config_dict = config.to_dict()
    vegetation = config_dict["gis"]["vegetation"]

    assert vegetation["active"] is False
    assert vegetation["geojson"] == []
    assert "vegetation_asset_path" not in vegetation


def test_parquet_export_disabled_by_default() -> None:
    """Parquet export should be disabled by default."""
    config = _make_config()
    cfg = config.to_dict()

    assert "parquet_export" not in cfg["db"]


def test_parquet_export_disable_via_api() -> None:
    """disable_parquet_export() should suppress the parquet_export section."""
    config = _make_config()
    config.disable_parquet_export()
    cfg = config.to_dict()

    assert "parquet_export" not in cfg["db"]


def test_parquet_export_entries_in_db_section() -> None:
    """Test parquet_export entries emitted by Python bindings."""
    config = _make_config()

    config.enable_parquet_export(
        timesteps_per_file=5,
        compression="zstd",
        max_workers=3,
        verify_exports=True,
    )
    config.add_parquet_s3_config(
        _make_s3_config(
            bucket="parquet-export-test",
            provider="minio",
            endpoint_url="http://localhost:9002",
            access_key="minioadmin",
            secret_key="minioadmin",
        ),
        nodes=["node1", "node2"],
    )
    config.set_parquet_iceberg(
        catalog_type="rest",
        catalog_uri="http://localhost:19120/iceberg/",
        catalog_name="default",
        nessie_ref="main",
    )

    cfg = config.to_dict()
    assert "db" in cfg
    assert "parquet_export" in cfg["db"]

    parquet = cfg["db"]["parquet_export"]
    assert parquet["timesteps_per_file"] == 5
    assert parquet["compression"] == "zstd"
    assert parquet["max_workers"] == 3
    assert parquet["verify_exports"] is True

    assert "s3_configs" in parquet
    assert len(parquet["s3_configs"]) == 1
    s3 = parquet["s3_configs"][0]
    assert s3["provider"] == "minio"
    assert s3["endpoint_url"] == "http://localhost:9002"
    assert s3["bucket"] == "parquet-export-test"
    assert s3["nodes"] == ["node1", "node2"]
    assert s3["access_key"] == "minioadmin"
    assert s3["secret_key"] == "minioadmin"
    assert s3["region"] == "us-east-1"
    assert s3["use_ssl"] is False

    assert "iceberg" in parquet
    iceberg = parquet["iceberg"]
    assert iceberg["catalog_type"] == "rest"
    assert iceberg["catalog_uri"] == "http://localhost:19120/iceberg/"
    assert iceberg["catalog_name"] == "default"
    assert iceberg["nessie_ref"] == "main"


def test_parquet_export_requires_s3_config() -> None:
    """Enabling parquet export without S3 config should fail."""
    config = _make_config()
    config.enable_parquet_export(
        timesteps_per_file=5,
        compression="zstd",
        max_workers=3,
        verify_exports=True,
    )

    with pytest.raises(RuntimeError, match="no S3 configs were provided"):
        _ = config.to_dict()


def test_parquet_s3_config_rejects_empty_bucket() -> None:
    """add_parquet_s3_config should reject an empty bucket name."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.enable_parquet_export()

    with pytest.raises(ValueError, match="bucket cannot be empty"):
        config.add_parquet_s3_config(
            _make_s3_config(
                bucket="",
                provider="minio",
                endpoint_url="http://localhost:9000",
            ),
            nodes=["node1"],
        )


def test_parquet_s3_config_defaults_nodes_to_node1() -> None:
    """add_parquet_s3_config should default nodes to ["node1"] for single-node deploy."""
    config = _make_config()
    config.enable_parquet_export()
    config.add_parquet_s3_config(
        _make_s3_config(
            bucket="parquet-export-test",
            provider="minio",
            endpoint_url="http://localhost:9002",
        )
    )

    cfg = config.to_dict()
    s3 = cfg["db"]["parquet_export"]["s3_configs"][0]
    assert s3["nodes"] == ["node1"]


def test_parquet_s3_config_rejects_minio_without_endpoint() -> None:
    """add_parquet_s3_config should reject minio provider with empty endpoint_url."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.enable_parquet_export()

    with pytest.raises(ValueError, match="endpoint_url is required.*minio"):
        config.add_parquet_s3_config(
            _make_s3_config(
                bucket="parquet-export-test",
                provider="minio",
                endpoint_url="",
            ),
            nodes=["node1"],
        )


def test_parquet_s3_config_rejects_minio_endpoint_without_scheme() -> None:
    """Reject MinIO endpoint_url that lacks http:// or https:// scheme."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.enable_parquet_export()

    with pytest.raises(ValueError, match="must start with 'http://' or 'https://'"):
        config.add_parquet_s3_config(
            _make_s3_config(
                bucket="parquet-export-test",
                provider="minio",
                endpoint_url="localhost:9002",
            ),
            nodes=["node1"],
        )


def test_parquet_s3_endpoint_rejects_clickhouse_port_collision() -> None:
    """S3 endpoint on the same host:port as ClickHouse should fail at to_dict()."""
    config = _make_config()
    config.enable_parquet_export()
    config.add_parquet_s3_config(
        _make_s3_config(
            bucket="parquet-export-test",
            provider="minio",
            endpoint_url="http://clickhouse:9000",
        ),
        nodes=["node1"],
    )

    with pytest.raises(ValueError, match="collides with ClickHouse"):
        config.to_dict()


def test_parquet_export_no_iceberg_when_not_set() -> None:
    """Parquet export should not include iceberg config unless explicitly set."""
    config = _make_config()
    config.enable_parquet_export(
        timesteps_per_file=5,
        compression="zstd",
        max_workers=3,
        verify_exports=True,
    )
    config.add_parquet_s3_config(
        _make_s3_config(
            bucket="parquet-export-test",
            provider="minio",
            endpoint_url="http://localhost:9002",
        ),
        nodes=["node1"],
    )

    cfg = config.to_dict()
    parquet = cfg["db"]["parquet_export"]
    assert "iceberg" not in parquet


def test_iceberg_rest_type_rejects_non_http_uri() -> None:
    """catalog_type='rest' with a non-http URI should fail."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.enable_parquet_export()

    with pytest.raises(ValueError, match="catalog_uri does not start with 'http"):
        config.set_parquet_iceberg(
            catalog_type="rest",
            catalog_uri="sqlite:///iceberg_catalog.db",
        )


def test_iceberg_rejects_empty_uri_for_non_glue() -> None:
    """catalog_uri is required for non-glue catalog types."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.enable_parquet_export()

    with pytest.raises(ValueError, match="catalog_uri is required"):
        config.set_parquet_iceberg(
            catalog_type="sql",
            catalog_uri="",
        )


def test_iceberg_rejects_unsupported_catalog_type() -> None:
    """Unsupported catalog_type should fail."""
    config = _make_config(DEFAULT_SCENE, SimMode.EM)
    config.enable_parquet_export()

    with pytest.raises(ValueError, match="Unsupported Iceberg catalog_type"):
        config.set_parquet_iceberg(
            catalog_type="dynamo",
            catalog_uri="http://localhost:8000",
        )

    
def test_quick_start(tmp_path: Path) -> None:
    """Test that quick start example in `client/config/docs/quickstart.rst`."""
    # -- 1. Create configuration builder --------------------------
    config = SimConfig(
        "test_data/maps/tokyo",
        SimMode.EM,
        str(Path(__file__).parent.parent / "examples" / "example_client_assets.yml"),
    )

    # -- 2. Set simulation identity and DB connection --------------
    config.set_simulation_id("my_sim")
    config.set_db(db_host="localhost", db_port=9000, db_author="aerial")

    # -- 3. Configure S3 storage (required) ------------------------
    s3 = S3Config(
        bucket="aerial-data",
        provider="minio",                  # "minio" or "aws"
        endpoint_url="http://localhost:9002",
        access_key="minioadmin",
        secret_key="minioadmin",
    )
    config.set_s3_config(s3)

    # -- 4. Set simulation parameters ------------------------------
    config.set_num_batches(1)
    config.set_timeline(slots_per_batch=12, realizations_per_slot=1)
    config.set_seed(10)

    config.add_tables_to_db(DBTable.CIRS)
    config.add_tables_to_db(DBTable.CFRS)

    # -- 5. Enable Parquet export ----------------------------------
    config.enable_parquet_export(timesteps_per_file=3)
    config.add_parquet_s3_config(s3)
    # Optional: register Parquet files in an Iceberg catalog
    # config.set_parquet_iceberg(catalog_type="rest",
    #                            catalog_uri="http://localhost:8181")

    # -- 6. Create panels and network elements ---------------------
    # RU panel
    ru_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.ThreeGPP38901],
        frequency_mhz=3600,
        horizontal_num=2,
        dual_polarized=True,
    )
    config.set_default_panel_ru(ru_panel)

    # UE panel
    ue_panel = Panel.create_panel(
        antenna_elements=[AntennaElement.InfinitesimalDipole],
        frequency_mhz=3600,
        vertical_num=2,
        dual_polarized=True,
        roll_first=-45,
        roll_second=45,
    )
    config.set_default_panel_ue(ue_panel)

    # DU
    du = Nodes.create_du(du_id=1, frequency_mhz=3600, scs_khz=30.0)
    du.set_position(Position.cartesian(0, 0, 100))
    config.add_du(du)

    # RU (must reference an existing DU)
    ru = Nodes.create_ru(ru_id=1, frequency_mhz=3600,
                            radiated_power_dbm=43.0, du_id=du.id())
    ru.set_position(Position.georef(35.66356, 139.74686))
    ru.set_height(2.5)
    config.add_ru(ru)

    # UE (must have at least one waypoint before add_ue)
    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    ue.add_waypoint(Position.georef(35.66376, 139.74599))
    ue.add_waypoint(Position.georef(35.66362, 139.74622))
    config.add_ue(ue)

    # -- 7. Export as YAML -----------------------------------------
    config_dict = config.to_dict()
    OmegaConf.save(config_dict, str(tmp_path / "output.yml"))


# =============================================================================
# Default-panel-id getters, get_*_ids, RU.panel_id, and Panel focused setters
# (added with import-yaml public-getters work; see
# docs/superpowers/plans/2026-05-13-import-yaml-public-getters.md)
# =============================================================================


def _make_imported_config_with_two_rus(config: SimConfig) -> None:
    """Populate `config` with default RU/UE panels, one DU and two RUs/UEs."""
    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ru(ru_panel)
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(ue_panel)

    du = Nodes.create_du(du_id=1, frequency_mhz=3600)
    du.set_position(Position.cartesian(0, 0, 100))
    config.add_du(du)

    for ru_id in (1, 2):
        ru = Nodes.create_ru(ru_id=ru_id, frequency_mhz=3600, du_id=1)
        ru.set_position(Position.georef(35.66, 139.74))
        config.add_ru(ru)

    for ue_id in (1, 2):
        ue = Nodes.create_ue(ue_id=ue_id)
        ue.add_waypoint(Position.georef(35.66, 139.74))
        config.add_ue(ue)


def test_simconfig_default_panel_id_getters_after_set() -> None:
    """get_default_(ru|ue)_panel_id() returns the ids assigned by setDefaultPanel*."""
    config = _make_config()
    ru_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ru(ru_panel)
    ue_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
    config.set_default_panel_ue(ue_panel)
    # Defaults from core_types.hpp: defaultPanelRU=2, defaultPanelUE=1.
    assert config.get_default_ru_panel_id() == 2
    assert config.get_default_ue_panel_id() == 1


def test_simconfig_default_panel_id_getters_round_trip(tmp_path: Path) -> None:
    """get_default_(ru|ue)_panel_id() round-trips through from_yaml_file."""
    config = _make_config()
    _make_imported_config_with_two_rus(config)
    path = _write_import_yaml(tmp_path, config.to_dict(), "default_ids.yml")

    imported = SimConfig.from_yaml_file(str(path))
    assert imported.get_default_ru_panel_id() == 2
    assert imported.get_default_ue_panel_id() == 1


def test_simconfig_get_prim_ids_returns_added_ids() -> None:
    """get_(ru|ue|du|panel)_ids() reports every prim added to the config."""
    config = _make_config()
    _make_imported_config_with_two_rus(config)

    assert sorted(config.get_ru_ids()) == [1, 2]
    assert sorted(config.get_ue_ids()) == [1, 2]
    assert sorted(config.get_du_ids()) == [1]
    # Panel ids: 1 (UE default), 2 (RU default).
    assert sorted(config.get_panel_ids()) == [1, 2]


def test_simconfig_get_prim_ids_empty_for_fresh_config() -> None:
    config = _make_config()
    assert config.get_ru_ids() == []
    assert config.get_ue_ids() == []
    assert config.get_du_ids() == []
    assert config.get_panel_ids() == []


def test_ru_panel_id_resolves_to_default_after_add() -> None:
    """RU.panel_id() returns the resolved default RU panel id after add_ru."""
    config = _make_config()
    _make_imported_config_with_two_rus(config)

    ru = config.get_ru(1)
    assert ru.panel_id() == config.get_default_ru_panel_id() == 2


def test_panel_set_antenna_elements_enum_and_string_overloads() -> None:
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600.0)
    panel.set_antenna_elements([AntennaElement.HalfwaveDipole])
    panel.set_antenna_elements([Panel.ISOTROPIC])  # string overload


def test_panel_set_frequency_updates_property_and_rejects_nonpositive() -> None:
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600.0)
    panel.set_frequency(7200.0)
    assert panel.frequency == 7200.0
    with pytest.raises(ValueError, match="frequency must be positive"):
        panel.set_frequency(0.0)
    with pytest.raises(ValueError, match="frequency must be positive"):
        panel.set_frequency(-1.0)


def test_panel_set_spacing_wavelengths_converts_to_mm() -> None:
    """Spacing in wavelengths is converted to mm using the current frequency.

    At 3000 MHz the wavelength is exactly 100 mm (c=2.998e8 m/s, so
    0.5 lambda ~= 49.96 mm). After add_panel + to_dict, the emitted YAML
    must reflect the converted mm value, never the input wavelengths.
    """
    config = _make_config()
    panel = Panel.create_panel([AntennaElement.Isotropic], 3000.0)
    panel.set_spacing_wavelengths(0.5, 0.25)
    config.add_panel(panel)

    # Spec-based panel attributes are emitted under Panels.update as
    # {ids: [pid], attributes: {...}}; the corresponding Panels.add
    # entry only carries the id (see buildPanelsSection in sim_config.hpp).
    pid = panel.id()
    panels_section = config.to_dict()["sim"]["Panels"]
    update_entries = panels_section.get("update", [])
    matched = next(
        (u for u in update_entries if u.get("ids") == [pid]),
        None,
    )
    assert matched is not None, f"Expected panel id={pid} in Panels.update"
    attrs = matched["attributes"]
    # 0.5 lambda * 100 mm/lambda ≈ 49.96 mm, 0.25 lambda ≈ 24.98 mm.
    assert 49.5 < attrs["antenna_spacing_vert_mm"] < 50.0
    assert 24.7 < attrs["antenna_spacing_horz_mm"] < 25.1


def test_panel_set_spacing_wavelengths_rejects_nonpositive() -> None:
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600.0)
    with pytest.raises(ValueError, match="Spacing must be positive"):
        panel.set_spacing_wavelengths(0.0, 0.5)
    with pytest.raises(ValueError, match="Spacing must be positive"):
        panel.set_spacing_wavelengths(0.5, -0.5)


def test_panel_set_panel_size_and_validates_size() -> None:
    panel = Panel.create_panel([Panel.ISOTROPIC], 3600.0)
    panel.set_panel_size(2, 2, True)
    assert panel.vertical_num_elements == 2
    assert panel.horizontal_num_elements == 2

    # Single name still passes (size constraint only fires for >1 names).
    panel.set_panel_size(4, 4, True)

    # Multi-name list with mismatched shape is rejected.
    multi = Panel.create_panel(
        [Panel.ISOTROPIC] * 8,
        3600.0,
        vertical_spacing=0.5,
        vertical_num=2,
        horizontal_spacing=0.5,
        horizontal_num=2,
        dual_polarized=True,
    )
    with pytest.raises(ValueError, match="must match"):
        multi.set_panel_size(1, 2, True)  # 1*2*2 = 4 vs 8 names
    # Strong exception guarantee: shape unchanged after the throw.
    assert multi.vertical_num_elements == 2
    assert multi.horizontal_num_elements == 2

    with pytest.raises(ValueError, match="must be positive"):
        panel.set_panel_size(0, 2, True)


def test_panel_set_roll_angles_does_not_throw() -> None:
    panel = Panel.create_panel([AntennaElement.Isotropic], 3600.0)
    panel.set_roll_angles(15.0, 75.0)


def test_panel_setters_rejected_on_file_based() -> None:
    panel = Panel.create_panel_from_file("custom_panel.csv")
    assert panel.is_file_based
    with pytest.raises(RuntimeError, match="file-based"):
        panel.set_antenna_elements([AntennaElement.Isotropic])
    with pytest.raises(RuntimeError, match="file-based"):
        panel.set_antenna_elements([Panel.ISOTROPIC])
    with pytest.raises(RuntimeError, match="file-based"):
        panel.set_frequency(3600.0)
    with pytest.raises(RuntimeError, match="file-based"):
        panel.set_spacing_wavelengths(0.5, 0.5)
    with pytest.raises(RuntimeError, match="file-based"):
        panel.set_panel_size(2, 2, True)
    with pytest.raises(RuntimeError, match="file-based"):
        panel.set_roll_angles(0.0, 90.0)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
