// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

// AODT Config - SimConfig class and YAML emission helpers

#pragma once

#include "prim_collections.hpp"

#include <charconv>
#include <functional>
#include <fstream>
#include <limits>
#include <unordered_set>

#include <yaml-cpp/yaml.h>

namespace aodt::config {

/// Reusable S3 connection credentials (shared across GIS, parquet export, etc.)
struct S3Config {
  std::string bucket;
  std::string endpointUrl;
  std::string region = "us-east-1";
  std::string accessKey;
  std::string secretKey;
  std::string provider; // "minio", "aws"
};

//=============================================================================
// SimConfig - High-Level Facade
//=============================================================================

/**
 * @brief Main configuration builder for AODT simulations
 *
 * Provides high-level, domain-oriented API for creating simulation
 * configurations. Handles validation, ID assignment, and relationship
 * management automatically.
 *
 * Usage pattern:
 * 1. Create config with scene and mode
 * 2. Set global simulation parameters (batches, timeline, seed, etc.)
 * 3. Create and configure panels
 * 4. Create network elements (DU, RU, UE) with automatic validation
 * 5. Generate YAML output
 *
 * Example:
 * @code
 * SimConfig config("plateau/tokyo_small.usd", SimMode::EM, "assets.yml");
 * config.setSimulationID("my_sim");
 * config.setNumBatches(1);
 *
 * Panel uePanel = Panel::createPanel({AntennaElement::Isotropic}, 3600);
 * config.setDefaultPanelUE(uePanel);
 *
 * DU du = Nodes::createDU(1, 3600);
 * du.setPosition(Position::cartesian(0, 0, 100));
 * config.addDU(du);
 *
 * config.toYaml("output.yml");
 * @endcode
 */
class SimConfig {
public:
  /**
   * @brief Construct configuration builder.
   * @param sceneUrl Scene URL — S3 key prefix (e.g. "test_data/maps/tokyo") or
   *        local absolute path. Used as-is, no prefix prepending.
   * @param mode Simulation mode (EM or RAN), default EM.
   * @param assetConfigPath Path to assets.yml (required). Each entry is
   *        a complete S3 key or local path — no 'home' prefix.
   * @throws std::runtime_error if assetConfigPath is empty or can't be loaded.
   */
  explicit SimConfig(const std::string &sceneUrl, SimMode mode = SimMode::EM,
                     const std::string &assetConfigPath = "")
      : m_mode(mode) {
    if (assetConfigPath.empty()) {
      throw std::runtime_error(
          "assetConfigPath is required. Provide a path to assets.yml.");
    }
    loadDefaultAssetPaths(assetConfigPath);
    m_sceneUrl = sceneUrl;

    // Initialize Scenario based on mode
    m_scenario.m_isFullSim = (mode == SimMode::RAN);
    m_scenario.m_enableWideband = (mode == SimMode::RAN);
    m_scenario.m_simulationMode = (mode == SimMode::RAN ? 1 : 0);
  }

  //============== YAML Import Factory ==============

  /**
   * @brief Load a complete YAML config file into editable SimConfig state.
   * @param filePath Path to an existing YAML file.
   * @throws std::runtime_error for file, parse, or shape errors.
   */
  static SimConfig fromYAMLFile(const std::string &filePath) {
    std::ifstream file(filePath);
    if (!file.is_open()) {
      throw std::runtime_error("Failed to open YAML file: " + filePath);
    }

    try {
      YAML::Node rootNode = YAML::Load(file);
      AttributeValue rootValue = convertFromYamlNode(rootNode, "$");
      const AttributeMap &root = requireMap(rootValue, "$");
      SimConfig cfg(ImportTag{});
      cfg.hydrateFromRoot(root);
      return cfg;
    } catch (const YAML::Exception &e) {
      throw std::runtime_error("Failed to parse YAML file '" + filePath +
                               "': " + e.what());
    } catch (const std::exception &e) {
      throw std::runtime_error("Failed to import YAML file '" + filePath +
                               "': " + e.what());
    }
  }

  /**
   * @brief Set the simulation ID (used as the DB name and identifier).
   * @param simulationID Non-empty simulation identifier string.
   * @throws std::invalid_argument if simulationID is empty
   */
  void setSimulationID(const std::string &simulationID) {
    if (simulationID.empty()) {
      throw std::invalid_argument("Simulation ID must not be empty");
    }
    m_simID = simulationID;
  }

  /**
   * @brief Set DB connection parameters.
   *
   * All parameters have sensible defaults; calling this is optional.
   *
   * @param dbHost  Database host (default "localhost").
   * @param dbPort  Database port (default 9000).
   * @param dbAuthor Author tag stored with simulation results.
   * @param dbNotes  Free-form notes stored with simulation results.
   */
  void setDB(const std::string &dbHost = "clickhouse", int dbPort = 9000,
             const std::string &dbAuthor = defaultDbAuthor,
             const std::string &dbNotes = "") {
    m_dbHost = dbHost;
    m_dbPort = dbPort;
    m_dbAuthor = dbAuthor;
    m_dbNotes = dbNotes;
  }

  //=========================================================================
  // Global Simulation Settings (Modify Scenario)
  //=========================================================================

  /**
   * @brief Set number of simulation batches
   * @param batches Number of batches (must be > 0)
   * @throws std::invalid_argument if batches <= 0
   */
  void setNumBatches(int batches) {
    if (batches <= 0)
      throw std::invalid_argument("Batches must be positive");
    m_scenario.m_batches = batches;
  }

  void setTimeline(std::optional<double> duration,
                   std::optional<double> interval,
                   std::optional<int> slotsPerBatch,
                   std::optional<int> realizationsPerSlot) {
    if ((duration.has_value() || interval.has_value()) &&
        (slotsPerBatch.has_value() || realizationsPerSlot.has_value())) {
      throw std::logic_error(
          "Either set Duration/Interval or Slots/Realizations. "
          "Cannot provide both.");
    }

    if (!duration.has_value() && !interval.has_value() &&
        !slotsPerBatch.has_value() && !realizationsPerSlot.has_value()) {
      throw std::logic_error(
          "Either set Duration/Interval or Slots/Realizations. "
          "Cannot provide neither.");
    }

    if (m_mode == SimMode::RAN) {
      if (duration.has_value() || interval.has_value()) {
        throw std::logic_error(
            "RAN mode: use slots/realizations, not duration/interval");
      }
    }

    if (duration.has_value() || interval.has_value()) {
      m_scenario.m_simulationMode = 0;
      m_scenario.m_duration =
          duration.has_value() ? duration.value() : defaultDuration;
      m_scenario.m_interval =
          interval.has_value() ? interval.value() : defaultInterval;
      if (m_scenario.m_duration <= 0 || m_scenario.m_interval <= 0)
        throw std::invalid_argument("Duration and interval must be positive");
      m_scenario.m_slotsPerBatch = 0;
      m_scenario.m_symbolsPerSlot = 1;
    } else { // slots and symbols mode
      m_scenario.m_simulationMode = 1;
      m_scenario.m_slotsPerBatch = slotsPerBatch.has_value()
                                       ? slotsPerBatch.value()
                                       : defaultSlotsPerBatch;
      m_scenario.m_symbolsPerSlot = realizationsPerSlot.has_value()
                                        ? realizationsPerSlot.value()
                                        : defaultSymbolsPerSlot;
      if (m_scenario.m_slotsPerBatch <= 0)
        throw std::invalid_argument("Slots per batch must be positive");
      if (m_scenario.m_symbolsPerSlot != 1 && m_scenario.m_symbolsPerSlot != 14)
        throw std::logic_error("Symbols per slot must be 1 or 14");
      // set duration and interval to 0 for slots/symbols mode
      m_scenario.m_duration = 0.0;
      m_scenario.m_interval = 0.0;
    }
  }

  void setSeed(int seed = defaultSeed) {
    // If called, it will be seeded.
    m_scenario.m_seed = seed;
    m_scenario.m_isSeeded = true;
  }

  void addTableToDb(DBTable table) {
    m_DBTable.emplace(DBTableToString(table));
    if (table == DBTable::CFRS) {
      m_scenario.m_enableWideband = true;
    }
    if (table == DBTable::TELEMETRY && !m_scenario.m_isFullSim) {
      throw std::logic_error("Telemetry is only supported in RAN mode");
    }
  }

  /**
   * @brief Set an option for a specific opt-in table.
   *
   * Adds a key-value pair to the `opt_in_tables_options` map in the DB
   * section. The table name should match one of the opt-in tables added via
   * addTableToDb().
   *
   * @param tableName  Table name (e.g. "raypaths")
   * @param option     Option value (e.g. "full")
   * @throws std::invalid_argument if tableName is empty
   *
   * Example:
   * @code
   *   config.addTableToDb(DBTable::RAYPATHS);
   *   config.addTableOption("raypaths", "full");
   * @endcode
   */
  void addTableOption(const std::string &tableName, const std::string &option) {
    if (tableName.empty()) {
      throw std::invalid_argument("tableName must not be empty");
    }
    m_optInTablesOptions[tableName] = option;
  }

  /// Set the global S3 config (e.g. for GIS map storage)`.
  /// @param config S3 connection credentials.
  void setS3Config(const S3Config &s3config) {
    _validateS3Config(s3config);
    m_s3Config = s3config;
  }

  /// Re-enable Parquet export or override export settings.
  ///
  /// Parquet export is disabled by default. Calling this enables it and
  /// clears any existing S3 and Iceberg configs. The user must call
  /// addParquetS3Config() and setParquetIcebergConfig() explicitly.
  ///
  /// @param timestepsPerFile  Number of simulation timesteps written per
  ///                          Parquet file before flushing/uploading. Must be
  ///                          positive.
  /// @param compression       Parquet compression codec (e.g. "zstd", "snappy",
  ///                          "gzip", "lz4").
  /// @param maxWorkers        Maximum concurrent export workers per node.
  ///                          Must be positive.
  /// @param verifyExports     If true, verify row counts after each export.
  /// @throws std::invalid_argument if timestepsPerFile or maxWorkers <= 0.
  void enableParquetExport(int timestepsPerFile = 100,
                           const std::string &compression = "zstd",
                           int maxWorkers = 2, bool verifyExports = true) {
    if (timestepsPerFile <= 0) {
      throw std::invalid_argument("timestepsPerFile must be positive");
    }
    if (maxWorkers <= 0) {
      throw std::invalid_argument("maxWorkers must be positive");
    }
    m_parquetEnabled = true;
    m_parquetTimestepsPerFile = timestepsPerFile;
    m_parquetCompression = compression;
    m_parquetMaxWorkers = maxWorkers;
    m_parquetVerifyExports = verifyExports;

    // user is explicitly asking for control, so clear defaults/infra-loaded
    // configs; they'll provide their own via addParquetS3Config() /
    // setParquetIcebergConfig()
    m_parquetS3Configs.clear();
    m_parquetIceberg.reset();
  }

  /// Disable Parquet export. S3 and Iceberg configs loaded from infra config
  /// are retained so that re-enabling (via enableParquetExport) restores
  /// the previous settings.
  void disableParquetExport() { m_parquetEnabled = false; }

  /// Add an S3-compatible storage config for Parquet export.
  ///
  /// Multiple configs may be added (e.g. one per compute node). The export
  /// worker selects the first config whose @p nodes list contains its own
  /// node id.
  ///
  /// @param s3config S3 connection credentials.
  /// @param nodes    Node identifiers that should use this config.
  ///                 Defaults to {"node1"} for single-node deployments.
  /// @param useSSL   Whether to use HTTPS for the S3 connection.
  /// @throws std::invalid_argument if bucket is empty.
  void addParquetS3Config(const S3Config &s3config,
                          const std::vector<std::string> &nodes = {"node1"},
                          bool useSSL = false) {
    _validateS3Config(s3config);
    auto effectiveNodes =
        nodes.empty() ? std::vector<std::string>{"node1"} : nodes;
    m_parquetS3Configs.push_back(
        ParquetS3Config{s3config.endpointUrl, s3config.bucket, effectiveNodes,
                        s3config.accessKey, s3config.secretKey,
                        toLower(s3config.provider), s3config.region, useSSL});
  }

  /// Configure an Apache Iceberg catalog for registering exported Parquet
  /// files as Iceberg tables.
  ///
  /// @param catalogType Type of Iceberg catalog backend ("sql", "rest",
  ///                    "glue").
  /// @param catalogUri  Connection URI for the catalog (e.g. a Nessie REST
  ///                    endpoint or "sqlite:///iceberg_catalog.db").
  /// @param catalogName Logical catalog name used in table namespacing.
  /// @param awsRegion   AWS region (required for Glue catalog, ignored
  ///                    otherwise).
  /// @param nessieRef   Nessie branch reference (only used with Nessie-backed
  ///                    catalogs).
  void setParquetIcebergConfig(
      const std::string &catalogType = "rest",
      const std::string &catalogUri = "http://nessie:19120/iceberg",
      const std::string &catalogName = "default",
      const std::string &awsRegion = "",
      const std::string &nessieRef = "main") {
    if (catalogUri.empty() && catalogType != "glue") {
      throw std::invalid_argument(
          "catalog_uri is required for Iceberg catalog type '" + catalogType +
          "'");
    }

    if (catalogType == "rest" && !catalogUri.empty() &&
        catalogUri.rfind("http", 0) != 0) {
      throw std::invalid_argument(
          "Iceberg catalog_type is 'rest' but catalog_uri does not start "
          "with 'http://' or 'https://' (got '" +
          catalogUri + "')");
    }
    if (catalogType != "sql" && catalogType != "rest" &&
        catalogType != "glue") {
      throw std::invalid_argument("Unsupported Iceberg catalog_type '" +
                                  catalogType +
                                  "'. Supported types: sql, rest, glue");
    }

    m_parquetIceberg = ParquetIcebergConfig{catalogName, catalogUri,
                                            catalogType, awsRegion, nessieRef};
  }

  void
  setRayTracingModel(DiffusionModel diffuseType = defaultDiffuseType,
                     int interactions = defaultInteractions,
                     int maxNumPathsPerAntPair = defaultMaxNumPathsPerAntPair,
                     int emittedRaysInThousands = defaultEmittedRaysInThousands,
                     bool fastMode = false) {
    m_scenario.m_diffuseType = static_cast<int>(diffuseType);
    m_scenario.m_interactions = interactions;
    m_scenario.m_maxNumPathsPerAntPair = maxNumPathsPerAntPair;
    m_scenario.m_emittedRaysInThousands = emittedRaysInThousands;
    m_scenario.m_fastMode = fastMode;
  }

  //=========================================================================
  // Panel Management
  //=========================================================================

  /**
   * @brief Set the default RU panel (ID 2). Can only be called once.
   *
   * Takes @p panel by reference so the assigned ID (2) is written back
   * to the caller's object. This enables the "add-once" invariant:
   * after this call, panel.id() != 0, so passing the same object to
   * addPanel or setDefaultPanelUE will be rejected.
   *
   * @throws std::runtime_error if panel was already added or default
   *         RU panel was already set
   */
  void setDefaultPanelRU(Panel &panel) {
    if (panel.id() != 0) {
      throw std::runtime_error(
          "Panel already added to config. Each Panel object can only be "
          "registered once (via setDefaultPanelRU/UE or addPanel).");
    }
    if (m_panelContainer.contains(defaultPanelRU)) {
      throw std::runtime_error("setDefaultPanelRU() can only be called once.");
    }

    panel.assignId(defaultPanelRU);
    _validatePanelFrequency(panel);
    m_panelContainer.addPrim(panel);
  }

  /**
   * @brief Set the default UE panel (ID 1). Can only be called once.
   *
   * Takes @p panel by reference for the same reason as setDefaultPanelRU:
   * the assigned ID is written back to enforce the "add-once" invariant.
   *
   * @throws std::runtime_error if panel was already added or default
   *         UE panel was already set
   */
  void setDefaultPanelUE(Panel &panel) {
    if (panel.id() != 0) {
      throw std::runtime_error(
          "Panel already added to config. Each Panel object can only be "
          "registered once (via setDefaultPanelRU/UE or addPanel).");
    }
    if (m_panelContainer.contains(defaultPanelUE)) {
      throw std::runtime_error("setDefaultPanelUE() can only be called once.");
    }

    panel.assignId(defaultPanelUE);
    _validatePanelFrequency(panel);
    m_panelContainer.addPrim(panel);
  }

  /**
   * @brief Add an additional (non-default) panel. Auto-assigns an ID.
   *
   * Takes @p panel by reference so the auto-assigned ID is written back,
   * enforcing the "add-once" invariant (same pattern as setDefaultPanel*).
   *
   * @throws std::runtime_error if the panel was already added
   */
  void addPanel(Panel &panel) {
    if (panel.id() != 0) {
      throw std::runtime_error(
          "Panel already added to config. Each Panel object can only be "
          "registered once (via setDefaultPanelRU/UE or addPanel).");
    }
    panel.assignId(m_nextPanelId++);
    _validatePanelFrequency(panel);
    m_panelContainer.addPrim(panel);
  }

  //=========================================================================
  // DU Factory and Management
  //=========================================================================

  /**
   * @brief Add a DU to the configuration.
   *
   * Takes @p du by value (one-way transfer). The config owns the copy;
   * further changes to the caller's DU object have no effect. Use
   * getDU(id) for post-add mutation.
   */
  void addDU(DU du) {
    if (!m_panelContainer.contains(m_scenario.m_defaultPanelRU)) {
      throw std::runtime_error(
          "Default RU panel ID '" +
          std::to_string(m_scenario.m_defaultPanelRU) +
          "' not found. Add and set default RU panel first.");
    }
    auto &panel = m_panelContainer.find(m_scenario.m_defaultPanelRU);

    if (panel.isFileBased()) {
      if (du.m_numAntennas == defaultNumAntennasDU) {
        // File-based panel: cannot auto-derive antenna count.
        // User must have called du.set_num_antennas() explicitly.
      }
    } else {
      if (std::abs(du.frequency() - panel.frequency()) > 0.1) {
        throw std::runtime_error(
            "DU frequency doesn't match RU panel frequency");
      }
      du.setNumAntennas(panel.numAntennas());
    }
    m_duContainer.addPrim(std::move(du));
  }

  //=========================================================================
  // RU Factory and Management
  //=========================================================================

  /**
   * @brief Add an RU to the configuration.
   *
   * Takes @p ru by value (one-way transfer). The config owns the copy;
   * further changes to the caller's RU object have no effect. Use
   * getRU(id) for post-add mutation.
   */
  void addRU(RU ru) {
    if (ru.duId() <= 0) {
      throw std::runtime_error("RU DU ID must be positive");
    }
    if (ru.frequency() <= 0) {
      throw std::runtime_error("RU frequency must be positive");
    }

    if (ru.m_panelId == 0) {
      ru.m_panelId = m_scenario.m_defaultPanelRU;
    }

    if (!m_panelContainer.contains(ru.m_panelId)) {
      throw std::runtime_error("Panel ID '" + std::to_string(ru.m_panelId) +
                               "' not found. Add the panel first.");
    }
    if (!m_duContainer.contains(ru.duId())) {
      throw std::runtime_error("DU with ID " + std::to_string(ru.duId()) +
                               " not found. Add DU first.");
    }

    auto &panel = m_panelContainer.find(ru.m_panelId);
    auto &du = m_duContainer.find(ru.duId());

    if (!panel.isFileBased()) {
      if (std::abs(panel.frequency() - ru.frequency()) > 0.1) {
        throw std::runtime_error("RU frequency doesn't match panel frequency");
      }
      if (du.m_numAntennas != panel.numAntennas()) {
        throw std::logic_error(
            "RU " + std::to_string(ru.id()) + " is equipped with panel_" +
            std::to_string(panel.id()) + " which has " +
            std::to_string(panel.numAntennas()) + " antennas, but du_" +
            std::to_string(ru.duId()) + " has " +
            std::to_string(du.m_numAntennas) + " antennas");
      }
    }

    m_ruContainer.addPrim(std::move(ru));
  }

  //=========================================================================
  // UE Factory and Management
  //=========================================================================

  /**
   * @brief Add a UE to the configuration.
   *
   * Takes @p ue by value (one-way transfer). The config owns the copy;
   * further changes to the caller's UE object have no effect. Use
   * getUE(id) for post-add mutation.
   */
  void addUE(UE ue) {
    if (ue.waypoints().empty() && !ue.hasGPX()) {
      throw std::runtime_error(
          "UE must have at least one waypoint or a GPX source before adding");
    }

    if (ue.m_panelId == 0) {
      ue.m_panelId = m_scenario.m_defaultPanelUE;
    }

    if (!m_panelContainer.contains(ue.m_panelId)) {
      throw std::runtime_error("Panel ID '" + std::to_string(ue.m_panelId) +
                               "' not found. Add the panel first.");
    }

    m_ueContainer.addPrim(std::move(ue));
  }

  void clearWaypoints(int ueId) {
    if (!m_ueContainer.contains(ueId)) {
      throw std::runtime_error("UE with ID " + std::to_string(ueId) +
                               " not found");
    }
    m_ueContainer.find(ueId).clearWaypoints();
  }

  void removeUE(int ueId) { m_ueContainer.erase(ueId); }

  //=========================================================================
  // Prim Accessors (mutable access for post-add customization)
  //=========================================================================

  UE &getUE(int ueId) {
    if (!m_ueContainer.contains(ueId)) {
      throw std::runtime_error("UE with ID " + std::to_string(ueId) +
                               " not found");
    }
    return m_ueContainer.find(ueId);
  }

  RU &getRU(int ruId) {
    if (!m_ruContainer.contains(ruId)) {
      throw std::runtime_error("RU with ID " + std::to_string(ruId) +
                               " not found");
    }
    return m_ruContainer.find(ruId);
  }

  DU &getDU(int duId) {
    if (!m_duContainer.contains(duId)) {
      throw std::runtime_error("DU with ID " + std::to_string(duId) +
                               " not found");
    }
    return m_duContainer.find(duId);
  }

  Panel &getPanel(int panelId) {
    if (!m_panelContainer.contains(panelId)) {
      throw std::runtime_error("Panel with ID " + std::to_string(panelId) +
                               " not found");
    }
    return m_panelContainer.find(panelId);
  }

  //=========================================================================
  // Default panel id accessors (facade over Scenario)
  //=========================================================================

  /**
   * @brief Returns the id used as the default RU panel
   *        (`sim_gnb_panel_type` in the YAML).
   *
   * Convenience facade over Scenario::getDefaultRUPanelId(). Useful when
   * mutating a config loaded via fromYAMLFile, e.g.:
   *
   *     auto &p = config.getPanel(config.getDefaultRUPanelId());
   *     p.setAntennaElements({AntennaElement::Isotropic});
   *
   * @see Scenario::getDefaultRUPanelId for caveats on default
   *      initialization.
   */
  [[nodiscard]] int getDefaultRUPanelId() const {
    int panelId = m_scenario.getDefaultRUPanelId();
    if (!m_panelContainer.contains(panelId)) {
      throw std::runtime_error("Default RU panel ID '" +
                               std::to_string(panelId) +
                               "' not found. Add the panel first.");
    }
    return panelId;
  }

  /**
   * @brief Returns the id used as the default UE panel
   *        (`sim_ue_panel_type` in the YAML).
   */
  [[nodiscard]] int getDefaultUEPanelId() const {
    int panelId = m_scenario.getDefaultUEPanelId();
    if (!m_panelContainer.contains(panelId)) {
      throw std::runtime_error("Default UE panel ID '" +
                               std::to_string(panelId) +
                               "' not found. Add the panel first.");
    }
    return panelId;
  }

  /**
   * @brief Returns the IDs of every added prim of the given type, in
   *        unspecified order.
   *
   * Compile-time dispatch over @p Prim. Supported types are `RU`, `UE`,
   * `DU`, and `Panel`; instantiating with any other type triggers a
   * `static_assert`. The order of returned ids reflects the underlying
   * unordered_map and must be treated as unspecified.
   *
   * @tparam Prim One of `RU`, `UE`, `DU`, `Panel`.
   * @return Vector of ids of all currently added prims of that type.
   */
  template <typename Prim> std::vector<int> getPrimIds() const {
    auto collectIds = [](const auto &container) {
      std::vector<int> ids;
      ids.reserve(container.prims().size());
      for (const auto &[id, prim] : container.prims()) {
        ids.push_back(prim.id());
      }
      return ids;
    };

    if constexpr (std::is_same_v<Prim, RU>) {
      return collectIds(m_ruContainer);
    } else if constexpr (std::is_same_v<Prim, UE>) {
      return collectIds(m_ueContainer);
    } else if constexpr (std::is_same_v<Prim, DU>) {
      return collectIds(m_duContainer);
    } else if constexpr (std::is_same_v<Prim, Panel>) {
      return collectIds(m_panelContainer);
    } else {
      static_assert(sizeof(Prim *) == 0, "getPrimIds: unsupported Prim type");
    }
  }

  //=========================================================================
  // GPX UE Creation
  //=========================================================================

  void addUEsFromGPX(const std::string &gpxSrc, const std::vector<int> &ueIds,
                     bool usePathfinding = true) {
    if (gpxSrc.empty()) {
      throw std::invalid_argument("GPX source path must not be empty");
    }
    if (ueIds.empty()) {
      throw std::invalid_argument("UE ID list must not be empty");
    }

    // Check for duplicate IDs within the provided list
    std::unordered_set<int> idSet(ueIds.begin(), ueIds.end());
    if (idSet.size() != ueIds.size()) {
      throw std::invalid_argument("Duplicate UE IDs in addUEsFromGPX");
    }

    for (int ueId : ueIds) {
      if (m_ueContainer.contains(ueId)) {
        throw std::runtime_error("UE with ID " + std::to_string(ueId) +
                                 " already exists");
      }
    }

    GPXSource gpx;
    gpx.src = gpxSrc;
    gpx.usePathfinding = usePathfinding;

    for (int ueId : ueIds) {
      UE ue(ueId);
      ue.setGPXSource(gpx);

      if (ue.m_panelId == 0) {
        ue.m_panelId = m_scenario.m_defaultPanelUE;
      }

      if (!m_panelContainer.contains(ue.m_panelId)) {
        throw std::runtime_error("Panel ID '" + std::to_string(ue.m_panelId) +
                                 "' not found. Add the panel first.");
      }

      m_ueContainer.addPrim(std::move(ue));
    }
  }

  /**
   * @brief Set UE height in meters for selected UEs.
   *
   * @param heightM UE height in meters (must be >= 0).
   * @param ids UE IDs to update. Empty means wildcard ("*").
   */
  void setUEsHeight(double heightM, const std::vector<int> &ids = {}) {
    if (heightM < 0.0) {
      throw std::invalid_argument("UE height cannot be negative");
    }
    AttributeMap attrs;
    attrs["height_m"] = AttributeValue{heightM};
    setAttributes<UE>("UEs", ids, attrs);
  }

  /**
   * @brief Set UE radiated power in dBm for selected UEs.
   *
   * @param radiatedPowerDbm UE radiated power in dBm (must be >= 0).
   * @param ids UE IDs to update. Empty means wildcard ("*").
   */
  void setUEsPower(double radiatedPowerDbm, const std::vector<int> &ids = {}) {
    if (radiatedPowerDbm < 0.0) {
      throw std::invalid_argument("UE radiated power cannot be negative");
    }
    AttributeMap attrs;
    attrs["aerial_ue_radiated_power"] = AttributeValue{radiatedPowerDbm};
    setAttributes<UE>("UEs", ids, attrs);
  }

  /**
   * @brief Set RU radiated power in dBm for selected RUs.
   *
   * @param radiatedPowerDbm RU radiated power in dBm (must be >= 0).
   * @param ids RU IDs to update. Empty means wildcard ("*").
   */
  void setRUsPower(double radiatedPowerDbm, const std::vector<int> &ids = {}) {
    if (radiatedPowerDbm < 0.0) {
      throw std::invalid_argument("RU radiated power cannot be negative");
    }
    AttributeMap attrs;
    attrs["aerial_gnb_radiated_power"] = AttributeValue{radiatedPowerDbm};
    setAttributes<RU>("RUs", ids, attrs);
  }

  //=========================================================================
  // Spawn Zone and Procedural UEs
  //=========================================================================

  /**
   * @brief Set spawn zone for procedural UEs as a CCW polygon.
   * @param pointsCCW Counter-clockwise polygon vertices (georeferenced).
   */
  void addSpawnZone(const std::vector<Position> &pointsCCW) {
    for (const auto &p : pointsCCW) {
      if (p.dim() != 2) {
        throw std::invalid_argument(
            "addSpawnZone points must be 2D (use Position::georef(lat, lon) "
            "or Position::cartesian(x, y) without alt/z)");
      }
    }
    m_spawnZone = SpawnZone(pointsCCW);
  }

  /**
   * @brief Set the bounding box window as a list of positions.
   *
   * The bbox_window is emitted under the 'gis' section and typically
   * consists of two georeferenced positions defining opposite corners.
   *
   * @param bboxWindow List of positions defining the bounding box.
   */
  void setBboxWindow(const std::vector<Position> &bboxWindow) {
    for (const auto &p : bboxWindow) {
      if (p.dim() != 2) {
        throw std::invalid_argument(
            "setBboxWindow points must be 2D (use Position::georef(lat, lon) "
            "or Position::cartesian(x, y) without alt/z)");
      }
    }
    m_bboxWindow = bboxWindow;
  }

  /**
   * @brief Set the speed range for procedural UEs.
   * @param minSpeed Minimum UE speed in m/s (must be >= 0).
   * @param maxSpeed Maximum UE speed in m/s (must be >= minSpeed).
   */
  void setUESpeed(double minSpeed, double maxSpeed) {
    if (minSpeed < 0)
      throw std::invalid_argument("UE min speed cannot be negative");
    if (maxSpeed < minSpeed)
      throw std::invalid_argument("UE max speed must be >= min speed");
    m_scenario.m_ueMinSpeed = minSpeed;
    m_scenario.m_ueMaxSpeed = maxSpeed;
  }

  void setNumProceduralUEs(int num) {
    if (num < 0)
      throw std::invalid_argument("Num procedural UEs cannot be negative");
    m_scenario.m_numProceduralUEs = num;
  }

  void setPercIndoorProceduralUEs(double perc) {
    if (perc < 0.0 || perc > 100.0)
      throw std::invalid_argument("Percentage must be in [0, 100]");
    m_scenario.m_percIndoorProceduralUEs = perc;
  }

  void setBldgRfAttr(bool isBldgExterior, bool activateRF,
                     bool activateDiffraction, bool activateDiffusion,
                     bool activateTransmission,
                     std::optional<double> diffuseSurfaceElementArea,
                     std::vector<std::string> &&BldgIds = {}) {
    AttributeMap attrs;
    attrs["AerialRFMesh"] = AttributeValue{activateRF};
    attrs["AerialRFDiffraction"] = AttributeValue{activateDiffraction};
    if (isBldgExterior) { // no indoor diffusion
      attrs["AerialRFDiffuse"] = AttributeValue{activateDiffusion};
      if (diffuseSurfaceElementArea.has_value()) {
        attrs["AerialRFdS"] = AttributeValue{*diffuseSurfaceElementArea};
      }
    }
    attrs["AerialRFTransmission"] = AttributeValue{activateTransmission};

    if (BldgIds.empty()) {
      BldgIds = std::vector<std::string>(1, "*");
    }
    if (isBldgExterior) {
      m_bldgExteriorContainer.addAttributeUpdateGroup(BldgIds, attrs);
    } else {
      m_bldgInteriorContainer.addAttributeUpdateGroup(BldgIds, attrs);
    }
  }

  void setBldgExteriorAttr(
      bool activateRF, bool activateDiffraction, bool activateDiffusion,
      bool activateTransmission,
      std::optional<double> diffuseSurfaceElementArea = std::nullopt,
      std::vector<std::string> BldgIds = {}) {
    setBldgRfAttr(true, activateRF, activateDiffraction, activateDiffusion,
                  activateTransmission, diffuseSurfaceElementArea,
                  std::move(BldgIds));
  }

  void setBldgInteriorAttr(bool activateRF, bool activateDiffraction,
                           bool activateTransmission,
                           std::vector<std::string> BldgIds = {}) {
    setBldgRfAttr(false, activateRF, activateDiffraction, false,
                  activateTransmission, std::nullopt, std::move(BldgIds));
  }

  //=========================================================================
  // Urban Mobility
  //=========================================================================

  /**
   * @brief Enable urban mobility simulation with vehicles
   * @param vehicles Number of vehicles (must be >= 0)
   * @param enableDynamicScattering Enable dynamic scattering (default true)
   * @throws std::invalid_argument if vehicles < 0
   */
  void enableUrbanMobility(int vehicles) {
    if (vehicles < 0)
      throw std::invalid_argument("Vehicles cannot be negative");
    m_scenario.m_numVehicles = vehicles;
    m_scenario.m_enableUrbanMobility = (vehicles > 0);
    m_scenario.m_enableDynamicScattering = (vehicles > 0);
    if (m_scenario.m_simulationMode == 0) {
      m_scenario.m_interval =
          0.1; // 0.1 sec in EM mode if urban mobility is enabled
    }
  }

  void enableWideband() { m_scenario.m_enableWideband = true; }

  /**
   * @brief Enable vegetation rendering from GeoJSON data.
   *
   * If a @p geojsonPath is provided, it is used as-is.
   *
   * If @p geojsonPath is empty, a default path is derived from @c m_sceneUrl:
   * "<scene_url>/sim/vegetation.geojson".
   *
   * Enabled vegetation also emits the configured
   * @c m_vegetationAssetPaths.vegetationAssetPath from assets.yml as
   * @c gis.vegetation.vegetation_asset_path.
   */
  void enableVegetation(const std::string &geojsonPath = "") {
    m_enableVegetation = true;

    if (!geojsonPath.empty()) {
      m_vegetationAssetPaths.geojson = geojsonPath;
      return;
    }

    // No explicit path: derive from scene URL if possible
    const auto derived = deriveVegetationGeojsonFromScene();
    if (!derived.has_value()) {
      throw std::runtime_error(
          "Failed to derive vegetation GeoJSON path from scene URL: " +
          m_sceneUrl + ". Expected format: <dir>/<map_name>.usd");
    }
    m_vegetationAssetPaths.geojson = derived.value();
  }

  //=========================================================================
  // Material Calibration
  //=========================================================================

  /**
   * @brief Add a material calibration definition file.
   * @param file  Path to the definition JSON file.
   * @param target  BLDG for sim.Materials, VEG for sim.VegetationMaterials.
   */
  void addMaterialDefinition(const std::string &file, GeoTargets target) {
    switch (target) {
    case GeoTargets::BLDG:
      m_materialContainer.addCalibrationDefinition(file);
      break;
    case GeoTargets::VEG:
      m_vegMaterialContainer.addCalibrationDefinition(file);
      break;
    }
  }

  /**
   * @brief Add a material calibration assignment file.
   * @param file  Path to the assignment JSON file.
   * @param target  BLDG for sim.Materials, VEG for sim.VegetationMaterials.
   */
  void addMaterialAssignment(const std::string &file, GeoTargets target) {
    switch (target) {
    case GeoTargets::BLDG:
      m_materialContainer.addCalibrationAssignment(file);
      break;
    case GeoTargets::VEG:
      m_vegMaterialContainer.addCalibrationAssignment(file);
      break;
    }
  }

  //=========================================================================
  // Calibration Run Configuration (top-level cal section)
  //=========================================================================

  void setCalibrationTargets(bool materials, bool vegMaterials, bool rus,
                             bool rusBeams, bool ues) {
    CalibrationConfig &cal = ensureCalibrationConfig();
    cal.targets.materials = materials;
    cal.targets.vegMaterials = vegMaterials;
    cal.targets.rus = rus;
    cal.targets.rusBeams = rusBeams;
    cal.targets.ues = ues;
  }

  void addCalibrationMeasurement(int ruId, int ueId,
                                 const std::string &measurementFile) {
    if (measurementFile.empty()) {
      throw std::invalid_argument("measurementFile must not be empty");
    }
    CalibrationConfig &cal = requireCalibrationConfig();
    cal.measurements.push_back(
        CalibrationMeasurement{ruId, ueId, measurementFile});
  }

  void setCalibrationTimeline(int start = 0, int step = 1,
                              std::optional<int> end = std::nullopt) {
    if (step <= 0) {
      throw std::invalid_argument("Calibration timeline step must be positive");
    }
    CalibrationConfig &cal = requireCalibrationConfig();
    cal.timeline.start = start;
    cal.timeline.step = step;
    cal.timeline.end = end;
  }

  void setCalibrationOutput(const std::string &folderKey) {
    if (folderKey.empty()) {
      throw std::invalid_argument(
          "Calibration output folder_key must not be empty");
    }
    CalibrationConfig &cal = requireCalibrationConfig();
    cal.outputFolderKey = folderKey;
  }

  void setCalibrationExecutionMode(const std::string &executionMode) {
    CalibrationConfig &cal = requireCalibrationConfig();
    cal.executionMode = executionMode;
  }

  void setCalibrationKeepLocalOutput(bool keepLocalOutput) {
    CalibrationConfig &cal = requireCalibrationConfig();
    cal.keepLocalOutput = keepLocalOutput;
  }

  //=========================================================================
  // Advanced API: setAttributes (for 10% users)
  //=========================================================================

  template <typename T_Prim>
  void setAttributes(const std::string &primType,
                     const std::vector<typename T_Prim::id_type> &ids,
                     const AttributeMap &attrs) {
    using T_id = typename T_Prim::id_type;

    // Validate ID type at compile-time based on prim family:
    //   int-id sections:    Panels, DUs, RUs, UEs
    //   string-id sections: Materials, VegetationMaterials,
    //                       BldgExterior, BldgInterior
    if constexpr (std::is_same_v<T_id, int>) {
      // Int-id sections only
      if (primType == "Scenario") {
        m_scenario.addAttributeUpdateGroup(attrs);
      } else if (primType == "Panels") {
        m_panelContainer.addAttributeUpdateGroup(ids, attrs);
      } else if (primType == "DUs") {
        m_duContainer.addAttributeUpdateGroup(ids, attrs);
      } else if (primType == "RUs") {
        m_ruContainer.addAttributeUpdateGroup(ids, attrs);
      } else if (primType == "UEs") {
        m_ueContainer.addAttributeUpdateGroup(ids, attrs);
      } else {
        throw std::invalid_argument("prim type '" + primType +
                                    "' requires string IDs, not int IDs");
      }
    } else if constexpr (std::is_same_v<T_id, std::string>) {
      // String-id sections only
      if (primType == "Materials") {
        m_materialContainer.addAttributeUpdateGroup(ids, attrs);
      } else if (primType == "VegetationMaterials") {
        m_vegMaterialContainer.addAttributeUpdateGroup(ids, attrs);
      } else if (primType == "BldgExterior") {
        m_bldgExteriorContainer.addAttributeUpdateGroup(ids, attrs);
      } else if (primType == "BldgInterior") {
        m_bldgInteriorContainer.addAttributeUpdateGroup(ids, attrs);
      } else {
        throw std::invalid_argument("prim type '" + primType +
                                    "' requires int IDs, not string IDs");
      }
    } else {
      throw std::invalid_argument("Unknown prim type: " + primType);
    }
  }

  //=========================================================================
  // Output
  //=========================================================================

  /**
   * @brief Generate YAML and save to file
   * @param filepath Output file path
   * @throws std::runtime_error if file can't be opened
   */
  void toYaml(const std::string &filepath) const {
    std::ofstream file(filepath);
    if (!file.is_open()) {
      throw std::runtime_error("Failed to open file: " + filepath);
    }
    file << toYamlString();
  }

  /**
   * @brief Generate YAML configuration as string
   * @return YAML string representation of the configuration
   */
  std::string toYamlString() const {
    AttributeMap root = toNeutralTree();
    return emitYAML(root);
  }

  /**
   * @brief Get neutral tree representation (for Python bindings)
   *
   * Returns the configuration as a neutral AttributeMap tree that can be
   * converted to Python dict for use with OmegaConf.
   *
   * @return Neutral tree representation (no YAML types)
   */
  [[nodiscard]] AttributeMap toNeutralTreePublic() const {
    return toNeutralTree();
  }

private:
  struct ImportTag {};
  explicit SimConfig(ImportTag) : m_mode(SimMode::EM) {}

  // === YAML import helpers ===

  // --- Neutral conversion: YAML::Node → AttributeValue ---

  static AttributeValue convertFromYamlNode(const YAML::Node &node,
                                            const std::string &path) {
    switch (node.Type()) {
    case YAML::NodeType::Null:
      return AttributeValue{};

    case YAML::NodeType::Map: {
      AttributeMap m;
      for (auto it = node.begin(); it != node.end(); ++it) {
        std::string key = it->first.as<std::string>();
        m[key] = convertFromYamlNode(it->second, path + "." + key);
      }
      return AttributeValue{std::move(m)};
    }

    case YAML::NodeType::Sequence: {
      AttributeList lst;
      std::size_t idx = 0;
      for (auto it = node.begin(); it != node.end(); ++it, ++idx) {
        lst.push_back(
            convertFromYamlNode(*it, path + "[" + std::to_string(idx) + "]"));
      }
      return AttributeValue{std::move(lst)};
    }

    case YAML::NodeType::Scalar: {
      // Pitfall #5: only type-parse when tag is "?" (non-specific / plain
      // unquoted). Quoted scalars get tag "!", explicit !!str etc. stay string.
      const std::string &raw = node.Scalar();
      if (node.Tag() != "?") {
        // Non-plain scalar (quoted) or explicit tag → always string
        return AttributeValue{raw};
      }
      // Plain scalar — try bool, int64, double, else string
      if (raw == "true" || raw == "True" || raw == "TRUE") {
        return AttributeValue{true};
      }
      if (raw == "false" || raw == "False" || raw == "FALSE") {
        return AttributeValue{false};
      }
      // Integer attempt (full-consumption via from_chars)
      {
        const char *beg = raw.data();
        const char *end = beg + raw.size();
        std::int64_t iv{};
        auto [p, ec] = std::from_chars(beg, end, iv);
        if (ec == std::errc{} && p == end) {
          return AttributeValue{iv};
        }
      }
      // Double attempt (full-consumption via from_chars)
      {
        const char *beg = raw.data();
        const char *end = beg + raw.size();
        double dv{};
        auto [p, ec] = std::from_chars(beg, end, dv);
        if (ec == std::errc{} && p == end) {
          return AttributeValue{dv};
        }
      }
      return AttributeValue{raw};
    }

    default:
      throw std::runtime_error("Unsupported YAML node type at " + path);
    }
  }

  // --- Extraction helpers ---

  static bool hasKey(const AttributeMap &m, const std::string &key) {
    return m.find(key) != m.end();
  }

  static const AttributeValue &requireKey(const AttributeMap &m,
                                          const std::string &key,
                                          const std::string &path) {
    auto it = m.find(key);
    if (it == m.end()) {
      throw std::runtime_error("Missing required key '" + key + "' at " + path);
    }
    return it->second;
  }

  static const AttributeMap &requireMap(const AttributeValue &v,
                                        const std::string &path) {
    const AttributeMap *mp = std::get_if<AttributeMap>(&v.value);
    if (!mp) {
      throw std::runtime_error("Expected map at " + path + ": got wrong type");
    }
    return *mp;
  }

  static const AttributeList &requireList(const AttributeValue &v,
                                          const std::string &path) {
    const AttributeList *lp = std::get_if<AttributeList>(&v.value);
    if (!lp) {
      throw std::runtime_error("Expected list at " + path + ": got wrong type");
    }
    return *lp;
  }

  static std::string requireString(const AttributeValue &v,
                                   const std::string &path) {
    const std::string *sp = std::get_if<std::string>(&v.value);
    if (!sp) {
      throw std::runtime_error("Expected string at " + path);
    }
    return *sp;
  }

  static bool requireBool(const AttributeValue &v, const std::string &path) {
    const bool *bp = std::get_if<bool>(&v.value);
    if (!bp) {
      throw std::runtime_error("Expected bool at " + path);
    }
    return *bp;
  }

  static std::int64_t requireInt64(const AttributeValue &v,
                                   const std::string &path) {
    const std::int64_t *ip = std::get_if<std::int64_t>(&v.value);
    if (!ip) {
      throw std::runtime_error("Expected int64 at " + path);
    }
    return *ip;
  }

  static int requireInt(const AttributeValue &v, const std::string &path) {
    std::int64_t iv = requireInt64(v, path);
    if (iv < static_cast<std::int64_t>(std::numeric_limits<int>::min()) ||
        iv > static_cast<std::int64_t>(std::numeric_limits<int>::max())) {
      throw std::runtime_error(
          "Integer overflow at " + path + ": value " + std::to_string(iv) +
          " is outside [" + std::to_string(std::numeric_limits<int>::min()) +
          ", " + std::to_string(std::numeric_limits<int>::max()) + "]");
    }
    return static_cast<int>(iv);
  }

  static double requireDouble(const AttributeValue &v,
                              const std::string &path) {
    // Pitfall #6: accept both double and int64 (unquoted 3600 parses as int64)
    if (const double *dp = std::get_if<double>(&v.value)) {
      return *dp;
    }
    if (const std::int64_t *ip = std::get_if<std::int64_t>(&v.value)) {
      return static_cast<double>(*ip);
    }
    throw std::runtime_error("Expected double (or int) at " + path);
  }

  static std::optional<const AttributeMap *>
  optionalMap(const AttributeMap &m, const std::string &key,
              const std::string &path) {
    // path is the parent map's path; the value's path is path + "." + key.
    if (!hasKey(m, key)) {
      return std::nullopt;
    }
    return &requireMap(requireKey(m, key, path), path + "." + key);
  }

  static std::optional<const AttributeList *>
  optionalList(const AttributeMap &m, const std::string &key,
               const std::string &path) {
    // path is the parent map's path; the value's path is path + "." + key.
    if (!hasKey(m, key)) {
      return std::nullopt;
    }
    return &requireList(requireKey(m, key, path), path + "." + key);
  }

  static S3Config parseS3Config(const AttributeMap &m,
                                const std::string &path) {
    S3Config s3;
    s3.bucket = requireString(requireKey(m, "bucket", path), path + ".bucket");
    s3.provider =
        requireString(requireKey(m, "provider", path), path + ".provider");
    if (hasKey(m, "region")) {
      s3.region =
          requireString(requireKey(m, "region", path), path + ".region");
    }
    if (hasKey(m, "endpoint_url")) {
      s3.endpointUrl = requireString(requireKey(m, "endpoint_url", path),
                                     path + ".endpoint_url");
    }
    if (hasKey(m, "access_key")) {
      s3.accessKey = requireString(requireKey(m, "access_key", path),
                                   path + ".access_key");
    }
    if (hasKey(m, "secret_key")) {
      s3.secretKey = requireString(requireKey(m, "secret_key", path),
                                   path + ".secret_key");
    }
    return s3;
  }

  static std::vector<std::string> parseStringList(const AttributeValue &v,
                                                  const std::string &path) {
    const AttributeList &lst = requireList(v, path);
    std::vector<std::string> result;
    result.reserve(lst.size());
    for (std::size_t i = 0; i < lst.size(); ++i) {
      result.push_back(
          requireString(lst[i], path + "[" + std::to_string(i) + "]"));
    }
    return result;
  }

  static Position parsePosition(const AttributeMap &m,
                                const std::string &path) {
    Position p;
    // Detect family by presence of georef or cartesian keys.
    const bool hasLat = hasKey(m, "lat");
    const bool hasLon = hasKey(m, "lon");
    const bool hasAlt = hasKey(m, "alt");
    const bool hasX = hasKey(m, "x");
    const bool hasY = hasKey(m, "y");
    const bool hasZ = hasKey(m, "z");
    // Reject mixed-family input before branching: otherwise the family branch
    // below would silently ignore keys from the other family.
    if ((hasLat || hasLon || hasAlt) && (hasX || hasY || hasZ)) {
      throw std::runtime_error(
          "Position at " + path +
          " mixes georef (lat/lon/alt) and cartesian (x/y/z) keys");
    }
    if (hasLat || hasLon || hasAlt) {
      // Georef family: lat and lon are required.
      if (!hasLat) {
        throw std::runtime_error("Missing required key 'lat' at " + path);
      }
      if (!hasLon) {
        throw std::runtime_error("Missing required key 'lon' at " + path);
      }
      p.lat = requireDouble(requireKey(m, "lat", path), path + ".lat");
      p.lon = requireDouble(requireKey(m, "lon", path), path + ".lon");
      if (hasAlt) {
        p.alt = requireDouble(requireKey(m, "alt", path), path + ".alt");
      }
    } else if (hasX || hasY || hasZ) {
      // Cartesian family: x and y are required.
      if (!hasX) {
        throw std::runtime_error("Missing required key 'x' at " + path);
      }
      if (!hasY) {
        throw std::runtime_error("Missing required key 'y' at " + path);
      }
      p.x = requireDouble(requireKey(m, "x", path), path + ".x");
      p.y = requireDouble(requireKey(m, "y", path), path + ".y");
      if (hasZ) {
        p.z = requireDouble(requireKey(m, "z", path), path + ".z");
      }
    } else {
      throw std::runtime_error("Position at " + path +
                               " has no recognised coordinate keys "
                               "(lat/lon or x/y)");
    }
    // Mixed-family input is rejected above. (void)p.dim() here is a
    // belt-and-suspenders consistency check on the constructed Position.
    (void)p.dim();
    return p;
  }

  static std::vector<Position> parsePositionList(const AttributeList &lst,
                                                 const std::string &path) {
    std::vector<Position> result;
    result.reserve(lst.size());
    for (std::size_t i = 0; i < lst.size(); ++i) {
      const std::string ipath = path + "[" + std::to_string(i) + "]";
      const AttributeMap &m = requireMap(lst[i], ipath);
      result.push_back(parsePosition(m, ipath));
    }
    return result;
  }

  // --- Root hydrator ---

  void hydrateFromRoot(const AttributeMap &root) {
    for (const char *key : {"db", "sim", "gis"}) {
      if (!hasKey(root, key)) {
        throw std::runtime_error(
            std::string("Missing required top-level section '") + key +
            "' at $");
      }
    }
    // Keys verified above; requireKey calls below cannot throw for missing
    // keys.
    const auto &db = requireMap(requireKey(root, "db", "$"), "$.db");
    const auto &sim = requireMap(requireKey(root, "sim", "$"), "$.sim");
    const auto &gis = requireMap(requireKey(root, "gis", "$"), "$.gis");

    hydrateDB(db);
    hydrateGIS(gis);
    hydrateSim(sim);
  }

  void hydrateDB(const AttributeMap &db) {
    // --- Clear collection defaults that may have been set by
    // default-member-initializers ---
    m_DBTable.clear();
    m_optInTablesOptions.clear();
    m_parquetEnabled = false;
    m_parquetS3Configs.clear();
    m_parquetIceberg.reset();
    m_s3Config.reset();

    // --- Required fields ---
    m_simID = requireString(requireKey(db, "sim_id", "$.db"), "$.db.sim_id");

    const auto &s3m =
        requireMap(requireKey(db, "s3_config", "$.db"), "$.db.s3_config");
    m_s3Config = parseS3Config(s3m, "$.db.s3_config");

    // --- Optional scalar fields ---
    if (hasKey(db, "db_host")) {
      m_dbHost =
          requireString(requireKey(db, "db_host", "$.db"), "$.db.db_host");
    }
    if (hasKey(db, "db_port")) {
      m_dbPort = requireInt(requireKey(db, "db_port", "$.db"), "$.db.db_port");
    }
    if (hasKey(db, "db_author")) {
      m_dbAuthor =
          requireString(requireKey(db, "db_author", "$.db"), "$.db.db_author");
    }
    if (hasKey(db, "db_notes")) {
      m_dbNotes =
          requireString(requireKey(db, "db_notes", "$.db"), "$.db.db_notes");
    }

    // --- Optional collection fields ---
    if (hasKey(db, "opt_in_tables")) {
      const auto entries = parseStringList(
          requireKey(db, "opt_in_tables", "$.db"), "$.db.opt_in_tables");
      for (const auto &entry : entries) {
        m_DBTable.insert(entry);
      }
    }
    if (auto optMap = optionalMap(db, "opt_in_tables_options", "$.db")) {
      const AttributeMap &optionsMap = **optMap;
      for (const auto &[key, val] : optionsMap) {
        m_optInTablesOptions[key] =
            requireString(val, "$.db.opt_in_tables_options." + key);
      }
    }

    // --- Parquet export (CRITICAL: set m_parquetEnabled = true last) ---
    if (auto parquetMapOpt = optionalMap(db, "parquet_export", "$.db")) {
      const AttributeMap &parq = **parquetMapOpt;
      const std::string ppath = "$.db.parquet_export";

      if (hasKey(parq, "max_workers")) {
        m_parquetMaxWorkers = requireInt(requireKey(parq, "max_workers", ppath),
                                         ppath + ".max_workers");
      }
      if (hasKey(parq, "compression")) {
        m_parquetCompression = requireString(
            requireKey(parq, "compression", ppath), ppath + ".compression");
      }
      if (hasKey(parq, "timesteps_per_file")) {
        m_parquetTimestepsPerFile =
            requireInt(requireKey(parq, "timesteps_per_file", ppath),
                       ppath + ".timesteps_per_file");
      }
      if (hasKey(parq, "verify_exports")) {
        m_parquetVerifyExports =
            requireBool(requireKey(parq, "verify_exports", ppath),
                        ppath + ".verify_exports");
      }

      if (!hasKey(parq, "s3_configs")) {
        throw std::runtime_error(
            ppath + ".s3_configs is required when parquet_export is present");
      }
      const AttributeList &s3list = requireList(
          requireKey(parq, "s3_configs", ppath), ppath + ".s3_configs");
      if (s3list.empty()) {
        throw std::runtime_error(ppath + ".s3_configs must not be empty");
      }
      for (std::size_t i = 0; i < s3list.size(); ++i) {
        const std::string spath =
            ppath + ".s3_configs[" + std::to_string(i) + "]";
        const AttributeMap &sm = requireMap(s3list[i], spath);
        ParquetS3Config ps3;
        if (hasKey(sm, "endpoint_url")) {
          ps3.endpointUrl = requireString(requireKey(sm, "endpoint_url", spath),
                                          spath + ".endpoint_url");
        }
        ps3.bucket =
            requireString(requireKey(sm, "bucket", spath), spath + ".bucket");
        ps3.nodes = hasKey(sm, "nodes")
                        ? parseStringList(requireKey(sm, "nodes", spath),
                                          spath + ".nodes")
                        : std::vector<std::string>{"node1"};
        if (hasKey(sm, "access_key")) {
          ps3.accessKey = requireString(requireKey(sm, "access_key", spath),
                                        spath + ".access_key");
        }
        if (hasKey(sm, "secret_key")) {
          ps3.secretKey = requireString(requireKey(sm, "secret_key", spath),
                                        spath + ".secret_key");
        }
        ps3.provider = requireString(requireKey(sm, "provider", spath),
                                     spath + ".provider");
        ps3.region = hasKey(sm, "region")
                         ? requireString(requireKey(sm, "region", spath),
                                         spath + ".region")
                         : S3Config{}.region;
        ps3.useSSL = hasKey(sm, "use_ssl")
                         ? requireBool(requireKey(sm, "use_ssl", spath),
                                       spath + ".use_ssl")
                         : false;
        m_parquetS3Configs.push_back(std::move(ps3));
      }

      if (auto icebergOpt = optionalMap(parq, "iceberg", ppath)) {
        const AttributeMap &ice = **icebergOpt;
        const std::string ipath = ppath + ".iceberg";
        ParquetIcebergConfig iceberg;
        iceberg.catalogName = requireString(
            requireKey(ice, "catalog_name", ipath), ipath + ".catalog_name");
        iceberg.catalogUri = requireString(
            requireKey(ice, "catalog_uri", ipath), ipath + ".catalog_uri");
        iceberg.catalogType = requireString(
            requireKey(ice, "catalog_type", ipath), ipath + ".catalog_type");
        if (hasKey(ice, "aws_region")) {
          iceberg.awsRegion = requireString(
              requireKey(ice, "aws_region", ipath), ipath + ".aws_region");
        }
        if (hasKey(ice, "nessie_ref")) {
          iceberg.nessieRef = requireString(
              requireKey(ice, "nessie_ref", ipath), ipath + ".nessie_ref");
        }
        m_parquetIceberg = std::move(iceberg);
      }

      // Pitfall #1: MUST set m_parquetEnabled = true AFTER all parquet
      // hydration. The emitter only emits the parquet_export section when this
      // flag is true; forgetting this silently drops the entire section.
      m_parquetEnabled = true;
    }
  }

  void hydrateGIS(const AttributeMap &gis) {
    // Required: scene.scene_url
    const auto &scene =
        requireMap(requireKey(gis, "scene", "$.gis"), "$.gis.scene");
    m_sceneUrl = requireString(requireKey(scene, "scene_url", "$.gis.scene"),
                               "$.gis.scene.scene_url");

    // Optional: vegetation
    if (auto vegOpt = optionalMap(gis, "vegetation", "$.gis")) {
      const AttributeMap &veg = **vegOpt;
      // active flag
      if (hasKey(veg, "active")) {
        m_enableVegetation =
            requireBool(requireKey(veg, "active", "$.gis.vegetation"),
                        "$.gis.vegetation.active");
      } else {
        m_enableVegetation = false;
      }
      // geojson list (v1: at most one entry)
      if (hasKey(veg, "geojson")) {
        auto entries =
            parseStringList(requireKey(veg, "geojson", "$.gis.vegetation"),
                            "$.gis.vegetation.geojson");
        if (entries.size() > 1) {
          throw std::runtime_error(
              "gis.vegetation.geojson supports at most one entry in YAML "
              "import v1; got " +
              std::to_string(entries.size()));
        }
        if (entries.size() == 1) {
          m_vegetationAssetPaths.geojson = entries[0];
        }
      }
      // vegetation_asset_path list (v1: at most one entry)
      if (hasKey(veg, "vegetation_asset_path")) {
        auto entries = parseStringList(
            requireKey(veg, "vegetation_asset_path", "$.gis.vegetation"),
            "$.gis.vegetation.vegetation_asset_path");
        if (entries.size() > 1) {
          throw std::runtime_error(
              "gis.vegetation.vegetation_asset_path supports at most one entry "
              "in YAML import v1; got " +
              std::to_string(entries.size()));
        }
        if (entries.size() == 1) {
          if (!entries[0].ends_with(".json")) {
            throw std::runtime_error(
                "gis.vegetation.vegetation_asset_path must reference a .json "
                "file; got '" +
                entries[0] + "'");
          }
          m_vegetationAssetPaths.vegetationAssetPath = entries[0];
          m_emitImportedVegetationAssetPath = true;
        }
      }
    }

    // Optional: spawn_zone
    if (auto spawnOpt = optionalMap(gis, "spawn_zone", "$.gis")) {
      const AttributeMap &sz = **spawnOpt;
      if (hasKey(sz, "points_ccw")) {
        const AttributeList &lst =
            requireList(requireKey(sz, "points_ccw", "$.gis.spawn_zone"),
                        "$.gis.spawn_zone.points_ccw");
        auto points = parsePositionList(lst, "$.gis.spawn_zone.points_ccw");
        for (const auto &p : points) {
          if (p.dim() != 2) {
            throw std::runtime_error(
                "gis.spawn_zone.points_ccw points must be 2D");
          }
        }
        m_spawnZone = SpawnZone(points);
      }
    }

    // Optional: bbox_window
    if (auto bboxOpt = optionalList(gis, "bbox_window", "$.gis")) {
      const AttributeList &lst = **bboxOpt;
      auto points = parsePositionList(lst, "$.gis.bbox_window");
      for (const auto &p : points) {
        if (p.dim() != 2) {
          throw std::runtime_error("gis.bbox_window points must be 2D");
        }
      }
      m_bboxWindow = std::move(points);
    }
  }

  void hydrateSim(const AttributeMap &sim) {
    const auto &scenario =
        requireMap(requireKey(sim, "Scenario", "$.sim"), "$.sim.Scenario");
    hydrateScenario(scenario);

    hydratePanels(sim);
    hydrateDUs(sim);
    hydrateRUs(sim);
    hydrateUEs(sim);

    const auto &mats =
        requireMap(requireKey(sim, "Materials", "$.sim"), "$.sim.Materials");
    hydrateMaterialSection(mats, m_materialContainer, "Materials");

    const auto &vegMats =
        requireMap(requireKey(sim, "VegetationMaterials", "$.sim"),
                   "$.sim.VegetationMaterials");
    hydrateMaterialSection(vegMats, m_vegMaterialContainer,
                           "VegetationMaterials");

    // Scatterers: default-only; add/update must be rejected (Pitfall #8).
    const auto &scatterers =
        requireMap(requireKey(sim, "Scatterers", "$.sim"), "$.sim.Scatterers");
    if (hasKey(scatterers, "add") || hasKey(scatterers, "update")) {
      throw std::runtime_error(
          "Scatterers does not support add or update blocks in YAML import");
    }
    m_assetPaths.scatterers =
        requireString(requireKey(scatterers, "default", "$.sim.Scatterers"),
                      "$.sim.Scatterers.default");

    // BldgExterior / BldgInterior: optional, update-only.
    auto bldgExtOpt = optionalMap(sim, "BldgExterior", "$.sim");
    if (bldgExtOpt) {
      hydrateRawStringUpdateOnlySection<BldgExterior>(
          **bldgExtOpt, m_bldgExteriorContainer, "BldgExterior",
          /*wildcardAsEmpty=*/false);
    }
    auto bldgIntOpt = optionalMap(sim, "BldgInterior", "$.sim");
    if (bldgIntOpt) {
      hydrateRawStringUpdateOnlySection<BldgInterior>(
          **bldgIntOpt, m_bldgInteriorContainer, "BldgInterior",
          /*wildcardAsEmpty=*/false);
    }
  }

  // === YAML import descriptor infrastructure ===

  // ImportAssigner<T_Target>: a function that writes a single known attribute
  // into a typed prim field.  The three arguments are (target, value, path).
  template <typename T_Target>
  using ImportAssigner = std::function<void(T_Target &, const AttributeValue &,
                                            const std::string &)>;

  // ImportDescriptorTable<T_Target>: maps YAML key names to their assigners.
  template <typename T_Target>
  using ImportDescriptorTable = std::map<std::string, ImportAssigner<T_Target>>;

  // consumeKnownAttributes: apply all known attrs via the descriptor table and
  // return the remaining (unknown) attrs as a residual map.
  template <typename T_Target>
  static AttributeMap
  consumeKnownAttributes(T_Target &target, const AttributeMap &attrs,
                         const ImportDescriptorTable<T_Target> &table,
                         const std::string &path) {
    AttributeMap residual;
    for (const auto &[key, value] : attrs) {
      auto it = table.find(key);
      if (it == table.end()) {
        residual[key] = value;
        continue;
      }
      it->second(target, value, path + "." + key);
    }
    return residual;
  }

  // --- Scenario descriptor table ---

  static const ImportDescriptorTable<Scenario> &scenarioImportTable() {
    static const ImportDescriptorTable<Scenario> table =
        makeScenarioImportTable();
    return table;
  }

  static ImportDescriptorTable<Scenario> makeScenarioImportTable() {
    ImportDescriptorTable<Scenario> table;
    table["sim_is_full"] = [](Scenario &s, const AttributeValue &v,
                              const std::string &p) {
      s.m_isFullSim = requireBool(v, p);
    };
    table["sim_simulation_mode"] = [](Scenario &s, const AttributeValue &v,
                                      const std::string &p) {
      s.m_simulationMode = requireInt(v, p);
    };
    table["sim_batches"] = [](Scenario &s, const AttributeValue &v,
                              const std::string &p) {
      s.m_batches = requireInt(v, p);
    };
    table["sim_duration"] = [](Scenario &s, const AttributeValue &v,
                               const std::string &p) {
      s.m_duration = requireDouble(v, p);
    };
    table["sim_interval"] = [](Scenario &s, const AttributeValue &v,
                               const std::string &p) {
      s.m_interval = requireDouble(v, p);
    };
    table["sim_slots_per_batch"] = [](Scenario &s, const AttributeValue &v,
                                      const std::string &p) {
      s.m_slotsPerBatch = requireInt(v, p);
    };
    table["sim_samples_per_slot"] = [](Scenario &s, const AttributeValue &v,
                                       const std::string &p) {
      s.m_symbolsPerSlot = requireInt(v, p);
    };
    table["sim_is_seeded"] = [](Scenario &s, const AttributeValue &v,
                                const std::string &p) {
      s.m_isSeeded = requireBool(v, p);
    };
    table["sim_seed"] = [](Scenario &s, const AttributeValue &v,
                           const std::string &p) {
      s.m_seed = requireInt(v, p);
    };
    table["sim_gnb_panel_type"] = [](Scenario &s, const AttributeValue &v,
                                     const std::string &p) {
      s.m_defaultPanelRU = requireInt(v, p);
    };
    table["sim_ue_panel_type"] = [](Scenario &s, const AttributeValue &v,
                                    const std::string &p) {
      s.m_defaultPanelUE = requireInt(v, p);
    };
    table["sim_enable_wideband"] = [](Scenario &s, const AttributeValue &v,
                                      const std::string &p) {
      s.m_enableWideband = requireBool(v, p);
    };
    table["sim_num_procedural_ues"] = [](Scenario &s, const AttributeValue &v,
                                         const std::string &p) {
      s.m_numProceduralUEs = requireInt(v, p);
    };
    table["sim_perc_indoor_procedural_ues"] =
        [](Scenario &s, const AttributeValue &v, const std::string &p) {
          s.m_percIndoorProceduralUEs = requireDouble(v, p);
        };
    table["sim_ue_min_speed"] = [](Scenario &s, const AttributeValue &v,
                                   const std::string &p) {
      s.m_ueMinSpeed = requireDouble(v, p);
    };
    table["sim_ue_max_speed"] = [](Scenario &s, const AttributeValue &v,
                                   const std::string &p) {
      s.m_ueMaxSpeed = requireDouble(v, p);
    };
    table["um_enable_urban_mobility"] = [](Scenario &s, const AttributeValue &v,
                                           const std::string &p) {
      s.m_enableUrbanMobility = requireBool(v, p);
    };
    table["sim_enable_dynamic_scattering"] =
        [](Scenario &s, const AttributeValue &v, const std::string &p) {
          s.m_enableDynamicScattering = requireBool(v, p);
        };
    table["um_num_vehicles"] = [](Scenario &s, const AttributeValue &v,
                                  const std::string &p) {
      s.m_numVehicles = requireInt(v, p);
    };
    table["sim_em_diffuse_type"] = [](Scenario &s, const AttributeValue &v,
                                      const std::string &p) {
      s.m_diffuseType = requireInt(v, p);
    };
    table["sim_em_interactions"] = [](Scenario &s, const AttributeValue &v,
                                      const std::string &p) {
      s.m_interactions = requireInt(v, p);
    };
    table["sim_em_max_num_paths_per_ant_pair"] =
        [](Scenario &s, const AttributeValue &v, const std::string &p) {
          s.m_maxNumPathsPerAntPair = requireInt(v, p);
        };
    table["sim_em_rays"] = [](Scenario &s, const AttributeValue &v,
                              const std::string &p) {
      s.m_emittedRaysInThousands = requireInt(v, p);
    };
    table["sim_em_fast_mode"] = [](Scenario &s, const AttributeValue &v,
                                   const std::string &p) {
      s.m_fastMode = requireBool(v, p);
    };
    return table;
  }

  // hydrateScenario: hydrate m_scenario from the Scenario section map via the
  // descriptor table, then derive m_mode from m_scenario.m_isFullSim and
  // validate the final typed Scenario state.
  void hydrateScenario(const AttributeMap &scenario) {
    // 1. Require Scenario.default (asset path).
    m_assetPaths.scenario =
        requireString(requireKey(scenario, "default", "$.sim.Scenario"),
                      "$.sim.Scenario.default");

    // 2. Process Scenario.update[] list (optional).
    if (!hasKey(scenario, "update")) {
      // No update list: default mode = EM.
      m_mode = SimMode::EM;
      return;
    }

    const std::string updPath = "$.sim.Scenario.update";
    const AttributeList &updateList =
        requireList(requireKey(scenario, "update", "$.sim.Scenario"), updPath);

    for (std::size_t gi = 0; gi < updateList.size(); ++gi) {
      const std::string gpath = updPath + "[" + std::to_string(gi) + "]";
      const AttributeMap &group = requireMap(updateList[gi], gpath);

      // attributes is required.
      const AttributeMap &attrs = requireMap(
          requireKey(group, "attributes", gpath), gpath + ".attributes");

      // Apply known attributes to m_scenario; collect residual unknown keys.
      AttributeMap residual = consumeKnownAttributes(
          m_scenario, attrs, scenarioImportTable(), gpath + ".attributes");

      // Preserve unknown keys as a residual update group.
      if (!residual.empty()) {
        m_scenario.addAttributeUpdateGroup(residual);
      }
    }

    m_mode = m_scenario.m_isFullSim ? SimMode::RAN : SimMode::EM;
    m_scenario.validateGeneratedImport();
  }

  // --- Panel descriptor table ---

  static const ImportDescriptorTable<Panel> &panelImportTable() {
    static const ImportDescriptorTable<Panel> table = makePanelImportTable();
    return table;
  }

  static ImportDescriptorTable<Panel> makePanelImportTable() {
    ImportDescriptorTable<Panel> table;
    table["antenna_names"] = [](Panel &p, const AttributeValue &v,
                                const std::string &path) {
      p.m_antennaNames = parseStringList(v, path);
    };
    table["reference_freq_mhz"] = [](Panel &p, const AttributeValue &v,
                                     const std::string &path) {
      p.m_frequencyMHz = requireDouble(v, path);
    };
    table["antenna_spacing_vert_mm"] = [](Panel &p, const AttributeValue &v,
                                          const std::string &path) {
      p.m_verticalSpacingMM = requireDouble(v, path);
    };
    table["num_loc_antenna_vert"] = [](Panel &p, const AttributeValue &v,
                                       const std::string &path) {
      p.m_verticalNumElements = requireInt(v, path);
    };
    table["antenna_spacing_horz_mm"] = [](Panel &p, const AttributeValue &v,
                                          const std::string &path) {
      p.m_horizontalSpacingMM = requireDouble(v, path);
    };
    table["num_loc_antenna_horz"] = [](Panel &p, const AttributeValue &v,
                                       const std::string &path) {
      p.m_horizontalNumElements = requireInt(v, path);
    };
    table["dual_polarized"] = [](Panel &p, const AttributeValue &v,
                                 const std::string &path) {
      p.m_dualPolarized = requireBool(v, path);
    };
    table["antenna_roll_angle_first_polz_degree"] =
        [](Panel &p, const AttributeValue &v, const std::string &path) {
          p.m_rollFirstPolElement = requireDouble(v, path);
        };
    table["antenna_roll_angle_second_polz_degree"] =
        [](Panel &p, const AttributeValue &v, const std::string &path) {
          p.m_rollSecondPolElement = requireDouble(v, path);
        };
    return table;
  }

  // hydratePanels: hydrate m_panelContainer from the Panels section map.
  // Panels are optional; if the section is absent, returns immediately.
  //
  // Pitfall #2 (file-based panels): the emitter skips update emit for
  // file-based panels (buildPanelsSection), so their update attrs must NOT
  // be consumed by the descriptor.  ALL attrs (known + unknown) flow to
  // residual for file-based panels.  Spec-based panels consume known attrs
  // normally; only unknowns become residual.
  void hydratePanels(const AttributeMap &sim) {
    // Panels section is optional.
    auto panelsOpt = optionalMap(sim, "Panels", "$.sim");
    if (!panelsOpt) {
      return;
    }
    const AttributeMap &panels = **panelsOpt;

    // Require default asset path.
    m_assetPaths.panels = requireString(
        requireKey(panels, "default", "$.sim.Panels"), "$.sim.Panels.default");

    // Hydrate add list.
    auto addListOpt = optionalList(panels, "add", "$.sim.Panels");
    if (addListOpt) {
      const AttributeList *addListPtr = *addListOpt;
      const std::string addPath = "$.sim.Panels.add";
      for (std::size_t i = 0; i < addListPtr->size(); ++i) {
        const std::string ipath = addPath + "[" + std::to_string(i) + "]";
        const AttributeMap &entry = requireMap((*addListPtr)[i], ipath);
        const int id =
            requireInt(requireKey(entry, "id", ipath), ipath + ".id");

        if (m_panelContainer.contains(id)) {
          throw std::runtime_error(
              "Panel with ID " + std::to_string(id) +
              " already exists (duplicate in Panels.add).");
        }

        Panel panel;
        if (hasKey(entry, "panel_file")) {
          const std::string pf = requireString(
              requireKey(entry, "panel_file", ipath), ipath + ".panel_file");
          panel = Panel::createPanelFromFile(pf);
        }
        // else: default-constructed spec-based Panel{}
        panel.assignId(id);
        m_panelContainer.addPrim(std::move(panel));
      }
    }

    // Apply update groups with per-id spec/file branching.
    if (!hasKey(panels, "update")) {
      // Advance m_nextPanelId even if no update list.
      _advancePanelNextId();
      return;
    }

    const std::string updPath = "$.sim.Panels.update";
    const AttributeList &updateList =
        requireList(requireKey(panels, "update", "$.sim.Panels"), updPath);

    for (std::size_t gi = 0; gi < updateList.size(); ++gi) {
      const std::string gpath = updPath + "[" + std::to_string(gi) + "]";
      const AttributeMap &group = requireMap(updateList[gi], gpath);

      const AttributeValue &idsVal = requireKey(group, "ids", gpath);
      const AttributeMap &attrs = requireMap(
          requireKey(group, "attributes", gpath), gpath + ".attributes");

      const AttributeList &idsList = requireList(idsVal, gpath + ".ids");
      const bool wildcard = isWildcardIds(idsList);

      // Collect all matching ids, split into spec vs file buckets.
      std::vector<int> originalIds;
      std::vector<int> specIds;
      std::vector<int> fileIds;
      std::vector<int> orphanIds; // concrete ids not in container

      if (wildcard) {
        for (const auto &[id, prim] : m_panelContainer.prims()) {
          if (prim.isFileBased()) {
            fileIds.push_back(id);
          } else {
            specIds.push_back(id);
          }
        }
        // originalIds stays empty → wildcard re-emit shape
      } else {
        originalIds = parseIntIds(idsVal, gpath + ".ids");
        for (int id : originalIds) {
          if (!m_panelContainer.contains(id)) {
            orphanIds.push_back(id);
          } else if (m_panelContainer.find(id).isFileBased()) {
            fileIds.push_back(id);
          } else {
            specIds.push_back(id);
          }
        }
      }

      const auto &table = panelImportTable();

      // --- Spec-based panels: consume known attrs, residual = unknowns ---
      AttributeMap specResidual;
      if (!specIds.empty()) {
        // Consume known attrs for each spec panel.  Residual is the same
        // for all (descriptor is pure WRT residual); capture on first.
        bool capturedResidual = false;
        for (int id : specIds) {
          Panel &prim = m_panelContainer.find(id);
          AttributeMap r =
              consumeKnownAttributes(prim, attrs, table, gpath + ".attributes");
          if (!capturedResidual) {
            specResidual = std::move(r);
            capturedResidual = true;
          }
        }
        // Emit residual update group for spec panels (unknowns only).
        if (!specResidual.empty()) {
          // Wildcard re-emit shape (`["*"]`) is preserved only when the
          // wildcard covers a single bucket; otherwise fall back to the
          // bucket's concrete ids so the file residual cannot shadow spec
          // typed state on re-import.
          std::vector<int> residualSpecIds =
              (wildcard && fileIds.empty()) ? std::vector<int>{} : specIds;
          m_panelContainer.addAttributeUpdateGroup(residualSpecIds,
                                                   specResidual);
        }
      }

      // --- File-based panels: ALL attrs are residual (nothing consumed) ---
      if (!fileIds.empty()) {
        // See comment above on wildcard preservation: when both buckets
        // are present in the wildcard population, emit concrete fileIds
        // so the file residual's known attrs cannot reapply to spec
        // panels on re-import (which would shadow API mutations).
        std::vector<int> residualFileIds =
            (wildcard && specIds.empty()) ? std::vector<int>{} : fileIds;
        m_panelContainer.addAttributeUpdateGroup(residualFileIds, attrs);
      }

      // --- Orphan ids: Pitfall #7 — drop known keys, preserve unknowns ---
      if (!orphanIds.empty()) {
        AttributeMap orphanResidual;
        for (const auto &[key, value] : attrs) {
          if (table.find(key) == table.end()) {
            orphanResidual[key] = value;
          }
        }
        if (!orphanResidual.empty()) {
          m_panelContainer.addAttributeUpdateGroup(orphanIds, orphanResidual);
        }
      }
    }

    _advancePanelNextId();
  }

  // Advance m_nextPanelId to max(initialPanelId, maxImportedId + 1).
  void _advancePanelNextId() {
    if (m_panelContainer.empty()) {
      m_nextPanelId = initialPanelId;
      return;
    }
    int maxId = initialPanelId - 1;
    for (const auto &[id, _prim] : m_panelContainer.prims()) {
      if (id > maxId) {
        maxId = id;
      }
    }
    m_nextPanelId = std::max(initialPanelId, maxId + 1);
  }

  // --- DU descriptor table ---

  static const ImportDescriptorTable<DU> &duImportTable() {
    static const ImportDescriptorTable<DU> table = makeDUImportTable();
    return table;
  }

  static ImportDescriptorTable<DU> makeDUImportTable() {
    ImportDescriptorTable<DU> table;
    table["aerial_du_reference_freq"] = [](DU &du, const AttributeValue &v,
                                           const std::string &p) {
      du.m_frequencyMHz = requireDouble(v, p);
    };
    table["aerial_du_num_antennas"] = [](DU &du, const AttributeValue &v,
                                         const std::string &p) {
      du.m_numAntennas = requireInt(v, p);
    };
    table["aerial_du_fft_size"] = [](DU &du, const AttributeValue &v,
                                     const std::string &p) {
      du.m_fftSize = requireInt(v, p);
    };
    table["aerial_du_subcarrier_spacing"] = [](DU &du, const AttributeValue &v,
                                               const std::string &p) {
      du.m_subcarrierSpacing = requireDouble(v, p);
    };
    table["aerial_du_max_channel_bandwidth"] =
        [](DU &du, const AttributeValue &v, const std::string &p) {
          du.m_maxChannelBandwidth = requireDouble(v, p);
        };
    return table;
  }

  // --- RU descriptor table ---

  static const ImportDescriptorTable<RU> &ruImportTable() {
    static const ImportDescriptorTable<RU> table = makeRUImportTable();
    return table;
  }

  static ImportDescriptorTable<RU> makeRUImportTable() {
    ImportDescriptorTable<RU> table;
    table["aerial_gnb_carrier_freq"] = [](RU &ru, const AttributeValue &v,
                                          const std::string &p) {
      ru.m_frequencyMHz = requireDouble(v, p);
    };
    table["aerial_gnb_panel_type"] = [](RU &ru, const AttributeValue &v,
                                        const std::string &p) {
      ru.m_panelId = requireInt(v, p);
    };
    table["aerial_gnb_radiated_power"] = [](RU &ru, const AttributeValue &v,
                                            const std::string &p) {
      ru.m_radiatedPowerDbm = requireDouble(v, p);
    };
    table["aerial_gnb_du_id"] = [](RU &ru, const AttributeValue &v,
                                   const std::string &p) {
      ru.m_duId = requireInt(v, p);
    };
    table["aerial_gnb_du_manual_assign"] = [](RU &ru, const AttributeValue &v,
                                              const std::string &p) {
      ru.m_duManualAssign = requireBool(v, p);
    };
    table["aerial_gnb_height"] = [](RU &ru, const AttributeValue &v,
                                    const std::string &p) {
      ru.m_height = requireDouble(v, p);
    };
    table["aerial_gnb_mech_azimuth"] = [](RU &ru, const AttributeValue &v,
                                          const std::string &p) {
      ru.m_mechAzimuth = requireDouble(v, p);
    };
    table["aerial_gnb_mech_tilt"] = [](RU &ru, const AttributeValue &v,
                                       const std::string &p) {
      ru.m_mechTilt = requireDouble(v, p);
    };
    return table;
  }

  // --- UE descriptor table ---

  static const ImportDescriptorTable<UE> &ueImportTable() {
    static const ImportDescriptorTable<UE> table = makeUEImportTable();
    return table;
  }

  static ImportDescriptorTable<UE> makeUEImportTable() {
    ImportDescriptorTable<UE> table;
    table["aerial_ue_panel_type"] = [](UE &ue, const AttributeValue &v,
                                       const std::string &p) {
      ue.m_panelId = requireInt(v, p);
    };
    table["aerial_ue_radiated_power"] = [](UE &ue, const AttributeValue &v,
                                           const std::string &p) {
      ue.m_radiatedPowerDbm = requireDouble(v, p);
    };
    table["aerial_ue_manual"] = [](UE &ue, const AttributeValue &v,
                                   const std::string &p) {
      ue.m_isManual = requireBool(v, p);
    };
    table["aerial_ue_bler_target"] = [](UE &ue, const AttributeValue &v,
                                        const std::string &p) {
      ue.m_blerTarget = requireDouble(v, p);
    };
    table["aerial_ue_initial_mech_azimuth"] =
        [](UE &ue, const AttributeValue &v, const std::string &p) {
          ue.m_initialMechAzimuth = requireDouble(v, p);
        };
    table["aerial_ue_mech_tilt"] = [](UE &ue, const AttributeValue &v,
                                      const std::string &p) {
      ue.m_mechTilt = requireDouble(v, p);
    };
    return table;
  }

  // --- GPX source parser ---

  static GPXSource parseGPXSource(const AttributeMap &m,
                                  const std::string &path) {
    GPXSource gpx;
    gpx.src = requireString(requireKey(m, "src", path), path + ".src");
    if (hasKey(m, "use_pathfinding")) {
      gpx.usePathfinding = requireBool(requireKey(m, "use_pathfinding", path),
                                       path + ".use_pathfinding");
    }
    // use_pathfinding defaults to true when absent (GPXSource default).
    return gpx;
  }

  // --- hydrateDUs: hydrate m_duContainer from the DUs section map ---

  void hydrateDUs(const AttributeMap &sim) {
    auto dusOpt = optionalMap(sim, "DUs", "$.sim");
    if (!dusOpt) {
      return;
    }
    const AttributeMap &dus = **dusOpt;

    m_assetPaths.du = requireString(requireKey(dus, "default", "$.sim.DUs"),
                                    "$.sim.DUs.default");

    auto addListOpt = optionalList(dus, "add", "$.sim.DUs");
    if (addListOpt) {
      const AttributeList *addListPtr = *addListOpt;
      const std::string addPath = "$.sim.DUs.add";
      for (std::size_t i = 0; i < addListPtr->size(); ++i) {
        const std::string ipath = addPath + "[" + std::to_string(i) + "]";
        const AttributeMap &entry = requireMap((*addListPtr)[i], ipath);
        const int id =
            requireInt(requireKey(entry, "id", ipath), ipath + ".id");

        if (m_duContainer.contains(id)) {
          throw std::runtime_error("DU with ID " + std::to_string(id) +
                                   " already exists (duplicate in DUs.add).");
        }

        DU du(id);
        if (hasKey(entry, "position")) {
          // Once `position` is present, `pos` is required — silently dropping
          // the position on a misspelled inner key would lose data on
          // round-trip. Matches the waypoint convention below.
          const AttributeMap &posMap = requireMap(
              requireKey(entry, "position", ipath), ipath + ".position");
          const AttributeMap &posInner =
              requireMap(requireKey(posMap, "pos", ipath + ".position"),
                         ipath + ".position.pos");
          du.setPosition(parsePosition(posInner, ipath + ".position.pos"));
        }
        m_duContainer.addPrim(std::move(du));
      }
    }

    applyTypedUpdateGroups<DU>("DUs", dus, m_duContainer, duImportTable());
  }

  // --- hydrateRUs: hydrate m_ruContainer from the RUs section map ---

  void hydrateRUs(const AttributeMap &sim) {
    auto rusOpt = optionalMap(sim, "RUs", "$.sim");
    if (!rusOpt) {
      return;
    }
    const AttributeMap &rus = **rusOpt;

    m_assetPaths.ru = requireString(requireKey(rus, "default", "$.sim.RUs"),
                                    "$.sim.RUs.default");

    auto addListOpt = optionalList(rus, "add", "$.sim.RUs");
    if (addListOpt) {
      const AttributeList *addListPtr = *addListOpt;
      const std::string addPath = "$.sim.RUs.add";
      for (std::size_t i = 0; i < addListPtr->size(); ++i) {
        const std::string ipath = addPath + "[" + std::to_string(i) + "]";
        const AttributeMap &entry = requireMap((*addListPtr)[i], ipath);
        const int id =
            requireInt(requireKey(entry, "id", ipath), ipath + ".id");

        if (m_ruContainer.contains(id)) {
          throw std::runtime_error("RU with ID " + std::to_string(id) +
                                   " already exists (duplicate in RUs.add).");
        }

        RU ru(id);
        if (hasKey(entry, "position")) {
          // See DU note above: once `position` is present, `pos` is required.
          const AttributeMap &posMap = requireMap(
              requireKey(entry, "position", ipath), ipath + ".position");
          const AttributeMap &posInner =
              requireMap(requireKey(posMap, "pos", ipath + ".position"),
                         ipath + ".position.pos");
          ru.setPosition(parsePosition(posInner, ipath + ".position.pos"));
        }
        m_ruContainer.addPrim(std::move(ru));
      }
    }

    applyTypedUpdateGroups<RU>("RUs", rus, m_ruContainer, ruImportTable());
  }

  // --- hydrateUEs: hydrate m_ueContainer from the UEs section map ---

  void hydrateUEs(const AttributeMap &sim) {
    auto uesOpt = optionalMap(sim, "UEs", "$.sim");
    if (!uesOpt) {
      return;
    }
    const AttributeMap &ues = **uesOpt;

    m_assetPaths.ue = requireString(requireKey(ues, "default", "$.sim.UEs"),
                                    "$.sim.UEs.default");

    auto addListOpt = optionalList(ues, "add", "$.sim.UEs");
    if (addListOpt) {
      const AttributeList *addListPtr = *addListOpt;
      const std::string addPath = "$.sim.UEs.add";
      for (std::size_t i = 0; i < addListPtr->size(); ++i) {
        const std::string ipath = addPath + "[" + std::to_string(i) + "]";
        const AttributeMap &entry = requireMap((*addListPtr)[i], ipath);
        const int id =
            requireInt(requireKey(entry, "id", ipath), ipath + ".id");

        if (m_ueContainer.contains(id)) {
          throw std::runtime_error("UE with ID " + std::to_string(id) +
                                   " already exists (duplicate in UEs.add).");
        }

        UE ue(id);

        // Parse optional waypoints list.
        if (hasKey(entry, "waypoints")) {
          const AttributeList &wpList = requireList(
              requireKey(entry, "waypoints", ipath), ipath + ".waypoints");
          for (std::size_t wi = 0; wi < wpList.size(); ++wi) {
            const std::string wpath =
                ipath + ".waypoints[" + std::to_string(wi) + "]";
            const AttributeMap &wpEntry = requireMap(wpList[wi], wpath);
            const AttributeMap &posMap =
                requireMap(requireKey(wpEntry, "pos", wpath), wpath + ".pos");
            Position pos = parsePosition(posMap, wpath + ".pos");

            double speed = 0.0;
            double pauseDuration = 0.0;
            double azimuthOffset = 0.0;
            if (hasKey(wpEntry, "speed")) {
              speed = requireDouble(requireKey(wpEntry, "speed", wpath),
                                    wpath + ".speed");
            }
            if (hasKey(wpEntry, "pause_duration")) {
              pauseDuration =
                  requireDouble(requireKey(wpEntry, "pause_duration", wpath),
                                wpath + ".pause_duration");
            }
            if (hasKey(wpEntry, "azimuth_offset")) {
              azimuthOffset =
                  requireDouble(requireKey(wpEntry, "azimuth_offset", wpath),
                                wpath + ".azimuth_offset");
            }
            ue.addWaypoint(pos, speed, pauseDuration, azimuthOffset);
          }
        }

        // Parse optional GPX source.
        if (hasKey(entry, "gpx")) {
          const AttributeMap &gpxMap =
              requireMap(requireKey(entry, "gpx", ipath), ipath + ".gpx");
          ue.setGPXSource(parseGPXSource(gpxMap, ipath + ".gpx"));
        }

        m_ueContainer.addPrim(std::move(ue));
      }
    }

    applyTypedUpdateGroups<UE>("UEs", ues, m_ueContainer, ueImportTable());
  }

  // --- hydrateMaterialSection: hydrate a MaterialContainer from a Materials or
  //     VegetationMaterials section map (default + calibration + update).
  void hydrateMaterialSection(const AttributeMap &section,
                              MaterialContainer &container,
                              const std::string &sectionName) {
    const std::string sectionPath = "$.sim." + sectionName;

    // Reject add blocks regardless of whether the list is empty.
    if (hasKey(section, "add")) {
      throw std::runtime_error(sectionName +
                               " does not support add blocks in YAML import");
    }

    // Require default asset path.
    container.setAssetPath(requireString(
        requireKey(section, "default", sectionPath), sectionPath + ".default"));

    // Optional calibration sub-map.
    auto calibOpt = optionalMap(section, "calibration", sectionPath);
    if (calibOpt) {
      const AttributeMap &calib = **calibOpt;
      const std::string calibPath = sectionPath + ".calibration";

      // definition: list of strings.
      auto defListOpt = optionalList(calib, "definition", calibPath);
      if (defListOpt) {
        const AttributeList &defList = **defListOpt;
        const std::string defPath = calibPath + ".definition";
        for (std::size_t i = 0; i < defList.size(); ++i) {
          container.addCalibrationDefinition(requireString(
              defList[i], defPath + "[" + std::to_string(i) + "]"));
        }
      }

      // assignment: list of strings.
      auto assListOpt = optionalList(calib, "assignment", calibPath);
      if (assListOpt) {
        const AttributeList &assList = **assListOpt;
        const std::string assPath = calibPath + ".assignment";
        for (std::size_t i = 0; i < assList.size(); ++i) {
          container.addCalibrationAssignment(requireString(
              assList[i], assPath + "[" + std::to_string(i) + "]"));
        }
      }
    }

    // Optional update list.
    auto updateListOpt = optionalList(section, "update", sectionPath);
    if (updateListOpt) {
      const AttributeList &updateList = **updateListOpt;
      const std::string updPath = sectionPath + ".update";
      for (std::size_t gi = 0; gi < updateList.size(); ++gi) {
        const std::string gpath = updPath + "[" + std::to_string(gi) + "]";
        const AttributeMap &group = requireMap(updateList[gi], gpath);
        const AttributeValue &idsVal = requireKey(group, "ids", gpath);
        const AttributeMap &attrs = requireMap(
            requireKey(group, "attributes", gpath), gpath + ".attributes");
        // wildcardAsEmpty=true: wildcard stored as {} so generic emit re-emits
        // as ["*"].
        std::vector<std::string> ids =
            parseStringIds(idsVal, gpath + ".ids", /*wildcardAsEmpty=*/true);
        container.addAttributeUpdateGroup(ids, attrs);
      }
    }
  }

  // --- hydrateRawStringUpdateOnlySection: hydrate a PrimContainer<T_Prim>
  //     that only supports update groups (no add, no default asset path).
  //     Used for BldgExterior and BldgInterior.
  template <typename T_Prim>
  void hydrateRawStringUpdateOnlySection(const AttributeMap &section,
                                         PrimContainer<T_Prim> &container,
                                         const std::string &sectionName,
                                         bool wildcardAsEmpty) {
    const std::string sectionPath = "$.sim." + sectionName;

    // Reject add blocks regardless of whether the list is empty.
    if (hasKey(section, "add")) {
      throw std::runtime_error(sectionName +
                               " does not support add blocks in YAML import");
    }

    // Optional update list.
    auto updateListOpt = optionalList(section, "update", sectionPath);
    if (updateListOpt) {
      const AttributeList &updateList = **updateListOpt;
      const std::string updPath = sectionPath + ".update";
      for (std::size_t gi = 0; gi < updateList.size(); ++gi) {
        const std::string gpath = updPath + "[" + std::to_string(gi) + "]";
        const AttributeMap &group = requireMap(updateList[gi], gpath);
        const AttributeValue &idsVal = requireKey(group, "ids", gpath);
        const AttributeMap &attrs = requireMap(
            requireKey(group, "attributes", gpath), gpath + ".attributes");
        std::vector<std::string> ids =
            parseStringIds(idsVal, gpath + ".ids", wildcardAsEmpty);
        container.addAttributeUpdateGroup(ids, attrs);
      }
    }
  }

  // --- Update id parsing helpers ---

  // isWildcardIds: returns true for an empty list or a single-element ["*"].
  static bool isWildcardIds(const AttributeList &ids) {
    if (ids.empty()) {
      return true;
    }
    if (ids.size() == 1) {
      const std::string *sp = std::get_if<std::string>(&ids[0].value);
      if (sp && *sp == "*") {
        return true;
      }
    }
    return false;
  }

  // parseIntIds: parse a list of int ids; wildcard returns empty vector.
  // Rejects mixed wildcard "*" with concrete ints.
  static std::vector<int> parseIntIds(const AttributeValue &v,
                                      const std::string &path) {
    const AttributeList &lst = requireList(v, path);
    if (isWildcardIds(lst)) {
      return {};
    }
    std::vector<int> result;
    result.reserve(lst.size());
    for (std::size_t i = 0; i < lst.size(); ++i) {
      const std::string epath = path + "[" + std::to_string(i) + "]";
      // Reject any string element (including stray "*") in an int ids list.
      if (std::get_if<std::string>(&lst[i].value)) {
        throw std::runtime_error("ids list element at " + epath +
                                 " mixes wildcard \"*\" with concrete ids");
      }
      result.push_back(requireInt(lst[i], epath));
    }
    return result;
  }

  // parseStringIds: parse a list of string ids.
  // wildcardAsEmpty=true  → wildcard returns {} (caller re-emits as ["*"])
  // wildcardAsEmpty=false → wildcard returns {"*"}
  // Rejects mixed wildcard "*" with concrete strings.
  static std::vector<std::string> parseStringIds(const AttributeValue &v,
                                                 const std::string &path,
                                                 bool wildcardAsEmpty) {
    const AttributeList &lst = requireList(v, path);
    if (isWildcardIds(lst)) {
      return wildcardAsEmpty ? std::vector<std::string>{}
                             : std::vector<std::string>{"*"};
    }
    std::vector<std::string> result;
    result.reserve(lst.size());
    for (std::size_t i = 0; i < lst.size(); ++i) {
      const std::string epath = path + "[" + std::to_string(i) + "]";
      const std::string s = requireString(lst[i], epath);
      if (s == "*") {
        throw std::runtime_error("ids list element at " + epath +
                                 " mixes wildcard \"*\" with concrete ids");
      }
      result.push_back(s);
    }
    return result;
  }

  // --- Typed update application helper ---

  // applyTypedUpdateGroups: read the YAML "update" list from a section map,
  // apply known attributes to matching prims via the descriptor table, and
  // emit residual update groups for unknown attributes.
  //
  // Pitfall #7 (orphan known-key drop): when the ids list matches no currently-
  // imported prim, known keys are DROPPED (not preserved as residuals). Only
  // unknown keys survive into the residual update group.  This prevents a
  // stale residual from shadowing API-set typed state when the user later adds
  // a prim with that id.
  template <typename T_Prim>
  void applyTypedUpdateGroups(const std::string &sectionName,
                              const AttributeMap &section,
                              PrimContainer<T_Prim> &container,
                              const ImportDescriptorTable<T_Prim> &table) {
    if (!hasKey(section, "update")) {
      return;
    }
    const std::string sectionPath = "$.sim." + sectionName;
    const std::string updPath = sectionPath + ".update";
    const AttributeList &updateList =
        requireList(requireKey(section, "update", sectionPath), updPath);

    for (std::size_t gi = 0; gi < updateList.size(); ++gi) {
      const std::string gpath = updPath + "[" + std::to_string(gi) + "]";
      const AttributeMap &group = requireMap(updateList[gi], gpath);

      // Both `ids` and `attributes` are required — no defaults.
      const AttributeValue &idsVal = requireKey(group, "ids", gpath);
      const AttributeMap &attrs = requireMap(
          requireKey(group, "attributes", gpath), gpath + ".attributes");

      const AttributeList &idsList = requireList(idsVal, gpath + ".ids");
      const bool wildcard = isWildcardIds(idsList);

      // Compute the list of currently-imported matching object ids.
      // For typed int sections, wildcard expands to all current prim ids.
      std::vector<int> matching;
      std::vector<int> originalIds; // for residual emission, preserves shape
      if (wildcard) {
        for (const auto &[id, _prim] : container.prims()) {
          matching.push_back(id);
        }
        // originalIds stays empty — empty ids in residual means wildcard,
        // which appendContainerUpdateGroups emits as ["*"].
      } else {
        originalIds = parseIntIds(idsVal, gpath + ".ids");
        for (int id : originalIds) {
          if (container.contains(id)) {
            matching.push_back(id);
          }
        }
      }

      AttributeMap residual;
      if (matching.empty()) {
        // Pitfall #7: orphan group — no current prim matches these ids.
        // Drop every key that appears in the descriptor table (there is no
        // target to apply it to, and preserving it would let the residual
        // shadow API-set typed state after the user adds the matching prim).
        // Preserve ONLY unknown keys.
        for (const auto &[key, value] : attrs) {
          if (table.find(key) == table.end()) {
            residual[key] = value;
          }
        }
      } else {
        // Apply known attrs to each matching prim's typed state.
        // The residual is the same for every target (descriptor consumption is
        // pure with respect to the target — same input, same residual).
        // Capture once on the first iteration.
        for (int id : matching) {
          T_Prim &prim = container.find(id);
          AttributeMap perTargetResidual =
              consumeKnownAttributes(prim, attrs, table, gpath + ".attributes");
          if (residual.empty() && !perTargetResidual.empty()) {
            residual = std::move(perTargetResidual);
          }
        }
      }

      if (!residual.empty()) {
        // Preserve the original group's id shape:
        // wildcard → empty vector (re-emitted as ["*"] by
        // appendContainerUpdateGroups) concrete → original concrete ids
        std::vector<int> residualIds =
            wildcard ? std::vector<int>{} : originalIds;
        container.addAttributeUpdateGroup(residualIds, residual);
      }
      // If residual is empty, drop the group entirely (no residual emit).
    }
  }

  //=========================================================================
  // Build Neutral Tree
  //=========================================================================
  [[nodiscard]] AttributeMap buildDBSection() const {
    AttributeMap dbMap;

    if (m_simID.empty()) {
      throw std::runtime_error(
          "sim_id is required. Call setSimulationID() before generating YAML.");
    }
    dbMap["sim_id"] = AttributeValue{m_simID};
    if (m_dbHost.empty()) {
      printf("No db_host provided. Using default value: localhost\n");
    }
    dbMap["db_host"] = AttributeValue{m_dbHost};
    dbMap["db_port"] = AttributeValue{std::int64_t{m_dbPort}};
    if (!m_dbAuthor.empty())
      dbMap["db_author"] = AttributeValue{m_dbAuthor};
    if (!m_dbNotes.empty())
      dbMap["db_notes"] = AttributeValue{m_dbNotes};

    AttributeList tables;
    for (const auto &table : m_DBTable) {
      tables.emplace_back(table);
    }
    dbMap["opt_in_tables"] = AttributeValue{std::move(tables)};

    if (!m_optInTablesOptions.empty()) {
      AttributeMap optionsMap;
      for (const auto &[key, val] : m_optInTablesOptions) {
        optionsMap[key] = AttributeValue{val};
      }
      dbMap["opt_in_tables_options"] = AttributeValue{std::move(optionsMap)};
    }

    if (m_parquetEnabled) {
      if (m_parquetS3Configs.empty()) {
        throw std::runtime_error(
            "Parquet export enabled but no S3 configs were provided. "
            "Call add_parquet_s3_config() at least once.");
      }

      // Ensure no S3 endpoint collides with the ClickHouse address.
      auto dbAddr = m_dbHost + ":" + std::to_string(m_dbPort);
      for (const auto &cfg : m_parquetS3Configs) {
        if (cfg.endpointUrl.empty())
          continue;
        auto url = cfg.endpointUrl;
        auto p = url.find("://");
        if (p != std::string::npos)
          url = url.substr(p + 3);
        if (!url.empty() && url.back() == '/')
          url.pop_back();
        // Normalize localhost variants
        auto normalize = [](std::string s) {
          auto pos = s.find("127.0.0.1");
          if (pos != std::string::npos)
            s.replace(pos, 9, "localhost");
          return s;
        };
        if (normalize(url) == normalize(dbAddr)) {
          throw std::invalid_argument("S3 endpoint '" + cfg.endpointUrl +
                                      "' collides with ClickHouse at '" +
                                      dbAddr +
                                      "'. They must use different ports.");
        }
      }

      AttributeMap parquetMap;
      parquetMap["max_workers"] = AttributeValue{m_parquetMaxWorkers};
      parquetMap["compression"] = AttributeValue{m_parquetCompression};
      parquetMap["timesteps_per_file"] =
          AttributeValue{m_parquetTimestepsPerFile};
      parquetMap["verify_exports"] = AttributeValue{m_parquetVerifyExports};

      AttributeList s3ConfigList;
      for (const auto &cfg : m_parquetS3Configs) {
        AttributeMap s3Map;
        if (!cfg.endpointUrl.empty()) {
          s3Map["endpoint_url"] = AttributeValue{cfg.endpointUrl};
        }
        s3Map["bucket"] = AttributeValue{cfg.bucket};

        AttributeList nodes;
        for (const auto &node : cfg.nodes) {
          nodes.emplace_back(node);
        }
        s3Map["nodes"] = AttributeValue{std::move(nodes)};

        if (!cfg.accessKey.empty()) {
          s3Map["access_key"] = AttributeValue{cfg.accessKey};
        }
        if (!cfg.secretKey.empty()) {
          s3Map["secret_key"] = AttributeValue{cfg.secretKey};
        }
        s3Map["provider"] = AttributeValue{cfg.provider};
        s3Map["region"] = AttributeValue{cfg.region};
        s3Map["use_ssl"] = AttributeValue{cfg.useSSL};
        s3ConfigList.emplace_back(AttributeValue{std::move(s3Map)});
      }
      parquetMap["s3_configs"] = AttributeValue{std::move(s3ConfigList)};

      if (m_parquetIceberg.has_value()) {
        const auto &iceberg = m_parquetIceberg.value();
        AttributeMap icebergMap;
        icebergMap["catalog_type"] = AttributeValue{iceberg.catalogType};
        icebergMap["catalog_uri"] = AttributeValue{iceberg.catalogUri};
        icebergMap["catalog_name"] = AttributeValue{iceberg.catalogName};
        if (!iceberg.awsRegion.empty()) {
          icebergMap["aws_region"] = AttributeValue{iceberg.awsRegion};
        }
        if (!iceberg.nessieRef.empty()) {
          icebergMap["nessie_ref"] = AttributeValue{iceberg.nessieRef};
        }
        parquetMap["iceberg"] = AttributeValue{std::move(icebergMap)};
      }

      dbMap["parquet_export"] = AttributeValue{std::move(parquetMap)};
    }

    if (!m_s3Config.has_value()) {
      throw std::runtime_error("db.s3_config is required. Call set_s3_config() "
                               "before generating YAML.");
    }
    AttributeMap s3Map;
    s3Map["bucket"] = AttributeValue{m_s3Config->bucket};
    if (!m_s3Config->endpointUrl.empty())
      s3Map["endpoint_url"] = AttributeValue{m_s3Config->endpointUrl};
    s3Map["provider"] = AttributeValue{m_s3Config->provider};
    s3Map["region"] = AttributeValue{m_s3Config->region};
    if (!m_s3Config->accessKey.empty())
      s3Map["access_key"] = AttributeValue{m_s3Config->accessKey};
    if (!m_s3Config->secretKey.empty())
      s3Map["secret_key"] = AttributeValue{m_s3Config->secretKey};
    dbMap["s3_config"] = AttributeValue{std::move(s3Map)};

    return dbMap;
  }

  [[nodiscard]] AttributeMap buildGISSection() const {
    AttributeMap gisMap;

    // Scene section
    AttributeMap sceneMap;
    sceneMap["scene_url"] = AttributeValue{m_sceneUrl};
    gisMap["scene"] = AttributeValue{std::move(sceneMap)};

    if (m_enableVegetation &&
        m_vegetationAssetPaths.vegetationAssetPath.empty()) {
      throw std::runtime_error(
          "Vegetation is enabled but no vegetation asset path was provided. "
          "Add 'vegetation_assets' to assets.yml (required) or provide "
          "'gis.vegetation.vegetation_asset_path' in the imported YAML.");
    }

    // Vegetation section (ConfigVegContainer expects lists for paths)
    AttributeMap vegetationMap;
    vegetationMap["active"] = AttributeValue{m_enableVegetation};

    if ((m_enableVegetation || m_emitImportedVegetationAssetPath) &&
        !m_vegetationAssetPaths.vegetationAssetPath.empty()) {
      AttributeList vegetationAssetPathList;
      vegetationAssetPathList.emplace_back(
          m_vegetationAssetPaths.vegetationAssetPath);
      vegetationMap["vegetation_asset_path"] =
          AttributeValue{std::move(vegetationAssetPathList)};
    }

    AttributeList geojsonList;
    if (!m_vegetationAssetPaths.geojson.empty()) {
      geojsonList.emplace_back(m_vegetationAssetPaths.geojson);
    }
    vegetationMap["geojson"] = AttributeValue{std::move(geojsonList)};
    gisMap["vegetation"] = AttributeValue{std::move(vegetationMap)};

    // Spawn zone (points_ccw polygon for procedural UEs)
    if (m_spawnZone.has_value() && !m_spawnZone->empty()) {
      AttributeMap spawnZoneMap;

      AttributeList pointsList;
      for (const auto &pt : m_spawnZone->pointsCCW()) {
        pointsList.emplace_back(pt.toAttributeMap());
      }
      spawnZoneMap["points_ccw"] = AttributeValue{std::move(pointsList)};
      gisMap["spawn_zone"] = AttributeValue{std::move(spawnZoneMap)};
    }

    // Bounding box window
    if (!m_bboxWindow.empty()) {
      AttributeList bboxList;
      for (const auto &pt : m_bboxWindow) {
        bboxList.emplace_back(pt.toAttributeMap());
      }
      gisMap["bbox_window"] = AttributeValue{std::move(bboxList)};
    }

    return gisMap;
  }

  [[nodiscard]] AttributeMap toNeutralTree() const {
    AttributeMap root;

    root["db"] = AttributeValue{buildDBSection()};

    root["sim"] = AttributeValue{buildSimSection()};

    // Always emit GIS section so scene_url is present.
    root["gis"] = AttributeValue{buildGISSection()};

    if (m_calibrationConfig.has_value()) {
      root["cal"] = AttributeValue{buildCalibrationSection()};
    }

    return root;
  }

  [[nodiscard]] AttributeMap buildCalibrationSection() const {
    if (!m_calibrationConfig.has_value()) {
      return {};
    }
    const CalibrationConfig &cal = *m_calibrationConfig;
    if (cal.outputFolderKey.empty()) {
      throw std::runtime_error(
          "Calibration output folder_key must be set before exporting YAML");
    }
    if (cal.measurements.empty()) {
      throw std::runtime_error("At least one calibration measurement must be "
                               "added before exporting YAML");
    }

    AttributeMap calMap;

    AttributeMap targetsMap;
    targetsMap["Materials"] = AttributeValue{cal.targets.materials};
    targetsMap["VegMaterials"] = AttributeValue{cal.targets.vegMaterials};
    targetsMap["RUs"] = AttributeValue{cal.targets.rus};
    targetsMap["RUsBeams"] = AttributeValue{cal.targets.rusBeams};
    targetsMap["UEs"] = AttributeValue{cal.targets.ues};
    calMap["targets"] = AttributeValue{std::move(targetsMap)};

    AttributeList measurementsList;
    for (const CalibrationMeasurement &measurement : cal.measurements) {
      AttributeMap measurementMap;
      measurementMap["ru_id"] = AttributeValue{measurement.ruId};
      measurementMap["ue_id"] = AttributeValue{measurement.ueId};
      measurementMap["measurement_file"] =
          AttributeValue{measurement.measurementFile};
      measurementsList.emplace_back(std::move(measurementMap));
    }
    calMap["measurements"] = AttributeValue{std::move(measurementsList)};

    AttributeMap timelineMap;
    timelineMap["start"] = AttributeValue{cal.timeline.start};
    timelineMap["step"] = AttributeValue{cal.timeline.step};
    if (cal.timeline.end.has_value()) {
      timelineMap["end"] = AttributeValue{*cal.timeline.end};
    } else {
      timelineMap["end"] = AttributeValue{};
    }
    calMap["timeline"] = AttributeValue{std::move(timelineMap)};

    AttributeMap outputMap;
    outputMap["folder_key"] = AttributeValue{cal.outputFolderKey};
    calMap["output"] = AttributeValue{std::move(outputMap)};

    if (cal.executionMode.has_value()) {
      calMap["execution_mode"] = AttributeValue{*cal.executionMode};
    }
    if (cal.keepLocalOutput) {
      calMap["keep_local_output"] = AttributeValue{cal.keepLocalOutput};
    }

    return calMap;
  }

  [[nodiscard]] AttributeMap
  buildMaterialSection(const MaterialContainer &container) const {
    AttributeMap matMap;
    matMap["default"] = AttributeValue{container.assetPath()};

    // Calibration sub-section
    const auto &defs = container.calibrationDefinitions();
    const auto &assigns = container.calibrationAssignments();
    if (!defs.empty() || !assigns.empty()) {
      AttributeMap calibMap;
      AttributeList defList;
      for (const auto &d : defs) {
        defList.emplace_back(AttributeValue{d});
      }
      calibMap["definition"] = AttributeValue{std::move(defList)};

      AttributeList assignList;
      for (const auto &a : assigns) {
        assignList.emplace_back(AttributeValue{a});
      }
      calibMap["assignment"] = AttributeValue{std::move(assignList)};

      matMap["calibration"] = AttributeValue{std::move(calibMap)};
    }

    // Update groups (from setAttributes)
    AttributeList updatesList;
    appendContainerUpdateGroups(container.updates(), updatesList);
    if (!updatesList.empty()) {
      matMap["update"] = AttributeValue{std::move(updatesList)};
    }

    return matMap;
  }

  [[nodiscard]] AttributeMap buildSimSection() const {
    AttributeMap simMap;

    // Scenario (always present)
    simMap["Scenario"] = AttributeValue{buildScenarioSection()};

    // Panels (SimConfigPanel: asset, add, update)
    if (!m_panelContainer.empty())
      simMap["Panels"] = AttributeValue{buildPanelsSection()};

    // DUs, RUs, UEs (SimConfigNode: asset, add, update)
    simMap["DUs"] = AttributeValue{buildDUsSection()};
    simMap["RUs"] = AttributeValue{buildRUsSection()};
    simMap["UEs"] = AttributeValue{buildUEsSection()};

    // Materials (SimConfigMaterial: default, calibration, update)
    simMap["Materials"] =
        AttributeValue{buildMaterialSection(m_materialContainer)};

    // VegetationMaterials (SimConfigMaterial: default, calibration, update)
    simMap["VegetationMaterials"] =
        AttributeValue{buildMaterialSection(m_vegMaterialContainer)};

    // Scatterers (used by mobility / dynamic scattering)
    AttributeMap scatterersMap;
    scatterersMap["default"] = AttributeValue{m_assetPaths.scatterers};
    simMap["Scatterers"] = AttributeValue{std::move(scatterersMap)};

    // Buildings (BldgExterior / BldgInterior sections)
    const AttributeMap bldgSections = buildBldgSection();
    for (const auto &[key, section] : bldgSections) {
      simMap[key] = section;
    }

    return simMap;
  }

  [[nodiscard]] AttributeMap buildScenarioSection() const {
    AttributeMap scenarioMap;

    // Asset path for scenario (SimConfigBase.default)
    scenarioMap["default"] = AttributeValue{m_assetPaths.scenario};

    // Update section: list of {attributes}
    AttributeList updatesList;

    // Scenario's own attributes
    AttributeMap updateEntry;
    updateEntry["attributes"] = AttributeValue{m_scenario.toAttributeMap()};
    updatesList.emplace_back(std::move(updateEntry));

    // Additional update groups (from setAttributes)
    for (const auto &updateGrp : m_scenario.updates()) {
      AttributeMap entry;
      entry["attributes"] = AttributeValue{updateGrp.attributes};
      updatesList.emplace_back(std::move(entry));
    }

    scenarioMap["update"] = AttributeValue{std::move(updatesList)};
    return scenarioMap;
  }

  [[nodiscard]] AttributeMap buildPanelsSection() const {
    AttributeMap panelsMap;

    // Asset path for panels (SimConfigPanel.default)
    panelsMap["default"] = AttributeValue{m_assetPaths.panels};

    AttributeList addList;
    for (const auto &[id, panelRef] : sortedPrims(m_panelContainer.prims())) {
      const Panel &panel = panelRef.get();
      AttributeMap addEntry;
      addEntry["id"] = AttributeValue{std::int64_t{panel.id()}};
      if (panel.isFileBased()) {
        addEntry["panel_file"] = AttributeValue{panel.panelFile()};
      }
      addList.emplace_back(std::move(addEntry));
    }
    if (!addList.empty()) {
      panelsMap["add"] = AttributeValue{std::move(addList)};
    }

    AttributeList updatesList;
    for (const auto &[id, panelRef] : sortedPrims(m_panelContainer.prims())) {
      const Panel &panel = panelRef.get();
      if (panel.isFileBased()) {
        continue; // skip update entry for file-based panels
      }
      AttributeMap updateGroup;
      AttributeList idsList{AttributeValue{std::int64_t{panel.id()}}};
      updateGroup["ids"] = AttributeValue{std::move(idsList)};
      updateGroup["attributes"] = AttributeValue{panel.toAttributeMap()};
      updatesList.emplace_back(std::move(updateGroup));
    }

    // Additional update groups (from setAttributes)
    appendContainerUpdateGroups(m_panelContainer.updates(), updatesList);

    if (!updatesList.empty()) {
      panelsMap["update"] = AttributeValue{std::move(updatesList)};
    }
    return panelsMap;
  }

  [[nodiscard]] AttributeMap buildDUsSection() const {
    AttributeMap dusMap;
    dusMap["default"] = AttributeValue{m_assetPaths.du};

    AttributeList addList;
    AttributeList updatesList;

    for (const auto &[id, duRef] : sortedPrims(m_duContainer.prims())) {
      const DU &du = duRef.get();
      AttributeMap addEntry;
      addEntry["id"] = AttributeValue{std::int32_t{du.id()}};
      if (du.position()) {
        AttributeMap posWrapper;
        posWrapper["pos"] = AttributeValue{du.position()->toAttributeMap()};
        addEntry["position"] = AttributeValue{std::move(posWrapper)};
      }
      addList.emplace_back(AttributeValue{std::move(addEntry)});

      // Update entry
      AttributeMap updateGroup;
      AttributeList idsList{AttributeValue{std::int32_t{du.id()}}};
      updateGroup["ids"] = AttributeValue{std::move(idsList)};
      updateGroup["attributes"] = AttributeValue{du.toAttributeMap()};
      updatesList.emplace_back(AttributeValue{std::move(updateGroup)});
    }

    // Additional update groups (from setAttributes)
    appendContainerUpdateGroups(m_duContainer.updates(), updatesList);

    if (!addList.empty()) {
      dusMap["add"] = AttributeValue{std::move(addList)};
    }
    if (!updatesList.empty()) {
      dusMap["update"] = AttributeValue{std::move(updatesList)};
    }
    return dusMap;
  }

  [[nodiscard]] AttributeMap buildRUsSection() const {
    AttributeMap rusMap;
    rusMap["default"] = AttributeValue{m_assetPaths.ru};

    AttributeList addList;
    AttributeList updatesList;

    for (const auto &[id, ruRef] : sortedPrims(m_ruContainer.prims())) {
      const RU &ru = ruRef.get();
      AttributeMap addEntry;
      addEntry["id"] = AttributeValue{std::int32_t{ru.id()}};
      if (ru.position()) {
        AttributeMap posWrapper;
        posWrapper["pos"] = AttributeValue{ru.position()->toAttributeMap()};
        addEntry["position"] = AttributeValue{std::move(posWrapper)};
      }
      addList.emplace_back(AttributeValue{std::move(addEntry)});

      AttributeMap updateGroup;
      AttributeList idsList{AttributeValue{std::int32_t{ru.id()}}};
      updateGroup["ids"] = AttributeValue{std::move(idsList)};
      updateGroup["attributes"] = AttributeValue{ru.toAttributeMap()};
      updatesList.emplace_back(AttributeValue{std::move(updateGroup)});
    }

    // Additional update groups (from setAttributes)
    appendContainerUpdateGroups(m_ruContainer.updates(), updatesList);

    if (!addList.empty()) {
      rusMap["add"] = AttributeValue{std::move(addList)};
    }
    if (!updatesList.empty()) {
      rusMap["update"] = AttributeValue{std::move(updatesList)};
    }
    return rusMap;
  }

  [[nodiscard]] AttributeMap buildUEsSection() const {
    AttributeMap uesMap;
    uesMap["default"] = AttributeValue{m_assetPaths.ue};

    AttributeList addList;
    AttributeList updatesList;

    for (const auto &[id, ueRef] : sortedPrims(m_ueContainer.prims())) {
      const UE &ue = ueRef.get();
      AttributeMap addEntry;
      addEntry["id"] = AttributeValue{std::int32_t{ue.id()}};

      if (ue.hasGPX()) {
        addEntry["gpx"] = AttributeValue{ue.gpxSource()->toAttributeMap()};
      }
      if (!ue.waypoints().empty()) {
        addEntry["waypoints"] = AttributeValue{ue.waypointsAttributeList()};
      }

      addList.emplace_back(AttributeValue{std::move(addEntry)});

      AttributeMap updateGroup;
      AttributeList idsList{AttributeValue{std::int32_t{ue.id()}}};
      updateGroup["ids"] = AttributeValue{std::move(idsList)};
      updateGroup["attributes"] = AttributeValue{ue.toAttributeMap()};
      updatesList.emplace_back(AttributeValue{std::move(updateGroup)});
    }

    // Additional update groups (from setAttributes)
    appendContainerUpdateGroups(m_ueContainer.updates(), updatesList);

    if (!addList.empty()) {
      uesMap["add"] = AttributeValue{std::move(addList)};
    }
    if (!updatesList.empty()) {
      uesMap["update"] = AttributeValue{std::move(updatesList)};
    }
    return uesMap;
  }

  [[nodiscard]] AttributeMap buildBldgSection() const {
    AttributeMap sections;

    const bool hasExterior = !m_bldgExteriorContainer.updates().empty();
    const bool hasInterior = !m_bldgInteriorContainer.updates().empty();

    // No building configuration requested
    if (!hasExterior && !hasInterior) {
      return sections;
    }

    auto buildBldgSubSection = [](const auto &container) -> AttributeMap {
      AttributeMap subSection;
      AttributeList updatesList;

      for (const auto &updateGrp : container.updates()) {
        AttributeMap entry;
        AttributeList idsList;
        for (const auto &id : updateGrp.ids) {
          idsList.emplace_back(AttributeValue{id});
        }
        entry["ids"] = AttributeValue{std::move(idsList)};
        entry["attributes"] = AttributeValue{updateGrp.attributes};
        updatesList.emplace_back(AttributeValue{std::move(entry)});
      }

      if (!updatesList.empty()) {
        subSection["update"] = AttributeValue{std::move(updatesList)};
      }

      return subSection;
    };

    if (hasExterior) {
      sections["BldgExterior"] =
          AttributeValue{buildBldgSubSection(m_bldgExteriorContainer)};
    }

    if (hasInterior) {
      sections["BldgInterior"] =
          AttributeValue{buildBldgSubSection(m_bldgInteriorContainer)};
    }

    return sections;
  }

  //=========================================================================
  // YAML Emission (Centralized)
  //=========================================================================

  static std::string emitYAML(const AttributeMap &tree) {
    YAML::Node root = convertToYamlNode(AttributeValue{tree});

    YAML::Emitter emitter;
    emitter.SetIndent(2);
    emitter.SetSeqFormat(YAML::Block);
    emitter.SetMapFormat(YAML::Block);
    emitter << root;

    return std::string{emitter.c_str()};
  }

  static YAML::Node convertToYamlNode(const AttributeValue &av) {
    return std::visit(
        [](auto &&val) -> YAML::Node {
          using T = std::decay_t<decltype(val)>;
          YAML::Node node;

          if constexpr (std::is_same_v<T, std::monostate>) {
            // Undefined
          } else if constexpr (std::is_same_v<T, AttributeMap>) {
            for (const auto &[k, v] : val) {
              node[k] = convertToYamlNode(v);
            }
          } else if constexpr (std::is_same_v<T, AttributeList>) {
            for (const auto &item : val) {
              node.push_back(convertToYamlNode(item));
            }
          } else {
            node = val;
          }

          return node;
        },
        av.value);
  }

  //=========================================================================
  // Private Helpers
  //=========================================================================

  /**
   * @brief Build an ``ids`` AttributeList for YAML emission.
   *
   * If @p ids is empty, returns ``["*"]`` (wildcard = "all IDs").
   * This matches the convention documented in UpdateGroup::ids.
   */
  template <typename T_Id>
  static AttributeList buildIdsListForEmission(const std::vector<T_Id> &ids) {
    AttributeList idsList;
    if (ids.empty()) {
      idsList.emplace_back(AttributeValue{std::string("*")});
    } else {
      for (const auto &id : ids) {
        idsList.emplace_back(AttributeValue{id});
      }
    }
    return idsList;
  }

  /**
   * @brief Append additional update groups from a PrimContainer to a YAML
   *        update list.  Handles empty ids -> wildcard ``['*']``.
   */
  template <typename T_Id>
  static void
  appendContainerUpdateGroups(const std::vector<UpdateGroup<T_Id>> &groups,
                              AttributeList &updatesList) {
    for (const auto &updateGrp : groups) {
      AttributeMap entry;
      entry["ids"] = AttributeValue{buildIdsListForEmission(updateGrp.ids)};
      entry["attributes"] = AttributeValue{updateGrp.attributes};
      updatesList.emplace_back(AttributeValue{std::move(entry)});
    }
  }

  /**
   * @brief Return a sorted vector of (id, prim) pairs from an unordered_map,
   *        ordered ascending by id. Used to guarantee stable emission order
   *        across round trips (unordered_map iteration order is
   *        non-deterministic).
   */
  template <typename T_Id, typename T_Prim>
  static std::vector<std::pair<T_Id, std::reference_wrapper<const T_Prim>>>
  sortedPrims(const std::unordered_map<T_Id, T_Prim> &primsMap) {
    std::vector<std::pair<T_Id, std::reference_wrapper<const T_Prim>>> sorted;
    sorted.reserve(primsMap.size());
    for (const auto &[id, prim] : primsMap) {
      sorted.emplace_back(id, std::cref(prim));
    }
    std::sort(sorted.begin(), sorted.end(),
              [](const auto &a, const auto &b) { return a.first < b.first; });
    return sorted;
  }

  /**
   * @brief Reject a panel with a duplicate ID.
   * @throws std::runtime_error if panelId already exists in m_panelContainer
   */
  void _rejectDuplicatePanelId(int panelId) const {
    if (m_panelContainer.contains(panelId)) {
      throw std::runtime_error("Panel with ID " + std::to_string(panelId) +
                               " already exists. Use a different ID.");
    }
  }

  static void _validateS3Config(const S3Config &s3config) {
    if (s3config.bucket.empty()) {
      throw std::invalid_argument("S3 bucket cannot be empty");
    }
    auto lowerProvider = toLower(s3config.provider);
    if (lowerProvider != "minio" && lowerProvider != "aws") {
      throw std::invalid_argument("Unsupported S3 provider '" +
                                  s3config.provider +
                                  "'. Supported providers: 'minio', 'aws'");
    }
    if (lowerProvider == "minio" && s3config.endpointUrl.empty()) {
      throw std::invalid_argument(
          "endpoint_url is required when provider is 'minio'");
    }
    if (lowerProvider == "minio" && !s3config.endpointUrl.empty() &&
        s3config.endpointUrl.rfind("http://", 0) != 0 &&
        s3config.endpointUrl.rfind("https://", 0) != 0) {
      throw std::invalid_argument(
          "endpoint_url must start with 'http://' or 'https://' for MinIO "
          "(got '" +
          s3config.endpointUrl + "')");
    }
  }

  /**
   * @brief Validate that a panel's frequency is consistent with existing
   *        non-file-based panels. Skips file-based panels on both sides.
   */
  void _validatePanelFrequency(const Panel &panel) const {
    if (panel.isFileBased() || m_panelContainer.empty()) {
      return;
    }
    for (const auto &[id, p] : m_panelContainer.prims()) {
      if (!p.isFileBased() &&
          std::abs(p.frequency() - panel.frequency()) > 0.1) {
        throw std::runtime_error(
            "Panel frequency doesn't match existing panel frequency");
      }
    }
  }

  //=========================================================================
  // Private Members
  //=========================================================================
private:
  struct ParquetS3Config {
    std::string endpointUrl;
    std::string bucket;
    std::vector<std::string> nodes;
    std::string accessKey;
    std::string secretKey;
    std::string provider;
    std::string region;
    bool useSSL;
  };

  struct ParquetIcebergConfig {
    std::string catalogName;
    std::string catalogUri;
    std::string catalogType;
    std::string awsRegion;
    std::string nessieRef;
  };

  struct CalibrationTargetsConfig {
    bool materials{true};
    bool vegMaterials{false};
    bool rus{false};
    bool rusBeams{false};
    bool ues{false};
  };

  struct CalibrationMeasurement {
    int ruId;
    int ueId;
    std::string measurementFile;
  };

  struct CalibrationTimelineConfig {
    int start{0};
    int step{1};
    std::optional<int> end;
  };

  struct CalibrationConfig {
    CalibrationTargetsConfig targets;
    std::vector<CalibrationMeasurement> measurements;
    CalibrationTimelineConfig timeline;
    std::string outputFolderKey;
    std::optional<std::string> executionMode;
    bool keepLocalOutput{false};
  };

  CalibrationConfig &ensureCalibrationConfig() {
    if (!m_calibrationConfig.has_value()) {
      m_calibrationConfig.emplace();
    }
    return *m_calibrationConfig;
  }

  CalibrationConfig &requireCalibrationConfig() {
    if (!m_calibrationConfig.has_value()) {
      throw std::logic_error(
          "Call setCalibrationTargets before setting calibration details");
    }
    return *m_calibrationConfig;
  }

  SimMode m_mode;
  std::string m_sceneUrl;
  std::unordered_set<std::string> m_DBTable{defaultChannelModelStr};
  std::string m_simID;
  std::string m_dbHost{"clickhouse"};
  int m_dbPort{9000};
  std::string m_dbAuthor{defaultDbAuthor};
  std::string m_dbNotes;
  std::map<std::string, std::string> m_optInTablesOptions{{"raypaths", "full"}};
  bool m_parquetEnabled{false};
  int m_parquetMaxWorkers{2};
  std::string m_parquetCompression{"zstd"};
  int m_parquetTimestepsPerFile{100};
  bool m_parquetVerifyExports{true};
  std::vector<ParquetS3Config> m_parquetS3Configs;
  std::optional<ParquetIcebergConfig> m_parquetIceberg;
  std::optional<S3Config>
      m_s3Config; // global S3 config (e.g. for GIS map storage)
  std::optional<CalibrationConfig> m_calibrationConfig;

  bool m_enableVegetation{false};
  bool m_emitImportedVegetationAssetPath{false};
  VegetationAssetPaths m_vegetationAssetPaths;

  AssetPaths m_assetPaths;

  // Containers (unified API)
  Scenario m_scenario; // Each SimConfig instance has its own Scenario
  std::optional<SpawnZone> m_spawnZone;
  std::vector<Position> m_bboxWindow;
  PrimContainer<Panel> m_panelContainer;
  PrimContainer<DU> m_duContainer;
  PrimContainer<RU> m_ruContainer;
  PrimContainer<UE> m_ueContainer;
  MaterialContainer m_materialContainer;
  MaterialContainer m_vegMaterialContainer;
  PrimContainer<BldgExterior> m_bldgExteriorContainer;
  PrimContainer<BldgInterior> m_bldgInteriorContainer;

  int m_nextPanelId{initialPanelId};
  int m_nextRUId{initialRUId};
  int m_nextUEId{initialUEId};

  void loadDefaultAssetPaths(const std::string &assetConfigPath) {
    try {
      YAML::Node config = YAML::LoadFile(assetConfigPath);

      const auto readRequiredAssetPath = [&](const char *key) -> std::string {
        YAML::Node value = config[key];
        if (!value || !value.IsScalar()) {
          throw std::runtime_error("Missing required scalar asset key '" +
                                   std::string(key) + "' in '" +
                                   assetConfigPath + "'");
        }
        std::string path = value.as<std::string>();
        if (!path.ends_with(".json")) {
          throw std::runtime_error("Asset key '" + std::string(key) +
                                   "' must reference a .json file in '" +
                                   assetConfigPath + "': " + path);
        }
        return path;
      };

      m_assetPaths.du = readRequiredAssetPath("du");
      m_assetPaths.ru = readRequiredAssetPath("ru");
      m_assetPaths.ue = readRequiredAssetPath("ue");
      m_assetPaths.scenario = readRequiredAssetPath("scenario");
      m_assetPaths.panels = readRequiredAssetPath("panels");
      m_assetPaths.scatterers = readRequiredAssetPath("scatterers");
      m_materialContainer.setAssetPath(readRequiredAssetPath("materials"));
      m_vegMaterialContainer.setAssetPath(
          readRequiredAssetPath("vegetation_materials"));
      m_vegetationAssetPaths.vegetationAssetPath =
          readRequiredAssetPath("vegetation_assets");
    } catch (const YAML::Exception &e) {
      throw std::runtime_error("Failed to load asset config from '" +
                               assetConfigPath + "': " + e.what());
    } catch (const std::exception &e) {
      throw std::runtime_error("Error reading asset config: " +
                               std::string(e.what()));
    }
  }

  /**
   * @brief Derive default vegetation GeoJSON path from the current scene URL.
   *
   * Let m_sceneUrl point to "<key>/<map_name>".
   * This returns "<key>/<map_name>/sim/vegetation.geojson",
   * i.e. a sibling "vegetation.geojson" file next to the scene file.
   */
  [[nodiscard]] std::optional<std::string>
  deriveVegetationGeojsonFromScene() const {
    // Normalize scene URL by adding a slash if there yet
    std::string keyS3 = m_sceneUrl;
    if (!keyS3.ends_with('/')) {
      keyS3 += '/';
    }

    return keyS3 + "sim/vegetation.geojson";
  }

  static std::string toLower(const std::string &str) {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return result;
  }

  static int extractNumericId(const std::string &id) {
    auto pos = id.find_last_of('_');
    if (pos != std::string::npos && pos + 1 < id.size()) {
      try {
        return std::stoi(id.substr(pos + 1));
      } catch (const std::exception &) {
        return 0;
      }
    }
    return 0;
  }
};

} // namespace aodt::config
