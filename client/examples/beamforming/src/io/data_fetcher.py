# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Fetch CFR and raypath data from Iceberg/S3."""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Iterable, List, Mapping, Optional, SupportsFloat, Tuple, Union

import duckdb
import numpy as np

from examples.beamforming.src.core.constants import (
    CFR_COLUMN_IM,
    CFR_COLUMN_RE,
    CFR_COLUMN_RU_ANT_EL,
    CFR_COLUMN_RU_ID,
    CFR_COLUMN_TIME_IDX,
    CFR_COLUMN_UE_ANT_EL,
    CFR_COLUMN_UE_ID,
    CFR_TABLE_FULL_NAME_TEMPLATE,
    CFR_TABLE_NAME,
    DEFAULT_ICEBERG_DATABASE,
    DUCKDB_HTTPFS_INSTALL_SQL,
    DUCKDB_S3_ACCESS_KEY_SETTING,
    DUCKDB_S3_ENDPOINT_SETTING,
    DUCKDB_S3_SECRET_KEY_SETTING,
    DUCKDB_S3_URL_STYLE_PATH,
    DUCKDB_S3_URL_STYLE_SETTING,
    DUCKDB_S3_USE_SSL_SETTING,
    EMPTY_CFR_PAIR_SHAPE,
    EMPTY_CFR_TENSOR_SHAPE,
    ICEBERG_CATALOG_NAME,
    ICEBERG_CATALOG_TYPE_KEY,
    ICEBERG_CATALOG_URI_KEY,
    MAX_FETCH_WORKERS,
    PARQUET_SCAN_FUNCTION,
    QUERY_LOG_TRUNCATE_CHARS,
    S3_ACCESS_KEY_PROPERTY,
    S3_ENDPOINT_PROPERTY,
    S3_REGION_PROPERTY,
    S3_SECRET_KEY_PROPERTY,
    URL_HTTP_PREFIX,
    URL_HTTPS_PREFIX,
)

try:
    from pyiceberg.catalog import load_catalog
    from pyiceberg.expressions import (
        And,
        EqualTo,
        GreaterThanOrEqual,
        LessThanOrEqual,
    )
except ImportError:
    load_catalog = None  # type: ignore[assignment,misc]
    And = EqualTo = GreaterThanOrEqual = LessThanOrEqual = None  # type: ignore[misc]

logger = logging.getLogger(__name__)

PARTIAL_VISIBILITY_POWER_DEVIATION_DB = 10.0
PARTIAL_VISIBILITY_POWER_EPS = np.finfo(np.float32).tiny
RAYPATH_TABLE_NAME = "raypaths"
RAYPATH_COLUMN_POINTS = "points"
RAYPATH_COLUMN_RU_ANT_EL = "ru_ant_el"
RAYPATH_COLUMN_UE_ANT_EL = "ue_ant_el"
RAYPATH_POSITION_SAMPLE_ROWS_PER_RU = 4096


def _ordered_struct_values(ant_el_dict: dict) -> tuple:
    """Return struct values sorted by numeric field key."""
    def _sort_key(k):
        s = str(k)
        return int(s) if s.lstrip("-").isdigit() else s

    keys_ordered = sorted(ant_el_dict.keys(), key=_sort_key)
    return tuple(ant_el_dict[k] for k in keys_ordered)


def _normalize_ru_ant_el_key(ru_ant_el):
    """Normalize RU antenna identifiers for grouping and indexing."""
    if isinstance(ru_ant_el, dict):
        if "y" in ru_ant_el:
            return (
                float(ru_ant_el["y"]),
                float(ru_ant_el["z"]),
                int(ru_ant_el["polz"]),
            )
        vals = _ordered_struct_values(ru_ant_el)
        if len(vals) >= 3:
            try:
                hor = int(float(vals[0]))
                ver = int(float(vals[1]))
                polz = int(float(vals[2]))
                return (hor, ver, polz)
            except (TypeError, ValueError):
                pass
        return vals
    if isinstance(ru_ant_el, (list, tuple)):
        if len(ru_ant_el) >= 3:
            try:
                return (
                    int(float(ru_ant_el[0])),
                    int(float(ru_ant_el[1])),
                    int(float(ru_ant_el[2])),
                )
            except (TypeError, ValueError):
                return tuple(ru_ant_el)
        return tuple(ru_ant_el)
    raise TypeError(f"Unexpected ru_ant_el type: {type(ru_ant_el)}")


def _normalize_ue_ant_el_key(ue_ant_el):
    if isinstance(ue_ant_el, dict):
        if "y" in ue_ant_el:
            return (
                float(ue_ant_el["y"]),
                float(ue_ant_el["z"]),
                int(ue_ant_el["polz"]),
            )
        vals = _ordered_struct_values(ue_ant_el)
        if len(vals) >= 3:
            try:
                return tuple(int(float(x)) for x in vals[:3])
            except (TypeError, ValueError):
                return vals
        return vals
    if isinstance(ue_ant_el, (list, tuple)):
        if len(ue_ant_el) >= 3:
            try:
                return tuple(int(float(x)) for x in ue_ant_el[:3])
            except (TypeError, ValueError):
                return tuple(ue_ant_el)
        return tuple(ue_ant_el)
    raise TypeError(f"Unexpected ue_ant_el type: {type(ue_ant_el)}")


def _try_tx_flat_index_mapping(ru_keys, n_tx: int):
    """Map complete grid antenna keys to flat TX indices."""
    if len(ru_keys) != n_tx:
        return None
    grid_triples = []
    for k in ru_keys:
        if (
            not isinstance(k, tuple)
            or len(k) < 3
            or not all(isinstance(x, int) for x in k[:3])
        ):
            return None
        grid_triples.append(k[:3])
    hors = [t[0] for t in grid_triples]
    vers = [t[1] for t in grid_triples]
    n_hor = max(hors) + 1
    n_ver_dim = max(vers) + 1
    if n_hor * n_ver_dim != n_tx:
        return None
    expected = {(h, v) for h in range(n_hor) for v in range(n_ver_dim)}
    got = {(t[0], t[1]) for t in grid_triples}
    if got != expected:
        return None
    flat_map = {}
    for k in ru_keys:
        h, v, _p = k[:3]
        flat_map[k] = h * n_ver_dim + v
    if set(flat_map.values()) != set(range(n_tx)):
        return None
    return flat_map



def _warn_if_partial_panel_visibility(
    cfrs_tensor: np.ndarray,
    ru_antenna_coords: List[tuple],
    time_indices: List[int],
    ru_id: int,
    ue_id: int,
    threshold_db: float = PARTIAL_VISIBILITY_POWER_DEVIATION_DB,
) -> None:
    """Log TX antenna power outliers before beamforming."""
    if cfrs_tensor.size == 0 or cfrs_tensor.ndim != 4:
        return
    if cfrs_tensor.shape[1] < 2:
        return

    tx_power = np.mean(np.abs(cfrs_tensor) ** 2, axis=(2, 3))
    tx_power_db = 10.0 * np.log10(
        np.maximum(tx_power, PARTIAL_VISIBILITY_POWER_EPS)
    )
    median_power_db = np.median(tx_power_db, axis=1)
    delta_db = np.abs(tx_power_db - median_power_db[:, np.newaxis])
    affected = np.argwhere(delta_db > threshold_db)
    if affected.size == 0:
        max_delta_by_tx = np.max(delta_db, axis=0)
        visibility_lines = [
            (
                f"ant idx {tx_idx} ele {ru_ant} clean "
                f"max_delta_db={float(max_delta_by_tx[tx_idx]):.2f} "
                f"threshold_db={threshold_db:.2f}"
            )
            for tx_idx, ru_ant in enumerate(ru_antenna_coords)
        ]
        logger.info(
            "Pre-flight panel visibility: RU=%s UE=%s\n%s",
            ru_id,
            ue_id,
            "\n".join(visibility_lines),
        )
        return

    first_time_idx, first_tx_idx = (int(v) for v in affected[0])
    time_value = (
        time_indices[first_time_idx]
        if first_time_idx < len(time_indices)
        else first_time_idx
    )
    ru_ant = (
        ru_antenna_coords[first_tx_idx]
        if first_tx_idx < len(ru_antenna_coords)
        else "unknown"
    )
    largest_delta_db = float(delta_db[affected[:, 0], affected[:, 1]].max())

    logger.warning(
        "Pre-flight partial panel visibility warning: RU=%s UE=%s "
        "time_idx=%s tx_idx=%s ru_ant=%s antenna_power_db=%.2f "
        "median_power_db=%.2f max_delta_db=%.2f threshold_db=%.2f",
        ru_id,
        ue_id,
        time_value,
        first_tx_idx,
        ru_ant,
        float(tx_power_db[first_time_idx, first_tx_idx]),
        float(median_power_db[first_time_idx]),
        largest_delta_db,
        threshold_db,
    )


def _normalize_raypath_point(
    point: Optional[
        Union[
            Mapping[str, SupportsFloat],
            Mapping[int, SupportsFloat],
            List[SupportsFloat],
            Tuple[SupportsFloat, ...],
        ]
    ],
) -> Optional[Tuple[float, float, float]]:
    """Normalize a raypath point to an xyz tuple."""
    if point is None:
        return None
    if isinstance(point, dict):
        if "x" in point:
            return (
                float(point["x"]),
                float(point["y"]),
                float(point["z"]),
            )
        if "1" in point:
            return (
                float(point["1"]),
                float(point["2"]),
                float(point["3"]),
            )
        if "0" in point:
            return (
                float(point["0"]),
                float(point["1"]),
                float(point["2"]),
            )
        ordered = _ordered_struct_values(point)
        if len(ordered) >= 3:
            return (
                float(ordered[0]),
                float(ordered[1]),
                float(ordered[2]),
            )
        return None
    if isinstance(point, (list, tuple)) and len(point) >= 3:
        return (float(point[0]), float(point[1]), float(point[2]))
    return None


def _first_raypath_tx_point(
    points: Optional[
        Union[
            Mapping[str, SupportsFloat],
            Mapping[int, SupportsFloat],
            List[SupportsFloat],
            Tuple[SupportsFloat, ...],
            List[
                Union[
                    Mapping[str, SupportsFloat],
                    Mapping[int, SupportsFloat],
                    List[SupportsFloat],
                    Tuple[SupportsFloat, ...],
                ]
            ],
            Tuple[
                Union[
                    Mapping[str, SupportsFloat],
                    Mapping[int, SupportsFloat],
                    List[SupportsFloat],
                    Tuple[SupportsFloat, ...],
                ],
                ...,
            ],
        ]
    ],
) -> Optional[Tuple[float, float, float]]:
    """Extract the first TX point from sampled raypath data."""
    if points is None:
        return None
    if isinstance(points, (list, tuple)) and points:
        first = points[0]
        if isinstance(first, (dict, list, tuple)):
            return _normalize_raypath_point(first)
    return _normalize_raypath_point(points)


def _collect_unique_raypath_tx_points(
    sampled_points: Iterable[
        Optional[
            Union[
                Mapping[str, SupportsFloat],
                Mapping[int, SupportsFloat],
                List[SupportsFloat],
                Tuple[SupportsFloat, ...],
                List[
                    Union[
                        Mapping[str, SupportsFloat],
                        Mapping[int, SupportsFloat],
                        List[SupportsFloat],
                        Tuple[SupportsFloat, ...],
                    ]
                ],
                Tuple[
                    Union[
                        Mapping[str, SupportsFloat],
                        Mapping[int, SupportsFloat],
                        List[SupportsFloat],
                        Tuple[SupportsFloat, ...],
                    ],
                    ...,
                ],
            ]
        ]
    ],
    expected_count: int,
) -> List[Tuple[float, float, float]]:
    """Collect unique TX points up to the expected panel count."""
    unique_points: Dict[Tuple[float, float, float], Tuple[float, float, float]] = {}
    for points in sampled_points:
        tx_point = _first_raypath_tx_point(points)
        if tx_point is None:
            continue
        key = tuple(round(value, 6) for value in tx_point)
        if key not in unique_points:
            unique_points[key] = tx_point
        if len(unique_points) >= expected_count:
            break
    return sorted(unique_points.values(), key=lambda point: (point[1], point[2], point[0]))


def _duckdb_parquet_columns(conn, files_str: str) -> set[str]:
    """Read Parquet column names visible to DuckDB."""
    rows = conn.execute(
        f"DESCRIBE SELECT * FROM {PARQUET_SCAN_FUNCTION}([{files_str}])"
    ).fetchall()
    return {str(row[0]) for row in rows}


def _format_raypath_db_stats(
    ru_id: int,
    max_rays_per_ant_pair_per_time: Optional[Union[int, float]],
    max_interactions_per_ray: Optional[Union[int, float]],
) -> str:

    """Format raypath table diagnostics for one RU."""
    rays_label = (
        str(int(max_rays_per_ant_pair_per_time))
        if max_rays_per_ant_pair_per_time is not None
        else "unavailable"
    )
    interactions_label = (
        str(int(max_interactions_per_ray))
        if max_interactions_per_ray is not None
        else "unavailable"
    )
    return (
        f"Raypath DB stats: RU={ru_id} "
        f"max_rays_per_ant_pair_per_time={rays_label} "
        f"max_interactions_per_ray={interactions_label}"
    )


def _format_raypath_abs_position(
    raypath_tx_positions: List[Tuple[float, float, float]],
    idx: int,
) -> str:
    """Format one sampled absolute TX point."""
    if idx >= len(raypath_tx_positions):
        return "raypath abs unavailable"
    pos = raypath_tx_positions[idx]
    return (
        f"raypath abs x={pos[0]:.6f} y={pos[1]:.6f} "
        f"z={pos[2]:.6f} cartesian"
    )


def log_position_extraction(
    antenna_locations: np.ndarray,
    panel_name: str,
    ru_id: int,
    center_position: Tuple[float, float, float],
    raypath_tx_positions: List[Tuple[float, float, float]],
    wavelength_m: float,
) -> None:
    """Log local and sampled antenna positions."""
    if antenna_locations.size == 0:
        return

    antenna_locations_lambda = antenna_locations / wavelength_m
    position_lines = [
        (
            f"ant idx {idx} rel x={float(pos[0]):.6f} "
            f"y={float(pos[1]):.6f} z={float(pos[2]):.6f} lambda | "
            f"{_format_raypath_abs_position(raypath_tx_positions, idx)}"
        )
        for idx, pos in enumerate(antenna_locations_lambda)
    ]
    logger.info(
        "PIPELINE: extracted antenna positions (RU=%s panel %s)\n"
        "center cartesian x=%.6f y=%.6f z=%.6f\n%s",
        ru_id,
        panel_name,
        center_position[0],
        center_position[1],
        center_position[2],
        "\n".join(position_lines),
    )


def fetch_raypath_tx_positions_from_iceberg(
    iceberg_config,
    ru_ids: List[int],
    expected_tx_counts: Dict[int, int],
    time_range: Optional[Tuple[int, int]],
    s3_config=None,
    max_rows_per_ru: int = RAYPATH_POSITION_SAMPLE_ROWS_PER_RU,
) -> Dict[int, List[Tuple[float, float, float]]]:
    """Sample raypath TX positions by RU."""
    if load_catalog is None or And is None:
        raise ImportError(
            "PyIceberg is required for raypath position sampling. "
            "Install with: pip install pyiceberg"
        )

    catalog_properties = {
        ICEBERG_CATALOG_URI_KEY: iceberg_config.catalog_uri,
        ICEBERG_CATALOG_TYPE_KEY: iceberg_config.catalog_type,
    }
    if s3_config:
        if s3_config.endpoint_url:
            catalog_properties[S3_ENDPOINT_PROPERTY] = s3_config.endpoint_url
        if s3_config.access_key:
            catalog_properties[S3_ACCESS_KEY_PROPERTY] = s3_config.access_key
        if s3_config.secret_key:
            catalog_properties[S3_SECRET_KEY_PROPERTY] = s3_config.secret_key
        if s3_config.region:
            catalog_properties[S3_REGION_PROPERTY] = s3_config.region

    catalog = load_catalog(ICEBERG_CATALOG_NAME, **catalog_properties)
    database = iceberg_config.database or DEFAULT_ICEBERG_DATABASE
    table_name = CFR_TABLE_FULL_NAME_TEMPLATE.format(
        database=database,
        table=RAYPATH_TABLE_NAME,
    )
    table = catalog.load_table(table_name)

    conn = duckdb.connect()
    conn.execute(DUCKDB_HTTPFS_INSTALL_SQL)
    if s3_config:
        if s3_config.access_key:
            conn.execute(f"SET {DUCKDB_S3_ACCESS_KEY_SETTING}='{s3_config.access_key}'")
        if s3_config.secret_key:
            conn.execute(f"SET {DUCKDB_S3_SECRET_KEY_SETTING}='{s3_config.secret_key}'")
        if s3_config.endpoint_url:
            endpoint = s3_config.endpoint_url.replace(URL_HTTP_PREFIX, "").replace(
                URL_HTTPS_PREFIX, ""
            )
            conn.execute(f"SET {DUCKDB_S3_ENDPOINT_SETTING}='{endpoint}'")
            conn.execute(f"SET {DUCKDB_S3_USE_SSL_SETTING}=false")
            conn.execute(
                f"SET {DUCKDB_S3_URL_STYLE_SETTING}='{DUCKDB_S3_URL_STYLE_PATH}'"
            )

    sampled_by_ru: Dict[int, List[Tuple[float, float, float]]] = {}
    try:
        for ru_id in ru_ids:
            row_filter = _build_raypath_row_filter(ru_id, time_range)
            scan = table.scan(row_filter=row_filter)
            files = [task.file.file_path for task in scan.plan_files()]
            if not files:
                continue
            files_str = ", ".join(f"'{f}'" for f in files)
            available_columns = _duckdb_parquet_columns(conn, files_str)
            stats_query = _build_raypath_db_stats_duckdb_query(
                files_str=files_str,
                ru_id=ru_id,
                time_range=time_range,
                available_columns=available_columns,
            )
            max_rays_per_ant_pair_per_time, max_interactions_per_ray = (
                conn.execute(stats_query).fetchone()
            )
            logger.info(
                "%s",
                _format_raypath_db_stats(
                    ru_id=ru_id,
                    max_rays_per_ant_pair_per_time=max_rays_per_ant_pair_per_time,
                    max_interactions_per_ray=max_interactions_per_ray,
                ),
            )
            query = _build_raypath_position_duckdb_query(
                files_str=files_str,
                ru_id=ru_id,
                time_range=time_range,
                limit=max_rows_per_ru,
            )
            rows = conn.execute(query).fetchall()
            sampled_by_ru[ru_id] = _collect_unique_raypath_tx_points(
                (row[3] for row in rows),
                expected_tx_counts.get(ru_id, 0),
            )
            logger.info(
                "Raypath position sample: RU=%s collected %s/%s TX element points",
                ru_id,
                len(sampled_by_ru[ru_id]),
                expected_tx_counts.get(ru_id, 0),
            )
    finally:
        conn.close()

    return sampled_by_ru


def fetch_raypath_ray_counts_by_tx_element_from_iceberg(
    iceberg_config,
    ru_ids: List[int],
    time_range: Optional[Tuple[int, int]],
    s3_config=None,
) -> Dict[int, List[int]]:
    """Count raypath rows by RU antenna element."""
    if load_catalog is None or And is None:
        raise ImportError(
            "PyIceberg is required for raypath count sampling. "
            "Install with: pip install pyiceberg"
        )

    catalog_properties = {
        ICEBERG_CATALOG_URI_KEY: iceberg_config.catalog_uri,
        ICEBERG_CATALOG_TYPE_KEY: iceberg_config.catalog_type,
    }
    if s3_config:
        if s3_config.endpoint_url:
            catalog_properties[S3_ENDPOINT_PROPERTY] = s3_config.endpoint_url
        if s3_config.access_key:
            catalog_properties[S3_ACCESS_KEY_PROPERTY] = s3_config.access_key
        if s3_config.secret_key:
            catalog_properties[S3_SECRET_KEY_PROPERTY] = s3_config.secret_key
        if s3_config.region:
            catalog_properties[S3_REGION_PROPERTY] = s3_config.region

    catalog = load_catalog(ICEBERG_CATALOG_NAME, **catalog_properties)
    database = iceberg_config.database or DEFAULT_ICEBERG_DATABASE
    table_name = CFR_TABLE_FULL_NAME_TEMPLATE.format(
        database=database,
        table=RAYPATH_TABLE_NAME,
    )
    table = catalog.load_table(table_name)

    conn = duckdb.connect()
    conn.execute(DUCKDB_HTTPFS_INSTALL_SQL)
    if s3_config:
        if s3_config.access_key:
            conn.execute(f"SET {DUCKDB_S3_ACCESS_KEY_SETTING}='{s3_config.access_key}'")
        if s3_config.secret_key:
            conn.execute(f"SET {DUCKDB_S3_SECRET_KEY_SETTING}='{s3_config.secret_key}'")
        if s3_config.endpoint_url:
            endpoint = s3_config.endpoint_url.replace(URL_HTTP_PREFIX, "").replace(
                URL_HTTPS_PREFIX,
                "",
            )
            conn.execute(f"SET {DUCKDB_S3_ENDPOINT_SETTING}='{endpoint}'")
            conn.execute(f"SET {DUCKDB_S3_USE_SSL_SETTING}=false")
            conn.execute(
                f"SET {DUCKDB_S3_URL_STYLE_SETTING}='{DUCKDB_S3_URL_STYLE_PATH}'"
            )

    ray_counts_by_ru: Dict[int, List[int]] = {}
    try:
        for ru_id in ru_ids:
            row_filter = _build_raypath_row_filter(ru_id, time_range)
            scan = table.scan(row_filter=row_filter)
            files = [task.file.file_path for task in scan.plan_files()]
            if not files:
                continue
            files_str = ", ".join(f"'{f}'" for f in files)
            available_columns = _duckdb_parquet_columns(conn, files_str)
            if RAYPATH_COLUMN_RU_ANT_EL not in available_columns:
                raise RuntimeError(
                    f"Raypath table is missing {RAYPATH_COLUMN_RU_ANT_EL!r}"
                )

            query = _build_raypath_tx_element_count_duckdb_query(
                files_str=files_str,
                ru_id=ru_id,
                time_range=time_range,
            )
            rows = conn.execute(query).fetchall()
            counts_by_key = {
                _normalize_ru_ant_el_key(ru_ant_el): int(ray_count)
                for ru_ant_el, ray_count in rows
            }
            ray_counts_by_ru[int(ru_id)] = [
                count
                for _ru_ant_key, count in sorted(
                    counts_by_key.items(),
                    key=lambda item: item[0],
                )
            ]
            logger.info(
                "Raypath rays by TX antenna: RU=%s counts=%s",
                ru_id,
                ray_counts_by_ru[int(ru_id)],
            )
    finally:
        conn.close()

    return ray_counts_by_ru


def fetch_cfr_from_iceberg(
    iceberg_config,
    ru_id: int,
    ue_id: int,
    time_range: Optional[Tuple[int, int]],
    s3_config=None,
) -> np.ndarray:
    """Fetch one RU/UE CFR tensor from Iceberg-backed Parquet."""
    if load_catalog is None or And is None:
        raise ImportError(
            "PyIceberg is required for Iceberg data fetching. "
            "Install with: pip install pyiceberg"
        )

    time_label = (
        f"[{time_range[0]}, {time_range[1]}]"
        if time_range is not None
        else "all available"
    )
    logger.debug(
        f"Fetching CFRs from Iceberg: ru_id={ru_id}, ue_id={ue_id}, "
        f"time={time_label}"
    )
    
    # Build catalog properties
    catalog_properties = {
        ICEBERG_CATALOG_URI_KEY: iceberg_config.catalog_uri,
        ICEBERG_CATALOG_TYPE_KEY: iceberg_config.catalog_type,
    }
    
    # Add S3 configuration if provided
    if s3_config:
        if s3_config.endpoint_url:
            catalog_properties[S3_ENDPOINT_PROPERTY] = s3_config.endpoint_url
        if s3_config.access_key:
            catalog_properties[S3_ACCESS_KEY_PROPERTY] = s3_config.access_key
        if s3_config.secret_key:
            catalog_properties[S3_SECRET_KEY_PROPERTY] = s3_config.secret_key
        if s3_config.region:
            catalog_properties[S3_REGION_PROPERTY] = s3_config.region
    
    # Load Iceberg catalog
    catalog = load_catalog(ICEBERG_CATALOG_NAME, **catalog_properties)
    
    # Determine table name (namespace.table)
    database = iceberg_config.database or DEFAULT_ICEBERG_DATABASE
    table_name = CFR_TABLE_FULL_NAME_TEMPLATE.format(
        database=database,
        table=CFR_TABLE_NAME,
    )
    
    logger.debug(f"Loading Iceberg table: {table_name}")
    
    # Load table
    try:
        table = catalog.load_table(table_name)
    except Exception as e:
        logger.error(f"Failed to load Iceberg table '{table_name}': {e}")
        logger.error(f"Available namespaces: {catalog.list_namespaces()}")
        raise
    
    row_filter = _build_cfr_row_filter(
        ru_id=ru_id,
        ue_id=ue_id,
        time_range=time_range,
    )
    
    logger.debug(f"Iceberg filter: {row_filter}")
    
    # Scan table with filter
    scan = table.scan(row_filter=row_filter)
    files = [task.file.file_path for task in scan.plan_files()]
    
    if not files:
        logger.warning(f"No data files found for ru_id={ru_id}, ue_id={ue_id}")
        # Return empty array with shape [0, 0, 0]
        return np.empty(EMPTY_CFR_PAIR_SHAPE, dtype=np.complex64)
    
    logger.debug(f"Found {len(files)} Parquet files to query")
    
    # Query using DuckDB
    conn = duckdb.connect()
    conn.execute(DUCKDB_HTTPFS_INSTALL_SQL)
    
    # Configure S3 credentials for DuckDB
    if s3_config:
        if s3_config.access_key:
            conn.execute(f"SET {DUCKDB_S3_ACCESS_KEY_SETTING}='{s3_config.access_key}'")
        if s3_config.secret_key:
            conn.execute(f"SET {DUCKDB_S3_SECRET_KEY_SETTING}='{s3_config.secret_key}'")
        if s3_config.endpoint_url:
            endpoint = s3_config.endpoint_url.replace(URL_HTTP_PREFIX, "").replace(
                URL_HTTPS_PREFIX, ""
            )
            conn.execute(f"SET {DUCKDB_S3_ENDPOINT_SETTING}='{endpoint}'")
            conn.execute(f"SET {DUCKDB_S3_USE_SSL_SETTING}=false")
            conn.execute(
                f"SET {DUCKDB_S3_URL_STYLE_SETTING}='{DUCKDB_S3_URL_STYLE_PATH}'"
            )
    
    files_str = ", ".join(f"'{f}'" for f in files)
    query = _build_cfr_duckdb_query(
        files_str=files_str,
        ru_id=ru_id,
        ue_id=ue_id,
        time_range=time_range,
    )
    
    logger.debug(
        f"Executing DuckDB query (truncated): {query[:QUERY_LOG_TRUNCATE_CHARS]}..."
    )
    
    # Execute query and fetch results
    result = conn.execute(query).fetchall()
    conn.close()
    
    if not result:
        logger.warning(f"Query returned no results for ru_id={ru_id}, ue_id={ue_id}")
        return np.empty(EMPTY_CFR_PAIR_SHAPE, dtype=np.complex64)
    
    logger.debug(f"Fetched {len(result)} CFR measurements")
    
    # Group CFRs by (time_idx, ru_ant_el, ue_ant_el)
    # Structure: {time_idx: {ru_ant_el: {ue_ant_el: cfr_tensor}}}
    grouped_cfrs = {}
    
    for row in result:
        ru_id_val, ue_id_val, time_idx, ru_ant_el, ue_ant_el, cfr_re, cfr_im = row
                
        ru_key = _normalize_ru_ant_el_key(ru_ant_el)
        ue_key = _normalize_ue_ant_el_key(ue_ant_el)
        
        # Convert CFR to numpy array
        cfr_re_arr = np.array(cfr_re, dtype=np.float32)
        cfr_im_arr = np.array(cfr_im, dtype=np.float32)
        cfr_complex = cfr_re_arr + 1j * cfr_im_arr
        
        # Skip all-zero CFRs
        if np.all(cfr_complex == 0):
            logger.warning(
                f"All-zero CFR: time={time_idx}, ru_ant={ru_key}, ue_ant={ue_key}"
            )
        
        # Group by time_idx, ru_ant_el, and ue_ant_el
        if time_idx not in grouped_cfrs:
            grouped_cfrs[time_idx] = {}
        if ru_key not in grouped_cfrs[time_idx]:
            grouped_cfrs[time_idx][ru_key] = {}
        
        # Store CFR indexed by both TX and RX antenna coordinates
        grouped_cfrs[time_idx][ru_key][ue_key] = cfr_complex
    
    if not grouped_cfrs:
        logger.warning("All CFRs were zero or invalid")
        return np.empty(EMPTY_CFR_TENSOR_SHAPE, dtype=np.complex64)
    
    # Determine dimensions
    time_indices = sorted(grouped_cfrs.keys())
    N_time = len(time_indices)
    
    # Get TX antenna indices from first time step
    first_time = time_indices[0]
    ru_antenna_coords = sorted(grouped_cfrs[first_time].keys())
    N_tx_antennas = len(ru_antenna_coords)
    
    tx_flat_by_ru_key = _try_tx_flat_index_mapping(
        ru_antenna_coords, N_tx_antennas
    )
    if tx_flat_by_ru_key is not None:
        ru_coord_to_tx_idx = tx_flat_by_ru_key
        logger.debug(
            "CFR tensor TX axis: flat index hor*n_ver+ver "
            "(aligned with beamforming weight vector order)"
        )
    else:
        ru_coord_to_tx_idx = {c: i for i, c in enumerate(ru_antenna_coords)}
    
    # Get RX antenna indices from first TX antenna
    first_ru_ant = ru_antenna_coords[0]
    ue_antenna_coords = sorted(grouped_cfrs[first_time][first_ru_ant].keys())
    N_ue_antennas = len(ue_antenna_coords)
    
    # Get frequency dimension from first CFR
    first_cfr = grouped_cfrs[first_time][first_ru_ant][ue_antenna_coords[0]]
    N_freq = first_cfr.shape[0]
    
    logger.debug(f"CFR dimensions: N_time={N_time}, N_tx_antennas={N_tx_antennas}, "
                 f"N_ue_antennas={N_ue_antennas}, N_freq={N_freq}")
    
    # Build output tensor [N_time, N_tx_antennas, N_ue_antennas, N_freq]
    cfrs_tensor = np.zeros((N_time, N_tx_antennas, N_ue_antennas, N_freq),
                           dtype=np.complex64)
    
    for t_idx, time_val in enumerate(time_indices):
        for ru_ant_coord in ru_antenna_coords:
            tx_idx = ru_coord_to_tx_idx[ru_ant_coord]
            for rx_idx, ue_ant_coord in enumerate(ue_antenna_coords):
                if (ru_ant_coord in grouped_cfrs[time_val] and 
                    ue_ant_coord in grouped_cfrs[time_val][ru_ant_coord]):
                    cfrs_tensor[t_idx, tx_idx, rx_idx, :] = \
                        grouped_cfrs[time_val][ru_ant_coord][ue_ant_coord]
                else:
                    logger.warning(f"Missing CFR for time={time_val}, "
                                 f"ru_ant={ru_ant_coord}, ue_ant={ue_ant_coord}")
    
    logger.debug(f"Successfully built CFR tensor: {cfrs_tensor.shape}")

    _warn_if_partial_panel_visibility(
        cfrs_tensor=cfrs_tensor,
        ru_antenna_coords=ru_antenna_coords,
        time_indices=time_indices,
        ru_id=ru_id,
        ue_id=ue_id,
    )
    
    return cfrs_tensor


def fetch_all_ru_ue_pairs(
    iceberg_config,
    ru_ids: List[int],
    ue_ids: List[int],
    time_range: Optional[Tuple[int, int]],
    s3_config=None,
) -> Dict[Tuple[int, int], np.ndarray]:
    """Fetch CFR tensors for all requested RU/UE pairs."""
    logger.info(f"Fetching CFRs for {len(ru_ids)} RUs x {len(ue_ids)} UEs = "
                f"{len(ru_ids) * len(ue_ids)} pairs")
    
    cfr_data = {}

    pairs = [(ru_id, ue_id) for ru_id in ru_ids for ue_id in ue_ids]

    def _fetch_one(pair):
        ru_id, ue_id = pair
        logger.debug(f"Fetching RU={ru_id}, UE={ue_id}...")
        return pair, fetch_cfr_from_iceberg(
            iceberg_config=iceberg_config,
            ru_id=ru_id,
            ue_id=ue_id,
            time_range=time_range,
            s3_config=s3_config,
        )

    with ThreadPoolExecutor(max_workers=min(len(pairs), MAX_FETCH_WORKERS)) as pool:
        for (ru_id, ue_id), cfrs in pool.map(_fetch_one, pairs):
            if cfrs.size > 0:
                cfr_data[(ru_id, ue_id)] = cfrs
            else:
                logger.warning(f"No CFRs found for RU={ru_id}, UE={ue_id}")
    
    logger.info(f"Successfully fetched CFRs for {len(cfr_data)} RU-UE pairs")
    
    return cfr_data


def _build_cfr_row_filter(
    ru_id: int,
    ue_id: int,
    time_range: Optional[Tuple[int, int]],
):
    """Build the Iceberg row filter for one RU/UE pair."""
    base_filter = And(
        EqualTo(CFR_COLUMN_RU_ID, ru_id),
        EqualTo(CFR_COLUMN_UE_ID, ue_id),
    )
    if time_range is None:
        return base_filter

    min_time, max_time = time_range
    return And(
        base_filter,
        And(
            GreaterThanOrEqual(CFR_COLUMN_TIME_IDX, min_time),
            LessThanOrEqual(CFR_COLUMN_TIME_IDX, max_time),
        ),
    )


def _build_raypath_row_filter(
    ru_id: int,
    time_range: Optional[Tuple[int, int]],
):
    """Build the Iceberg row filter for one RU raypath position sample."""
    base_filter = EqualTo(CFR_COLUMN_RU_ID, ru_id)
    if time_range is None:
        return base_filter

    min_time, max_time = time_range
    return And(
        base_filter,
        And(
            GreaterThanOrEqual(CFR_COLUMN_TIME_IDX, min_time),
            LessThanOrEqual(CFR_COLUMN_TIME_IDX, max_time),
        ),
    )


def _build_cfr_duckdb_query(
    files_str: str,
    ru_id: int,
    ue_id: int,
    time_range: Optional[Tuple[int, int]],
) -> str:
    """Build the DuckDB CFR query for one RU/UE pair."""
    time_filter = ""
    if time_range is not None:
        min_time, max_time = time_range
        time_filter = (
            f"\n          AND {CFR_COLUMN_TIME_IDX} >= {min_time}"
            f"\n          AND {CFR_COLUMN_TIME_IDX} <= {max_time}"
        )

    return f"""
        SELECT {CFR_COLUMN_RU_ID}, {CFR_COLUMN_UE_ID}, {CFR_COLUMN_TIME_IDX},
               {CFR_COLUMN_RU_ANT_EL}, {CFR_COLUMN_UE_ANT_EL},
               {CFR_COLUMN_RE}, {CFR_COLUMN_IM}
        FROM {PARQUET_SCAN_FUNCTION}([{files_str}])
        WHERE {CFR_COLUMN_RU_ID} = {ru_id} AND {CFR_COLUMN_UE_ID} = {ue_id}{time_filter}
        ORDER BY {CFR_COLUMN_TIME_IDX}, {CFR_COLUMN_RU_ANT_EL}
    """


def _build_raypath_position_duckdb_query(
    files_str: str,
    ru_id: int,
    time_range: Optional[Tuple[int, int]],
    limit: int,
) -> str:
    """Build a DuckDB raypath query for TX position sampling."""
    time_filter = ""
    if time_range is not None:
        min_time, max_time = time_range
        time_filter = (
            f"\n          AND {CFR_COLUMN_TIME_IDX} >= {min_time}"
            f"\n          AND {CFR_COLUMN_TIME_IDX} <= {max_time}"
        )

    return f"""
        SELECT {CFR_COLUMN_RU_ID}, {CFR_COLUMN_UE_ID}, {CFR_COLUMN_TIME_IDX},
               {RAYPATH_COLUMN_POINTS}
        FROM {PARQUET_SCAN_FUNCTION}([{files_str}])
        WHERE {CFR_COLUMN_RU_ID} = {ru_id}{time_filter}
        ORDER BY {CFR_COLUMN_TIME_IDX}, {CFR_COLUMN_UE_ID}
        LIMIT {int(limit)}
    """


def _build_raypath_tx_element_count_duckdb_query(
    files_str: str,
    ru_id: int,
    time_range: Optional[Tuple[int, int]],
) -> str:
    """Build a DuckDB raypath count query grouped by TX antenna element."""
    time_filter = ""
    if time_range is not None:
        min_time, max_time = time_range
        time_filter = (
            f"\n          AND {CFR_COLUMN_TIME_IDX} >= {min_time}"
            f"\n          AND {CFR_COLUMN_TIME_IDX} <= {max_time}"
        )

    return f"""
        SELECT {RAYPATH_COLUMN_RU_ANT_EL}, COUNT(*) AS ray_count
        FROM {PARQUET_SCAN_FUNCTION}([{files_str}])
        WHERE {CFR_COLUMN_RU_ID} = {ru_id}{time_filter}
        GROUP BY {RAYPATH_COLUMN_RU_ANT_EL}
    """


def _build_raypath_db_stats_duckdb_query(
    files_str: str,
    ru_id: int,
    time_range: Optional[Tuple[int, int]],
    available_columns: set[str],
) -> str:
    """Build a DuckDB query for raypath table max-count diagnostics."""
    time_filter = ""
    if time_range is not None:
        min_time, max_time = time_range
        time_filter = (
            f"\n          AND {CFR_COLUMN_TIME_IDX} >= {min_time}"
            f"\n          AND {CFR_COLUMN_TIME_IDX} <= {max_time}"
        )

    has_ant_pair = {
        RAYPATH_COLUMN_RU_ANT_EL,
        RAYPATH_COLUMN_UE_ANT_EL,
    }.issubset(available_columns)
    pair_counts_cte = ""
    max_rays_expr = "NULL::BIGINT"
    if has_ant_pair:
        pair_counts_cte = f"""
        , pair_counts AS (
            SELECT {CFR_COLUMN_TIME_IDX}, {RAYPATH_COLUMN_RU_ANT_EL}, {RAYPATH_COLUMN_UE_ANT_EL}, COUNT(*) AS ray_count
            FROM base
            GROUP BY {CFR_COLUMN_TIME_IDX}, {RAYPATH_COLUMN_RU_ANT_EL}, {RAYPATH_COLUMN_UE_ANT_EL}
        )"""
        max_rays_expr = "(SELECT MAX(ray_count) FROM pair_counts)"

    return f"""
        WITH base AS (
            SELECT *
            FROM {PARQUET_SCAN_FUNCTION}([{files_str}])
            WHERE {CFR_COLUMN_RU_ID} = {ru_id}{time_filter}
        ){pair_counts_cte}
        SELECT
            {max_rays_expr} AS max_rays_per_ant_pair_per_time,
            MAX(array_length({RAYPATH_COLUMN_POINTS}) - 2) AS max_interactions_per_ray
        FROM base
    """
