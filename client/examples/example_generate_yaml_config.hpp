// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#pragma once
#include "aodt_config.hpp"
#include <iostream>
#include <string>

using aodt::config::AntennaElement;
using aodt::config::DBTable;
using aodt::config::defaultRadiatedPowerDbmRU;
using aodt::config::defaultRadiatedPowerDbmUE;
using aodt::config::defaultSubcarrierSpacing;
using aodt::config::DiffusionModel;
using aodt::config::DU;
using aodt::config::Nodes;
using aodt::config::Panel;
using aodt::config::Position;
using aodt::config::RU;
using aodt::config::SimConfig;
using aodt::config::SimMode;
using aodt::config::UE;

/**
 * @brief Generates an example AODT simulation YAML configuration as a string.
 *
 * @param scene_url The scene URL (relative to assets home or full omniverse
 * URL).
 * @param asset_config The path to the asset configuration file (contains asset
 * paths).
 * @param sim_id The simulation ID (used as DB name and identifier).
 * @param output_file The path to save the generated YAML file.
 * @param yaml_string The output string containing the generated YAML.
 * @throws std::runtime_error on failure to generate config
 */
void genExampleYamlString(const std::string &scene_url,
                          const std::string &asset_config,
                          const std::string &sim_id,
                          const std::string &output_file,
                          std::string &yaml_string) {
  SimConfig config(scene_url, SimMode::EM, asset_config);
  config.setSimulationID(sim_id);
  config.setDB("localhost", 9000, "aerial");

  // 2. Set simulation parameters
  config.setNumBatches(1);
  config.setTimeline(std::nullopt, std::nullopt, 3, 1);
  config.setSeed(0); // Seeding enabled. If random deployment is desired, do not
  // call this function.
  // 2.1. Optional for advanced users
  // Tables to save in the DB. By default, only CIRS is saved.
  config.addTableToDb(DBTable::CIRS);
  config.addTableToDb(DBTable::CFRS);
  config.addTableToDb(DBTable::RAYPATHS);
  // Enable wideband simulation, by default it is disabled.
  config.enableWideband();
  // Enable urban mobility simulation, by default it is disabled.
  config.enableUrbanMobility(50);
  // Ray tracing model, by default it is DIRECTIONAL.
  config.setRayTracingModel(DiffusionModel::DIRECTIONAL, 5, 500, 500);

  // 3. Create RU panel
  Panel ruPanel =
      Panel::createPanel({AntennaElement::ThreeGPP38901},
                         3600,   // frequency MHz
                         0.5, 1, // vertical: 0.5λ spacing, 1 element
                         0.5, 2, // horizontal: 0.5λ spacing, 2 elements
                         true,   // dual polarized
                         -45, 45 // roll angles
      );

  // 4. Create UE panel
  Panel uePanel = Panel::createPanel({AntennaElement::InfinitesimalDipole},
                                     3600, 0.5, 2, // vertical: 2 elements
                                     0.5, 1,       // horizontal: 1 element
                                     true, -45, 45);

  // 5. Set default panels for RUs and UEs
  config.setDefaultPanelRU(ruPanel);
  config.setDefaultPanelUE(uePanel);

  // 6. Create DU, set position, then add
  DU du = Nodes::createDU(1, 3600.0, defaultSubcarrierSpacing); // duId, freq
  du.setPosition(Position::cartesian(0.0, 0.0, 100.0));         // DU position
  config.addDU(du); // Add after position configured

  // 7. Create RU, configure, then add
  RU ru =
      Nodes::createRU(1, 3600.0, defaultRadiatedPowerDbmRU, du.id()); // ruId...
  ru.setPosition(Position::georef(35.66356389841298, 139.74686323425487));
  ru.setHeight(2.5);
  ru.setMechAzimuth(0.0);
  ru.setMechTilt(0.0);
  config.addRU(ru); // Add after configuration

  RU ru2 = Nodes::createRU(2, 3600.0, defaultRadiatedPowerDbmRU, du.id());
  ru2.setPosition(Position::cartesian(150.2060449, 99.5086621, 0));
  config.addRU(ru2); // Add after configuration

  // 8. Create UE, add waypoints, then add to config
  UE ue = Nodes::createUE(1, defaultRadiatedPowerDbmUE);
  ue.addWaypoint(Position::georef(35.66376818087683, 139.7459968717682));
  ue.addWaypoint(Position::georef(35.663622296081414, 139.74622811587614));
  ue.addWaypoint(Position::georef(35.66362516562424, 139.74653110368598));
  config.addUE(ue); // Add after waypoints configured

  UE ue2 = Nodes::createUE(2, defaultRadiatedPowerDbmUE);
  ue2.addWaypoint(Position::cartesian(150.2060449, 99.5086621, 0));
  config.addUE(ue2); // Add after waypoints configured

  // 9. Configure spawn zone for procedural UEs (CCW polygon)
  config.addSpawnZone(
      {Position::georef(35.659246045102776, 139.7447971347694),
       Position::georef(35.658433940152484, 139.7464869752049),
       Position::georef(35.659584050861596, 139.74790935897965),
       Position::georef(35.660768917135265, 139.74561467296084)});

  // 10. Enable procedural UEs and urban mobility
  config.setNumProceduralUEs(1);
  config.setPercIndoorProceduralUEs(0.0);
  config.enableUrbanMobility(50); // 50 vehicles

  // 11. Generate YAML
  try {
    if (output_file.empty()) {
      std::cout << "output_file is empty, generating YAML string..."
                << std::endl;
      yaml_string = config.toYamlString();
      std::cout << "YAML string generated successfully" << std::endl;
    } else {
      std::cout << "output_file is not empty, saving YAML to file: "
                << output_file << std::endl;
      config.toYaml(output_file);
      std::cout << "YAML saved to file: " << output_file << std::endl;
    }
  } catch (const std::exception &e) {
    std::cerr << "Error: " << e.what() << std::endl;
    throw std::runtime_error("Error: " + std::string(e.what()));
  }
}
