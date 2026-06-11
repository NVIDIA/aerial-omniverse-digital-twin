API Reference
=============

This page documents the public classes and enums in the ``_config`` module
(C++ with pybind11 bindings).

.. contents:: On this page
   :local:
   :depth: 3

Enums
-----

SimMode
~~~~~~~

.. py:class:: SimMode

   Simulation mode.

   .. py:attribute:: EM

      Electromagnetic mode (duration/interval based).

   .. py:attribute:: RAN

      RAN mode (slot/symbol based).

DBTable
~~~~~~~

.. py:class:: DBTable

   Result tables that can be persisted to the database.

   .. py:attribute:: CIRS

      Channel Impulse Response.

   .. py:attribute:: CFRS

      Channel Frequency Response. Adding this table automatically
      enables wideband simulation.

   .. py:attribute:: RAYPATHS

      Ray path data.

   .. py:attribute:: TELEMETRY

      Telemetry data (RAN mode only).

GeoTargets
~~~~~~~~~~

.. py:class:: GeoTargets

   Target geometry type for material calibration operations.

   .. py:attribute:: BLDG

      Building materials (``sim.Materials`` section).

   .. py:attribute:: VEG

      Vegetation materials (``sim.VegetationMaterials`` section).

DiffusionModel
~~~~~~~~~~~~~~

.. py:class:: DiffusionModel

   EM diffusion model for ray tracing.

   .. py:attribute:: LAMBERTIAN

      Lambertian diffusion.

   .. py:attribute:: DIRECTIONAL

      Directional diffusion.

Data Classes
------------

Position
~~~~~~~~

.. py:class:: Position

   A geographic or Cartesian position.

   .. py:staticmethod:: georef(lat: float, lon: float, alt: Optional[float] = None) -> Position

      Create a georeferenced position from latitude and longitude.
      *alt* is an altitude offset above terrain in meters. When *alt*
      is set, the point is 3D and AODT projects ``z = terrain_z + alt``.
      When *alt* is ``None``, the point is 2D and AODT
      projects ``z`` to the terrain+buildings surface.

   .. py:staticmethod:: cartesian(x: float, y: float, z: Optional[float] = None) -> Position

      Create a Cartesian position. *z* is the vertical coordinate in
      meters. When *z* is ``None``, the point is 2D and AODT
      projects ``z`` to the terrain+buildings surface.

Waypoint
~~~~~~~~

.. py:class:: Waypoint

   UE waypoint with position and mobility parameters.

   .. py:attribute:: position
      :type: Position

   .. py:attribute:: speed
      :type: float

      Speed in m/s.

   .. py:attribute:: pauseDuration
      :type: float

      Pause duration in seconds.

   .. py:attribute:: azimuthOffset
      :type: float

      Azimuth offset in degrees.

S3Config
~~~~~~~~

.. py:class:: S3Config(bucket="", provider="", endpoint_url="", access_key="", secret_key="", region="us-east-1")

   Reusable S3 connection credentials. Used by
   :py:meth:`SimConfig.set_s3_config` and
   :py:meth:`SimConfig.add_parquet_s3_config`.

   :param str bucket: S3 bucket name.
   :param str provider: ``"minio"`` or ``"aws"``.
   :param str endpoint_url: S3 endpoint URL (not required for AWS).
   :param str access_key: Access key.
   :param str secret_key: Secret key.
   :param str region: AWS region (default ``"us-east-1"``).

Domain Objects
--------------

Panel
~~~~~

.. py:class:: Panel

   Antenna panel configuration. Create via the static factory methods
   below -- do not instantiate directly.

   .. py:staticmethod:: create_panel(antenna_elements: list[str], frequency_mhz: float, vertical_spacing: float = 0.5, vertical_num: int = 1, horizontal_spacing: float = 0.5, horizontal_num: int = 2, dual_polarized: bool = True, roll_first: float = 0.0, roll_second: float = 90.0) -> Panel

      Create a panel from antenna element names.

      *antenna_elements* accepts built-in pattern name constants
      (e.g. ``Panel.THREE_GPP_38901``, ``Panel.ISOTROPIC``) or custom
      file paths (e.g. ``"path/to/pattern.csv"``).

      Built-in constants: ``Panel.ISOTROPIC``,
      ``Panel.INFINITESIMAL_DIPOLE``, ``Panel.HALFWAVE_DIPOLE``,
      ``Panel.REC_MICROSTRIP_PATCH``, ``Panel.THREE_GPP_38901``,
      ``Panel.POLARIZED_ISOTROPIC``.

      :param list[str] antenna_elements: Antenna element names or file paths.
      :param float frequency_mhz: Reference frequency in MHz.
      :param float vertical_spacing: Vertical spacing in wavelengths.
      :param int vertical_num: Number of vertical elements.
      :param float horizontal_spacing: Horizontal spacing in wavelengths.
      :param int horizontal_num: Number of horizontal elements.
      :param bool dual_polarized: Whether the panel is dual-polarized.
      :param float roll_first: First polarization roll angle (degrees).
      :param float roll_second: Second polarization roll angle (degrees).
      :rtype: Panel

   .. py:staticmethod:: create_panel_from_file(panel_file_path: str) -> Panel

      Create a file-based panel from a CSV or FFD file. The panel
      configuration is entirely defined by the file.

      :param str panel_file_path: Path to the panel definition file.
      :rtype: Panel

   .. py:method:: id() -> int

      Return the panel ID (assigned when added to a config).

   .. rubric:: Mutators

   The setters below mutate an existing :py:class:`Panel`. They are intended
   for editing a config loaded via :py:meth:`SimConfig.from_yaml_file`.

   For example:

   .. code-block:: python

      panel = config.get_panel(config.get_default_ru_panel_id())
      panel.set_antenna_elements([AntennaElement.Isotropic])

   None of the setters are valid on a file-based panel (one created via
   :py:meth:`Panel.create_panel_from_file`); calling any of them on such
   a panel raises ``RuntimeError``. Setters that re-run the panel
   invariant check (``set_antenna_elements``, ``set_panel_size``)
   provide a strong exception guarantee: if validation fails, the panel
   reverts to its previous state.

   .. py:method:: set_antenna_elements(elements: list[AntennaElement])
                  set_antenna_elements(names: list[str])

      Replace the antenna element list. Two forms are accepted:

      - A list of :class:`AntennaElement` enum values.
      - A list of strings: built-in pattern name constants
        (``Panel.THREE_GPP_38901``, ``Panel.ISOTROPIC``, ...) or custom
        pattern file paths. Empty strings are rejected.

      Re-runs the full panel invariant check, so the new list must be
      consistent with the current array shape: either a single element
      (broadcast to every antenna) or exactly
      ``vertical_num * horizontal_num * (2 if dual_polarized else 1)``
      entries.

      :param list[AntennaElement] elements: Antenna element enum values.
      :param list[str] names: Antenna element names or file paths.
      :raises RuntimeError: If the panel is file-based, or the list
         size does not match the panel shape.

   .. py:method:: set_frequency(mhz: float)

      Set the panel reference frequency in MHz.

      Does not change the stored mm spacing: a real panel has a fixed
      physical element spacing and only its wavelength ratio changes
      with frequency. To re-derive the spacing at the new frequency,
      call :py:meth:`set_spacing_wavelengths` afterwards.

      :param float mhz: Reference frequency in MHz (must be > 0).
      :raises RuntimeError: If the panel is file-based, or *mhz* is
         not positive.

   .. py:method:: set_spacing_wavelengths(vertical_wavelengths: float, horizontal_wavelengths: float)

      Set the element spacings in wavelengths at the current reference
      frequency. Stored internally as millimeters.

      :param float vertical_wavelengths: Vertical spacing in wavelengths.
      :param float horizontal_wavelengths: Horizontal spacing in wavelengths.
      :raises RuntimeError: If the panel is file-based, or either
         spacing is not positive.

   .. py:method:: set_panel_size(vertical_num: int, horizontal_num: int, dual_polarized: bool)

      Set the array shape (vertical x horizontal element counts) and
      whether the panel is dual-polarized.

      Re-runs the full panel invariant check, so the current antenna
      element list must still be size-compatible with the new shape.

      :param int vertical_num: Number of vertical elements (must be > 0).
      :param int horizontal_num: Number of horizontal elements (must be > 0).
      :param bool dual_polarized: Whether the panel is dual-polarized.
      :raises RuntimeError: If the panel is file-based, the counts are
         non-positive, or the antenna element list does not match the
         new shape.

   .. py:method:: set_roll_angles(first_deg: float, second_deg: float)

      Set the polarization roll angles in degrees.

      :param float first_deg: First polarization roll angle (degrees).
      :param float second_deg: Second polarization roll angle (degrees).
      :raises RuntimeError: If the panel is file-based.

DU (Distributed Unit)
~~~~~~~~~~~~~~~~~~~~~

.. py:class:: DU

   Distributed Unit. Create via :py:meth:`Nodes.create_du`.

   .. py:method:: id() -> int

      Return the DU ID.

   .. py:method:: frequency() -> float

      Return carrier frequency in MHz.

   .. py:method:: set_position(position: Position)

      Set the DU position.

   .. py:method:: set_frequency(mhz: float)

      Set the DU reference frequency in MHz.

      Only this DU's emitted ``aerial_du_reference_freq`` is updated;
      the frequencies of associated RUs are independent and must be
      adjusted separately with :py:meth:`RU.set_frequency` if the
      deployment expects them to track.

      :param float mhz: Reference frequency in MHz (must be > 0).
      :raises ValueError: If *mhz* is not positive.

   .. py:method:: set_fft_size(size: int)

      Set FFT size.

   .. py:method:: set_max_channel_bandwidth(bw: float)

      Set maximum channel bandwidth in MHz.

   .. py:method:: set_num_antennas(num: int)

      Override the number of antennas (normally auto-derived from the
      default RU panel).

RU (Radio Unit)
~~~~~~~~~~~~~~~

.. py:class:: RU

   Radio Unit. Create via :py:meth:`Nodes.create_ru`.

   .. py:method:: id() -> int

      Return the RU ID.

   .. py:method:: frequency() -> float

      Return carrier frequency in MHz.

   .. py:method:: du_id() -> int

      Return the associated DU ID.

   .. py:method:: panel_id() -> int

      Return the ID of the panel assigned to this RU.

      For an RU retrieved via :py:meth:`SimConfig.get_ru` this is
      always non-zero: :py:meth:`SimConfig.add_ru` resolves an unset
      (``0``) value to the current default RU panel before storing the
      RU. The accessor only returns ``0`` on a freshly constructed RU
      that has not yet been added to a config.

   .. py:method:: set_position(position: Position)

      Set the RU position (georeferenced or Cartesian).

   .. py:method:: set_height(height_m: float)

      Set height in meters above ground.

   .. py:method:: set_radiated_power(power_dbm: float)

      Set radiated power in dBm.

   .. py:method:: set_mech_azimuth(deg: float)

      Set mechanical azimuth in degrees.

   .. py:method:: set_mech_tilt(deg: float)

      Set mechanical tilt in degrees.

   .. py:method:: set_frequency(mhz: float)

      Set the RU carrier frequency in MHz.

      Only this RU's emitted ``aerial_gnb_carrier_freq`` is updated;
      the associated DU's frequency is not modified.

      :param float mhz: Carrier frequency in MHz (must be > 0).
      :raises ValueError: If *mhz* is not positive.

   .. py:method:: assign_panel(panel: Panel)

      Assign a specific panel to this RU, overriding the default.

UE (User Equipment)
~~~~~~~~~~~~~~~~~~~

.. py:class:: UE

   User Equipment. Create via :py:meth:`Nodes.create_ue`.

   .. py:method:: id() -> int

      Return the UE ID.

   .. py:method:: add_waypoint(position: Position, speed: float = 0.0, pause_duration: float = 0.0, azimuth_offset: float = 0.0)

      Add a waypoint. At least one waypoint is required before calling
      :py:meth:`SimConfig.add_ue` (unless using a GPX source).
      Waypoints for the same UE must all have the same dimensionality;
      adding a 2D waypoint to a 3D UE, or a 3D waypoint to a 2D UE,
      raises.

      :param Position position: Waypoint position.
      :param float speed: Speed in m/s.
      :param float pause_duration: Pause duration in seconds.
      :param float azimuth_offset: Azimuth offset in degrees.

   .. py:method:: clear_waypoints()

      Remove all waypoints from this UE.

   .. py:method:: set_radiated_power(power_dbm: float)

      Set UE radiated power in dBm.

   .. py:method:: assign_panel(panel: Panel)

      Assign a specific panel to this UE, overriding the default.

   .. py:method:: set_bler_target(target: float)

      Set the BLER target.

   .. py:method:: set_manual(manual: bool)

      Set manual mode for this UE.

Factory
-------

Nodes
~~~~~

.. py:class:: Nodes

   Factory for creating DU, RU, and UE objects.

   .. py:staticmethod:: create_du(du_id: int, frequency_mhz: float = 3600.0, scs_khz: float = 30.0) -> DU

      Create a Distributed Unit.

      :param int du_id: DU identifier (must be > 0).
      :param float frequency_mhz: Carrier frequency in MHz.
      :param float scs_khz: Subcarrier spacing in kHz.
      :rtype: DU

   .. py:staticmethod:: create_ru(ru_id: int, frequency_mhz: float = 3600.0, radiated_power_dbm: float = 43.0, du_id: int = 1) -> RU

      Create a Radio Unit.

      :param int ru_id: RU identifier (must be > 0).
      :param float frequency_mhz: Carrier frequency in MHz.
      :param float radiated_power_dbm: Radiated power in dBm.
      :param int du_id: Associated DU identifier.
      :rtype: RU

   .. py:staticmethod:: create_ue(ue_id: int, radiated_power_dbm: float = 26.0) -> UE

      Create a User Equipment.

      :param int ue_id: UE identifier (must be in [1, 10000]).
      :param float radiated_power_dbm: Radiated power in dBm.
      :rtype: UE

Configuration Builder
---------------------

SimConfig
~~~~~~~~~

.. py:class:: SimConfig(scene_url: str, mode: SimMode = SimMode.EM, asset_config_path: str = "")

   High-level configuration builder for AODT simulations.

   :param str scene_url: Scene URL -- S3 key prefix or local path.
   :param SimMode mode: Simulation mode (default ``EM``).
   :param str asset_config_path: Path to ``assets.yml`` (**required**).
   :raises RuntimeError: If *asset_config_path* is empty or cannot be loaded.

.. py:staticmethod:: SimConfig.from_yaml_file(file_path: str) -> SimConfig

   Load an existing complete YAML config file into an editable
   :class:`SimConfig`.

   The import path reads asset defaults from the YAML ``sim.*.default`` keys
   and does not require an ``assets.yml`` path. The returned object can be
   edited with the normal builder API, for example :py:meth:`get_ru`,
   :py:meth:`get_ue`, :py:meth:`add_ue`, etc.

   Import is semantic rather than byte preserving: comments, YAML scalar
   style, anchors, duplicate keys, and original ordering are not preserved.

   Import assumes the YAML file is generated by this client library.

   :param str file_path: Path to the YAML config file.
   :raises RuntimeError: If the file cannot be opened, parsed, or imported.

Global Settings
^^^^^^^^^^^^^^^

.. py:method:: SimConfig.set_simulation_id(simulation_id: str)

   Set the simulation ID (used as DB name and identifier).

.. py:method:: SimConfig.set_db(db_host: str = "localhost", db_port: int = 9000, db_author: str = "aerial", db_notes: str = "")

   Set database connection parameters.

.. py:method:: SimConfig.set_num_batches(batches: int)

   Set number of simulation batches (must be > 0).

.. py:method:: SimConfig.set_timeline(duration: float = None, interval: float = None, slots_per_batch: int = None, realizations_per_slot: int = None)

   Set simulation timeline. Provide **either** *duration*/*interval*
   (EM mode) **or** *slots_per_batch*/*realizations_per_slot* (RAN /
   slot mode) -- not both.

.. py:method:: SimConfig.set_seed(seed: int = 0)

   Enable deterministic seeding for mobility.

.. py:method:: SimConfig.add_tables_to_db(table: DBTable)

   Add a result table to persist in the database.

.. py:method:: SimConfig.add_table_option(table_name: str, option: str)

   Set an option for an opt-in table (e.g.
   ``add_table_option("raypaths", "full")``).

.. py:method:: SimConfig.set_s3_config(s3_config: S3Config)

   Set the global S3 config (**required**). Emitted as
   ``db.s3_config`` in the YAML output.

.. .. py:method:: SimConfig.set_bbox_window(points: list[Position])

..    Set the GIS bounding-box window. ``SimConfig.set_bbox_window``
..    accepts only 2D points and raises on 3D ``Position`` values.

.. py:method:: SimConfig.enable_parquet_export(timesteps_per_file: int = 100, compression: str = "zstd", max_workers: int = 2, verify_exports: bool = True)

   Enable Parquet export to S3.

.. py:method:: SimConfig.disable_parquet_export()

   Disable Parquet export.

.. py:method:: SimConfig.add_parquet_s3_config(s3_config: S3Config, nodes: list[str] = ["node1"], use_ssl: bool = False)

   Add an S3 storage config for Parquet export.

.. py:method:: SimConfig.set_parquet_iceberg(catalog_type: str = "rest", catalog_uri: str = "http://nessie:19120/iceberg", catalog_name: str = "default", aws_region: str = "", nessie_ref: str = "main")

   Configure an Apache Iceberg catalog for Parquet export.

.. py:method:: SimConfig.set_ray_tracing_model(diffuse_type: DiffusionModel = DiffusionModel.LAMBERTIAN, interactions: int = 5, max_num_paths_per_ant_pair: int = 500, emitted_rays_in_thousands: int = 500, fast_mode: bool = False)

   Set EM ray tracing solver parameters.

.. py:method:: SimConfig.enable_wideband()

   Enable wideband simulation (automatically enabled when adding
   ``DBTable.CFRS``).

Panel Management
^^^^^^^^^^^^^^^^

.. py:method:: SimConfig.set_default_panel_ru(panel: Panel)

   Set the default RU panel (assigns ID 2). Must be called before
   adding any DU, RU, or UE.

.. py:method:: SimConfig.set_default_panel_ue(panel: Panel)

   Set the default UE panel (assigns ID 1). Must be called before
   adding any DU, RU, or UE.

.. py:method:: SimConfig.add_panel(panel: Panel)

   Add an additional panel (auto-assigns an ID).

.. py:method:: SimConfig.get_default_ru_panel_id() -> int

   Return the ID of the panel registered as the default RU panel
   (the YAML field ``sim_gnb_panel_type``). Useful when re-editing a
   config loaded via :py:meth:`SimConfig.from_yaml_file`::

      panel = config.get_panel(config.get_default_ru_panel_id())
      panel.set_antenna_elements([AntennaElement.Isotropic])

   .. note::

      The underlying field is value-initialized (``2``), so a non-zero
      return value does not by itself imply that a Panel with that ID
      has been added to the config yet. This is safe on configs loaded
      via :py:meth:`SimConfig.from_yaml_file` (the import populates real
      panels and defaults), but a brand-new ``SimConfig()`` may report
      an ID that does not yet correspond to any registered panel.

.. py:method:: SimConfig.get_default_ue_panel_id() -> int

   Return the ID of the panel registered as the default UE panel
   (the YAML field ``sim_ue_panel_type``). See
   :py:meth:`get_default_ru_panel_id` for caveats on default
   initialization.

Network Node Management
^^^^^^^^^^^^^^^^^^^^^^^

.. py:method:: SimConfig.add_du(du: DU)

   Add a DU to the configuration.

.. py:method:: SimConfig.add_ru(ru: RU)

   Add an RU to the configuration. The referenced DU must already
   exist.

.. py:method:: SimConfig.add_ue(ue: UE)

   Add a UE to the configuration. At least one waypoint or GPX
   source must be set.

.. py:method:: SimConfig.get_du(du_id: int) -> DU

   Get a mutable reference to a DU by ID.

.. py:method:: SimConfig.get_ru(ru_id: int) -> RU

   Get a mutable reference to an RU by ID.

.. py:method:: SimConfig.get_ue(ue_id: int) -> UE

   Get a mutable reference to a UE by ID.

.. py:method:: SimConfig.get_panel(panel_id: int) -> Panel

   Get a mutable reference to a Panel by ID.

.. py:method:: SimConfig.get_ru_ids() -> list[int]

   Return the IDs of all RUs currently added to the config. The order
   reflects the underlying hash map and must be treated as
   unspecified.

.. py:method:: SimConfig.get_ue_ids() -> list[int]

   Return the IDs of all UEs currently added to the config (order
   unspecified).

.. py:method:: SimConfig.get_du_ids() -> list[int]

   Return the IDs of all DUs currently added to the config (order
   unspecified).

.. py:method:: SimConfig.get_panel_ids() -> list[int]

   Return the IDs of all Panels currently added to the config (order
   unspecified).

.. py:method:: SimConfig.remove_ue(ue_id: int)

   Remove a UE from the configuration.

.. py:method:: SimConfig.clear_waypoints(ue_id: int)

   Clear all waypoints for a given UE.

.. py:method:: SimConfig.add_ues_from_gpx(gpx_src: str, ue_ids: list[int], use_pathfinding: bool = True)

   Create UEs driven by a GPX file. Use :py:meth:`SimConfig.get_ue`
   to customize individual UEs afterwards.

Procedural UEs and Urban Mobility
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

.. py:method:: SimConfig.add_spawn_zone(points_ccw: list[Position])

   Add a spawn zone for procedural UEs as a counter-clockwise
   polygon. ``SimConfig.add_spawn_zone`` accepts only 2D points and
   raises on 3D ``Position`` values.

.. py:method:: SimConfig.set_num_procedural_ues(num: int)

   Set number of procedural UEs.

.. py:method:: SimConfig.set_perc_indoor_procedural_ues(perc: float)

   Set percentage of indoor procedural UEs (0--100).

.. py:method:: SimConfig.set_ue_speed(min_speed: float, max_speed: float)

   Set speed range for procedural UEs in m/s.

.. py:method:: SimConfig.enable_urban_mobility(vehicles: int)

   Enable urban mobility simulation with the given number of
   vehicles.

Vegetation
^^^^^^^^^^

.. py:method:: SimConfig.enable_vegetation(geojson_path: str = "")

   Enable vegetation rendering from GeoJSON data. If *geojson_path*
   is omitted, a default is derived from the scene URL as
   ``<scene_url>/sim/vegetation.geojson``. Enabled vegetation also emits
   ``gis.vegetation.vegetation_asset_path`` from the required
   ``vegetation_assets`` entry in ``assets.yml``.

Material Calibration
^^^^^^^^^^^^^^^^^^^^

.. py:method:: SimConfig.add_material_definition(file: str, target: GeoTargets)

   Add a material calibration definition file.

.. py:method:: SimConfig.add_material_assignment(file: str, target: GeoTargets)

   Add a material calibration assignment file.

Calibration Run Configuration
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

.. py:method:: SimConfig.set_calibration_targets(materials: bool, veg_materials: bool, rus: bool, rus_beams: bool, ues: bool)

   Set the calibration target flags. Call this before the other
   calibration run configuration methods.

   :param bool materials: Calibrate building materials.
   :param bool veg_materials: Calibrate vegetation materials.
   :param bool rus: Calibrate RU angles.
   :param bool rus_beams: Calibrate RU beam settings.
   :param bool ues: Calibrate UE angles.

.. py:method:: SimConfig.add_calibration_measurement(ru_id: int, ue_id: int, measurement_file: str)

   Add one measured RU/UE link used as a calibration reference.
   *measurement_file* must be non-empty. At least one measurement is
   required before exporting a calibration YAML.

   :param int ru_id: RU ID for the measured link.
   :param int ue_id: UE ID for the measured link.
   :param str measurement_file: Measurement CSV path.

.. py:method:: SimConfig.set_calibration_timeline(start: int = 0, step: int = 1, end: int = None)

   Set the time indices used for calibration. *step* must be positive.

   :param int start: First time index.
   :param int step: Time index stride.
   :param int end: Optional final time index.

.. py:method:: SimConfig.set_calibration_output(folder_key: str)

   Set the calibration output S3 folder key under the configured bucket.
   The folder key must be non-empty and is required before exporting a
   calibration YAML.

.. py:method:: SimConfig.set_calibration_execution_mode(execution_mode: str)

   Override the calibration execution mode. Typical calibration configs
   should leave this unset; when omitted, the calibration pipeline derives
   the execution mode from :py:meth:`SimConfig.set_calibration_targets`.

   Use this only when an explicit training bitmask or calibration pipeline
   debug mode is required. For example, ``"0"`` means debug forward pass;
   positive values are calibration-group bitmasks.

.. py:method:: SimConfig.set_calibration_keep_local_output(keep_local_output: bool)

   Set whether calibration keeps local output files.

Building RF Attributes
^^^^^^^^^^^^^^^^^^^^^^

.. py:method:: SimConfig.set_bldg_exterior_attr(activate_rf: bool, activate_diffraction: bool, activate_diffusion: bool, activate_transmission: bool, diffuse_surface_element_area: float = None, building_ids: list[str] = [])

   Convenience wrapper to set RF attributes for exterior buildings.

   :param bool activate_rf: Enable RF mesh for exterior surfaces.
   :param bool activate_diffraction: Enable diffraction.
   :param bool activate_diffusion: Enable diffusion.
   :param bool activate_transmission: Enable transmission.
   :param float diffuse_surface_element_area: Diffuse surface element area in m\ :sup:`2`.
   :param list[str] building_ids: Building IDs to target. Empty list = all buildings.

.. py:method:: SimConfig.set_bldg_interior_attr(activate_rf: bool, activate_diffraction: bool, activate_transmission: bool, building_ids: list[str] = [])

   Convenience wrapper to set RF attributes for interior buildings.

   :param bool activate_rf: Enable RF mesh for interior surfaces.
   :param bool activate_diffraction: Enable diffraction.
   :param bool activate_transmission: Enable transmission.
   :param list[str] building_ids: Building IDs to target. Empty list = all buildings.

Bulk Updates (advanced)
^^^^^^^^^^^^^^^^^^^^^^^

.. py:method:: SimConfig.set_ues_height(height_m: float, ids: list[int] = [])

   Set UE height for selected UEs. Empty *ids* = all UEs.

.. py:method:: SimConfig.set_ues_power(radiated_power_dbm: float, ids: list[int] = [])

   Set UE radiated power for selected UEs.

.. py:method:: SimConfig.set_rus_power(radiated_power_dbm: float, ids: list[int] = [])

   Set RU radiated power for selected RUs.

.. TODO: not exposed to users in 1.5
.. .. py:method:: SimConfig.set_attributes(prim_type: str, ids: list, attributes: dict)

..    Set arbitrary attributes on a named sim section. *prim_type* is
..    one of ``"DUs"``, ``"RUs"``, ``"UEs"``, ``"Panels"``,
..    ``"Materials"``, ``"VegetationMaterials"``, ``"BldgExterior"``,
..    ``"BldgInterior"``. *ids* uses ``int`` for node types and ``str``
..    for material and building types. Empty list = wildcard.

Output
^^^^^^

.. py:method:: SimConfig.to_dict() -> dict

   Convert the configuration to a nested Python dictionary,
   compatible with ``OmegaConf.save()``.
