// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "aodt_config.hpp"
#include <iostream>

using namespace aodt::config;

int main() {
  std::cout << "Testing asset loading..." << std::endl;

  // Test 1: Load from assets.yml
  try {
    SimConfig cfg(defaultSceneUrl, SimMode::EM, "assets.yml");
    std::cout << "  ✓ Successfully loaded assets from assets.yml" << std::endl;
  } catch (const std::exception &e) {
    std::cerr << "  ✗ Failed to load assets.yml: " << e.what() << std::endl;
    return 1;
  }

  // Test 2: Use hardcoded defaults (empty path)
  try {
    SimConfig cfg2(defaultSceneUrl, SimMode::EM, "");
    std::cout << "  ✓ Successfully used hardcoded defaults" << std::endl;
  } catch (const std::exception &e) {
    std::cerr << "  ✗ Failed with hardcoded defaults: " << e.what()
              << std::endl;
    return 1;
  }

  // Test 3: Default parameter (no asset path)
  try {
    SimConfig cfg3(defaultSceneUrl, SimMode::EM);
    std::cout << "  ✓ Successfully used default constructor" << std::endl;
  } catch (const std::exception &e) {
    std::cerr << "  ✗ Failed with default constructor: " << e.what()
              << std::endl;
    return 1;
  }

  std::cout << "\n=== All asset loading tests passed! ===" << std::endl;
  return 0;
}
