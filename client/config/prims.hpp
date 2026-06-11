// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

// AODT Config - Domain Objects (Prims): Scenario, Panel, DU, RU, UE, etc.

#pragma once

#include "core_types.hpp"

namespace aodt::config {

class Nodes;

//=============================================================================
// Domain Objects (Prims) - Pure C++, No YAML Dependency
//=============================================================================

// Scenario Prim (Singleton - holds global simulation settings)
class Scenario {
public:
  Scenario() = default;

  // special handling: no ids for Scenario
  void addAttributeUpdateGroup(const AttributeMap &attrs) {
    m_updates.emplace_back(UpdateGroup<int>{{}, attrs});
  }

  /**
   * @brief ID of the panel registered as the default RU panel
   *        (i.e. the value of `sim_gnb_panel_type`).
   *
   * Returns the integer id only — call `SimConfig::getPanel(id)` to
   * access the panel object. The field is initialized to
   * `defaultPanelRU` (= 2) before any panel is registered, so a non-zero
   * return value does not by itself imply that a Panel with that id
   * exists in the config yet.
   */
  [[nodiscard]] int getDefaultRUPanelId() const { return m_defaultPanelRU; }

  /**
   * @brief ID of the panel registered as the default UE panel
   *        (i.e. the value of `sim_ue_panel_type`).
   *
   * @see getDefaultRUPanelId for caveats on default initialization.
   */
  [[nodiscard]] int getDefaultUEPanelId() const { return m_defaultPanelUE; }

  [[nodiscard]] AttributeMap toAttributeMap() const {
    AttributeMap attrs;

    // Simulation mode settings (field names match ScenarioPrim)
    attrs["sim_is_full"] = AttributeValue{m_isFullSim};
    attrs["sim_simulation_mode"] = AttributeValue{m_simulationMode};
    attrs["sim_batches"] = AttributeValue{m_batches};

    // Timeline: duration/interval mode
    if (m_duration) {
      attrs["sim_duration"] = AttributeValue{*m_duration};
      attrs["sim_interval"] = AttributeValue{*m_interval};
    }
    // Timeline: slots/symbols mode
    if (m_slotsPerBatch) {
      attrs["sim_slots_per_batch"] = AttributeValue{*m_slotsPerBatch};
      attrs["sim_samples_per_slot"] = AttributeValue{*m_symbolsPerSlot};
    }

    // Seeding
    if (m_isSeeded) {
      attrs["sim_is_seeded"] = AttributeValue{m_isSeeded};
      attrs["sim_seed"] = AttributeValue{m_seed};
    }

    // Default panel types
    if (m_defaultPanelRU > 0) {
      attrs["sim_gnb_panel_type"] = AttributeValue{m_defaultPanelRU};
    }
    if (m_defaultPanelUE > 0) {
      attrs["sim_ue_panel_type"] = AttributeValue{m_defaultPanelUE};
    }

    // Wideband simulation
    attrs["sim_enable_wideband"] = AttributeValue{m_enableWideband};

    // Procedural UEs
    if (m_numProceduralUEs > 0) {
      attrs["sim_num_procedural_ues"] =
          AttributeValue{std::int32_t{m_numProceduralUEs}};
      attrs["sim_perc_indoor_procedural_ues"] =
          AttributeValue{m_percIndoorProceduralUEs};
    }

    // UE speed range
    if (m_ueMinSpeed) {
      attrs["sim_ue_min_speed"] = AttributeValue{*m_ueMinSpeed};
    }
    if (m_ueMaxSpeed) {
      attrs["sim_ue_max_speed"] = AttributeValue{*m_ueMaxSpeed};
    }

    // Urban mobility
    if (m_enableUrbanMobility) {
      attrs["um_enable_urban_mobility"] = AttributeValue{true};
      attrs["sim_enable_dynamic_scattering"] =
          AttributeValue{m_enableDynamicScattering};
      attrs["um_num_vehicles"] = AttributeValue{std::int32_t{m_numVehicles}};
    }

    // EM solver settings
    attrs["sim_em_diffuse_type"] = AttributeValue{m_diffuseType};
    attrs["sim_em_interactions"] = AttributeValue{m_interactions};
    attrs["sim_em_max_num_paths_per_ant_pair"] =
        AttributeValue{m_maxNumPathsPerAntPair};
    attrs["sim_em_rays"] = AttributeValue{m_emittedRaysInThousands};
    attrs["sim_em_fast_mode"] = AttributeValue{m_fastMode};

    return attrs;
  }
  [[nodiscard]] const std::vector<UpdateGroup<int>> &updates() const {
    return m_updates;
  }

  void validateGeneratedImport() const {
    if (m_simulationMode != 0 && m_simulationMode != 1) {
      throw std::runtime_error(
          "Scenario sim_simulation_mode must be 0 or 1 in YAML import");
    }
    if (m_batches <= 0) {
      throw std::runtime_error(
          "Scenario sim_batches must be positive in YAML import");
    }
    if (m_simulationMode == 0) {
      if (!m_duration.has_value() || !m_interval.has_value() ||
          *m_duration <= 0.0 || *m_interval <= 0.0) {
        throw std::runtime_error("Scenario duration/interval timeline requires "
                                 "positive sim_duration "
                                 "and sim_interval in YAML import");
      }
    } else {
      if (!m_slotsPerBatch.has_value() || !m_symbolsPerSlot.has_value() ||
          *m_slotsPerBatch <= 0 ||
          (*m_symbolsPerSlot != 1 && *m_symbolsPerSlot != 14)) {
        throw std::runtime_error(
            "Scenario slots/samples timeline requires positive "
            "sim_slots_per_batch and sim_samples_per_slot of 1 or 14 in YAML "
            "import");
      }
    }
    if (m_isFullSim && m_simulationMode != 1) {
      throw std::runtime_error(
          "Scenario sim_is_full=true requires sim_simulation_mode=1 in YAML "
          "import");
    }
  }

private:
  friend class SimConfig;
  friend class Nodes;

  // Simulation mode settings
  bool m_isFullSim{false};
  int m_simulationMode{0};
  int m_batches{1};
  std::optional<double> m_duration{defaultDuration};
  std::optional<double> m_interval{defaultInterval};
  std::optional<int> m_slotsPerBatch{defaultSlotsPerBatch};
  std::optional<int> m_symbolsPerSlot{defaultSymbolsPerSlot};

  // Seeding
  bool m_isSeeded{false};
  int m_seed{defaultSeed};

  // Channel model
  bool m_enableWideband{false};

  // Urban mobility
  int m_numVehicles{defaultNumVehicles};
  bool m_enableUrbanMobility{false};
  bool m_enableDynamicScattering{false};

  // Procedural UEs
  int m_numProceduralUEs{defaultNumProceduralUEs};
  double m_percIndoorProceduralUEs{defaultPercIndoorProceduralUEs};

  // UE speed range (procedural UE generation)
  std::optional<double> m_ueMinSpeed;
  std::optional<double> m_ueMaxSpeed;

  // Default panels
  int m_defaultPanelRU{defaultPanelRU};
  int m_defaultPanelUE{defaultPanelUE};

  // Ray tracing model
  int m_diffuseType{static_cast<int>(defaultDiffuseType)};
  int m_interactions{defaultInteractions};
  int m_maxNumPathsPerAntPair{defaultMaxNumPathsPerAntPair};
  int m_emittedRaysInThousands{defaultEmittedRaysInThousands};
  bool m_fastMode{false};

  std::vector<UpdateGroup<int>> m_updates;
};

/**
 * @brief Antenna panel configuration
 *
 * Represents an antenna array panel with configurable elements, spacing, and
 * polarization. Typically created via the static Panel::createPanel (C++) or
 * Panel.create_panel (Python) factory functions.
 *
 * @note Spacing is specified in wavelengths and automatically converted to
 * meters
 * @note Number of antennas = vertical * horizontal * (dual_polarized ? 2 : 1)
 */
class Panel {
public:
  //=========================================================================
  // Built-in pattern name constants (Python: Panel.ThreeGPP38901 etc.)
  //=========================================================================
  static inline const std::string ISOTROPIC{"isotropic"};
  static inline const std::string INFINITESIMAL_DIPOLE{"infinitesimal_dipole"};
  static inline const std::string HALFWAVE_DIPOLE{"halfwave_dipole"};
  static inline const std::string REC_MICROSTRIP_PATCH{"rec_microstrip_patch"};
  static inline const std::string THREE_GPP_38901{"threeGPP_38901"};
  static inline const std::string POLARIZED_ISOTROPIC{"polarized_isotropic"};

  /**
   * @brief Construct panel with antenna configuration (string-based names).
   */
  explicit Panel(
      const std::vector<std::string> &antennaNames = {HALFWAVE_DIPOLE},
      double frequencyMHz = defaultCarrierFreqMHz,
      double verticalSpacingWavelengths = defaultVerticalSpacingWavelengths,
      int verticalNumElements = defaultVerticalNumElements,
      double horizontalSpacingWavelengths = defaultHorizontalSpacingWavelengths,
      int horizontalNumElements = defaultHorizontalNumElements,
      bool dualPolarized = defaultDualPolarized,
      double rollFirstPolElement = defaultRollFirstPolElement,
      double rollSecondPolElement = defaultRollSecondPolElement)
      : m_antennaNames(antennaNames), m_frequencyMHz(frequencyMHz),
        m_verticalSpacingMM(verticalSpacingWavelengths),
        m_verticalNumElements(verticalNumElements),
        m_horizontalSpacingMM(horizontalSpacingWavelengths),
        m_horizontalNumElements(horizontalNumElements),
        m_dualPolarized(dualPolarized),
        m_rollFirstPolElement(rollFirstPolElement),
        m_rollSecondPolElement(rollSecondPolElement) {
    // validate() is unit-agnostic for the spacing fields (it only checks
    // > 0), so it is safe to run before the wavelength->mm conversion.
    validate();
    const double wavelengthM = SPEED_OF_LIGHT_M_S / (m_frequencyMHz * 1e6);
    m_verticalSpacingMM =
        m_verticalSpacingMM * wavelengthM * 1000.0; // Convert to millimeters
    m_horizontalSpacingMM =
        m_horizontalSpacingMM * wavelengthM * 1000.0; // Convert to millimeters
  }

  /**
   * @brief Factory: create a Panel from enum-based antenna elements.
   * Backward-compatible overload.
   */
  static Panel
  createPanel(const std::vector<AntennaElement> &antennaElements,
              double frequencyMHz,
              double verticalSpacing = defaultVerticalSpacingWavelengths,
              int verticalNum = defaultVerticalNumElements,
              double horizontalSpacing = defaultHorizontalSpacingWavelengths,
              int horizontalNum = defaultHorizontalNumElements,
              bool dualPolarized = defaultDualPolarized,
              double rollFirst = defaultRollFirstPolElement,
              double rollSecond = defaultRollSecondPolElement) {
    // Convert enums to strings and delegate
    std::vector<std::string> names;
    names.reserve(antennaElements.size());
    for (const auto &elem : antennaElements) {
      names.push_back(antennaElementToString(elem));
    }
    return createPanel(names, frequencyMHz, verticalSpacing, verticalNum,
                       horizontalSpacing, horizontalNum, dualPolarized,
                       rollFirst, rollSecond);
  }

  /**
   * @brief Factory: create a Panel from string-based antenna names.
   * Names can be built-in constants (Panel::ISOTROPIC etc.) or custom
   * pattern file paths ending in .csv/.ffd.
   */
  static Panel
  createPanel(const std::vector<std::string> &antennaNames, double frequencyMHz,
              double verticalSpacing = defaultVerticalSpacingWavelengths,
              int verticalNum = defaultVerticalNumElements,
              double horizontalSpacing = defaultHorizontalSpacingWavelengths,
              int horizontalNum = defaultHorizontalNumElements,
              bool dualPolarized = defaultDualPolarized,
              double rollFirst = defaultRollFirstPolElement,
              double rollSecond = defaultRollSecondPolElement) {
    return Panel(antennaNames, frequencyMHz, verticalSpacing, verticalNum,
                 horizontalSpacing, horizontalNum, dualPolarized, rollFirst,
                 rollSecond);
  }

  /**
   * @brief Factory: create a file-based Panel from a CSV/FFD panel file.
   * All panel configuration (elements, spacing, etc.) is read from the file
   * at runtime by deploy_antennas_and_patterns. No update entry is emitted.
   */
  static Panel createPanelFromFile(const std::string &panelFilePath) {
    if (panelFilePath.empty()) {
      throw std::invalid_argument("Panel file path must not be empty");
    }
    Panel p(FileBasedTag{}, panelFilePath);
    return p;
  }

  [[nodiscard]] int id() const { return m_id; }
  [[nodiscard]] double frequency() const { return m_frequencyMHz; }
  [[nodiscard]] int numAntennas() const {
    return m_verticalNumElements * m_horizontalNumElements *
           (m_dualPolarized ? 2 : 1);
  }
  [[nodiscard]] int verticalNumElements() const {
    return m_verticalNumElements;
  }
  [[nodiscard]] int horizontalNumElements() const {
    return m_horizontalNumElements;
  }
  [[nodiscard]] bool dualPolarized() const { return m_dualPolarized; }
  [[nodiscard]] bool isFileBased() const { return m_isFileBased; }
  [[nodiscard]] const std::string &panelFile() const { return m_panelFile; }

  /**
   * @brief Replace the antenna element list (enum-typed convenience).
   *
   * Re-runs the full panel invariant check so the new list is consistent
   * with the current (vert * horz * dualPol) array shape.
   *
   * @throws std::logic_error if the panel is file-based.
   */
  void setAntennaElements(const std::vector<AntennaElement> &elements) {
    std::vector<std::string> names;
    names.reserve(elements.size());
    for (const auto &e : elements) {
      names.push_back(antennaElementToString(e));
    }
    setAntennaElements(std::move(names));
  }

  /**
   * @brief Replace the antenna element list (string-typed).
   *
   * @throws std::logic_error if the panel is file-based.
   * @throws std::invalid_argument on empty names or size/shape mismatch.
   */
  void setAntennaElements(std::vector<std::string> names) {
    if (m_isFileBased) {
      throw std::logic_error(
          "setAntennaElements is not valid on a file-based panel");
    }
    // Strong exception guarantee: validate against the candidate; if
    // validate() throws, restore the original list before propagating.
    m_antennaNames.swap(names);
    try {
      validate();
    } catch (...) {
      m_antennaNames.swap(names);
      throw;
    }
  }

  /**
   * @brief Update the panel reference frequency in MHz.
   *
   * Does not change the stored mm-spacing: a real panel has a fixed
   * physical element spacing and only its wavelength ratio changes with
   * frequency. To re-derive spacing from a new wavelength ratio, call
   * setSpacingWavelengths() afterwards.
   *
   * @throws std::logic_error if the panel is file-based.
   * @throws std::invalid_argument if @p mhz <= 0.
   */
  void setFrequency(double mhz) {
    if (m_isFileBased) {
      throw std::logic_error("setFrequency is not valid on a file-based panel");
    }
    if (mhz <= 0) {
      throw std::invalid_argument("Panel frequency must be positive");
    }
    m_frequencyMHz = mhz;
  }

  /**
   * @brief Update element spacings, expressed in wavelengths at the
   *        current reference frequency. Stored internally as mm.
   *
   * @throws std::logic_error if the panel is file-based.
   * @throws std::invalid_argument if either spacing is non-positive.
   */
  void setSpacingWavelengths(double verticalWavelengths,
                             double horizontalWavelengths) {
    if (m_isFileBased) {
      throw std::logic_error(
          "setSpacingWavelengths is not valid on a file-based panel");
    }
    if (verticalWavelengths <= 0 || horizontalWavelengths <= 0) {
      throw std::invalid_argument("Spacing must be positive");
    }
    const double wavelengthM = SPEED_OF_LIGHT_M_S / (m_frequencyMHz * 1e6);
    m_verticalSpacingMM = verticalWavelengths * wavelengthM * 1000.0;
    m_horizontalSpacingMM = horizontalWavelengths * wavelengthM * 1000.0;
  }

  /**
   * @brief Update the array shape (vertical x horizontal element counts).
   *
   * Re-runs the full panel invariant check.
   *
   * @throws std::logic_error if the panel is file-based.
   * @throws std::invalid_argument on non-positive counts or
   *         antennaNames-vs-shape mismatch.
   */
  void setPanelSize(int verticalNum, int horizontalNum, bool dualPolarized) {
    if (m_isFileBased) {
      throw std::logic_error(
          "setNumElements is not valid on a file-based panel");
    }
    // Strong exception guarantee.
    const int oldV = m_verticalNumElements;
    const int oldH = m_horizontalNumElements;
    const bool oldD = m_dualPolarized;
    m_verticalNumElements = verticalNum;
    m_horizontalNumElements = horizontalNum;
    m_dualPolarized = dualPolarized;
    try {
      validate();
    } catch (...) {
      m_verticalNumElements = oldV;
      m_horizontalNumElements = oldH;
      m_dualPolarized = oldD;
      throw;
    }
  }

  /**
   * @brief Set the polarization roll angles in degrees.
   *
   * @throws std::logic_error if the panel is file-based.
   */
  void setRollAngles(double firstDeg, double secondDeg) {
    if (m_isFileBased) {
      throw std::logic_error(
          "setRollAngles is not valid on a file-based panel");
    }
    m_rollFirstPolElement = firstDeg;
    m_rollSecondPolElement = secondDeg;
  }

  [[nodiscard]] AttributeMap toAttributeMap() const {
    AttributeMap attrs;

    // Antenna element names from string storage
    AttributeList elemList;
    for (const auto &name : m_antennaNames) {
      elemList.emplace_back(name);
    }
    attrs["antenna_names"] = AttributeValue{std::move(elemList)};
    attrs["reference_freq_mhz"] = AttributeValue{m_frequencyMHz};
    attrs["antenna_spacing_vert_mm"] = AttributeValue{m_verticalSpacingMM};
    attrs["num_loc_antenna_vert"] =
        AttributeValue{std::int64_t{m_verticalNumElements}};
    attrs["antenna_spacing_horz_mm"] = AttributeValue{m_horizontalSpacingMM};
    attrs["num_loc_antenna_horz"] =
        AttributeValue{std::int64_t{m_horizontalNumElements}};
    attrs["dual_polarized"] = AttributeValue{m_dualPolarized};
    attrs["antenna_roll_angle_first_polz_degree"] =
        AttributeValue{m_rollFirstPolElement};
    attrs["antenna_roll_angle_second_polz_degree"] =
        AttributeValue{m_rollSecondPolElement};

    return attrs;
  }

  using id_type = int;

private:
  friend class SimConfig;
  void assignId(int id) { m_id = id; }

  /**
   * @brief Check all spec-panel invariants. No-op for file-based panels.
   *
   * Unit-agnostic for the spacing fields (only checks > 0), so it is
   * safe to call before or after the constructor's wavelength->mm
   * conversion.
   */
  void validate() const {
    if (m_isFileBased) {
      return; // file-based panels read every spec field at deploy time
    }
    if (m_frequencyMHz <= 0) {
      throw std::invalid_argument("Panel frequency must be positive");
    }
    if (m_verticalNumElements <= 0 || m_horizontalNumElements <= 0) {
      throw std::invalid_argument("Number of elements must be positive");
    }
    if (m_verticalSpacingMM <= 0 || m_horizontalSpacingMM <= 0) {
      throw std::invalid_argument("Spacing must be positive");
    }
    for (const auto &name : m_antennaNames) {
      if (name.empty()) {
        throw std::invalid_argument("Antenna name must not be empty");
      }
    }
    const auto expectedCount = static_cast<std::size_t>(
        m_verticalNumElements * m_horizontalNumElements *
        (m_dualPolarized ? 2 : 1));
    if (m_antennaNames.size() > 1 && m_antennaNames.size() != expectedCount) {
      throw std::invalid_argument(
          "Size of 'antennaNames' must match 'verticalNum' * "
          "'horizontalNum' * ('dualPolarized' ? 2 : 1) when 'antennaNames' "
          "has more than 1 element.");
    }
  }

  // Private tag-based constructor for createPanelFromFile
  struct FileBasedTag {};
  Panel(FileBasedTag, std::string panelFilePath)
      : m_panelFile(std::move(panelFilePath)), m_isFileBased(true) {}

  int m_id{0};
  std::vector<std::string> m_antennaNames{HALFWAVE_DIPOLE};
  double m_frequencyMHz{defaultCarrierFreqMHz};
  double m_verticalSpacingMM{defaultVerticalSpacingWavelengths};
  int m_verticalNumElements{defaultVerticalNumElements};
  double m_horizontalSpacingMM{defaultHorizontalSpacingWavelengths};
  int m_horizontalNumElements{defaultHorizontalNumElements};
  bool m_dualPolarized{defaultDualPolarized};
  double m_rollFirstPolElement{defaultRollFirstPolElement};
  double m_rollSecondPolElement{defaultRollSecondPolElement};

  // File-based panel support
  std::string m_panelFile{};
  bool m_isFileBased{false};
};

class DU {
public:
  explicit DU(int duId, double frequencyMHz = defaultCarrierFreqMHz,
              double subcarrierSpacingMHz = defaultSubcarrierSpacing)
      : m_frequencyMHz(frequencyMHz), m_duId(duId),
        m_subcarrierSpacing(subcarrierSpacingMHz) {
    if (frequencyMHz <= 0)
      throw std::invalid_argument("DU frequency must be positive");
    if (duId <= 0)
      throw std::invalid_argument("DU ID must be positive");
    if (subcarrierSpacingMHz <= 0)
      throw std::invalid_argument("DU subcarrier spacing must be positive");
  }

  void setPosition(Position position) { m_position = position; }

  using id_type = int;

  void setFFTSize(int size) { m_fftSize = size; }
  void setMaxChannelBandwidth(double bw) { m_maxChannelBandwidth = bw; }
  void setNumAntennas(int numAntennas) { m_numAntennas = numAntennas; }

  /**
   * @brief Update the DU reference frequency in MHz.
   *
   * Affects only this DU's emitted aerial_du_reference_freq.
   * Frequencies of associated RUs are independent and must be updated
   * separately with RU::setFrequency if the deployment expects them
   * to track.
   *
   * @throws std::invalid_argument if @p mhz <= 0.
   */
  void setFrequency(double mhz) {
    if (mhz <= 0) {
      throw std::invalid_argument("DU frequency must be positive");
    }
    m_frequencyMHz = mhz;
  }

  [[nodiscard]] int id() const { return m_duId; }
  [[nodiscard]] double frequency() const { return m_frequencyMHz; }
  [[nodiscard]] std::optional<Position> position() const { return m_position; }

  [[nodiscard]] AttributeMap toAttributeMap() const {
    AttributeMap attrs;
    // Field names match DUPrim
    attrs["aerial_du_reference_freq"] = AttributeValue{m_frequencyMHz};
    attrs["aerial_du_num_antennas"] =
        AttributeValue{std::int32_t{m_numAntennas}};
    attrs["aerial_du_fft_size"] = AttributeValue{std::int32_t{m_fftSize}};
    attrs["aerial_du_subcarrier_spacing"] = AttributeValue{m_subcarrierSpacing};
    attrs["aerial_du_max_channel_bandwidth"] =
        AttributeValue{m_maxChannelBandwidth};
    return attrs;
  }

private:
  friend class SimConfig;
  friend class Nodes;
  int m_duId;
  double m_frequencyMHz{defaultCarrierFreqMHz};
  int m_numAntennas{defaultNumAntennasDU};
  std::optional<Position> m_position;
  int m_fftSize{defaultFftSize};
  double m_subcarrierSpacing{defaultSubcarrierSpacing};
  double m_maxChannelBandwidth{defaultMaxChannelBandwidth};
};

class RU {
public:
  explicit RU(int ruId) : m_ruId(ruId) {}

  void setPosition(Position position) { m_position = position; }
  void setHeight(double heightM) { m_height = heightM; }
  void setRadiatedPower(double powerdBm) { m_radiatedPowerDbm = powerdBm; }
  void setMechAzimuth(double deg) { m_mechAzimuth = deg; }
  void setMechTilt(double deg) { m_mechTilt = deg; }

  /**
   * @brief Update the RU carrier frequency in MHz.
   *
   * Affects only this RU's emitted aerial_gnb_carrier_freq. The
   * associated DU's frequency is independent and not modified.
   *
   * @throws std::invalid_argument if @p mhz <= 0.
   */
  void setFrequency(double mhz) {
    if (mhz <= 0) {
      throw std::invalid_argument("RU frequency must be positive");
    }
    m_frequencyMHz = mhz;
  }

  void setDUManualAssign(bool manualAssign) { m_duManualAssign = manualAssign; }

  void assignPanel(const Panel &panel) {
    if (panel.id() == 0) {
      throw std::invalid_argument("Panel must have a non-zero ID (register via "
                                  "setDefaultPanel* or addPanel first)");
    }
    m_panelId = panel.id();
  }

  /**
   * @brief ID of the panel assigned to this RU.
   *
   * For an RU retrieved via `SimConfig::getRU(id)` this is always
   * non-zero: `SimConfig::addRU` resolves an unset (`0`) value to the
   * current default RU panel before storing the RU. The accessor only
   * returns 0 on a freshly constructed RU that has not yet been added.
   */
  [[nodiscard]] int panelId() const { return m_panelId; }

  using id_type = int;

  [[nodiscard]] int id() const { return m_ruId; }
  [[nodiscard]] double frequency() const { return m_frequencyMHz; }
  [[nodiscard]] int duId() const { return m_duId; }
  [[nodiscard]] std::optional<Position> position() const { return m_position; }

  [[nodiscard]] AttributeMap toAttributeMap() const {
    AttributeMap attrs;
    // Field names match RUPrim
    attrs["aerial_gnb_carrier_freq"] = AttributeValue{m_frequencyMHz};
    attrs["aerial_gnb_panel_type"] = AttributeValue{m_panelId};
    attrs["aerial_gnb_radiated_power"] = AttributeValue{m_radiatedPowerDbm};
    attrs["aerial_gnb_du_id"] = AttributeValue{std::int32_t{m_duId}};
    attrs["aerial_gnb_du_manual_assign"] = AttributeValue{m_duManualAssign};

    if (m_height)
      attrs["aerial_gnb_height"] = AttributeValue{*m_height};
    if (m_mechAzimuth)
      attrs["aerial_gnb_mech_azimuth"] = AttributeValue{*m_mechAzimuth};
    if (m_mechTilt)
      attrs["aerial_gnb_mech_tilt"] = AttributeValue{*m_mechTilt};

    return attrs;
  }

private:
  friend class SimConfig;
  friend class Nodes;

  int m_ruId{0};
  int m_panelId{0}; // 0 = unset; SimConfig resolves via Scenario default
  double m_frequencyMHz{defaultCarrierFreqMHz};
  double m_radiatedPowerDbm{defaultRadiatedPowerDbmRU};
  int m_duId{defaultDuId};
  std::optional<Position> m_position;
  std::optional<double> m_height{defaultRUHeight};
  std::optional<double> m_mechAzimuth{defaultRUMechAzimuth};
  std::optional<double> m_mechTilt{defaultRUMechTilt};
  bool m_duManualAssign{defaultRUDUManualAssign};
};

struct GPXSource {
  std::string src;
  bool usePathfinding{true};

  [[nodiscard]] AttributeMap toAttributeMap() const {
    AttributeMap m;
    m["src"] = AttributeValue{src};
    m["use_pathfinding"] = AttributeValue{usePathfinding};
    return m;
  }
};

class UE {
public:
  explicit UE(int ueId) : m_ueId(ueId) {
    if (ueId <= 0 || ueId > maxUEId)
      throw std::invalid_argument("UE ID must be in [1, 10000]");
  }

  using id_type = int;

  void addWaypoint(Position position, double speed = 0.0,
                   double pauseDuration = 0.0, double azimuthOffset = 0.0) {
    const int incoming = position.dim();
    if (m_wpDim == 0) {
      m_wpDim = incoming;
    } else if (m_wpDim != incoming) {
      throw std::invalid_argument(
          "UE " + std::to_string(m_ueId) + " waypoint dim mismatch: incoming " +
          std::to_string(incoming) + "D waypoint does not match prior " +
          std::to_string(m_wpDim) +
          "D waypoints; all waypoints must be all 2D or all 3D");
    }

    Waypoint wp;
    wp.position = position;
    wp.speed = speed;
    wp.pauseDuration = pauseDuration;
    wp.azimuthOffset = azimuthOffset;
    m_waypoints.push_back(wp);
  }

  void setBlerTarget(double target) {
    if (target < 0.0 || target > 1.0)
      throw std::invalid_argument("BLER target must be in [0, 1]");
    m_blerTarget = target;
  }

  void setManual(bool manual) { m_isManual = manual; }

  void setRadiatedPower(double powerdBm) { m_radiatedPowerDbm = powerdBm; }

  void setInitialMechAzimuth(double deg) { m_initialMechAzimuth = deg; }
  void setMechTilt(double deg) { m_mechTilt = deg; }

  void assignPanel(const Panel &panel) {
    if (panel.id() == 0) {
      throw std::invalid_argument("Panel must have a non-zero ID (register via "
                                  "setDefaultPanel* or addPanel first)");
    }
    m_panelId = panel.id();
  }

  void setGPXSource(GPXSource gpx) { m_gpxSource = std::move(gpx); }

  [[nodiscard]] const std::optional<GPXSource> &gpxSource() const {
    return m_gpxSource;
  }

  [[nodiscard]] bool hasGPX() const { return m_gpxSource.has_value(); }

  [[nodiscard]] double radiatedPowerDbm() const { return m_radiatedPowerDbm; }

  void clearWaypoints() {
    m_waypoints.clear();
    m_wpDim = 0;
  }

  [[nodiscard]] int id() const { return m_ueId; }
  [[nodiscard]] int panelId() const { return m_panelId; }
  [[nodiscard]] const std::vector<Waypoint> &waypoints() const {
    return m_waypoints;
  }
  [[nodiscard]] int wpDim() const { return m_wpDim; }

  [[nodiscard]] AttributeList waypointsAttributeList() const {
    AttributeList list;
    for (const auto &wp : m_waypoints) {
      list.emplace_back(wp.toAttributeMap());
    }
    return list;
  }

  [[nodiscard]] AttributeMap toAttributeMap() const {
    AttributeMap attrs;
    // Field names match UEPrim
    attrs["aerial_ue_panel_type"] = AttributeValue{m_panelId};
    attrs["aerial_ue_radiated_power"] = AttributeValue{m_radiatedPowerDbm};
    attrs["aerial_ue_manual"] = AttributeValue{m_isManual};

    if (m_blerTarget) {
      attrs["aerial_ue_bler_target"] = AttributeValue{*m_blerTarget};
    }

    attrs["aerial_ue_initial_mech_azimuth"] =
        AttributeValue{m_initialMechAzimuth};
    attrs["aerial_ue_mech_tilt"] = AttributeValue{m_mechTilt};

    return attrs;
  }

private:
  friend class SimConfig;
  friend class Nodes;

  int m_ueId{0};
  int m_panelId{0}; // 0 = unset; SimConfig resolves via Scenario default
  double m_radiatedPowerDbm{defaultRadiatedPowerDbmUE};
  bool m_isManual{defaultUeIsManual};
  std::vector<Waypoint> m_waypoints;
  int m_wpDim{0}; // 0 = no waypoints yet; 2 or 3 once first waypoint added
  std::optional<double> m_blerTarget{defaultBlerTarget};
  std::optional<GPXSource> m_gpxSource;
  double m_initialMechAzimuth{defaultUEInitialMechAzimuth};
  double m_mechTilt{defaultUEMechTilt};
};

class SpawnZone {
public:
  SpawnZone() = default;

  explicit SpawnZone(const std::vector<Position> &pointsCCW)
      : m_pointsCCW(pointsCCW) {}

  void addPointCCW(Position position) { m_pointsCCW.push_back(position); }

  [[nodiscard]] const std::vector<Position> &pointsCCW() const {
    return m_pointsCCW;
  }
  [[nodiscard]] bool empty() const { return m_pointsCCW.empty(); }

private:
  std::vector<Position> m_pointsCCW;
};

class Material {
public:
  using id_type = std::string;

  [[nodiscard]] static AttributeMap toAttributeMap() {
    AttributeMap attrs;
    return attrs;
  }
};

class BldgExterior {
public:
  using id_type = std::string;

  [[nodiscard]] static AttributeMap toAttributeMap() {
    AttributeMap attrs;
    return attrs;
  }
};

class BldgInterior {
public:
  using id_type = std::string;

  [[nodiscard]] static AttributeMap toAttributeMap() {
    AttributeMap attrs;
    return attrs;
  }
};

//=============================================================================
// Nodes - Stateless Factory for Network Elements
//=============================================================================

/**
 * @brief Stateless factory for creating DU, RU, and UE prims.
 *
 * This helper class provides simple, configuration-independent factory
 * functions for constructing DU, RU, and UE instances. It is intended for
 * high-level APIs (including Python bindings) where object creation is
 * separated from configuration management.
 */
class Nodes {
public:
  Nodes() = delete;

  /**
   * @brief Create a Distributed Unit (DU) with the given ID and frequency.
   *
   * The returned DU is independent of any SimConfig instance. Validation
   * that depends on panels or other topology is performed when the DU is
   * added via SimConfig::addDU.
   */
  static DU createDU(int duId, double frequencyMHz = defaultCarrierFreqMHz,
                     double subcarrierSpacingMHz = defaultSubcarrierSpacing) {
    return DU(duId, frequencyMHz, subcarrierSpacingMHz);
  }

  /**
   * @brief Create a Radio Unit (RU) with the given parameters.
   *
   * The returned RU carries the requested carrier frequency, radiated power,
   * and DU association. Validation against panels and DUs is performed when
   * the RU is added via SimConfig::addRU.
   */
  static RU createRU(int ruId, double frequencyMHz = defaultCarrierFreqMHz,
                     double radiatedPowerDbm = defaultRadiatedPowerDbmRU,
                     int duId = defaultDuId) {
    RU ru(ruId);
    ru.m_frequencyMHz = frequencyMHz;
    ru.m_radiatedPowerDbm = radiatedPowerDbm;
    ru.m_duId = duId;
    return ru;
  }

  /**
   * @brief Create a User Equipment (UE) with the given ID and radiated power.
   *
   * The returned UE is configured with the requested radiated power. It will
   * be associated with the default UE panel when added via SimConfig::addUE.
   */
  static UE createUE(int ueId,
                     double radiatedPowerDbm = defaultRadiatedPowerDbmUE) {
    UE ue(ueId);
    ue.m_radiatedPowerDbm = radiatedPowerDbm;
    return ue;
  }
};

} // namespace aodt::config
