Quick Start
===========

This guide walks through building a simulation configuration using the
``_config`` Python API — from container setup through YAML export.

.. contents:: On this page
   :local:
   :depth: 2

Prerequisites
-------------

Enter the development container (from the repository root):

.. code-block:: bash

   ./container/run.sh

Inside the container, build the client and the ``_config`` module:

.. code-block:: bash

   cd client
   cmake -B build -DCMAKE_BUILD_TYPE=Release .
   cmake --build build -j$(nproc)

Set ``PYTHONPATH`` so Python can find both the ``dt_client`` and
``_config`` modules. ``$BUILD_DIR`` below refers to the cmake output
directory (``build/`` if you followed the commands above):

.. code-block:: bash

   export BUILD_DIR=build
   export PYTHONPATH=$BUILD_DIR/:$BUILD_DIR/config/

Verify the import works:

.. code-block:: bash

   python3 -c "from _config import SimConfig; print('OK')"

7-Step Workflow
---------------

The example below creates a complete simulation config with S3 storage
and Parquet export.  It mirrors
``examples/example_client_yaml_config.py``.

.. code-block:: python

   from _config import (
       SimConfig, SimMode, DBTable, Panel, Nodes,
       DiffusionModel, AntennaElement, Position, S3Config,
   )
   from omegaconf import OmegaConf

   # -- 1. Create configuration builder --------------------------
   config = SimConfig(
       "test_data/maps/tokyo",
       SimMode.EM,
       "examples/example_client_assets.yml",
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
   OmegaConf.save(config_dict, "output.yml")

3D (aerial) UE waypoints
~~~~~~~~~~~~~~~~~~~~~~~~

Pass an ``alt`` (altitude offset above terrain in meters) to make every
waypoint 3D. asim_em routes 3D UEs to its 3D mobility engine and projects
``z`` from terrain only - buildings are not used as a floor. Every
waypoint of the same UE must be 3D; mixing 2D and 3D in one UE raises.

.. code-block:: python

    ue = Nodes.create_ue(ue_id=1, radiated_power_dbm=26.0)
    ue.add_waypoint(Position.georef(35.66, 139.74, alt=20.0))
    ue.add_waypoint(Position.georef(35.67, 139.75, alt=25.0))
    config.add_ue(ue)

Required Ordering
-----------------

The API enforces a strict ordering to ensure correctness:

1. **Set default panels first** -- before adding any DU, RU, or UE.
2. **Create DU before RU** -- each RU references a DU by ID.
3. **Add waypoints to UE before calling** ``add_ue()`` -- at least one
   waypoint is required (unless using GPX sources).

Violating these constraints raises a ``RuntimeError`` with a descriptive
message.

Timeline Modes
--------------

**Duration / Interval (EM mode):**

.. code-block:: python

   config.set_timeline(duration=10.0, interval=0.1)

**Slots / Symbols (RAN mode):**

.. code-block:: python

   config = SimConfig("scene.usd", SimMode.RAN, "assets.yml")
   config.set_timeline(slots_per_batch=10, realizations_per_slot=1)

You cannot mix both modes.  RAN mode requires slots/symbols.

Database Tables
---------------

Select which result tables to persist:

.. code-block:: python

   from _config import DBTable

   config.add_tables_to_db(DBTable.CIRS)
   config.add_tables_to_db(DBTable.RAYPATHS)
   config.add_table_option("raypaths", "full")

Available tables: ``CIRS``, ``CFRS``, ``RAYPATHS``, ``TELEMETRY``
(telemetry is RAN-mode only).

S3 Configuration
----------------

``S3Config`` holds reusable S3 connection credentials.  Call
``set_s3_config()`` to set the global S3 config (required for GIS map
storage).  The same ``S3Config`` object can be reused for Parquet export.

.. code-block:: python

   s3 = S3Config(
       bucket="aerial-data",
       provider="minio",        # "minio" or "aws"
       endpoint_url="http://localhost:9002",
       access_key="minioadmin",
       secret_key="minioadmin",
       region="us-east-1",      # default
   )
   config.set_s3_config(s3)

For AWS, ``endpoint_url`` is not required:

.. code-block:: python

   s3_aws = S3Config(bucket="my-bucket", provider="aws",
                      access_key="AKIA...", secret_key="...")
   config.set_s3_config(s3_aws)

Parquet Export
--------------

Enable Parquet export to write simulation results to S3 as Parquet
files:

.. code-block:: python

   config.enable_parquet_export(
       timesteps_per_file=3,
       compression="zstd",       # zstd, snappy, gzip, lz4
       max_workers=2,
       verify_exports=True,
   )
   config.add_parquet_s3_config(s3)  # reuse S3Config from above

Optionally register Parquet files in an Apache Iceberg catalog:

.. code-block:: python

   config.set_parquet_iceberg(
       catalog_type="rest",              # "sql", "rest", or "glue"
       catalog_uri="http://localhost:8181",
       catalog_name="default",
   )

To disable Parquet export after enabling it:

.. code-block:: python

   config.disable_parquet_export()
