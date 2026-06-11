// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "aodt_config.hpp"
#include <cassert>
#include <iostream>
#include <string>

using namespace aodt::config;

void testAttributeValue() {
  std::cout << "Testing AttributeValue..." << std::endl;

  AttributeValue nullVal;
  AttributeValue boolVal{true};
  AttributeValue intVal{std::int32_t{42}};
  AttributeValue doubleVal{3.14};
  AttributeValue strVal{std::string{"hello"}};

  AttributeList list;
  list.push_back(AttributeValue{1.0});
  list.push_back(AttributeValue{2.0});
  AttributeValue listVal{list};
  assert(listVal.isList());

  AttributeMap map;
  map["key"] = AttributeValue{std::string{"value"}};
  AttributeValue mapVal{map};
  assert(mapVal.isMap());

  std::cout << "  ✓ AttributeValue passed" << std::endl;
}

void testPosition() {
  std::cout << "Testing Position..." << std::endl;

  Position geo = Position::georef(35.66, 139.74);
  assert(geo.isGeoref());
  assert(!geo.isCartesian());

  Position cart = Position::cartesian(100.0, 200.0, 0.0);
  assert(cart.isCartesian());
  assert(!cart.isGeoref());

  auto geoAttrs = geo.toAttributeMap();
  assert(geoAttrs.size() == 2);

  std::cout << "  ✓ Position passed" << std::endl;
}

void testPanel() {
  std::cout << "Testing Panel..." << std::endl;

  Panel panel({AntennaElement::Isotropic}, 3600, 0.5, 2, 0.5, 1, true, -45, 45);

  assert(panel.frequency() == 3600);
  assert(panel.numAntennas() == 4); // 2v * 1h * 2(dual-pol)
  assert(panel.verticalNumElements() == 2);
  assert(panel.horizontalNumElements() == 1);
  assert(panel.dualPolarized());

  auto attrs = panel.toAttributeMap();
  assert(!attrs.empty());

  std::cout << "  ✓ Panel passed" << std::endl;
}

void testDU() {
  std::cout << "Testing DU..." << std::endl;

  DU du(1, 3600, 30.0); // duId, frequency
  assert(du.id() == 1);
  assert(du.frequency() == 3600);
  assert(!du.position().has_value());

  du.setPosition(Position::georef(35.66, 139.74));
  assert(du.position().has_value());
  assert(du.position()->isGeoref());

  auto attrs = du.toAttributeMap();
  assert(!attrs.empty());

  std::cout << "  ✓ DU passed" << std::endl;
}

void testRU() {
  std::cout << "Testing RU..." << std::endl;

  RU ru(1); // Just ruId
  assert(ru.id() == 1);

  ru.setPosition(Position::georef(35.66, 139.74));
  ru.setHeight(2.5);
  ru.setMechAzimuth(0.0);
  ru.setMechTilt(0.0);

  assert(ru.position().has_value());

  auto attrs = ru.toAttributeMap();
  assert(!attrs.empty());

  std::cout << "  ✓ RU passed" << std::endl;
}

void testUE() {
  std::cout << "Testing UE..." << std::endl;

  UE ue(1); // Just ueId
  assert(ue.waypoints().empty());

  ue.addWaypoint(Position::georef(35.66, 139.74));
  ue.addWaypoint(Position::georef(35.66, 139.75));

  assert(ue.waypoints().size() == 2);

  auto wpList = ue.waypointsAttributeList();
  assert(wpList.size() == 2);

  auto attrs = ue.toAttributeMap();
  assert(!attrs.empty());

  std::cout << "  ✓ UE passed" << std::endl;
}

void testSimConfig() {
  std::cout << "Testing SimConfig..." << std::endl;

  SimConfig config(defaultSceneUrl, SimMode::EM);

  config.setNumBatches(2);
  config.setTimeline(10.0, 0.1, std::nullopt, std::nullopt);
  config.setSeed(100);
  config.addTableToDb(DBTable::CIRS);

  // Create panels (not automatically added)
  Panel panel1 = Panel::createPanel({AntennaElement::Isotropic}, 3600);
  Panel panel2 = Panel::createPanel({AntennaElement::Isotropic}, 3600);

  // Set default panels for UE and RU
  config.setDefaultPanelUE(panel1);
  config.setDefaultPanelRU(panel2);

  // Create DU via Nodes, configure, then add
  DU du = Nodes::createDU(1, 3600.0, defaultSubcarrierSpacing);
  du.setPosition(Position::cartesian(0, 0, 100));
  config.addDU(du);

  // Create RU via Nodes, configure, then add
  RU ru = Nodes::createRU(1, 3600.0, defaultRadiatedPowerDbmRU, du.id());
  ru.setPosition(Position::georef(35.66, 139.74));
  ru.setHeight(10.0);
  config.addRU(ru);

  // Create UE via Nodes (uses default UE panel)
  UE ue = Nodes::createUE(1, defaultRadiatedPowerDbmUE);
  ue.addWaypoint(Position::georef(35.66, 139.74));
  config.addUE(ue);

  // Generate YAML
  std::string yaml = config.toYamlString();
  assert(!yaml.empty());
  assert(yaml.find("db:") != std::string::npos);
  assert(yaml.find("sim:") != std::string::npos);
  assert(yaml.find("Scenario:") != std::string::npos);
  assert(yaml.find("Panels:") != std::string::npos);
  assert(yaml.find("DUs:") != std::string::npos);
  assert(yaml.find("RUs:") != std::string::npos);
  assert(yaml.find("UEs:") != std::string::npos);

  std::cout << "  ✓ SimConfig passed" << std::endl;
}

void testValidation() {
  std::cout << "Testing validation..." << std::endl;

  SimConfig config(defaultSceneUrl, SimMode::EM);

  // Test panel validation
  bool caught = false;
  try {
    Panel bad({AntennaElement::Isotropic}, -100); // Negative frequency
  } catch (const std::invalid_argument &) {
    caught = true;
  }
  assert(caught);

  // Test RU default panel not found (addRU should throw)
  caught = false;
  try {
    SimConfig config2(defaultSceneUrl, SimMode::EM);
    // Don't set default panel, try to add RU
    RU ru = Nodes::createRU(1);
    config2.addRU(ru); // Should throw - no default RU panel
  } catch (const std::runtime_error &) {
    caught = true;
  }
  assert(caught);

  // Test UE no waypoints
  caught = false;
  try {
    Panel p = Panel::createPanel({AntennaElement::Isotropic}, 3600);
    config.setDefaultPanelUE(p);
    UE ue = Nodes::createUE(1, 26.0);
    config.addUE(ue); // Should throw - no waypoints
  } catch (const std::runtime_error &) {
    caught = true;
  }
  assert(caught);

  std::cout << "  ✓ Validation passed" << std::endl;
}

int main() {
  std::cout << "=== AODT Config V3 Tests ===" << std::endl << std::endl;

  try {
    testAttributeValue();
    testPosition();
    testPanel();
    testDU();
    testRU();
    testUE();
    testSimConfig();
    testValidation();

    std::cout << "\n=== All tests passed! ===" << std::endl;
    return 0;
  } catch (const std::exception &e) {
    std::cerr << "\n!!! Test failed: " << e.what() << std::endl;
    return 1;
  }
}
