#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Quick start (local Nessie + MinIO):
#   python3 ran_metric.py --database basic6 --ru_id 1 --ue_id 1 --sample 0
#
# Add --s3_endpoint, --s3_access_key, --s3_secret_key, or --iceberg_uri when
# connecting to non-default storage/catalog services.
#
# This script reads telemetry rows for one sample/RU/UE tuple from the Iceberg telemetry
# table and calculates the BLER, instantaneous UE rate, average UE throughput, and PF metric.

from __future__ import annotations
import re
import duckdb
from duckdb import DuckDBPyConnection
import numpy as np
from pyiceberg.catalog import load_catalog
from pyiceberg.catalog import Catalog
import argparse
import sys
import matplotlib.pyplot as plt
from typing import Optional


def connect_catalog(
    catalog_type: str,
    catalog_uri: Optional[str],
    aws_region: Optional[str] = None,
    s3_access_key: Optional[str] = None,
    s3_secret_key: Optional[str] = None,
):
    """Build and return a PyIceberg catalog.

    For REST catalogs, warehouse and S3 file I/O settings are owned by the
    catalog service and returned through the catalog configuration.
    """
    from pyiceberg.catalog import load_catalog

    if catalog_type == "rest":
        props = {"type": "rest", "uri": catalog_uri}
    elif catalog_type == "glue":
        props = {"type": "glue"}
        if aws_region:
            props["region_name"] = aws_region
            props["s3.region"] = aws_region
    else:
        print(f"Error: Unsupported catalog type '{catalog_type}'")
        print("  Supported types: rest, glue")
        sys.exit(1)

    if s3_access_key and s3_secret_key:
        # Credentials are still client-side: the catalog points at the object
        # store, but PyIceberg needs permission to read metadata and data files.
        props["s3.access-key-id"] = s3_access_key
        props["s3.secret-access-key"] = s3_secret_key
        props["client.access-key-id"] = s3_access_key
        props["client.secret-access-key"] = s3_secret_key

    label = catalog_uri if catalog_type == "rest" else f"AWS Glue ({aws_region})"
    print(f"Connecting to {catalog_type.upper()} catalog at {label} ...")

    catalog = load_catalog("default", **props)
    print()
    return catalog


def load_iceberg_catalog(
    warehouse: str = "s3://aerial-data",
    endpoint: str = "http://localhost:9000",
    access_key: str = "minioadmin",
    secret_key: str = "minioadmin",
    rest_uri: str = "http://localhost:19120/iceberg",
    catalog_name: str = "default",
) -> Catalog:
    props = {
        "warehouse": warehouse,
        "type": "rest",
        "uri": rest_uri,
        "s3.endpoint": endpoint,
        "s3.access-key-id": access_key,
        "s3.secret-access-key": secret_key,
        "client.access-key-id": access_key,
        "client.secret-access-key": secret_key,
    }
    return load_catalog(catalog_name, **props)


def connect_duckdb_s3(
    endpoint: str = "http://localhost:9000",
    access_key: str = "minioadmin",
    secret_key: str = "minioadmin",
    region: str = "us-east-1",
) -> DuckDBPyConnection:
    host = endpoint.replace("http://", "").replace("https://", "")
    ssl = endpoint.startswith("https://")
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute(f"SET s3_endpoint = {host!r}")
    con.execute("SET s3_url_style = 'path'")
    con.execute("SET s3_use_ssl = " + ("true" if ssl else "false"))
    con.execute("SET s3_access_key_id = " + repr(access_key))
    con.execute("SET s3_secret_access_key = " + repr(secret_key))
    con.execute(f"SET s3_region = {region!r}")
    return con

def load_table(
    con: DuckDBPyConnection,
    s3_bucket: str,
    catalog: Catalog,
    database: tuple[str, ...] | str,
    table_name: str,
    columns: list[str] | None = None,
):
    namespace = (
        tuple(p for p in database.split("/") if p)
        if isinstance(database, str)
        else database
    )
    iceberg_table = catalog.load_table((*namespace, table_name))
    scan = iceberg_table.scan()
    files = [task.file.file_path for task in scan.plan_files()]
    files_str = ", ".join(
        "'" + re.sub(r"^s3://[^/]+", f"s3://{s3_bucket}", f) + "'" for f in files
    )
    cols = ["*"] if columns is None else columns
    select_cols = ", ".join(cols) if cols else "*"
    query = f"SELECT {select_cols} FROM parquet_scan([{files_str}])"
    return con.execute(query).fetchdf()

def build_telemetry_data(data, con: DuckDBPyConnection, s3_bucket: str, namespace_path: str):

    ch_to_pd_types = {
        'UInt32': 'uint32',
        'UInt8': 'uint8',
        'String': 'string',
        'Float32': 'float32'
    }

    '''
    # If you need separate lists for names and types
    column_names = [col[0] for col in column_info]
    column_types = [col[0] for col in column_info]


    # Convert DataFrame column data types
    for col, ch_type in zip(data.columns, column_types):
        pd_type = ch_to_pd_types[ch_type]
        data[col] = data[col].astype(pd_type)
    '''    
    unique_batch_ids = data['batch_id'].unique()

    for batch_id in unique_batch_ids:
        batch_data = data[data['batch_id'] == batch_id]
        
        sorted_unique_ue_ids = sorted(batch_data['ue_id'].unique())
        ue_num = batch_data['ue_id'].nunique()
        slot_num = np.max(batch_data['slot_id']) + 1

        bler = {"DL": np.ones((ue_num, slot_num)) * -1, "UL": np.ones((ue_num, slot_num)) * -1}
        outcome = np.ones((ue_num, slot_num)) * -1 # -1: not scheduled. 1: success. 0: fail
        insRate = {"DL": np.zeros((ue_num, slot_num)), "UL": np.zeros((ue_num, slot_num))}
        AvgTput = {"DL": np.zeros((ue_num, slot_num)), "UL": np.zeros((ue_num, slot_num))}
        TPUT_COEFFICIENT = 0.001

        for row_idx, slot_id in enumerate(batch_data["slot_id"]):
            link = batch_data['link'][row_idx]
            ue_id = batch_data["ue_id"][row_idx]
            ue_idx = sorted_unique_ue_ids.index(ue_id)
            
            outcome[ue_idx, slot_id] = batch_data["outcome"][row_idx]
            bler[link][ue_idx, slot_id] = sum(outcome[ue_idx, :(slot_id+1)] == 0) / sum(outcome[ue_idx, :(slot_id+1)] != -1)

            if outcome[ue_idx, slot_id] == 1:
                insRate[link][ue_idx, slot_id] = np.round(8 * batch_data["tbs"][row_idx] / 0.0005 / 1000 / 1000, 2) # Mbps
                    
        for ue_idx in np.arange(ue_num):
            for slot_id in np.arange(slot_num):   
                for link in ["DL", "UL"]:    
                    if slot_id > 0:
                        AvgTput[link][ue_idx, slot_id] =  insRate[link][ue_idx, slot_id]*TPUT_COEFFICIENT + (1-TPUT_COEFFICIENT)*AvgTput[link][ue_idx, slot_id-1]
                    else:
                        AvgTput[link][ue_idx, slot_id] =  insRate[link][ue_idx, slot_id]

                    # adjust -1 (not scheduled) to meaningful number
                    if bler[link][ue_idx, slot_id] == -1:
                        if slot_id == 0:
                            bler[link][ue_idx, slot_id] = 0
                        else:
                            bler[link][ue_idx, slot_id] = bler[link][ue_idx, slot_id-1]

        PF_metric = {"DL": np.zeros(slot_num), "UL": np.zeros(slot_num)}
        for slot_id in np.arange(slot_num):
            for link in ["DL", "UL"]:
                modified_tput = np.where(AvgTput[link][:, slot_id] > 0, 
                         AvgTput[link][:, slot_id] * 1000 * 1000, 
                         1)  # Replace 0 with 1 to avoid log(0)
                PF_metric[link][slot_id] = sum(np.log2(modified_tput))

        np.set_printoptions(precision=2)
        print('----------------------------------------------')
        print(f"BLER of batch {batch_id}: (rows: UEs, cols: slots)")
        print("DL:"), 
        print(bler["DL"])
        print("UL:"), 
        print(bler["UL"])
        print('----------------------------------------------')
        print(f"Instantaneous UE rate (Mbps) of batch {batch_id}:  (rows: UEs, cols: slots)")
        print("DL:"), 
        print(insRate["DL"])
        print("UL:"), 
        print(insRate["UL"])
        print('----------------------------------------------')
        print(f"Average of UE throught of batch {batch_id}: (rows: UEs, cols: slots)")
        print("DL:"), 
        print(AvgTput["DL"])
        print("UL:"), 
        print(AvgTput["UL"])
        print('----------------------------------------------')
        print(f"PF metric of batch {batch_id}: (cols: slots)")
        print("DL:"), 
        print(PF_metric["DL"])
        print("UL:"), 
        print(PF_metric["UL"])      
        print('----------------------------------------------')

        plt.figure()
        draw_ue_id = sorted_unique_ue_ids[0]
        fig_width, fig_height = plt.gcf().get_size_inches()
        fig_scale = 1.4
        plt.figure(figsize=(fig_width*fig_scale, fig_height*fig_scale))
        plt.plot(np.arange(slot_num), bler['DL'][sorted_unique_ue_ids.index(draw_ue_id), :])
        plt.ylabel('BLER')
        plt.xlabel('Slots')
        plt.savefig(f"BLER_batch{batch_id}_ue{draw_ue_id}.png")

    return data




def build_cfrs_buffers(
    cfrs,
    con: DuckDBPyConnection,
    s3_bucket: str,
    namespace_path: str,
    max_subcarriers: int = 4096,
):
    ues_panel = con.execute(
        f"SELECT panel FROM parquet_scan(['s3://{s3_bucket}/{namespace_path}/ues/data/ues.parquet'])"
    ).fetchdf()
    ue_panel_id = ues_panel.iloc[0]["panel"][0]

    rus_panel = con.execute(
        f"SELECT panel FROM parquet_scan(['s3://{s3_bucket}/{namespace_path}/rus/data/rus.parquet'])"
    ).fetchdf()
    ru_panel_id = rus_panel.iloc[0]["panel"][0]

    panels = con.execute(
        "SELECT panel_id, dual_polarized, num_loc_antenna_horz, num_loc_antenna_vert "
        f"FROM parquet_scan(['s3://{s3_bucket}/{namespace_path}/panels/data/panels.parquet'])"
    ).fetchdf()
    p_ue = panels.loc[panels["panel_id"] == ue_panel_id].iloc[0]
    p_ru = panels.loc[panels["panel_id"] == ru_panel_id].iloc[0]
    n_ue_h = p_ue["num_loc_antenna_horz"]
    n_ue_v = p_ue["num_loc_antenna_vert"]
    n_ue_p = int(p_ue["dual_polarized"]) + 1  # Boolean to int for Polarization
    n_ru_h = p_ru["num_loc_antenna_horz"]
    n_ru_v = p_ru["num_loc_antenna_vert"]
    n_ru_p = int(p_ru["dual_polarized"]) + 1
    data = {}
    for idx in range(len(cfrs)):
        row = cfrs.iloc[idx]
        sample_idx = row["time_idx"]

        ru_id = row["ru_id"]
        ue_id = row["ue_id"]
        ru_ant_el = row["ru_ant_el"]
        ue_ant_el = row["ue_ant_el"]
        cfr_re = row["cfr_re"]
        cfr_im = row["cfr_im"]

        ru_h = ru_ant_el["1"]
        ru_v = ru_ant_el["2"]
        ru_pol_idx = ru_ant_el["3"]

        ue_h = ue_ant_el["1"]
        ue_v = ue_ant_el["2"]
        ue_pol_idx = ue_ant_el["3"]

        if sample_idx not in data:
            data[sample_idx] = {}

        ru_cm_idx = (n_ru_v * ru_h + ru_v) * n_ru_p + ru_pol_idx
        ue_cm_idx = (n_ue_v * ue_h + ue_v) * n_ue_p + ue_pol_idx

        buffer_ru = data[sample_idx].get(ru_id, {})

        buffer_ue = buffer_ru.get(
            ue_id,
            np.zeros(
                (
                    max_subcarriers,
                    n_ue_h * n_ue_v * n_ue_p,
                    n_ru_h * n_ru_v * n_ru_p,
                ),
                dtype=complex,
            ),
        )

        for k in np.arange(0, len(cfr_re)):
            buffer_ue[k, ue_cm_idx, ru_cm_idx] = complex(cfr_re[k], cfr_im[k])

        buffer_ru[ue_id] = buffer_ue
        data[sample_idx][ru_id] = buffer_ru

    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Calculate BLER, instantaneous UE rate, average UE throughput, and PF metric from telemetry data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python ran_metric.py --database db_name --ru_id 1 --ue_id 1 --sample 0

        """
    )

    parser.add_argument("--s3_endpoint", type=str, default="http://localhost:9000", help="S3 endpoint URL. Required for MinIO; leave empty for AWS.")
    parser.add_argument("--s3_bucket", type=str, default="aerial-data", help="S3 bucket name")
    parser.add_argument("--s3_provider", type=str, default="minio", choices=["minio", "aws"], help="S3 provider. Defaults to 'minio' if --s3_endpoint is set, otherwise 'aws'.")
    parser.add_argument("--s3_access_key", type=str, default="minioadmin", help="S3 access key (MinIO only)")
    parser.add_argument("--s3_secret_key", type=str, default="minioadmin", help="S3 secret key (MinIO only)")
    parser.add_argument("--iceberg_uri", type=str, default="http://localhost:19120/iceberg", help="Iceberg catalog URI. Needs to be running and reachable.")
    parser.add_argument("--iceberg_catalog_type", type=str, default="rest", choices=["sql", "rest", "glue"], help="Iceberg catalog type")
    parser.add_argument("--database", type=str, dest="database", help="Specifies the database to use", required=True)


    args = parser.parse_args()

    catalog = load_iceberg_catalog(endpoint=args.s3_endpoint, access_key=args.s3_access_key, secret_key=args.s3_secret_key, rest_uri=args.iceberg_uri, catalog_name="default")
    con = connect_duckdb_s3(endpoint=args.s3_endpoint, access_key=args.s3_access_key, secret_key=args.s3_secret_key)

    telemetry = load_table(con, args.s3_bucket, catalog, args.database, table_name="telemetry")
    data = build_telemetry_data(telemetry, con, args.s3_bucket, args.database)
