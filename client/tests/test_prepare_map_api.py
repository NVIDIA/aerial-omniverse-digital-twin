# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""PrepareMap client API regression tests.

Validates that OSMTask / GMLTask Python bindings expose the correct set of
BaseTask fields, that required fields are enforced, nullable fields accept
None, and legacy fields are gone. The cesium3dtiles_{b3dm,draco,gzip} flags
default to None ("let GIS decide") rather than being set client-side, so
asim_gis owns the effective defaults.

TerraformConfig follows the same convention: all fields default to None and
are forwarded to asim_gis only when explicitly set.
"""

import pytest

import dt_client


# ============ Default-parity tests ============


def test_osm_task_defaults_match_gis() -> None:
    t = dt_client.OSMTask(
        output_folder_key="out",
        coords=(-122.34, 47.60, -122.33, 47.61),
        include_elevation=True,
    )
    assert t.ground_source == "terrarium"
    assert t.vegetation_source == "procedural"
    assert t.vegetation_density == pytest.approx(50.0)
    assert t.vegetation_scale_min == pytest.approx(0.8)
    assert t.vegetation_scale_max == pytest.approx(1.2)
    # cesium3dtiles_{b3dm,draco,gzip} default to None so asim_gis applies its
    # own defaults (b3dm=True, draco=False, gzip=True).
    assert t.cesium3dtiles_b3dm is None
    assert t.cesium3dtiles_draco is None
    assert t.cesium3dtiles_gzip is None
    assert t.cesium3dtiles_chunk_size is None
    assert t.cesium3dtiles_veg_instanced is True
    assert t.rough is True
    assert t.include_elevation is True
    assert t.disable_interiors is False
    assert t.terrain_clip_margin is None
    # terraform_config defaults to None (let asim_gis use HARMONIZE_PARAMS).
    assert t.terraform_config is None


def test_gml_task_defaults_match_gis() -> None:
    g = dt_client.GMLTask(
        output_folder_key="out",
        input_files=["/tmp/a.gml"],
        epsg_in="4326",
        include_elevation=False,
    )
    assert g.epsg_out is None
    assert g.ground_source == "terrarium"
    assert g.vegetation_source == "procedural"
    assert g.vegetation_density == pytest.approx(50.0)
    assert g.vegetation_scale_min == pytest.approx(0.8)
    assert g.vegetation_scale_max == pytest.approx(1.2)
    assert g.cesium3dtiles_b3dm is None
    assert g.cesium3dtiles_draco is None
    assert g.cesium3dtiles_gzip is None
    assert g.cesium3dtiles_chunk_size is None
    assert g.cesium3dtiles_veg_instanced is True
    assert g.rough is True
    assert g.include_elevation is False
    assert g.disable_interiors is False
    assert g.terrain_clip_margin is None
    assert g.terraform_config is None


# ============ Required-field tests ============


def test_gml_task_requires_epsg_in_and_include_elevation() -> None:
    with pytest.raises(TypeError):
        dt_client.GMLTask(output_folder_key="out", input_files=["/tmp/a.gml"])


def test_osm_task_requires_include_elevation() -> None:
    with pytest.raises(TypeError):
        dt_client.OSMTask(
            output_folder_key="out",
            coords=(-122.34, 47.60, -122.33, 47.61),
        )


# ============ Nullable-field tests ============


def test_nullable_fields_accept_none() -> None:
    t = dt_client.GMLTask(
        output_folder_key="out",
        input_files=["/tmp/a.gml"],
        epsg_in="4326",
        include_elevation=False,
        epsg_out=None,
        ground_source=None,
        cesium3dtiles_chunk_size=None,
        cesium3dtiles_b3dm=None,
        cesium3dtiles_draco=None,
        cesium3dtiles_gzip=None,
    )
    assert t.epsg_out is None
    assert t.ground_source is None
    assert t.cesium3dtiles_chunk_size is None
    assert t.cesium3dtiles_b3dm is None
    assert t.cesium3dtiles_draco is None
    assert t.cesium3dtiles_gzip is None


# ============ Field mutability tests ============


def test_osm_task_fields_are_writable() -> None:
    t = dt_client.OSMTask(
        output_folder_key="out",
        coords=(-122.34, 47.60, -122.33, 47.61),
        include_elevation=True,
    )
    t.vegetation_density = 75.0
    t.ground_source = "custom"
    t.cesium3dtiles_chunk_size = 500
    assert t.vegetation_density == pytest.approx(75.0)
    assert t.ground_source == "custom"
    assert t.cesium3dtiles_chunk_size == 500


def test_gml_task_fields_are_writable() -> None:
    g = dt_client.GMLTask(
        output_folder_key="out",
        input_files=["/tmp/a.gml"],
        epsg_in="4326",
        include_elevation=True,
    )
    g.epsg_in = "6697"
    g.cesium3dtiles_draco = True
    assert g.epsg_in == "6697"
    assert g.cesium3dtiles_draco is True


# ============ Custom-value construction tests ============


def test_osm_task_custom_values() -> None:
    t = dt_client.OSMTask(
        output_folder_key="custom",
        coords=(139.7, 35.6, 139.8, 35.7),
        include_elevation=False,
        vegetation_density=75.0,
        ground_source="custom_src",
        cesium3dtiles_b3dm=False,
    )
    assert t.vegetation_density == pytest.approx(75.0)
    assert t.ground_source == "custom_src"
    assert t.cesium3dtiles_b3dm is False
    assert t.include_elevation is False
    assert t.vegetation_source == "procedural"
    assert t.rough is True


def test_gml_task_custom_values() -> None:
    g = dt_client.GMLTask(
        output_folder_key="custom",
        input_files=["/data/a.gml", "/data/b.gml"],
        epsg_in="4326",
        include_elevation=True,
        epsg_out="32631",
        vegetation_source="lidar",
        cesium3dtiles_gzip=True,
    )
    assert g.epsg_in == "4326"
    assert g.epsg_out == "32631"
    assert g.vegetation_source == "lidar"
    assert g.cesium3dtiles_gzip is True
    assert len(g.input_files) == 2
    assert g.vegetation_density == pytest.approx(50.0)
    assert g.disable_interiors is False


# ============ Legacy field regression ============


def test_legacy_prepare_map_fields_are_not_exposed() -> None:
    t = dt_client.OSMTask(
        output_folder_key="out",
        coords=(-122.34, 47.60, -122.33, 47.61),
        include_elevation=True,
    )
    assert not hasattr(t, "name")
    assert not hasattr(t, "terrain_from_geotiff")
    assert not hasattr(t, "quantizedmesh_terrain_padding")
    assert not hasattr(t, "vegetation_seed")

    g = dt_client.GMLTask(
        output_folder_key="out",
        input_files=["/tmp/a.gml"],
        epsg_in="4326",
        include_elevation=False,
    )
    assert not hasattr(g, "vegetation_seed")


# ============ TerraformConfig tests ============


_TERRAFORM_FIELDS = (
    "terraform",
    "pad_radius",
    "pre_tessellation_length",
    "pre_smooth_terrain",
    "pre_smooth_iters",
    "pre_smooth_lambda",
    "terraform_smooth",
    "terraform_smooth_iters",
    "terraform_smooth_lambda",
    "terraform_smooth_radius",
    "building_base_method",
    "base_merge_distance",
    "base_influence_radius",
    "base_influence_sigma",
    "base_smooth_iters",
    "adaptive_bands",
    "near_radius",
    "near_tessellation_threshold",
    "far_tessellation_threshold",
)


def test_terraform_config_defaults_are_all_none() -> None:
    c = dt_client.TerraformConfig()
    for f in _TERRAFORM_FIELDS:
        assert getattr(c, f) is None, f"{f} should default to None"


def test_terraform_config_custom_values_round_trip() -> None:
    c = dt_client.TerraformConfig(
        terraform=True,
        pad_radius=100.0,
        pre_smooth_terrain=False,
        pre_smooth_iters=3,
        terraform_smooth_lambda=0.25,
        building_base_method="average",
        adaptive_bands=True,
        far_tessellation_threshold=2.5,
    )
    assert c.terraform is True
    assert c.pad_radius == pytest.approx(100.0)
    assert c.pre_smooth_terrain is False
    assert c.pre_smooth_iters == 3
    assert c.terraform_smooth_lambda == pytest.approx(0.25)
    assert c.building_base_method == "average"
    assert c.adaptive_bands is True
    assert c.far_tessellation_threshold == pytest.approx(2.5)
    # Untouched fields stay None.
    assert c.pre_tessellation_length is None
    assert c.terraform_smooth is None


def test_terraform_config_fields_are_writable() -> None:
    c = dt_client.TerraformConfig()
    c.terraform = True
    c.pad_radius = 50.0
    c.building_base_method = "top10"
    assert c.terraform is True
    assert c.pad_radius == pytest.approx(50.0)
    assert c.building_base_method == "top10"


def test_terraform_config_attaches_to_osm_and_gml_tasks() -> None:
    cfg = dt_client.TerraformConfig(terraform=True, pad_radius=42.0)
    t = dt_client.OSMTask(
        output_folder_key="out",
        coords=(-122.34, 47.60, -122.33, 47.61),
        include_elevation=True,
        terraform_config=cfg,
    )
    g = dt_client.GMLTask(
        output_folder_key="out",
        input_files=["/tmp/a.gml"],
        epsg_in="4326",
        include_elevation=False,
        terraform_config=cfg,
    )
    assert t.terraform_config is not None
    assert t.terraform_config.terraform is True
    assert t.terraform_config.pad_radius == pytest.approx(42.0)
    assert g.terraform_config is not None
    assert g.terraform_config.terraform is True


def test_terraform_config_assignment_after_construction() -> None:
    t = dt_client.OSMTask(
        output_folder_key="out",
        coords=(-122.34, 47.60, -122.33, 47.61),
        include_elevation=True,
    )
    assert t.terraform_config is None
    t.terraform_config = dt_client.TerraformConfig(terraform_smooth=True)
    assert t.terraform_config is not None
    assert t.terraform_config.terraform_smooth is True

