// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

// AODT Simulation Config - High-Level Domain API (Design V3)
// Simple, intuitive API for building simulation configurations
// Decoupled from yaml-cpp - uses neutral AttributeValue layer

/**
 * @file aodt_config.hpp
 * @brief Helper library for authoring AODT simulation configuration YAML files
 *
 * This library provides a simple, type-safe API for building AODT simulation
 * configurations. It uses domain objects (Panel, DU, RU, UE) instead of raw
 * YAML attributes, making it easier to create correct configurations.
 *
 * Key features:
 * - Domain-oriented API (work with Panels, DUs, RUs, UEs)
 * - Smart defaults and validation
 * - Decoupled from YAML library (neutral AttributeValue layer)
 * - Both C++ and Python bindings available
 *
 * Example usage (C++):
 * @code
 * using namespace aodt::config;
 *
 * SimConfig config("plateau/tokyo_small.usd", SimMode::EM, "assets.yml");
 * config.setSimulationID("my_sim");
 * config.setNumBatches(1);
 * config.setTimeline(10.0, 0.1, std::nullopt, std::nullopt);
 *
 * Panel ruPanel = Panel::createPanel({AntennaElement::Isotropic}, 3600);
 * config.setDefaultPanelRU(ruPanel);
 *
 * DU du = Nodes::createDU(1, 3600);
 * du.setPosition(Position::cartesian(0, 0, 100));
 * config.addDU(du);
 *
 * config.toYaml("output.yml");
 * @endcode
 */

#pragma once

#include "core_types.hpp"
#include "prim_collections.hpp"
#include "prims.hpp"
#include "sim_config.hpp"
