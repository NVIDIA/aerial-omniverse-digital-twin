// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "client.h"

#include <cassert>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

#include <grpcpp/grpcpp.h>

namespace {

void test_temporal_index_types() {
  std::cout << "Testing temporal index helpers..." << std::endl;

  SlotIndex slot(5);
  TimeStepIndex timestep(7);
  SlotIndices slots({0, 2, 4});
  TimeStepIndices timesteps({1, 3, 5});

  assert(slot.value == 5);
  assert(timestep.value == 7);
  assert(slots.size() == 3);
  assert(timesteps.size() == 3);
  assert(slots.values[1] == 2);
  assert(timesteps.values[2] == 5);

  std::cout << "  PASS temporal index helpers" << std::endl;
}

void test_default_cir_allocation_state() {
  std::cout << "Testing default CIR allocation state..." << std::endl;

  DigitalTwinClient::CIRBatchAllocation allocation;

  assert(allocation.temporal_indices.empty());
  assert(allocation.ru_indices_per_ts.empty());
  assert(allocation.ue_indices_per_ts.empty());
  assert(allocation.total_values_bytes == 0);
  assert(allocation.total_delays_bytes == 0);
  assert(allocation.total_angles_of_departure_bytes == 0);
  assert(allocation.total_angles_of_arrival_bytes == 0);
  assert(allocation.num_time_steps == 0);
  assert(!allocation.values_fetched);
  assert(!allocation.delays_fetched);
  assert(!allocation.angles_of_departure_fetched);
  assert(!allocation.angles_of_arrival_fetched);
  assert(allocation.angles_of_departure_ipc_handle.empty());
  assert(allocation.angles_of_arrival_ipc_handle.empty());
  assert(allocation.angles_of_departure_shapes_per_ts.empty());
  assert(allocation.angles_of_arrival_shapes_per_ts.empty());
  assert(allocation.angles_of_departure_time_step_offsets.empty());
  assert(allocation.angles_of_arrival_time_step_offsets.empty());
  assert(allocation.angles_of_departure_ru_offsets_per_ts.empty());
  assert(allocation.angles_of_arrival_ru_offsets_per_ts.empty());

  std::cout << "  PASS default CIR allocation state" << std::endl;
}

void test_unreachable_server_fails_cleanly() {
  std::cout << "Testing unreachable server failure path..." << std::endl;

  const char *env_addr = std::getenv("DT_CLIENT_TEST_UNREACHABLE_ADDR");
  const std::string server_address = env_addr ? env_addr : "127.0.0.1:1";

  bool threw = false;

  try {
    auto channel =
        grpc::CreateChannel(server_address, grpc::InsecureChannelCredentials());
    DigitalTwinClient client(channel);
    (void)client;
  } catch (const std::runtime_error &e) {
    threw = true;
    const std::string message = e.what();
    assert(message.find("Connect failed") != std::string::npos ||
           message.find("Transport negotiation failed") != std::string::npos);
    std::cout << "  PASS unreachable server failure path: " << message
              << std::endl;
  }

  assert(threw && "Expected unreachable server constructor to throw");
}

} // namespace

int main() {
  std::cout << "=== Standalone Client Smoke Tests ===" << std::endl
            << std::endl;

  try {
    test_temporal_index_types();
    test_default_cir_allocation_state();
    test_unreachable_server_fails_cleanly();
  } catch (const std::exception &e) {
    std::cerr << "Smoke test failed: " << e.what() << std::endl;
    return 1;
  }

  std::cout << std::endl
            << "=== All standalone client smoke tests passed ===" << std::endl;
  return 0;
}
