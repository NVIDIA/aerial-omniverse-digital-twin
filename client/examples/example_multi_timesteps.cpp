// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "client.h"
#include "example_generate_yaml_config.hpp"
#include "logger.hpp"

#include <filesystem>
#include <fstream>
#include <sstream>

using dt_service::MatrixShape;

std::string ReadYamlFile(const std::string &path) {
  std::ifstream file(path);
  if (!file.is_open()) {
    std::stringstream msg;
    msg << "Error: Could not open YAML file: " << path;
    throw std::runtime_error(msg.str());
  }
  std::string content((std::istreambuf_iterator<char>(file)),
                      std::istreambuf_iterator<char>());
  return content;
}

std::string FormatShape(const dt_service::MatrixShape &shape) {
  std::stringstream ss;
  ss << "[";
  for (int i = 0; i < shape.dimensions_size(); i++) {
    ss << shape.dimensions(i);
    if (i < shape.dimensions_size() - 1)
      ss << ", ";
  }
  ss << "] (" << shape.total_elements() << " elements)";
  return ss.str();
}

void LogAllocationShapes(const DigitalTwinClient::CIRBatchAllocation &alloc) {
  for (int ts = 0; ts < alloc.num_time_steps; ts++) {
    LOG(INFO) << "  Time step " << ts << ":";
    for (size_t ru_pos = 0; ru_pos < alloc.ru_indices_per_ts[ts].size();
         ru_pos++) {
      const auto &values_shape = alloc.values_shapes_per_ts[ts][ru_pos];
      const auto &delays_shape = alloc.delays_shapes_per_ts[ts][ru_pos];
      LOG(INFO) << "    RU " << alloc.ru_indices_per_ts[ts][ru_pos]
                << ": values=" << FormatShape(values_shape)
                << ", delays=" << FormatShape(delays_shape);
    }
  }
}

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
    std::string asset_config = (std::filesystem::path(__FILE__).parent_path() /
                                "example_client_assets.yml")
                                   .lexically_normal()
                                   .string();
    genExampleYamlString("test_data/maps/tokyo", asset_config, "test_dt_db", "",
                         yaml_content);
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
  if (!scenario_loaded) {
    LOG(ERROR) << "Scenario not loaded";
    return 1;
  }

  LOG(INFO) << "✅ Scenario loaded successfully!";
  LOG(INFO) << "📊 Scenario configuration: " << num_rus << " RUs, " << num_ues
            << " UEs, " << total_batches << " batches, "
            << num_slots_or_timesteps_per_batch
            << (is_slot_symbol_mode ? " slots/batch" : " time steps/batch");

  // ==================================================================
  // Test 1: CIR Batch Allocation + Multi-Time-Step Compute
  // ==================================================================
  LOG(INFO) << "\n" << std::string(60, '=');
  LOG(INFO) << "Test 1: Multi-Time-Step CIR Batch Allocation";
  LOG(INFO) << std::string(60, '=');

  std::vector<int> ru_indices =
      (num_rus >= 2) ? std::vector<int>{0, 1} : std::vector<int>{0};
  std::vector<std::vector<int>> ue_indices_per_ru;
  if (num_ues >= 3) {
    for (size_t i = 0; i < ru_indices.size(); i++) {
      ue_indices_per_ru.push_back({0, 1, 2});
    }
  } else if (num_ues >= 1) {
    for (size_t i = 0; i < ru_indices.size(); i++) {
      ue_indices_per_ru.push_back({0});
    }
  } else {
    LOG(ERROR) << "No UEs available in scenario";
    return 1;
  }

  const bool is_full_antenna_pair = false;
  const int num_time_steps = 3;

  LOG(INFO) << "Configuration (broadcast style)";
  LOG(INFO) << "  Num time steps: " << num_time_steps;
  LOG(INFO) << "  Num RUs: " << ru_indices.size();
  LOG(INFO) << "  Num UEs per RU: " << ue_indices_per_ru.front().size();
  LOG(INFO) << "  Full antenna pair: "
            << (is_full_antenna_pair ? "true" : "false");

  DigitalTwinClient::CIRBatchAllocation allocation;
  if (!client.AllocateCIRResultsMemory(ru_indices, ue_indices_per_ru,
                                       is_full_antenna_pair, allocation,
                                       num_time_steps)) {
    LOG(ERROR) << "Failed to allocate CIR batch memory";
    return 1;
  }

  LOG(INFO) << "✅ CIR batch allocated: values="
            << allocation.total_values_bytes
            << " bytes, delays=" << allocation.total_delays_bytes << " bytes";
  LogAllocationShapes(allocation);

  std::vector<int> requested_temporal_indices = {0, 1, 2};

  LOG(INFO) << "Computing CIR for "
            << (is_slot_symbol_mode ? "slots" : "time steps") << ": ";
  for (size_t i = 0; i < requested_temporal_indices.size(); i++) {
    LOG(INFO) << "  " << requested_temporal_indices[i];
  }

  const int batch_index = 0;
  bool cir_ok = false;
  if (is_slot_symbol_mode) {
    cir_ok = client.GetChannelImpulseResponse(
        allocation, batch_index, SlotIndices(requested_temporal_indices));
  } else {
    cir_ok = client.GetChannelImpulseResponse(
        allocation, batch_index, TimeStepIndices(requested_temporal_indices));
  }

  if (!cir_ok) {
    LOG(ERROR) << "Failed to compute CIR batch";
    client.DeallocateCIRResultsMemory(allocation);
    return 1;
  }

  LOG(INFO) << "✅ CIR batch computed. Returned indices:";
  for (const auto &idx : allocation.temporal_indices) {
    LOG(INFO) << "  " << idx;
  }

  // Access CIR data via FetchBuffer for all time steps and all RUs
  // (works for all transport modes)
  if (!allocation.temporal_indices.empty() &&
      !allocation.values_shapes_per_ts.empty() &&
      !allocation.values_shapes_per_ts[0].empty()) {
    auto values_buf = client.FetchBuffer(allocation, "values", MemoryType::GPU);
    auto delays_buf = client.FetchBuffer(allocation, "delays", MemoryType::GPU);

    if (values_buf.ptr && delays_buf.ptr) {
      for (size_t ts = 0; ts < allocation.values_shapes_per_ts.size(); ts++) {
        if (allocation.values_shapes_per_ts[ts].empty()) {
          continue;
        }

        const size_t num_rus_this_ts =
            allocation.values_shapes_per_ts[ts].size();
        for (size_t ru_pos = 0; ru_pos < num_rus_this_ts; ru_pos++) {
          const MatrixShape &values_shape =
              allocation.values_shapes_per_ts[ts][ru_pos];
          const MatrixShape &delays_shape =
              allocation.delays_shapes_per_ts[ts][ru_pos];

          const int64_t values_offset_elements =
              allocation.values_time_step_offsets[ts] +
              allocation.values_ru_offsets_per_ts[ts][ru_pos];
          const int64_t delays_offset_elements =
              allocation.delays_time_step_offsets[ts] +
              allocation.delays_ru_offsets_per_ts[ts][ru_pos];

          auto *values_ptr =
              reinterpret_cast<char *>(values_buf.ptr) +
              values_offset_elements * sizeof(std::complex<float>);
          auto *delays_ptr = reinterpret_cast<char *>(delays_buf.ptr) +
                             delays_offset_elements * sizeof(float);

          const int ru_idx = allocation.ru_indices_per_ts[ts][ru_pos];
          LOG(INFO) << "✅ CIR access successful for ts=" << ts << ", RU "
                    << ru_idx;
          client.PrintCIRResultsSample(values_ptr, delays_ptr, values_shape,
                                       ru_idx);
        }
      }
    } else {
      LOG(WARNING) << "Failed to access CIR buffers";
    }
  }

  if (!client.DeallocateCIRResultsMemory(allocation)) {
    LOG(ERROR) << "Failed to deallocate CIR batch memory";
    return 1;
  }
  LOG(INFO) << "✅ CIR batch memory deallocated";

  // ==================================================================
  // Test 2: Per-Time-Step CIR Batch Allocation (variable config)
  // ==================================================================
  LOG(INFO) << "\n" << std::string(60, '=');
  LOG(INFO) << "Test 2: Multi-Time-Step CIR (Per-Time-Step Style)";
  LOG(INFO) << std::string(60, '=');

  auto build_ue_list = [&](int desired_count) {
    std::vector<int> ues;
    const int count = std::min(desired_count, num_ues);
    for (int i = 0; i < count; i++) {
      ues.push_back(i);
    }
    return ues;
  };

  std::vector<std::vector<int>> ru_indices_per_ts;
  std::vector<std::vector<std::vector<int>>> ue_indices_per_ts;
  ru_indices_per_ts.resize(num_time_steps);
  ue_indices_per_ts.resize(num_time_steps);

  // Time step 0: RU 0 with 1 UE
  ru_indices_per_ts[0] = {0};
  ue_indices_per_ts[0] = {build_ue_list(1)};

  // Time step 1: RU 0 (and RU 1 if available) with 2 UEs each
  ru_indices_per_ts[1] =
      (num_rus > 1) ? std::vector<int>{0, 1} : std::vector<int>{0};
  ue_indices_per_ts[1].push_back(build_ue_list(2));
  if (num_rus > 1) {
    ue_indices_per_ts[1].push_back(build_ue_list(2));
  }

  // Time step 2: RU 0 with 3 UEs
  ru_indices_per_ts[2] = {0};
  ue_indices_per_ts[2] = {build_ue_list(3)};

  DigitalTwinClient::CIRBatchAllocation per_ts_allocation;
  if (!client.AllocateCIRResultsMemory(ru_indices_per_ts, ue_indices_per_ts,
                                       is_full_antenna_pair,
                                       per_ts_allocation)) {
    LOG(ERROR) << "Failed to allocate per-time-step CIR batch memory";
    return 1;
  }

  LOG(INFO) << "✅ Per-time-step CIR batch allocated: values="
            << per_ts_allocation.total_values_bytes
            << " bytes, delays=" << per_ts_allocation.total_delays_bytes
            << " bytes";
  LogAllocationShapes(per_ts_allocation);

  bool per_ts_ok = false;
  if (is_slot_symbol_mode) {
    per_ts_ok = client.GetChannelImpulseResponse(
        per_ts_allocation, batch_index,
        SlotIndices(requested_temporal_indices));
  } else {
    per_ts_ok = client.GetChannelImpulseResponse(
        per_ts_allocation, batch_index,
        TimeStepIndices(requested_temporal_indices));
  }

  if (!per_ts_ok) {
    LOG(ERROR) << "Failed to compute per-time-step CIR batch";
    client.DeallocateCIRResultsMemory(per_ts_allocation);
    return 1;
  }

  LOG(INFO) << "✅ Per-time-step CIR batch computed. Returned indices:";
  for (const auto &idx : per_ts_allocation.temporal_indices) {
    LOG(INFO) << "  " << idx;
  }

  // Access CIR data via FetchBuffer (works for all transport modes)
  if (!per_ts_allocation.temporal_indices.empty() &&
      !per_ts_allocation.values_shapes_per_ts.empty()) {
    auto values_buf =
        client.FetchBuffer(per_ts_allocation, "values", MemoryType::GPU);
    auto delays_buf =
        client.FetchBuffer(per_ts_allocation, "delays", MemoryType::GPU);

    if (values_buf.ptr && delays_buf.ptr) {
      for (size_t ts = 0; ts < per_ts_allocation.values_shapes_per_ts.size();
           ts++) {
        if (per_ts_allocation.values_shapes_per_ts[ts].empty()) {
          continue;
        }

        if (ts >= per_ts_allocation.values_time_step_offsets.size() ||
            ts >= per_ts_allocation.delays_time_step_offsets.size()) {
          LOG(ERROR) << "Missing time-step offsets for ts=" << ts;
          continue;
        }
        if (ts >= per_ts_allocation.values_ru_offsets_per_ts.size() ||
            per_ts_allocation.values_ru_offsets_per_ts[ts].empty() ||
            ts >= per_ts_allocation.delays_ru_offsets_per_ts.size() ||
            per_ts_allocation.delays_ru_offsets_per_ts[ts].empty()) {
          LOG(ERROR) << "Missing RU offsets for ts=" << ts;
          continue;
        }

        const size_t num_rus_this_ts =
            per_ts_allocation.values_shapes_per_ts[ts].size();
        for (size_t ru_pos = 0; ru_pos < num_rus_this_ts; ru_pos++) {
          const MatrixShape &values_shape =
              per_ts_allocation.values_shapes_per_ts[ts][ru_pos];
          const MatrixShape &delays_shape =
              per_ts_allocation.delays_shapes_per_ts[ts][ru_pos];

          if (ru_pos >= per_ts_allocation.values_ru_offsets_per_ts[ts].size() ||
              ru_pos >= per_ts_allocation.delays_ru_offsets_per_ts[ts].size()) {
            LOG(ERROR) << "Missing RU offset for ts=" << ts
                       << ", ru_pos=" << ru_pos;
            continue;
          }

          const int64_t values_offset_elements =
              per_ts_allocation.values_time_step_offsets[ts] +
              per_ts_allocation.values_ru_offsets_per_ts[ts][ru_pos];
          const int64_t delays_offset_elements =
              per_ts_allocation.delays_time_step_offsets[ts] +
              per_ts_allocation.delays_ru_offsets_per_ts[ts][ru_pos];

          auto *values_ptr =
              reinterpret_cast<char *>(values_buf.ptr) +
              values_offset_elements * sizeof(std::complex<float>);
          auto *delays_ptr = reinterpret_cast<char *>(delays_buf.ptr) +
                             delays_offset_elements * sizeof(float);

          const int ru_idx = per_ts_allocation.ru_indices_per_ts[ts][ru_pos];
          LOG(INFO) << "✅ CIR access successful for ts=" << ts << ", RU "
                    << ru_idx;
          client.PrintCIRResultsSample(values_ptr, delays_ptr, values_shape,
                                       ru_idx);
        }
      }
    } else {
      LOG(WARNING) << "Failed to access CIR buffers";
    }
  }

  if (!client.DeallocateCIRResultsMemory(per_ts_allocation)) {
    LOG(ERROR) << "Failed to deallocate per-time-step CIR batch memory";
    return 1;
  }
  LOG(INFO) << "✅ Per-time-step CIR batch memory deallocated";

  client.StopServerLogStreaming();

  LOG(INFO) << "\n✅ Multi-time-step CIR example completed!";
  return 0;
}
