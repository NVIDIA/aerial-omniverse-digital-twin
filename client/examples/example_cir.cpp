// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "client.h"
#include "example_generate_yaml_config.hpp"
#include "logger.hpp"
#include <filesystem>
#include <fstream>

using dt_service::AllocRequest;
using dt_service::CIRResultsAllocReply;
using dt_service::CIRResultsAllocRequest;
using dt_service::CIRResultsDeallocRequest;
using dt_service::CIRResultsReply;
using dt_service::CIRResultsRequest;
using dt_service::DataReply;
using dt_service::DataRequest;
using dt_service::DTWorker;
using dt_service::GPUMemoryHandle;
using dt_service::GPUReply;
using dt_service::GPURequest;
using dt_service::MatrixShape;
using dt_service::Position3D;
using dt_service::RUPositionReply;
using dt_service::RUPositionRequest;
using dt_service::StatusReply;
using dt_service::UEPositionReply;
using dt_service::UEPositionRequest;

int main(int argc, char **argv) {
  std::string server_address = "localhost:50051";
  if (argc > 1) {
    server_address = argv[1];
  }
  std::string yaml_option = "file";
  if (argc > 2) {
    yaml_option = argv[2];
  }
  if (yaml_option != "file" && yaml_option != "string") {
    LOG(ERROR) << "Invalid YAML option: " << yaml_option;
    return 1;
  }

  LOG(INFO) << "Connecting to GPU worker at " << server_address;

  // Check CUDA availability
  int device_count = 0;
  cudaError_t err = cudaGetDeviceCount(&device_count);
  if (err != cudaSuccess || device_count == 0) {
    LOG(ERROR) << "No CUDA devices available";
    return 1;
  }

  cudaDeviceProp prop;
  cudaGetDeviceProperties(&prop, 0);
  LOG(INFO) << "CUDA Device: " << prop.name;

  DigitalTwinClient client(
      grpc::CreateChannel(server_address, grpc::InsecureChannelCredentials()));

  // Start streaming server logs to a local file (non-blocking)
  client.StartServerLogStreaming("dt_server.log", "INFO");

  // ==================================================================
  // Test 0: Start Scenario
  // ==================================================================
  LOG(INFO) << "\n" << std::string(60, '=');
  LOG(INFO) << "Test 0: Start Scenario";
  LOG(INFO) << std::string(60, '=');

  std::string yaml_content;
  if (yaml_option == "file") {
    std::string yaml_file = (std::filesystem::path(__FILE__).parent_path() /
                             "../tests/assets/TC_2RU_4UE_4T4R_1sym.yml")
                                .lexically_normal()
                                .string();

    // Verify file has .yaml or .yml extension
    std::string extension;
    size_t dot_pos = yaml_file.find_last_of('.');
    if (dot_pos != std::string::npos) {
      extension = yaml_file.substr(dot_pos);
    }

    if (extension != ".yaml" && extension != ".yml") {
      LOG(ERROR) << "Error: Please provide a .yaml or .yml YAML file. Got: "
                 << yaml_file;
      return 1;
    }

    // Read YAML file content
    std::ifstream file(yaml_file);
    if (!file.is_open()) {
      LOG(ERROR) << "Error: Could not open YAML file: " << yaml_file;
      return 1;
    }

    yaml_content = std::string((std::istreambuf_iterator<char>(file)),
                               std::istreambuf_iterator<char>());
    file.close();

    LOG(INFO) << "Read YAML file: " << yaml_file << " (" << yaml_content.size()
              << " bytes)";
  } else if (yaml_option == "string") {
    try {
      std::string asset_config =
          (std::filesystem::path(__FILE__).parent_path() /
           "example_client_assets.yml")
              .lexically_normal()
              .string();
      genExampleYamlString("test_data/maps/tokyo", asset_config, "test_dt_db",
                           "", yaml_content);
    } catch (const std::exception &e) {
      LOG(ERROR) << "Error generating YAML string: " << e.what();
      return 1;
    }
  } else {
    LOG(ERROR) << "Invalid YAML option: " << yaml_option;
    return 1;
  }

  if (!client.Start(yaml_content)) {
    LOG(ERROR) << "Failed to start scenario - cannot proceed with tests";
    return 1;
  }

  // Get scenario information after loading
  bool scenario_loaded = false;
  bool is_slot_symbol_mode = true;
  int num_rus = 0, num_ues = 0, total_batches = 0,
      num_slots_or_timesteps_per_batch = 0;

  if (!client.GetScenarioStatus(scenario_loaded, num_rus, num_ues,
                                total_batches, is_slot_symbol_mode,
                                num_slots_or_timesteps_per_batch)) {
    LOG(ERROR) << "Failed to get scenario status";
    return 1;
  }

  LOG(INFO) << "✅ Scenario loaded successfully!";
  if (is_slot_symbol_mode) {
    LOG(INFO) << "📊 Scenario configuration: " << num_rus << " RUs, " << num_ues
              << " UEs, " << total_batches << " batches, "
              << num_slots_or_timesteps_per_batch << " slots/batch";
  } else {
    LOG(INFO) << "📊 Scenario configuration: " << num_rus << " RUs, " << num_ues
              << " UEs, " << total_batches << " batches, "
              << num_slots_or_timesteps_per_batch << " time steps/batch";
  }

  // ==================================================================
  // Test 1: RU Position Requests
  // ==================================================================
  LOG(INFO) << "\n" << std::string(60, '=');
  LOG(INFO) << "Test 1: RU Position Requests";
  LOG(INFO) << std::string(60, '=');

  // Test RU position request (static infrastructure)
  std::vector<std::array<float, 3>> ru_positions;

  LOG(INFO) << "\n📡 Getting RU positions (static infrastructure)";

  if (client.GetRUPositions(ru_positions)) {
    LOG(INFO) << "✅ Retrieved " << ru_positions.size() << " RU positions";

    // Show RU positions
    if (!ru_positions.empty()) {
      LOG(INFO) << "📊 RU Infrastructure Positions:";
      for (size_t i = 0; i < ru_positions.size(); i++) {
        LOG(INFO) << "    RU " << i << ": (" << std::fixed
                  << std::setprecision(1) << ru_positions[i][0] << ", "
                  << ru_positions[i][1] << ", " << ru_positions[i][2] << ")";
      }

      float avg_x = 0, avg_y = 0, avg_z = 0;
      for (const auto &pos : ru_positions) {
        avg_x += pos[0];
        avg_y += pos[1];
        avg_z += pos[2];
      }
      avg_x /= ru_positions.size();
      avg_y /= ru_positions.size();
      avg_z /= ru_positions.size();

      LOG(INFO) << "📊 Average position: (" << avg_x << ", " << avg_y << ", "
                << avg_z << ")";
    }
  } else {
    LOG(ERROR) << "Failed to get RU positions";
  }

  // ==================================================================
  // Test 2: UE Position Requests (mobility over time)
  // ==================================================================
  LOG(INFO) << "\n" << std::string(60, '=');
  LOG(INFO) << "Test 2: UE Position Requests (Mobility Simulation)";
  LOG(INFO) << std::string(60, '=');

  // Test UE position requests for different slot indices to see mobility
  std::vector<int> ue_test_slots = {0, 5, 10, 20};

  for (int slot : ue_test_slots) {
    std::vector<std::array<float, 3>> ue_positions;

    LOG(INFO) << "\n📱 Getting UE positions for slot " << slot;

    int batch_index = 0;
    if (client.GetUEPositions(batch_index, SlotIndex(slot), ue_positions)) {
      LOG(INFO) << "✅ Retrieved " << ue_positions.size() << " UE positions:";

      // Show mobility by comparing with previous slot
      if (!ue_positions.empty()) {
        for (size_t i = 0; i < ue_positions.size(); i++) {
          LOG(INFO) << "    UE " << i << " at slot " << slot << ": ("
                    << std::fixed << std::setprecision(2) << ue_positions[i][0]
                    << ", " << ue_positions[i][1] << ", " << ue_positions[i][2]
                    << ")";
        }
      }
    } else {
      LOG(ERROR) << "Failed to get UE positions for slot " << slot;
    }
  }

  // ==================================================================
  // Test 3: CIR (Channel Impulse Response) Requests (GPU IPC)
  // ==================================================================
  LOG(INFO) << "\n" << std::string(60, '=');
  LOG(INFO) << "Test 3: CIR (Channel Impulse Response) Requests (GPU IPC)";
  LOG(INFO) << std::string(60, '=');

  // Test different CIR configurations
  struct CIRTest {
    int batch_index;
    int slot_index;
    std::vector<int> ru_indices;
    std::vector<std::vector<int>>
        ue_indices_per_ru; // UE indices per RU (list of lists)
    bool is_full_antenna_pair;
    std::string description;
  };

  // Generate CIR test cases based on loaded scenario
  std::vector<CIRTest> cir_tests;

  // Test 1: Small subset
  if (num_rus >= 2 && num_ues >= 3) {
    cir_tests.push_back({0,
                         0,
                         {0, 1},
                         {{0, 1, 2}, {0, 1, 2}},
                         false,
                         "2 RUs, 3 UEs each, single antenna"});
  }

  // Test 2: Medium subset with full antennas and different UEs per RU
  if (num_rus >= 2 && num_ues >= 2 && num_slots_or_timesteps_per_batch > 3) {
    int ue1 = std::min(1, num_ues - 1);
    int ue2 = std::min(3, num_ues - 1);
    cir_tests.push_back({0,
                         3,
                         {0, 1},
                         {{ue1}, {ue2}},
                         true,
                         "2 RUs, different UEs per RU, full antennas"});
  }

  // Test 3: Multiple RUs, subset of UEs (all RUs get same UEs)
  if (num_rus >= 1 && num_ues >= 2 && num_slots_or_timesteps_per_batch > 5) {
    std::vector<int> all_rus;
    std::vector<std::vector<int>> ues_per_ru;
    for (int i = 0; i < std::min(4, num_rus); i++) {
      all_rus.push_back(i);
      ues_per_ru.push_back({0, 1}); // Each RU gets UE 0 and 1
    }
    cir_tests.push_back({0, 5, all_rus, ues_per_ru, true,
                         "Multiple RUs, 2 UEs each, full antennas"});
  }

  // Test 4: Single RU/UE
  if (num_rus >= 1 && num_ues >= 1 && num_slots_or_timesteps_per_batch > 9) {
    cir_tests.push_back(
        {1, 9, {0}, {{0}}, false, "1 RU, 1 UE, single antenna"});
  }

  // Test 5: Edge case - high batch index (should fail)
  if (num_rus >= 1 && num_ues >= 1 && total_batches > 1) {
    cir_tests.push_back({std::min(10, total_batches),
                         0,
                         {0},
                         {{0}},
                         false,
                         "Edge case: high batch index"});
  }

  if (cir_tests.empty()) {
    LOG(WARNING) << "No suitable CIR test cases for current scenario "
                    "configuration";
    LOG(WARNING) << "   Scenario has " << num_rus << " RUs, " << num_ues
                 << " UEs";
  }

  for (size_t i = 0; i < cir_tests.size(); i++) {
    const auto &test = cir_tests[i];
    LOG(INFO) << "\n==================================================";
    LOG(INFO) << "📊 Test case 3." << i + 1 << ": " << test.description;

    // Step 1: Allocate GPU memory for CIR results using batch allocation
    DigitalTwinClient::CIRBatchAllocation allocation;
    if (!client.AllocateCIRResultsMemory(
            test.ru_indices, test.ue_indices_per_ru, test.is_full_antenna_pair,
            allocation)) {
      LOG(ERROR) << "Failed to allocate CIR batch memory";
      continue;
    }

    LOG(INFO) << "✅ CIR batch memory allocated successfully";
    LOG(INFO) << "   Allocated values=" << allocation.total_values_bytes
              << " bytes, delays=" << allocation.total_delays_bytes
              << " bytes for " << test.ru_indices.size() << " RUs";

    // Print shape information for each allocated RU (coefficients and delays)
    const int time_step_index =
        0; // this script only allocates for a single time step by default
           // num_time_steps = 1 in AllocateCIRResultsMemory
    for (size_t i = 0;
         i < allocation.values_shapes_per_ts[time_step_index].size(); i++) {
      const auto &cirvalue_shape =
          allocation.values_shapes_per_ts[time_step_index][i];
      const auto &delay_shape =
          allocation.delays_shapes_per_ts[time_step_index][i];

      std::stringstream cirvalue_shape_str;
      cirvalue_shape_str << "   RU " << test.ru_indices[i]
                         << " CIR coefficients shape: [";
      for (int j = 0; j < cirvalue_shape.dimensions_size(); j++) {
        cirvalue_shape_str << cirvalue_shape.dimensions(j);
        if (j < cirvalue_shape.dimensions_size() - 1)
          cirvalue_shape_str << ", ";
      }
      cirvalue_shape_str << "] = " << cirvalue_shape.total_elements()
                         << " elements, dtype: " << cirvalue_shape.dtype();
      LOG(INFO) << cirvalue_shape_str.str();

      std::stringstream delay_shape_str;
      delay_shape_str << "   RU " << test.ru_indices[i]
                      << " CIR delays shape: [";
      for (int j = 0; j < delay_shape.dimensions_size(); j++) {
        delay_shape_str << delay_shape.dimensions(j);
        if (j < delay_shape.dimensions_size() - 1)
          delay_shape_str << ", ";
      }
      delay_shape_str << "] = " << delay_shape.total_elements()
                      << " elements, dtype: " << delay_shape.dtype();
      LOG(INFO) << delay_shape_str.str();
    }

    // Step 2: Compute CIR into the batch allocation for the requested slot
    if (client.GetChannelImpulseResponse(allocation, test.batch_index,
                                         SlotIndex(test.slot_index))) {
      LOG(INFO) << "✅ CIR computed into batch allocation";

      // Step 3: Access CIR data via FetchBuffer (works for all transport modes)
      if (!allocation.values_shapes_per_ts.empty() &&
          !allocation.values_shapes_per_ts[time_step_index].empty()) {
        const auto &values_shape =
            allocation.values_shapes_per_ts[time_step_index][0];
        const auto &delays_shape =
            allocation.delays_shapes_per_ts[time_step_index][0];

        auto values_buf =
            client.FetchBuffer(allocation, "values", MemoryType::GPU);
        auto delays_buf =
            client.FetchBuffer(allocation, "delays", MemoryType::GPU);

        if (values_buf.ptr && delays_buf.ptr) {
          LOG(INFO) << "CIR buffers accessible (tested RU "
                    << test.ru_indices[time_step_index] << ")";

          client.PrintCIRResultsSample(values_buf.ptr, delays_buf.ptr,
                                       values_shape,
                                       test.ru_indices[time_step_index]);
        }
      }
    } else {
      LOG(ERROR) << "Failed to compute CIR batch";
    }

    // Step 4: Deallocate batch memory
    if (client.DeallocateCIRResultsMemory(allocation)) {
      LOG(INFO) << "✅ CIR batch memory deallocated successfully";
    } else {
      LOG(ERROR) << "Failed to deallocate CIR batch memory";
    }
  }

  client.StopServerLogStreaming();

  LOG(INFO) << "\n✅ Digital Twin CIR client test completed!";
  LOG(INFO) << "📝 Note: CIR results use GPU IPC for zero-copy access";
  LOG(INFO) << "🚀 GPU IPC enables high-performance CIR processing with "
               "amplitude & delay data";
  LOG(INFO) << "💾 CIR memory allocated per RU";

  return 0;
}
