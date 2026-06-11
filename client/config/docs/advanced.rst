Advanced Features
=================

This page covers optional features beyond the core workflow described in
:doc:`quickstart`.

.. contents:: On this page
   :local:
   :depth: 2

Coordinate forms and projection
-------------------------------

============================================  ===  ===========================================================
Position factory                              dim  asim_em projection (z computation)
============================================  ===  ===========================================================
``Position.georef(lat, lon)``                 2    Project to map surface; z = terrain top **including** buildings
``Position.cartesian(x, y)``                  2    Project to map surface; z = terrain top **including** buildings
``Position.georef(lat, lon, alt)``            3    z = terrain_z + alt / meters_per_unit (terrain only, no buildings)
``Position.cartesian(x, y, z)``               3    Passthrough; z is preserved as given
============================================  ===  ===========================================================

For UE waypoint lists, every waypoint of the same UE must share the same
dim. The ``UE.add_waypoint`` API enforces this eagerly.
``SimConfig.add_spawn_zone`` accepts
only 2D points (asim_em hard-codes ``dim=2`` when projecting them).

Urban Mobility
--------------

Enable urban mobility simulation with vehicles and procedural UEs:

.. code-block:: python

   config.enable_urban_mobility(vehicles=10)
   config.set_num_procedural_ues(50)
   config.set_perc_indoor_procedural_ues(0.0)  # 0-100
   config.set_ue_speed(min_speed=1.0, max_speed=5.0)

Define a spawn zone for procedural UEs as a counter-clockwise polygon:

.. code-block:: python

   config.add_spawn_zone([
       Position.georef(35.664, 139.746),
       Position.georef(35.663, 139.746),
       Position.georef(35.663, 139.747),
       Position.georef(35.664, 139.747),
   ])

GPX-Driven UEs
--------------

Create UEs whose mobility is driven by a GPX file instead of manually
defined waypoints:

.. code-block:: python

   # Create multiple UEs from a single GPX file
   config.add_ues_from_gpx(
       gpx_src="path/to/route.gpx",
       ue_ids=[10, 11, 12],
       use_pathfinding=True,   # default
   )

   # Customise individual UEs after creation
   ue10 = config.get_ue(10)
   ue10.set_radiated_power(20.0)

Vegetation
----------

Enable vegetation rendering from GeoJSON data:

.. code-block:: python

   # Auto-derive GeoJSON path from scene URL
   config.enable_vegetation()

   # Or provide an explicit path
   config.enable_vegetation("path/to/vegetation.geojson")

Explicit GeoJSON paths are used as-is. When vegetation is enabled, the
vegetation asset model path comes from the required ``vegetation_assets`` entry
in ``assets.yml`` and is emitted as
``gis.vegetation.vegetation_asset_path``.

Material Calibration
--------------------

Override default material properties with calibration files:

.. code-block:: python

   from _config import GeoTargets

   # Building materials
   config.add_material_definition("path/to/definitions.json", GeoTargets.BLDG)
   config.add_material_assignment("path/to/assignments.json", GeoTargets.BLDG)

   # Vegetation materials
   config.add_material_definition("path/to/veg_defs.json", GeoTargets.VEG)
   config.add_material_assignment("path/to/veg_assigns.json", GeoTargets.VEG)

Calibration Runs
----------------

Calibration runs start from a simulation YAML that has already been generated
and run. Reload that same YAML with :py:meth:`SimConfig.from_yaml_file`, add the
top-level calibration settings, then load the calibration YAML through the
Digital Twin client and call ``client.run_calibration()``.

.. code-block:: python

   from _config import SimConfig

   config = SimConfig.from_yaml_file("example_generated_YAML_config.yml")

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
   config.set_calibration_timeline(start=0, step=1, end=640)
   config.set_calibration_output("test_calibration_run/output")

At export time, calibration YAML requires at least one measurement and a
non-empty output folder key. ``set_calibration_execution_mode`` is optional and
is normally omitted so the calibration pipeline derives the mode from the
target flags.

Runnable examples:

- ``client/examples/example_calibration.py`` runs the base simulation, reloads
  the scenario with calibration settings, and starts calibration.
- ``client/examples/example_client_calibration_yaml_config.py`` shows how to
  generate both the base simulation YAML and the calibration YAML.

Building RF Attributes
----------------------

Control RF interaction properties for building exteriors and interiors.
Attributes are emitted under the ``sim.BldgExterior`` and
``sim.BldgInterior`` YAML sections.

.. code-block:: python

   # Exterior buildings: all RF features enabled
   config.set_bldg_exterior_attr(
       activate_rf=True,
       activate_diffraction=True,
       activate_diffusion=True,
       activate_transmission=True,
       diffuse_surface_element_area=1.0,
       building_ids=[],          # empty = all buildings
   )

   # Interior buildings: no diffusion
   config.set_bldg_interior_attr(
       activate_rf=True,
       activate_diffraction=True,
       activate_transmission=True,
       building_ids=["bldg_01", "bldg_02"],  # specific buildings
   )

Custom Antenna Patterns
-----------------------

Panels can be created from built-in pattern constants, string names, or
files:

.. code-block:: python

   # Built-in pattern names
   panel = Panel.create_panel([Panel.THREE_GPP_38901], 3600)

   # Customized pattern files (CSV or FFD)
   panel = Panel.create_panel([Panel.THREE_GPP_38901, "/path/to/custom_pattern.csv"], 3600)

   # File-based panel (entire config from file)
   panel = Panel.create_panel_from_file("path/to/custom_panel.csv")

Additional panels beyond the defaults can be added and assigned to
specific RUs or UEs:

.. code-block:: python

   extra_panel = Panel.create_panel([AntennaElement.Isotropic], 3600)
   config.add_panel(extra_panel)

   ru = Nodes.create_ru(ru_id=2, frequency_mhz=3600, du_id=1)
   ru.assign_panel(extra_panel)
   config.add_ru(ru)

.. TODO: Don't exposed to users in 1.5
.. Bounding Box Window
.. -------------------

.. Set a bounding box window for the GIS section:

.. .. code-block:: python

..    config.set_bbox_window([
..        Position.georef(35.660, 139.744),
..        Position.georef(35.665, 139.749),
..    ])

Ray Tracing Model
-----------------

Configure the EM ray tracing solver:

.. code-block:: python

   from _config import DiffusionModel

   config.set_ray_tracing_model(
       diffuse_type=DiffusionModel.DIRECTIONAL,
       interactions=5,
       max_num_paths_per_ant_pair=500,
       emitted_rays_in_thousands=500,
       fast_mode=False,
   )

.. TODO: Not matured yet, may change in future releases
.. Bulk Attribute Updates
.. ----------------------

.. Set attributes on multiple elements at once.  An empty ``ids`` list
.. acts as a wildcard (all elements of that type).

.. .. code-block:: python

..    # Set height for all UEs
..    config.set_ues_height(height_m=1.5)

..    # Set power for specific UEs
..    config.set_ues_power(radiated_power_dbm=23.0, ids=[1, 2])

..    # Set power for all RUs
..    config.set_rus_power(radiated_power_dbm=40.0)

.. For full control, use the generic ``set_attributes`` API:

.. .. code-block:: python

..    config.set_attributes(
..        prim_type="RUs",
..        ids=[1, 2],
..        attributes={"aerial_gnb_radiated_power": 40.0},
..    )

..    # String-keyed sections (Materials, VegetationMaterials)
..    config.set_attributes(
..        prim_type="Materials",
..        ids=["concrete", "glass"],
..        attributes={"some_property": 0.5},
..    )

Post-Add Mutation
-----------------

After adding elements to the config, you can retrieve and modify them:

.. code-block:: python

   # Retrieve mutable references
   ue = config.get_ue(1)
   ru = config.get_ru(1)
   du = config.get_du(1)
   panel = config.get_panel(2)

   # Modify
   ue.set_radiated_power(20.0)
   ue.clear_waypoints()
   ue.add_waypoint(Position.georef(35.664, 139.747))

   # Remove a UE entirely
   config.remove_ue(1)

   # Clear waypoints via SimConfig
   config.clear_waypoints(ue_id=2)

Importing an Existing YAML Config
---------------------------------

The build-from-scratch flow in :doc:`quickstart` is the primary entry
point for new configs. To re-edit a previously generated AODT YAML
without rebuilding it field by field, use
:py:meth:`SimConfig.from_yaml_file` and then mutate the returned
:class:`SimConfig` with the normal builder API.

Caveats:

- The import is **semantic, not byte-preserving**: comments, scalar
  style, anchors, duplicate keys, and original ordering are not
  preserved on round-trip.
- The import path assumes the YAML file was generated by this client
  library. Foreign YAMLs are not guaranteed to be supported.
- Asset defaults are read from the YAML's ``sim.*.default`` keys, so
  no ``assets.yml`` path is required.

The following snippet mirrors
``examples/example_import_yaml_config.py``: load a YAML, edit a few
global settings, swap the antenna pattern on the default RU/UE panels,
and bulk-update radiated power across every node:

.. code-block:: python

   from _config import (
       SimConfig, AntennaElement, DiffusionModel,
   )
   from omegaconf import OmegaConf

   config = SimConfig.from_yaml_file("example_generated_YAML_config.yml")

   # Global edits
   config.set_simulation_id("test_new_sim_id")
   config.set_timeline(duration=5, interval=1)
   config.set_num_batches(2)
   config.set_ray_tracing_model(DiffusionModel.LAMBERTIAN, 5, 500, 500)

   # Switch the default RU/UE panels to new antenna elements.
   # get_default_ru_panel_id() returns the id of the panel registered
   # as sim_gnb_panel_type in the YAML.
   ru_panel_id = config.get_default_ru_panel_id()
   config.get_panel(ru_panel_id).set_antenna_elements(
       [AntennaElement.Isotropic]
   )

   ue_panel_id = config.get_default_ue_panel_id()
   config.get_panel(ue_panel_id).set_antenna_elements(
       [AntennaElement.InfinitesimalDipole]
   )

   # Bulk-update radiated power across every RU and UE.
   for ru_id in config.get_ru_ids():
       config.get_ru(ru_id).set_radiated_power(43.0)
   for ue_id in config.get_ue_ids():
       config.get_ue(ue_id).set_radiated_power(23.0)

   OmegaConf.save(config.to_dict(), "example_new_YAML_config.yml")

To target a specific node instead of the global default panel, look up
the panel ID through the node:

.. code-block:: python

   ru = config.get_ru(1)
   config.get_panel(ru.panel_id()).set_antenna_elements(
       [AntennaElement.Isotropic]
   )

A runnable version of this flow lives at
``client/examples/example_import_yaml_config.py``.

Wideband Simulation
-------------------

Enable wideband channel simulation (automatically enabled when adding
``DBTable.CFRS``):

.. code-block:: python

   config.enable_wideband()
