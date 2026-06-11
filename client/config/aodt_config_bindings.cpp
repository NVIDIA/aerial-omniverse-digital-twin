// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "aodt_config.hpp"
#include <pybind11/operators.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

namespace py = pybind11;
using namespace aodt::config;

PYBIND11_MODULE(_config, m) {
  m.doc() = "AODT Configuration Builder - High-Level Domain API";

  //=========================================================================
  // S3Config (reusable across GIS, parquet export, etc.)
  //=========================================================================

  py::class_<S3Config>(
      m, "S3Config",
      "S3 connection credentials, reusable across calls.\n\n"
      "Example:\n"
      "    s3 = S3Config(bucket='warehouse', provider='minio',\n"
      "                 endpoint_url='http://localhost:9002')")
      .def(py::init([](const std::string &bucket, const std::string &provider,
                       const std::string &endpoint_url,
                       const std::string &access_key,
                       const std::string &secret_key,
                       const std::string &region) {
             S3Config cfg;
             cfg.bucket = bucket;
             cfg.provider = provider;
             cfg.endpointUrl = endpoint_url;
             cfg.accessKey = access_key;
             cfg.secretKey = secret_key;
             cfg.region = region;
             return cfg;
           }),
           py::arg("bucket") = "", py::arg("provider") = "",
           py::arg("endpoint_url") = "", py::arg("access_key") = "",
           py::arg("secret_key") = "", py::arg("region") = "us-east-1")
      .def_readwrite("bucket", &S3Config::bucket)
      .def_readwrite("provider", &S3Config::provider)
      .def_readwrite("endpoint_url", &S3Config::endpointUrl)
      .def_readwrite("access_key", &S3Config::accessKey)
      .def_readwrite("secret_key", &S3Config::secretKey)
      .def_readwrite("region", &S3Config::region);

  //=========================================================================
  // Enums
  //=========================================================================

  py::enum_<SimMode>(m, "SimMode", "Simulation mode")
      .value("EM", SimMode::EM, "Electromagnetic mode (duration-based)")
      .value("RAN", SimMode::RAN, "RAN mode (slot-based)")
      .export_values();

  py::enum_<DBTable>(m, "DBTable", "Tables to save in the DB")
      .value("CIRS", DBTable::CIRS, "Channel Impulse Response")
      .value("CFRS", DBTable::CFRS, "Channel Frequency Response")
      .value("RAYPATHS", DBTable::RAYPATHS, "Raypaths")
      .value("TELEMETRY", DBTable::TELEMETRY, "Telemetry")
      .export_values();

  py::enum_<GeoTargets>(m, "GeoTargets",
                        "Target geometry type for material operations")
      .value("BLDG", GeoTargets::BLDG, "Building materials (sim.Materials)")
      .value("VEG", GeoTargets::VEG,
             "Vegetation materials (sim.VegetationMaterials)")
      .export_values();

  py::enum_<DiffusionModel>(m, "DiffusionModel", "EM diffusion model")
      .value("LAMBERTIAN", DiffusionModel::LAMBERTIAN,
             "Lambertian diffusion (0)")
      .value("DIRECTIONAL", DiffusionModel::DIRECTIONAL,
             "Directional diffusion (1)")
      .export_values();

  py::enum_<AntennaElement>(m, "AntennaElement", "Antenna element type")
      .value("Isotropic", AntennaElement::Isotropic)
      .value("InfinitesimalDipole", AntennaElement::InfinitesimalDipole)
      .value("HalfwaveDipole", AntennaElement::HalfwaveDipole)
      .value("RecMicrostripPatch", AntennaElement::RecMicrostripPatch)
      .value("ThreeGPP38901", AntennaElement::ThreeGPP38901)
      .value("PolarizedIsotropic", AntennaElement::PolarizedIsotropic)
      .export_values();

  //=========================================================================
  // Position and Waypoint
  //=========================================================================

  py::class_<Position>(m, "Position", "Position (2D/3D georef or Cartesian)")
      .def_static("georef", &Position::georef, py::arg("lat"), py::arg("lon"),
                  py::arg("alt") = std::nullopt,
                  "Create georeferenced position")
      .def_static("cartesian", &Position::cartesian, py::arg("x"), py::arg("y"),
                  py::arg("z") = std::nullopt, "Create Cartesian position");

  py::class_<Waypoint>(m, "Waypoint",
                       "UE waypoint with position and parameters")
      .def(py::init<>())
      .def_readwrite("position", &Waypoint::position)
      .def_readwrite("speed", &Waypoint::speed, "Speed in m/s")
      .def_readwrite("pauseDuration", &Waypoint::pauseDuration,
                     "Pause duration in seconds")
      .def_readwrite("azimuthOffset", &Waypoint::azimuthOffset,
                     "Azimuth offset in degrees")
      .def("__repr__", [](const Waypoint &w) -> std::string {
        std::string pos_str;
        if (w.position.isGeoref()) {
          pos_str = "lat=" + std::to_string(*w.position.lat) +
                    ", lon=" + std::to_string(*w.position.lon);
          if (w.position.alt.has_value()) {
            pos_str += ", alt=" + std::to_string(*w.position.alt);
          }
        } else if (w.position.isCartesian()) {
          pos_str = "x=" + std::to_string(*w.position.x) +
                    ", y=" + std::to_string(*w.position.y);
          if (w.position.z.has_value()) {
            pos_str += ", z=" + std::to_string(*w.position.z);
          }
        } else {
          pos_str = "undefined";
        }
        return "<Waypoint(" + pos_str + ", speed=" + std::to_string(w.speed) +
               ", pause=" + std::to_string(w.pauseDuration) +
               ", azimuth=" + std::to_string(w.azimuthOffset) + ")>";
      });

  py::class_<GPXSource>(m, "GPXSource", "GPX source configuration")
      .def(py::init<>())
      .def_readwrite("src", &GPXSource::src, "GPX file path")
      .def_readwrite("usePathfinding", &GPXSource::usePathfinding,
                     "Enable pathfinding (default true)")
      .def("__repr__", [](const GPXSource &g) {
        return "<GPXSource(src=" + g.src +
               ", pathfinding=" + (g.usePathfinding ? "true" : "false") + ")>";
      });

  //=========================================================================
  // Domain Objects (Prims)
  //=========================================================================

  py::class_<Panel>(m, "Panel", "Antenna panel configuration")
      // Built-in pattern name constants
      .def_readonly_static("ISOTROPIC", &Panel::ISOTROPIC)
      .def_readonly_static("INFINITESIMAL_DIPOLE", &Panel::INFINITESIMAL_DIPOLE)
      .def_readonly_static("HALFWAVE_DIPOLE", &Panel::HALFWAVE_DIPOLE)
      .def_readonly_static("REC_MICROSTRIP_PATCH", &Panel::REC_MICROSTRIP_PATCH)
      .def_readonly_static("THREE_GPP_38901", &Panel::THREE_GPP_38901)
      .def_readonly_static("POLARIZED_ISOTROPIC", &Panel::POLARIZED_ISOTROPIC)

      // Overload 1 (enum-based): register first for specific-first dispatch
      .def_static(
          "create_panel",
          static_cast<Panel (*)(const std::vector<AntennaElement> &, double,
                                double, int, double, int, bool, double,
                                double)>(&Panel::createPanel),
          py::arg("antenna_elements"), py::arg("frequency_mhz"),
          py::arg("vertical_spacing") = defaultVerticalSpacingWavelengths,
          py::arg("vertical_num") = defaultVerticalNumElements,
          py::arg("horizontal_spacing") = defaultHorizontalSpacingWavelengths,
          py::arg("horizontal_num") = defaultHorizontalNumElements,
          py::arg("dual_polarized") = defaultDualPolarized,
          py::arg("roll_first") = defaultRollFirstPolElement,
          py::arg("roll_second") = defaultRollSecondPolElement,
          R"pbdoc(
            Create an antenna panel from AntennaElement enums.

            Args:
                antenna_elements: List of antenna element types (AntennaElement enum).
                frequency_mhz: Reference frequency in MHz.
                vertical_spacing: Vertical spacing in wavelengths (default 0.5).
                vertical_num: Number of vertical elements (default 1).
                horizontal_spacing: Horizontal spacing in wavelengths (default 0.5).
                horizontal_num: Number of horizontal elements (default 2).
                dual_polarized: Whether panel is dual polarized (default True).
                roll_first: First polarization roll angle in degrees.
                roll_second: Second polarization roll angle in degrees.

            Returns:
                Panel: Created panel instance.
          )pbdoc")

      // Overload 2 (string-based): registered second
      .def_static(
          "create_panel",
          static_cast<Panel (*)(const std::vector<std::string> &, double,
                                double, int, double, int, bool, double,
                                double)>(&Panel::createPanel),
          py::arg("antenna_elements"), py::arg("frequency_mhz"),
          py::arg("vertical_spacing") = defaultVerticalSpacingWavelengths,
          py::arg("vertical_num") = defaultVerticalNumElements,
          py::arg("horizontal_spacing") = defaultHorizontalSpacingWavelengths,
          py::arg("horizontal_num") = defaultHorizontalNumElements,
          py::arg("dual_polarized") = defaultDualPolarized,
          py::arg("roll_first") = defaultRollFirstPolElement,
          py::arg("roll_second") = defaultRollSecondPolElement,
          R"pbdoc(
            Create an antenna panel from string-based antenna names.

            Args:
                antenna_elements: List of antenna names as strings (e.g. ``Panel.ISOTROPIC``, ``Panel.THREE_GPP_38901``, or custom file paths like ``"path/to/pattern.csv"``).
                frequency_mhz: Reference frequency in MHz.
                vertical_spacing: Vertical spacing in wavelengths (default 0.5).
                vertical_num: Number of vertical elements (default 1).
                horizontal_spacing: Horizontal spacing in wavelengths (default 0.5).
                horizontal_num: Number of horizontal elements (default 2).
                dual_polarized: Whether panel is dual polarized (default True).
                roll_first: First polarization roll angle in degrees.
                roll_second: Second polarization roll angle in degrees.

            Returns:
                Panel: Created panel instance.
          )pbdoc")

      // File-based panel factory
      .def_static("create_panel_from_file", &Panel::createPanelFromFile,
                  py::arg("panel_file_path"),
                  R"pbdoc(
            Create a file-based panel from a CSV/FFD file.

            The panel configuration is entirely defined by the file.
            No update entry is emitted in the generated YAML.

            Args:
                panel_file_path: Path to the panel definition file.

            Returns:
                Panel: Created file-based panel instance.
          )pbdoc")

      .def("id", &Panel::id, "Get panel ID")
      .def_property_readonly("frequency", &Panel::frequency, "Frequency in MHz")
      .def_property_readonly("num_antennas", &Panel::numAntennas,
                             "Total number of antennas")
      .def_property_readonly("vertical_num_elements",
                             &Panel::verticalNumElements,
                             "Number of vertical elements")
      .def_property_readonly("horizontal_num_elements",
                             &Panel::horizontalNumElements,
                             "Number of horizontal elements")
      .def_property_readonly("dual_polarized", &Panel::dualPolarized,
                             "Whether panel is dual polarized")
      .def_property_readonly("is_file_based", &Panel::isFileBased,
                             "Whether panel is loaded from a file")
      .def_property_readonly("panel_file", &Panel::panelFile,
                             "Path to panel file (empty if not file-based)")

      // Focused setters (not valid on file-based panels).
      .def("set_antenna_elements",
           static_cast<void (Panel::*)(const std::vector<AntennaElement> &)>(
               &Panel::setAntennaElements),
           py::arg("elements"),
           R"pbdoc(
            Replace the antenna element list (AntennaElement enum form).

            Re-runs the full panel invariant check.

            Args:
                elements: List of AntennaElement values.

            Raises:
                RuntimeError: If the panel is file-based, or if
                    ``len(elements) > 1`` and does not match
                    ``vertical_num * horizontal_num * (2 if dual_polarized else 1)``.
          )pbdoc")
      .def("set_antenna_elements",
           static_cast<void (Panel::*)(std::vector<std::string>)>(
               &Panel::setAntennaElements),
           py::arg("names"),
           R"pbdoc(
            Replace the antenna element list (string form).

            Names can be built-in pattern constants (``Panel.ISOTROPIC``
            etc.) or custom pattern file paths. Empty strings are
            rejected.
          )pbdoc")
      .def("set_frequency", &Panel::setFrequency, py::arg("mhz"),
           R"pbdoc(
            Set the panel reference frequency in MHz. Does not change
            the stored mm-spacing; call set_spacing_wavelengths() if you
            want to re-derive spacing at the new frequency.
          )pbdoc")
      .def("set_spacing_wavelengths", &Panel::setSpacingWavelengths,
           py::arg("vertical_wavelengths"), py::arg("horizontal_wavelengths"),
           "Set element spacing in wavelengths at the current frequency "
           "(stored internally as mm).")
      .def("set_panel_size", &Panel::setPanelSize, py::arg("vertical_num"),
           py::arg("horizontal_num"), py::arg("dual_polarized"),
           "Set the array shape and dual polarization; re-runs the "
           "antenna-list size check.")
      .def("set_roll_angles", &Panel::setRollAngles, py::arg("first_deg"),
           py::arg("second_deg"),
           "Set the polarization roll angles in degrees.")

      .def("__repr__", [](const Panel &p) {
        if (p.isFileBased()) {
          return "<Panel(id=" + std::to_string(p.id()) +
                 ", file=" + p.panelFile() + ")>";
        }
        return "<Panel(id=" + std::to_string(p.id()) +
               ", freq=" + std::to_string(p.frequency()) + " MHz" +
               ", antennas=" + std::to_string(p.numAntennas()) + ")>";
      });

  py::class_<DU>(m, "DU", "Distributed Unit")
      .def("id", &DU::id, "Get DU ID")
      .def("frequency", &DU::frequency, "Get frequency in MHz")
      .def("set_position", py::overload_cast<Position>(&DU::setPosition),
           py::arg("position"), "Set DU position")
      .def("set_frequency", &DU::setFrequency, py::arg("mhz"),
           "Set the DU reference frequency in MHz. Does not modify the "
           "frequencies of associated RUs.")
      .def("set_fft_size", &DU::setFFTSize, py::arg("size"))
      .def("set_max_channel_bandwidth", &DU::setMaxChannelBandwidth,
           py::arg("bw"))
      .def("set_num_antennas", &DU::setNumAntennas, py::arg("num"))
      .def("__repr__", [](const DU &du) {
        return "<DU(id=" + std::to_string(du.id()) +
               ", freq=" + std::to_string(du.frequency()) + " MHz)>";
      });

  py::class_<RU>(m, "RU", "Radio Unit")
      .def("id", &RU::id, "Get RU ID")
      .def("frequency", &RU::frequency, "Get frequency in MHz")
      .def("du_id", &RU::duId, "Get associated DU ID")
      .def("panel_id", &RU::panelId,
           "Get the id of the panel assigned to this RU. For an RU "
           "retrieved via SimConfig.get_ru(id) this is always non-zero "
           "(SimConfig.add_ru resolves unset to the default RU panel).")
      .def("set_position", py::overload_cast<Position>(&RU::setPosition),
           py::arg("position"), "Set RU position")
      .def("set_height", &RU::setHeight, py::arg("height_m"),
           "Set height in meters")
      .def("set_radiated_power", &RU::setRadiatedPower, py::arg("power_dbm"),
           "Set radiated power in dBm")
      .def("set_mech_azimuth", &RU::setMechAzimuth, py::arg("deg"),
           "Set mechanical azimuth in degrees")
      .def("set_mech_tilt", &RU::setMechTilt, py::arg("deg"),
           "Set mechanical tilt in degrees")
      .def("set_frequency", &RU::setFrequency, py::arg("mhz"),
           "Set the RU carrier frequency in MHz. Does not modify the "
           "associated DU's frequency.")
      .def("set_du_manual_assign", &RU::setDUManualAssign,
           py::arg("manual_assign"),
           "Set whether the RU is manually assigned to its DU")
      .def("assign_panel", &RU::assignPanel, py::arg("panel"),
           "Assign a specific panel to this RU (overrides default)")
      .def("__repr__", [](const RU &ru) {
        return "<RU(id=" + std::to_string(ru.id()) +
               ", freq=" + std::to_string(ru.frequency()) + " MHz" +
               ", duId=" + std::to_string(ru.duId()) + ")>";
      });

  py::class_<UE>(m, "UE", "User Equipment")
      .def("id", &UE::id, "Get UE ID")
      .def("panel_id", &UE::panelId, "Get panel ID")
      .def("add_waypoint", &UE::addWaypoint, py::arg("position"),
           py::arg("speed") = 0.0, py::arg("pause_duration") = 0.0,
           py::arg("azimuth_offset") = 0.0,
           "Add waypoint with optional speed, pause, and azimuth")
      .def("clear_waypoints", &UE::clearWaypoints, "Clear all waypoints")
      .def("set_bler_target", &UE::setBlerTarget, py::arg("target"))
      .def("set_manual", &UE::setManual, py::arg("manual"))
      .def("set_radiated_power", &UE::setRadiatedPower, py::arg("power_dbm"),
           "Set UE radiated power in dBm")
      .def("set_initial_mech_azimuth", &UE::setInitialMechAzimuth,
           py::arg("deg"), "Set initial UE mechanical azimuth in degrees")
      .def("set_mech_tilt", &UE::setMechTilt, py::arg("deg"),
           "Set UE mechanical tilt in degrees")
      .def("assign_panel", &UE::assignPanel, py::arg("panel"),
           "Assign a specific panel to this UE (overrides default)")
      .def("set_gpx_source", &UE::setGPXSource, py::arg("gpx"),
           "Set GPX source for this UE")
      .def("has_gpx", &UE::hasGPX, "Check if UE has a GPX source")
      .def("gpx_source", &UE::gpxSource,
           py::return_value_policy::reference_internal, "Get GPX source")
      .def("radiated_power_dbm", &UE::radiatedPowerDbm,
           "Get UE radiated power in dBm")
      .def("waypoints", &UE::waypoints,
           py::return_value_policy::reference_internal, "Get waypoints list")
      .def("__repr__", [](const UE &ue) {
        return "<UE(id=" + std::to_string(ue.id()) +
               ", waypoints=" + std::to_string(ue.waypoints().size()) +
               ", gpx=" + (ue.hasGPX() ? ue.gpxSource()->src : "none") + ")>";
      });

  //=========================================================================
  // Nodes - Factory API
  //=========================================================================

  py::class_<Nodes>(m, "Nodes", "Factory for creating DU, RU, and UE objects")
      .def_static("create_du", &Nodes::createDU, py::arg("du_id"),
                  py::arg("frequency_mhz") = defaultCarrierFreqMHz,
                  py::arg("scs_khz") = defaultSubcarrierSpacing,
                  R"pbdoc(
            Create a Distributed Unit (DU).

            Args:
                du_id: DU identifier (must be > 0).
                frequency_mhz: Carrier frequency in MHz (default 3600).
                scs_khz: Subcarrier spacing in kHz (default 30).

            Returns:
                DU: Created DU instance.
          )pbdoc")
      .def_static("create_ru", &Nodes::createRU, py::arg("ru_id"),
                  py::arg("frequency_mhz") = defaultCarrierFreqMHz,
                  py::arg("radiated_power_dbm") = defaultRadiatedPowerDbmRU,
                  py::arg("du_id") = defaultDuId,
                  R"pbdoc(
            Create a Radio Unit (RU).

            Args:
                ru_id: RU identifier (must be > 0).
                frequency_mhz: Carrier frequency in MHz (default 3600).
                radiated_power_dbm: Radiated power in dBm (default 43).
                du_id: Associated DU identifier (default 1).

            Returns:
                RU: Created RU instance.
          )pbdoc")
      .def_static("create_ue", &Nodes::createUE, py::arg("ue_id"),
                  py::arg("radiated_power_dbm") = defaultRadiatedPowerDbmUE,
                  R"pbdoc(
            Create a User Equipment (UE).

            Args:
                ue_id: UE identifier (must be in [1, 10000]).
                radiated_power_dbm: Radiated power in dBm (default 26).

            Returns:
                UE: Created UE instance.
          )pbdoc");

  //=========================================================================
  // SimConfig - Main API
  //=========================================================================

  py::class_<SimConfig>(m, "SimConfig",
                        R"pbdoc(
        High-level configuration builder for AODT simulations.
        
        Provides simple, domain-oriented API for building simulation configs.
        )pbdoc")
      .def(py::init<const std::string &, SimMode, const std::string &>(),
           py::arg("scene_url"), py::arg("mode") = SimMode::EM,
           py::arg("asset_config_path") = "",
           R"pbdoc(
             Create configuration builder.

             Args:
                 scene_url: Scene URL — S3 key prefix (e.g. "test_data/maps/tokyo") or
                     local absolute path.
                 mode: Simulation mode (EM or RAN, default EM).
                 asset_config_path: Path to assets.yml (required). Each entry
                     is a complete S3 key or local path.

             Raises:
                 RuntimeError: If asset_config_path is empty or cannot be loaded.
             )pbdoc")

      .def_static("from_yaml_file", &SimConfig::fromYAMLFile,
                  py::arg("file_path"),
                  R"pbdoc(
             Load an existing complete YAML config file.

             Imported configs do not require assets.yml; asset defaults are
             read from the YAML file and the returned SimConfig remains
             editable through the normal API.
             )pbdoc")

      //=====================================================================
      // Global Settings
      //=====================================================================

      .def("set_num_batches", &SimConfig::setNumBatches, py::arg("batches"),
           R"pbdoc(
            Set number of simulation batches.

            Args:
                batches: Number of batches (must be > 0).

            Raises:
                ValueError: If batches <= 0.
          )pbdoc")

      .def("set_simulation_id", &SimConfig::setSimulationID,
           py::arg("simulation_id"),
           R"pbdoc(
            Set the simulation ID (used as DB name and identifier).

            Args:
                simulation_id: Non-empty simulation identifier string.
          )pbdoc")

      .def("set_db", &SimConfig::setDB, py::arg("db_host") = "clickhouse",
           py::arg("db_port") = 9000, py::arg("db_author") = defaultDbAuthor,
           py::arg("db_notes") = std::string(""),
           R"pbdoc(
            Set DB connection parameters (all optional with defaults).

            Args:
                db_host: Database host (default "localhost").
                db_port: Database port (default 9000).
                db_author: Author tag (default "aerial").
                db_notes: Free-form notes (default "").
          )pbdoc")

      .def("set_timeline", &SimConfig::setTimeline,
           py::arg("duration") = std::nullopt,
           py::arg("interval") = std::nullopt,
           py::arg("slots_per_batch") = std::nullopt,
           py::arg("realizations_per_slot") = std::nullopt,
           R"pbdoc(
            Set simulation timeline. Provide **either** duration/interval
            **or** slots/realizations — not both.

            Args:
                duration: Simulation duration in seconds (EM mode).
                interval: Time step interval in seconds (EM mode).
                slots_per_batch: Number of slots per batch (RAN / slot mode).
                realizations_per_slot: Realizations per slot (1 or 14).

            Raises:
                RuntimeError: If both groups are provided, or neither, or
                    duration/interval is used in RAN mode.
          )pbdoc")

      .def("set_seed", &SimConfig::setSeed, py::arg("seed") = 0,
           R"pbdoc(
            Enable deterministic seeding for mobility.

            Calling this method enables seeded mode. The same seed
            produces the same procedural UE placements and vehicle
            trajectories across runs.

            Args:
                seed: Integer seed value (default 0).
          )pbdoc")

      .def("add_tables_to_db", &SimConfig::addTableToDb, py::arg("table"),
           "Add a table to save in the DB")

      .def("add_table_option", &SimConfig::addTableOption,
           py::arg("table_name"), py::arg("option"),
           R"pbdoc(
            Set an option for a specific opt-in table.

            Adds a key-value pair to the opt_in_tables_options map in
            the DB section. The table_name should match one of the tables
            added via add_tables_to_db().

            Args:
                table_name: Table name (e.g. "raypaths").
                option: Option value (e.g. "full").
          )pbdoc")

      .def("set_s3_config", &SimConfig::setS3Config, py::arg("s3_config"),
           R"pbdoc(
            Set the S3 connection config for GIS map storage.
            Emitted as db.s3_config in the YAML output.

            Args:
                s3_config: S3Config object with connection credentials.
          )pbdoc")

      .def("enable_parquet_export", &SimConfig::enableParquetExport,
           py::arg("timesteps_per_file") = 100, py::arg("compression") = "zstd",
           py::arg("max_workers") = 2, py::arg("verify_exports") = true,
           R"pbdoc(
            Enable Parquet export section under db.

            Args:
                timesteps_per_file: Number of timesteps per parquet file.
                compression: Parquet compression method (zstd/snappy/gzip/lz4).
                max_workers: Max worker processes per node.
                verify_exports: Whether to verify exported row counts.
          )pbdoc")

      .def("disable_parquet_export", &SimConfig::disableParquetExport,
           R"pbdoc(
            Disable parquet export. Configs loaded from infra are retained
            so re-enabling restores previous settings.
          )pbdoc")

      .def("add_parquet_s3_config", &SimConfig::addParquetS3Config,
           py::arg("s3_config"),
           py::arg("nodes") = std::vector<std::string>{"node1"},
           py::arg("use_ssl") = false,
           R"pbdoc(
            Add one S3/MinIO config entry for parquet export.

            Args:
                s3_config: S3Config object with connection credentials.
                nodes: Node ids that should use this storage config (default: ["node1"]).
                use_ssl: Whether to use TLS.
          )pbdoc")

      .def("set_parquet_iceberg", &SimConfig::setParquetIcebergConfig,
           py::arg("catalog_type") = "rest",
           py::arg("catalog_uri") = "http://nessie:19120/iceberg",
           py::arg("catalog_name") = "default", py::arg("aws_region") = "",
           py::arg("nessie_ref") = "main",
           R"pbdoc(
            Set iceberg catalog settings for parquet export.
            Presence of this call enables iceberg registration.

            Args:
                catalog_type: Catalog type ("sql", "rest", "glue").
                catalog_uri: Catalog endpoint URI.
                catalog_name: Catalog logical name.
                aws_region: AWS region for Glue catalogs.
                nessie_ref: Nessie ref/branch.
          )pbdoc")

      .def("set_ray_tracing_model", &SimConfig::setRayTracingModel,
           py::arg("diffuse_type") = DiffusionModel::LAMBERTIAN,
           py::arg("interactions") = 5,
           py::arg("max_num_paths_per_ant_pair") = 500,
           py::arg("emitted_rays_in_thousands") = 500,
           py::arg("fast_mode") = false,
           R"pbdoc(
            Set ray tracing parameters.

            Args:
                diffuse_type: Diffusion model (LAMBERTIAN or DIRECTIONAL).
                interactions: Number of ray interactions (default 5).
                max_num_paths_per_ant_pair: Max paths per antenna pair (default 500).
                emitted_rays_in_thousands: Emitted rays in thousands (default 500).
                fast_mode: Enable EMsolver fast mode (default false).
          )pbdoc")

      .def("enable_wideband", &SimConfig::enableWideband,
           "Enable wideband simulation")

      //=====================================================================
      // Panel Management
      //=====================================================================

      .def("set_default_panel_ru", &SimConfig::setDefaultPanelRU,
           py::arg("panel"), "Set default panel for RUs (assigns ID 2)")

      .def("set_default_panel_ue", &SimConfig::setDefaultPanelUE,
           py::arg("panel"), "Set default panel for UEs (assigns ID 1)")

      .def("add_panel", &SimConfig::addPanel, py::arg("panel"),
           "Add an additional panel (auto-assigns ID if unset)")

      //=====================================================================
      // DU Management
      //=====================================================================

      .def("add_du", &SimConfig::addDU, py::arg("du"),
           "Add DU to config (after configuration)")

      //=====================================================================
      // RU Management
      //=====================================================================

      .def("add_ru", &SimConfig::addRU, py::arg("ru"),
           "Add RU to config (after configuration)")

      //=====================================================================
      // UE Management
      //=====================================================================

      .def("add_ue", &SimConfig::addUE, py::arg("ue"),
           "Add UE to config (after waypoints are configured)")

      .def("clear_waypoints", &SimConfig::clearWaypoints, py::arg("ue_id"),
           "Clear all waypoints for a given UE")

      .def("remove_ue", &SimConfig::removeUE, py::arg("ue_id"),
           "Remove a UE from the configuration")

      .def("get_ue", &SimConfig::getUE, py::arg("ue_id"),
           py::return_value_policy::reference_internal,
           "Get mutable reference to a UE by ID")

      .def("get_ru", &SimConfig::getRU, py::arg("ru_id"),
           py::return_value_policy::reference_internal,
           "Get mutable reference to an RU by ID")

      .def("get_du", &SimConfig::getDU, py::arg("du_id"),
           py::return_value_policy::reference_internal,
           "Get mutable reference to a DU by ID")

      .def("get_panel", &SimConfig::getPanel, py::arg("panel_id"),
           py::return_value_policy::reference_internal,
           "Get mutable reference to a Panel by ID")

      .def("get_default_ru_panel_id", &SimConfig::getDefaultRUPanelId,
           R"pbdoc(
            Return the id of the panel registered as the default RU panel
            (the YAML field ``sim_gnb_panel_type``).

            Useful when re-editing a config loaded via ``from_yaml_file``::

                panel = config.get_panel(config.get_default_ru_panel_id())
                panel.set_antenna_elements([AntennaElement.Isotropic])

            Note: the underlying field is always populated (defaults to 2),
            so a non-zero return value does not by itself imply that a
            Panel with that id has been added to the config yet.
          )pbdoc")

      .def("get_default_ue_panel_id", &SimConfig::getDefaultUEPanelId,
           R"pbdoc(
            Return the id of the panel registered as the default UE panel
            (the YAML field ``sim_ue_panel_type``).

            See :py:meth:`get_default_ru_panel_id` for caveats on default
            initialization.
          )pbdoc")

      .def("get_ru_ids", &SimConfig::getPrimIds<RU>,
           "Return the ids of all added RUs (unspecified order).")

      .def("get_ue_ids", &SimConfig::getPrimIds<UE>,
           "Return the ids of all added UEs (unspecified order).")

      .def("get_du_ids", &SimConfig::getPrimIds<DU>,
           "Return the ids of all added DUs (unspecified order).")

      .def("get_panel_ids", &SimConfig::getPrimIds<Panel>,
           "Return the ids of all added Panels (unspecified order).")

      .def("add_ues_from_gpx", &SimConfig::addUEsFromGPX, py::arg("gpx_src"),
           py::arg("ue_ids"), py::arg("use_pathfinding") = true,
           R"pbdoc(
            Add UEs driven by a GPX file.

            Creates UEs with the given IDs and assigns them the GPX source.
            UEs will use the default UE panel. Use get_ue() to customize
            individual UE properties after adding.

            Args:
                gpx_src: Path to GPX file.
                ue_ids: List of UE IDs to create.
                use_pathfinding: Enable pathfinding for the route (default true).
          )pbdoc")

      //=====================================================================
      // Procedural UEs and Urban Mobility
      //=====================================================================

      .def("add_spawn_zone", &SimConfig::addSpawnZone, py::arg("points_ccw"),
           "Add spawn zone for procedural UEs as a CCW polygon of positions")

      .def("set_bbox_window", &SimConfig::setBboxWindow, py::arg("bbox_window"),
           R"pbdoc(
            Set the bounding box window as a list of positions.

            Typically two georeferenced positions defining opposite corners.

            Args:
                bbox_window: List of Position objects defining the bbox.
          )pbdoc")

      .def("set_ue_speed", &SimConfig::setUESpeed, py::arg("min_speed"),
           py::arg("max_speed"),
           R"pbdoc(
            Set speed range for procedural UEs.

            Args:
                min_speed: Minimum UE speed in m/s (>= 0).
                max_speed: Maximum UE speed in m/s (>= min_speed).
          )pbdoc")

      .def("set_num_procedural_ues", &SimConfig::setNumProceduralUEs,
           py::arg("num"), "Set number of procedural UEs")

      .def("set_perc_indoor_procedural_ues",
           &SimConfig::setPercIndoorProceduralUEs, py::arg("perc"),
           "Set percentage of indoor procedural UEs (0-100)")

      .def("enable_urban_mobility", &SimConfig::enableUrbanMobility,
           py::arg("vehicles"), "Enable urban mobility with vehicles")
      .def("enable_vegetation", &SimConfig::enableVegetation,
           py::arg("geojson_path") = std::string{},
           R"pbdoc(
            Enable vegetation rendering from GeoJSON data.

            Args:
                geojson_path: Optional custom GeoJSON path used as-is.
                    If omitted, a default is derived from the scene URL
                    (``<scene_url>/sim/vegetation.geojson``).

            The vegetation asset model path comes from ``vegetation_assets``
            in assets.yml and is emitted as
            ``gis.vegetation.vegetation_asset_path`` when vegetation is active.
          )pbdoc")

      //=====================================================================
      // Material Calibration
      //=====================================================================

      .def("add_material_definition", &SimConfig::addMaterialDefinition,
           py::arg("file"), py::arg("target"),
           R"pbdoc(
            Add a material calibration definition file.

            Args:
                file: Path to the definition JSON file.
                target: GeoTargets.BLDG for building materials,
                        GeoTargets.VEG for vegetation materials.
          )pbdoc")

      .def("add_material_assignment", &SimConfig::addMaterialAssignment,
           py::arg("file"), py::arg("target"),
           R"pbdoc(
            Add a material calibration assignment file.

            Args:
                file: Path to the assignment JSON file.
                target: GeoTargets.BLDG for building materials,
                        GeoTargets.VEG for vegetation materials.
          )pbdoc")

      //=====================================================================
      // Calibration Run Configuration
      //=====================================================================

      .def("set_calibration_targets", &SimConfig::setCalibrationTargets,
           py::arg("materials"), py::arg("veg_materials"), py::arg("rus"),
           py::arg("rus_beams"), py::arg("ues"),
           R"pbdoc(
            Set calibration target flags.

            Args:
                materials: Calibrate building materials.
                veg_materials: Calibrate vegetation materials.
                rus: Calibrate RU angles.
                rus_beams: Calibrate RU beam settings.
                ues: Calibrate UE angles.
          )pbdoc")

      .def("add_calibration_measurement", &SimConfig::addCalibrationMeasurement,
           py::arg("ru_id"), py::arg("ue_id"), py::arg("measurement_file"),
           R"pbdoc(
            Add one calibration measurement entry.

            Args:
                ru_id: RU ID for the measured link.
                ue_id: UE ID for the measured link.
                measurement_file: Measurement CSV path.
          )pbdoc")

      .def("set_calibration_timeline", &SimConfig::setCalibrationTimeline,
           py::arg("start") = 0, py::arg("step") = 1,
           py::arg("end") = std::nullopt,
           R"pbdoc(
            Set calibration timeline.

            Args:
                start: First time index.
                step: Time index stride.
                end: Optional final time index.
          )pbdoc")

      .def("set_calibration_output", &SimConfig::setCalibrationOutput,
           py::arg("folder_key"),
           R"pbdoc(
            Set calibration output S3 folder key.

            Args:
                folder_key: Output folder key under configured S3 bucket.
          )pbdoc")

      .def("set_calibration_execution_mode",
           &SimConfig::setCalibrationExecutionMode, py::arg("execution_mode"),
           R"pbdoc(
            Override the calibration execution mode.

            Typical calibration configs should leave this unset. If omitted,
            the calibration pipeline derives the execution mode from the
            target flags set by `set_calibration_targets()`.

            Use this only when you need an explicit training bitmask or a
            debug mode understood by the calibration pipeline.

            Args:
                execution_mode: String form of the execution-mode integer.
                    For example, "0" means debug forward pass; positive values
                    are calibration-group bitmasks.
          )pbdoc")

      .def("set_calibration_keep_local_output",
           &SimConfig::setCalibrationKeepLocalOutput,
           py::arg("keep_local_output"),
           "Set whether calibration keeps local output files.")

      //=====================================================================
      // Building RF attributes
      //=====================================================================
      .def("set_bldg_exterior_attr", &SimConfig::setBldgExteriorAttr,
           py::arg("activate_rf"), py::arg("activate_diffraction"),
           py::arg("activate_diffusion"), py::arg("activate_transmission"),
           py::arg("diffuse_surface_element_area") = std::nullopt,
           py::arg("building_ids") = std::vector<std::string>{},
           R"pbdoc(
             Convenience wrapper to set RF attributes for exterior buildings.

             If `diffuse_surface_element_area` is omitted (None), the
             `AerialRFdS` attribute is not emitted in the generated YAML.
           )pbdoc")

      .def("set_bldg_interior_attr", &SimConfig::setBldgInteriorAttr,
           py::arg("activate_rf"), py::arg("activate_diffraction"),
           py::arg("activate_transmission"),
           py::arg("building_ids") = std::vector<std::string>{},
           R"pbdoc(
             Convenience wrapper to set RF attributes for interior buildings.
           )pbdoc")

      //=====================================================================
      // Advanced API
      //=====================================================================

      .def("set_ues_height", &SimConfig::setUEsHeight, py::arg("height_m"),
           py::arg("ids") = std::vector<int>{},
           R"pbdoc(
            Set UE height for selected UEs.

            Args:
                height_m: UE height in meters.
                ids: Optional UE IDs to update. Empty means wildcard (all UEs).
          )pbdoc")

      .def("set_ues_power", &SimConfig::setUEsPower,
           py::arg("radiated_power_dbm"), py::arg("ids") = std::vector<int>{},
           R"pbdoc(
            Set UE radiated power for selected UEs.

            Args:
                radiated_power_dbm: UE radiated power in dBm.
                ids: Optional UE IDs to update. Empty means wildcard (all UEs).
          )pbdoc")

      .def("set_rus_power", &SimConfig::setRUsPower,
           py::arg("radiated_power_dbm"), py::arg("ids") = std::vector<int>{},
           R"pbdoc(
            Set RU radiated power for selected RUs.

            Args:
                radiated_power_dbm: RU radiated power in dBm.
                ids: Optional RU IDs to update. Empty means wildcard (all RUs).
          )pbdoc")

      .def(
          "set_attributes",
          [](SimConfig &cfg, const std::string &primType, const py::list &ids,
             const py::dict &attrs) {
            // Convert py::dict to AttributeMap
            AttributeMap attrMap;
            for (auto &[k, v] : attrs) {
              std::string key = py::cast<std::string>(k);
              if (py::isinstance<py::bool_>(v)) {
                attrMap[key] = AttributeValue{py::cast<bool>(v)};
              } else if (py::isinstance<py::int_>(v)) {
                attrMap[key] = AttributeValue{
                    static_cast<std::int64_t>(py::cast<long long>(v))};
              } else if (py::isinstance<py::float_>(v)) {
                attrMap[key] = AttributeValue{py::cast<double>(v)};
              } else if (py::isinstance<py::str>(v)) {
                attrMap[key] = AttributeValue{py::cast<std::string>(v)};
              } else {
                throw std::invalid_argument(
                    "Unsupported attribute value type for key: " + key);
              }
            }
            // Route based on prim type
            if (primType == "Materials" || primType == "VegetationMaterials" ||
                primType == "BldgExterior" || primType == "BldgInterior") {
              std::vector<std::string> strIds;
              for (auto &id : ids) {
                strIds.push_back(py::cast<std::string>(id));
              }
              if (primType == "BldgExterior") {
                cfg.setAttributes<BldgExterior>(primType, strIds, attrMap);
              } else if (primType == "BldgInterior") {
                cfg.setAttributes<BldgInterior>(primType, strIds, attrMap);
              } else {
                cfg.setAttributes<Material>(primType, strIds, attrMap);
              }
            } else if (primType == "DUs" || primType == "RUs" ||
                       primType == "UEs" || primType == "Panels") {
              std::vector<int> intIds;
              for (auto &id : ids) {
                intIds.push_back(py::cast<int>(id));
              }
              if (primType == "DUs") {
                cfg.setAttributes<DU>(primType, intIds, attrMap);
              } else if (primType == "RUs") {
                cfg.setAttributes<RU>(primType, intIds, attrMap);
              } else if (primType == "UEs") {
                cfg.setAttributes<UE>(primType, intIds, attrMap);
              } else {
                cfg.setAttributes<Panel>(primType, intIds, attrMap);
              }
            } else {
              throw std::invalid_argument("Unknown prim type: " + primType);
            }
          },
          py::arg("prim_type"), py::arg("ids"), py::arg("attributes"),
          R"pbdoc(
            Set attributes on a named sim section (advanced API).

            Args:
                prim_type: Section name ("Materials", "VegetationMaterials",
                           "BldgExterior", "BldgInterior", "DUs", "RUs",
                           "UEs", "Panels").
                ids: List of IDs (strings for Materials, VegetationMaterials,
                     BldgExterior, and BldgInterior; ints for DUs/RUs/UEs/
                     Panels). Empty list = wildcard.
                attributes: Dict of attribute key-value pairs to set.
          )pbdoc")

      //=====================================================================
      // Output (Python dict, not YAML string)
      //=====================================================================

      .def(
          "to_dict",
          [](const SimConfig &cfg) -> py::dict {
            // Convert AttributeMap to Python dict recursively
            std::function<py::object(const AttributeValue &)> convertToPython;

            convertToPython = [&](const AttributeValue &av) -> py::object {
              return std::visit(
                  [&](auto &&val) -> py::object {
                    using T = std::decay_t<decltype(val)>;

                    if constexpr (std::is_same_v<T, std::monostate>) {
                      return py::none();
                    } else if constexpr (std::is_same_v<T, AttributeMap>) {
                      py::dict d;
                      for (const auto &[k, v] : val) {
                        d[py::str(k)] = convertToPython(v);
                      }
                      return d;
                    } else if constexpr (std::is_same_v<T, AttributeList>) {
                      py::list lst;
                      for (const auto &item : val) {
                        lst.append(convertToPython(item));
                      }
                      return lst;
                    } else if constexpr (std::is_same_v<T, bool>) {
                      return py::bool_(val);
                    } else if constexpr (std::is_same_v<T, std::int64_t>) {
                      return py::int_(val);
                    } else if constexpr (std::is_same_v<T, double>) {
                      return py::float_(val);
                    } else if constexpr (std::is_same_v<T, std::string>) {
                      return py::str(val);
                    } else {
                      return py::none();
                    }
                  },
                  av.value);
            };

            // Build neutral tree (now public via toNeutralTreePublic)
            AttributeMap tree = cfg.toNeutralTreePublic();

            // Convert to Python dict
            return convertToPython(AttributeValue{tree}).cast<py::dict>();
          },
          R"pbdoc(
        Convert configuration to Python dictionary.

        Returns:
            dict: Configuration as nested Python dict (compatible with OmegaConf)

        Example:
            >>> config = SimConfig("plateau/tokyo_small.usd", SimMode.EM, "assets.yml")
            >>> config_dict = config.to_dict()
            >>> from omegaconf import OmegaConf
            >>> OmegaConf.save(config_dict, "output.yml")
        )pbdoc")

      .def("__repr__", [](const SimConfig &cfg) -> std::string {
        return std::string("<SimConfig>"); // m_mode is private, can't access
      });

  // No additional helper functions exported
}
