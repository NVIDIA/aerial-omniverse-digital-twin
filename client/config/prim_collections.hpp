// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

// AODT Config - Asset Paths and PrimCollection

#pragma once

#include "prims.hpp"

#include <unordered_map>

namespace aodt::config {

//=============================================================================
// Asset Path Structures (Type-Safe Alternative to Maps)
//=============================================================================

/**
 * @brief Primary asset paths for simulation entities
 *
 * Type-safe structure replacing std::map<string, string> for better
 * IDE support, compile-time validation, and documentation.
 */
struct AssetPaths {
  std::string scenario;
  std::string du;
  std::string ru;
  std::string ue;
  std::string panels;
  std::string scatterers;

  AssetPaths() = default;
};

/**
 * @brief Vegetation-specific asset paths
 */
struct VegetationAssetPaths {
  std::string geojson;
  std::string vegetationAssetPath;

  VegetationAssetPaths() = default;
};

//=============================================================================
// Container Layer (Unified API for All Prims)
//=============================================================================

template <typename T_Prim> class PrimContainer {
public:
  PrimContainer() = default;
  using T_id = typename T_Prim::id_type;

  void addPrim(T_Prim prim) {
    auto id = prim.id();
    m_add.emplace(std::move(id), std::move(prim));
  }

  [[nodiscard]] T_Prim &find(const T_id &id) { return m_add.at(id); }

  [[nodiscard]] const T_Prim &find(const T_id &id) const {
    return m_add.at(id);
  }

  [[nodiscard]] bool contains(const T_id &id) const {
    return m_add.count(id) > 0;
  }

  void erase(const T_id &id) { m_add.erase(id); }

  void addAttributeUpdateGroup(const std::vector<T_id> &ids,
                               const AttributeMap &attrs) {
    m_updates.emplace_back(UpdateGroup<T_id>{ids, attrs});
  }

  [[nodiscard]] bool empty() const {
    return m_add.empty() && m_updates.empty() && m_assetPath.empty();
  }

  void setAssetPath(const std::string &path) { m_assetPath = path; }

  [[nodiscard]] const std::unordered_map<T_id, T_Prim> &prims() const {
    return m_add;
  }
  [[nodiscard]] std::unordered_map<T_id, T_Prim> &prims() { return m_add; }
  [[nodiscard]] const std::vector<UpdateGroup<T_id>> &updates() const {
    return m_updates;
  }
  [[nodiscard]] const std::string &assetPath() const { return m_assetPath; }

private:
  std::string m_assetPath;
  std::unordered_map<T_id, T_Prim> m_add;
  std::vector<UpdateGroup<T_id>> m_updates;
};

/**
 * @brief Extended container for materials with calibration file lists.
 *
 * Inherits asset path + update groups from PrimContainer<Material>.
 * Adds calibration definition/assignment file lists.
 *
 * Note: empty() intentionally hides PrimContainer<Material>::empty()
 * to include calibration state. This is safe because MaterialContainer
 * is never used polymorphically.
 */
class MaterialContainer : public PrimContainer<Material> {
public:
  void addCalibrationDefinition(const std::string &file) {
    m_calibrationDefinitions.push_back(file);
  }
  void addCalibrationAssignment(const std::string &file) {
    m_calibrationAssignments.push_back(file);
  }

  [[nodiscard]] const std::vector<std::string> &calibrationDefinitions() const {
    return m_calibrationDefinitions;
  }
  [[nodiscard]] const std::vector<std::string> &calibrationAssignments() const {
    return m_calibrationAssignments;
  }

  [[nodiscard]] bool empty() const {
    return PrimContainer<Material>::empty() &&
           m_calibrationDefinitions.empty() && m_calibrationAssignments.empty();
  }

private:
  std::vector<std::string> m_calibrationDefinitions;
  std::vector<std::string> m_calibrationAssignments;
};

} // namespace aodt::config
