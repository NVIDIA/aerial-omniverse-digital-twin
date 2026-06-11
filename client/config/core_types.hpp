// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

// AODT Config - Core Types (enums, constants, value layer, position)

#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace aodt::config {

//=============================================================================
// Simulation Configuration Enums
//=============================================================================

/**
 * @brief Simulation mode
 */
enum class SimMode {
  EM, ///< EM mode
  RAN ///< RAN mode (must be slots/symbols based)
};

/**
 * @brief Tables to save in the DB
 */
enum class DBTable {
  CIRS,     ///< Channel Impulse Response
  CFRS,     ///< Channel Frequency Response
  RAYPATHS, ///< Raypaths
  TELEMETRY ///< Telemetry
};

inline std::string DBTableToString(DBTable table) {
  switch (table) {
  case DBTable::CIRS:
    return "cirs";
  case DBTable::CFRS:
    return "cfrs";
  case DBTable::RAYPATHS:
    return "raypaths";
  case DBTable::TELEMETRY:
    return "telemetry";
  default:
    throw std::invalid_argument("Unknown table to save in the DB");
  }
}

/**
 * @brief Target geometry type for material operations
 */
enum class GeoTargets {
  BLDG, ///< Building materials (sim.Materials)
  VEG   ///< Vegetation materials (sim.VegetationMaterials)
};

/**
 * @brief EM diffusion model for ray tracing
 */
enum class DiffusionModel {
  LAMBERTIAN = 0, ///< Lambertian diffusion
  DIRECTIONAL = 1 ///< Directional diffusion
};

//=============================================================================
// Default Values as Constants
//=============================================================================
inline constexpr int defaultPanelRU = 2;
inline constexpr int defaultPanelUE = 1;
inline constexpr double defaultRadiatedPowerDbmRU = 43.0;
inline constexpr double defaultRadiatedPowerDbmUE = 26.0;
inline constexpr double defaultCarrierFreqMHz = 3600.0;

// General Constants
inline constexpr double SPEED_OF_LIGHT_M_S = 299792458.0;

// Scenario Defaults
inline constexpr double defaultDuration = 1.0;
inline constexpr double defaultInterval = 1.0;
inline constexpr int defaultSlotsPerBatch = 1;
inline constexpr int defaultSymbolsPerSlot = 1;
inline constexpr int defaultSeed = 0;
inline constexpr int defaultNumVehicles = 0;
inline constexpr int defaultNumProceduralUEs = 0;
inline constexpr double defaultPercIndoorProceduralUEs = 0.0;
inline constexpr DiffusionModel defaultDiffuseType = DiffusionModel::LAMBERTIAN;
inline constexpr int defaultInteractions = 5;
inline constexpr int defaultMaxNumPathsPerAntPair = 500;
inline constexpr int defaultEmittedRaysInThousands = 500;

// Panel Defaults
inline constexpr double defaultVerticalSpacingWavelengths = 0.5;
inline constexpr int defaultVerticalNumElements = 1;
inline constexpr double defaultHorizontalSpacingWavelengths = 0.5;
inline constexpr int defaultHorizontalNumElements = 2;
inline constexpr bool defaultDualPolarized = true;
inline constexpr double defaultRollFirstPolElement = 0.0;
inline constexpr double defaultRollSecondPolElement = 90.0;

// DU Defaults
inline constexpr int defaultNumAntennasDU = 4;
inline constexpr int defaultFftSize = 4096;
inline constexpr double defaultSubcarrierSpacing = 30.0;
inline constexpr double defaultMaxChannelBandwidth = 100.0;

// RU Defaults
inline constexpr int defaultDuId = 1;
inline constexpr double defaultRUHeight = 2.5;
inline constexpr double defaultRUMechAzimuth = 0.0;
inline constexpr double defaultRUMechTilt = 0.0;
inline constexpr bool defaultRUDUManualAssign = true;

// UE Defaults
inline constexpr int maxUEId = 10000;
inline constexpr bool defaultUeIsManual = true;
inline constexpr double defaultBlerTarget = 0.1;
inline constexpr double defaultUEInitialMechAzimuth = 0.0;
inline constexpr double defaultUEMechTilt = 0.0;

// SimConfig Defaults
inline constexpr const char *defaultChannelModelStr = "cirs";
inline constexpr const char *defaultDbAuthor = "aerial";
inline constexpr bool defaultSaveToDB = true;
inline constexpr int initialPanelId = 3;
inline constexpr int initialRUId = 1;
inline constexpr int initialUEId = 1;
inline constexpr const char *defaultSceneUrl = "test_data/maps/tokyo";
//=============================================================================
// Neutral Value Layer (Decoupled from yaml-cpp)
//=============================================================================

struct AttributeValue;

using AttributeMap = std::map<std::string, AttributeValue>;
using AttributeList = std::vector<AttributeValue>;

struct AttributeValue {
  using variant_type = std::variant<std::monostate, bool, std::int64_t, double,
                                    std::string, AttributeList, AttributeMap>;

  variant_type value{};

  AttributeValue() = default;
  AttributeValue(const AttributeValue &) = default;
  AttributeValue(AttributeValue &&) noexcept = default;
  AttributeValue &operator=(const AttributeValue &) = default;
  AttributeValue &operator=(AttributeValue &&) noexcept = default;

  // Scalar overloads (prefer a single integer alternative: int64_t)
  explicit AttributeValue(bool v) noexcept : value(v) {}
  explicit AttributeValue(std::int8_t v) noexcept
      : value(static_cast<std::int64_t>(v)) {}
  explicit AttributeValue(std::int16_t v) noexcept
      : value(static_cast<std::int64_t>(v)) {}
  explicit AttributeValue(std::int32_t v) noexcept
      : value(static_cast<std::int64_t>(v)) {}
  explicit AttributeValue(std::int64_t v) noexcept : value(v) {}
  explicit AttributeValue(unsigned int v) noexcept
      : value(static_cast<std::int64_t>(v)) {}
  explicit AttributeValue(std::uint64_t v)
      : value(v > INT64_MAX ? throw std::overflow_error(
                                  "uint64_t value too large for int64_t")
                            : static_cast<std::int64_t>(v)) {}
  explicit AttributeValue(float v) noexcept : value(static_cast<double>(v)) {}
  explicit AttributeValue(double v) noexcept : value(v) {}
  explicit AttributeValue(const char *s) : value(std::string(s)) {}
  explicit AttributeValue(std::string s) : value(std::move(s)) {}
  explicit AttributeValue(std::string_view sv) : value(std::string(sv)) {}

  // Container overloads
  explicit AttributeValue(AttributeList list) : value(std::move(list)) {}
  explicit AttributeValue(AttributeMap map) : value(std::move(map)) {}

  // Convenience: vector<double> -> AttributeList
  explicit AttributeValue(const std::vector<double> &vec) {
    AttributeList list;
    list.reserve(vec.size());
    for (double d : vec) {
      list.emplace_back(d);
    }
    value = std::move(list);
  }

  // Convenience: vector<int> / vector<int64_t> -> AttributeList
  explicit AttributeValue(const std::vector<int> &vec) {
    AttributeList list;
    list.reserve(vec.size());
    for (int x : vec) {
      list.emplace_back(static_cast<std::int64_t>(x));
    }
    value = std::move(list);
  }
  explicit AttributeValue(const std::vector<std::int64_t> &vec) {
    AttributeList list;
    list.reserve(vec.size());
    for (std::int64_t x : vec) {
      list.emplace_back(x);
    }
    value = std::move(list);
  }

  // Intentionally no catch-all templated constructor to avoid ambiguity

  bool isMap() const noexcept {
    return std::holds_alternative<AttributeMap>(value);
  }
  bool isList() const noexcept {
    return std::holds_alternative<AttributeList>(value);
  }
  bool isScalar() const noexcept { return !isMap() && !isList(); }
};

//=============================================================================
// Position and Waypoint Structures
//=============================================================================

/**
 * @brief Position in 2D/3D space (georeferenced or Cartesian)
 *
 * Can represent either:
 * - Georeferenced: latitude/longitude coordinates, optional altitude
 * - Cartesian: x/y coordinates in meters, optional z
 *
 * Use factory methods to create:
 * - Position::georef(lat, lon, alt)
 * - Position::cartesian(x, y, z)
 */
struct Position {
  std::optional<double> lat, lon, alt;
  std::optional<double> x, y, z;

  [[nodiscard]] bool isGeoref() const {
    return lat.has_value() && lon.has_value() && !x.has_value() &&
           !y.has_value() && !z.has_value();
  }
  [[nodiscard]] bool isCartesian() const {
    return x.has_value() && y.has_value() && !lat.has_value() &&
           !lon.has_value() && !alt.has_value();
  }

  [[nodiscard]] int dim() const {
    const bool hasGeorefCoord =
        lat.has_value() || lon.has_value() || alt.has_value();
    const bool hasCartesianCoord =
        x.has_value() || y.has_value() || z.has_value();

    if (hasGeorefCoord && hasCartesianCoord) {
      throw std::logic_error(
          "Position cannot mix georeferenced and Cartesian coordinates");
    }
    if (hasGeorefCoord) {
      if (!lat.has_value() || !lon.has_value()) {
        throw std::logic_error("Georeferenced Position requires lat and lon");
      }
      return alt.has_value() ? 3 : 2;
    }
    if (hasCartesianCoord) {
      if (!x.has_value() || !y.has_value()) {
        throw std::logic_error("Cartesian Position requires x and y");
      }
      return z.has_value() ? 3 : 2;
    }
    throw std::logic_error("Position is empty");
  }

  /**
   * @brief Create georeferenced position
   * @param lat Latitude in degrees
   * @param lon Longitude in degrees
   * @param alt Optional altitude
   * @return Position with lat/lon set
   */
  [[nodiscard]] static Position
  georef(double lat, double lon, std::optional<double> alt = std::nullopt) {
    Position p;
    p.lat = lat;
    p.lon = lon;
    p.alt = alt;
    return p;
  }

  /**
   * @brief Create Cartesian position
   * @param x X coordinate in meters
   * @param y Y coordinate in meters
   * @param z Optional Z coordinate in meters
   * @return Position with x/y set
   */
  [[nodiscard]] static Position
  cartesian(double x, double y, std::optional<double> z = std::nullopt) {
    Position p;
    p.x = x;
    p.y = y;
    p.z = z;
    return p;
  }

  [[nodiscard]] AttributeMap toAttributeMap() const {
    const int positionDim = dim();
    AttributeMap attrs;
    if (isGeoref()) {
      attrs["lat"] = AttributeValue{*lat};
      attrs["lon"] = AttributeValue{*lon};
      if (positionDim == 3) {
        attrs["alt"] = AttributeValue{*alt};
      }
    } else if (isCartesian()) {
      attrs["x"] = AttributeValue{*x};
      attrs["y"] = AttributeValue{*y};
      if (positionDim == 3) {
        attrs["z"] = AttributeValue{*z};
      }
    }
    return attrs;
  }
};

struct Waypoint {
  Position position;
  double speed{0.0};
  double pauseDuration{0.0};
  double azimuthOffset{0.0};

  [[nodiscard]] AttributeMap toAttributeMap() const {
    AttributeMap attrs;
    attrs["pos"] = AttributeValue{position.toAttributeMap()};
    attrs["speed"] = AttributeValue{speed};
    attrs["pause_duration"] = AttributeValue{pauseDuration};
    attrs["azimuth_offset"] = AttributeValue{azimuthOffset};
    return attrs;
  }
};

//=============================================================================
// Antenna Element Enum
//=============================================================================

/**
 * @brief Antenna element types for panel configuration
 */
enum class AntennaElement {
  Isotropic,           ///< Isotropic antenna
  InfinitesimalDipole, ///< Infinitesimal dipole
  HalfwaveDipole,      ///< Half-wave dipole
  RecMicrostripPatch,  ///< Rectangular microstrip patch
  ThreeGPP38901,       ///< 3GPP 38.901 antenna model
  PolarizedIsotropic   ///< Polarized isotropic antenna
};

inline std::string antennaElementToString(AntennaElement elem) {
  switch (elem) {
  case AntennaElement::Isotropic:
    return "isotropic";
  case AntennaElement::InfinitesimalDipole:
    return "infinitesimal_dipole";
  case AntennaElement::HalfwaveDipole:
    return "halfwave_dipole";
  case AntennaElement::RecMicrostripPatch:
    return "rec_microstrip_patch";
  case AntennaElement::ThreeGPP38901:
    return "threeGPP_38901";
  case AntennaElement::PolarizedIsotropic:
    return "polarized_isotropic";
  default:
    throw std::invalid_argument("Unknown antenna element");
  }
}

//=============================================================================
// UpdateGroup Template
//=============================================================================

template <typename T_Id> struct UpdateGroup {
  std::vector<T_Id> ids; // Empty = "*" (or numeric IDs as strings)
  AttributeMap attributes;
};

} // namespace aodt::config
