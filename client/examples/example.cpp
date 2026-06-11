// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "client.h"
#include "logger.hpp"
#include <filesystem>
#include <fstream>

using dt_service::AllocRequest;
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

  LOG(INFO) << "Connecting to GPU worker at " << server_address;

#ifdef HAVE_CUDA
  int device_count = 0;
  cudaError_t err = cudaGetDeviceCount(&device_count);
  if (err != cudaSuccess || device_count == 0) {
    LOG(WARNING) << "No CUDA devices available (GPU features disabled)";
  } else {
    cudaDeviceProp prop;
    cudaGetDeviceProperties(&prop, 0);
    LOG(INFO) << "CUDA Device: " << prop.name;
  }
#else
  LOG(INFO)
      << "Built without CUDA — LOCAL_IPC and GPU receive buffers disabled";
#endif

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

  std::string yaml_content((std::istreambuf_iterator<char>(file)),
                           std::istreambuf_iterator<char>());
  file.close();

  LOG(INFO) << "Read YAML file: " << yaml_file << " (" << yaml_content.size()
            << " bytes)";

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
  // Test 3: CIR (Channel Impulse Response) Operations
  // ==================================================================
  LOG(INFO) << "\n" << std::string(60, '=');
  LOG(INFO) << "Test 3: CIR (Channel Impulse Response) Operations";
  LOG(INFO) << std::string(60, '=');

  // Define CIR test configuration
  std::vector<int> cir_ru_indices =
      (num_rus >= 2) ? std::vector<int>{0, 1} : std::vector<int>{0};
  std::vector<std::vector<int>> cir_ue_indices_per_ru;
  if (num_ues >= 3) {
    cir_ue_indices_per_ru = {{0, 1, 2}, {0, 1, 2}};
  } else {
    cir_ue_indices_per_ru = {{0}};
  }
  bool cir_is_full_antenna_pair = false;

  LOG(INFO) << "\n📡 CIR Configuration (single time step):";
  LOG(INFO) << "  RU indices: " << cir_ru_indices.size() << " RUs";
  LOG(INFO) << "  Full antenna pair: "
            << (cir_is_full_antenna_pair ? "true" : "false");

  // Step 1: Allocate CIR batch memory using broadcast style
  LOG(INFO) << "\nStep 1: Allocating CIR batch memory (broadcast style)...";
  DigitalTwinClient::CIRBatchAllocation cir_allocation;

  if (client.AllocateCIRResultsMemory(cir_ru_indices, cir_ue_indices_per_ru,
                                      cir_is_full_antenna_pair,
                                      cir_allocation)) {

    LOG(INFO) << "✅ Allocated CIR batch memory for "
              << cir_allocation.num_time_steps << " time steps";
    LOG(INFO) << "  Total buffer sizes: values="
              << cir_allocation.total_values_bytes
              << " bytes, delays=" << cir_allocation.total_delays_bytes
              << " bytes";

    // Display per-time-step shapes (this script only allocates for a single
    // time step by default num_time_steps = 1 in AllocateCIRResultsMemory)
    for (size_t ts_idx = 0; ts_idx < cir_allocation.values_shapes_per_ts.size();
         ts_idx++) {
      LOG(INFO) << "  Time step " << ts_idx << ":";
      const auto &ts_values_shapes =
          cir_allocation.values_shapes_per_ts[ts_idx];
      const auto &ts_delays_shapes =
          cir_allocation.delays_shapes_per_ts[ts_idx];
      for (size_t ru_pos = 0; ru_pos < ts_values_shapes.size(); ru_pos++) {
        int ru_idx = cir_allocation.ru_indices_per_ts[ts_idx][ru_pos];
        LOG(INFO) << "    RU " << ru_idx << ": CIR value shape dims="
                  << ts_values_shapes[ru_pos].dimensions_size()
                  << ", delay shape dims="
                  << ts_delays_shapes[ru_pos].dimensions_size();
      }
    }

    // Step 2: Compute CIR (if supported)
    LOG(INFO) << "\nStep 2: Computing CIR for slot 0...";
    if (client.GetChannelImpulseResponse(cir_allocation, 0, SlotIndex(0))) {
      LOG(INFO) << "✅ CIR computed successfully for "
                << cir_allocation.temporal_indices.size() << " time steps";

#ifdef HAVE_CUDA
      if (!cir_allocation.values_shapes_per_ts.empty() &&
          !cir_allocation.values_shapes_per_ts[0].empty()) {
        auto values_buf =
            client.FetchBuffer(cir_allocation, "values", MemoryType::GPU);
        auto delays_buf =
            client.FetchBuffer(cir_allocation, "delays", MemoryType::GPU);
        if (values_buf.ptr && delays_buf.ptr) {
          const auto &values_shape = cir_allocation.values_shapes_per_ts[0][0];
          const int ru_idx = cir_allocation.ru_indices_per_ts[0][0];
          client.PrintCIRResultsSample(values_buf.ptr, delays_buf.ptr,
                                       values_shape, ru_idx);
        }
      }
#else
      LOG(INFO) << "Skipping GPU data access (built without CUDA)";
#endif
    } else {
      LOG(WARNING) << "⚠️  CIR computation not fully implemented or failed";
    }

    // Step 3: Deallocate CIR memory
    LOG(INFO) << "\nStep 3: Deallocating CIR batch memory...";
    if (client.DeallocateCIRResultsMemory(cir_allocation)) {
      LOG(INFO) << "✅ CIR batch memory deallocated successfully";
    } else {
      LOG(ERROR) << "Failed to deallocate CIR batch memory";
    }
  } else {
    LOG(ERROR) << "Failed to allocate CIR batch memory";
  }

  // Also demonstrate per-time-step style allocation
  if (num_rus >= 1 && num_ues >= 1) {
    LOG(INFO) << "\n📡 CIR Configuration (per-time-step style):";

    // Variable config: different RUs/UEs per time step
    std::vector<std::vector<int>> ru_indices_per_ts = {{0},
                                                       {0}}; // 2 time steps
    std::vector<std::vector<std::vector<int>>> ue_indices_per_ts = {
        {{0}}, // Time step 0: RU 0 with UE 0
        {{0}}  // Time step 1: RU 0 with UE 0
    };

    LOG(INFO) << "  Num time steps: " << ru_indices_per_ts.size();
    LOG(INFO) << "  Variable config per time step";

    DigitalTwinClient::CIRBatchAllocation cir_allocation2;

    if (client.AllocateCIRResultsMemory(ru_indices_per_ts, ue_indices_per_ts,
                                        cir_is_full_antenna_pair,
                                        cir_allocation2)) {
      LOG(INFO) << "✅ Per-time-step style allocation successful";
      LOG(INFO) << "  Allocated for " << cir_allocation2.num_time_steps
                << " time steps";

      // Cleanup
      client.DeallocateCIRResultsMemory(cir_allocation2);
      LOG(INFO) << "✅ Deallocated per-time-step allocation";
    } else {
      LOG(ERROR) << "Failed per-time-step style allocation";
    }
  }

  client.StopServerLogStreaming();

  LOG(INFO) << "\n✅ Digital Twin client test completed!";
  LOG(INFO)
      << "📝 Note: CIR uses FetchBuffer (LOCAL_IPC: zero-copy GPU access; "
         "REMOTE: UCX transfer)";
  LOG(INFO) << "💾 Memory allocated per RU for optimal parallelization";

  return 0;
}
