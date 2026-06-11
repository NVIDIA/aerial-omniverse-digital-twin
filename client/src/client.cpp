// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "client.h"
#include "logger.hpp"

#include <atomic>
#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>
#include <fstream>
#include <future>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <thread>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#define CLOSE_SOCKET closesocket
#else
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>
#define CLOSE_SOCKET close
#endif

// Use protobuf namespace
using dt_service::AllocRequest;
using dt_service::CancelSimulationReply;
using dt_service::CancelSimulationRequest;
using dt_service::CIRResultsAllocReply;
using dt_service::CIRResultsAllocRequest;
using dt_service::CIRResultsDeallocRequest;
using dt_service::CIRResultsReply;
using dt_service::CIRResultsRequest;
using dt_service::ClearExportedResultsRequest;
using dt_service::ConnectReply;
using dt_service::ConnectRequest;
using dt_service::DataReply;
using dt_service::DataRequest;
using dt_service::DataTransferChunk;
using dt_service::DataTransferPullReply;
using dt_service::DataTransferPullRequest;
using dt_service::DataTransportReply;
using dt_service::DataTransportRequest;
using dt_service::DisconnectReply;
using dt_service::DisconnectRequest;
using dt_service::DTWorker;
using dt_service::ExportResultsProgress;
using dt_service::ExportResultsRequest;
using dt_service::GPUMemoryHandle;
using dt_service::GPUReply;
using dt_service::GPURequest;
using dt_service::MatrixShape;
using dt_service::Position3D;
using dt_service::PrepareMapProgress;
using dt_service::PrepareMapRequest;
using dt_service::RUPositionReply;
using dt_service::RUPositionRequest;
using dt_service::ScenarioStatusReply;
using dt_service::ScenarioStatusRequest;
using dt_service::StartReply;
using dt_service::StartRequest;
using dt_service::StatusReply;
using dt_service::UEPositionReply;
using dt_service::UEPositionRequest;
using grpc::Channel;
using grpc::ClientContext;
using grpc::Status;

namespace {

// Builds a single-line progress bar string for in-place stderr updates.
// Format: [=========>          ] 45.0% (90/200) stage
std::string FormatProgressBar(float percent, int current, int total,
                              const std::string &stage) {
  const int bar_width = 30;
  int filled =
      (total > 0) ? static_cast<int>(bar_width * (percent / 100.0f) + 0.5f) : 0;
  if (filled > bar_width) {
    filled = bar_width;
  }
  std::ostringstream oss;
  oss << "[";
  for (int i = 0; i < bar_width; ++i) {
    if (i < filled)
      oss << "=";
    else if (i == filled)
      oss << ">";
    else
      oss << " ";
  }
  oss << "] " << std::fixed << std::setprecision(1) << percent << "%";
  if (total > 0) {
    oss << " (" << current << "/" << total << ")";
  }
  oss << " " << stage;
  return oss.str();
}

std::string FormatIndeterminateProgress(const std::string &stage,
                                        char spinner) {
  std::ostringstream oss;
  oss << stage << " " << spinner;
  return oss.str();
}

// Tracks throttled progress-bar redraws to avoid excessive stderr output.
struct ProgressBarTracker {
  float last_percent = -1.0f;
  std::chrono::steady_clock::time_point last_redraw =
      std::chrono::steady_clock::now();

  void MaybeRedraw(float pct, int current, int total,
                   const std::string &stage) {
    auto now = std::chrono::steady_clock::now();
    auto elapsed_ms =
        std::chrono::duration<double, std::milli>(now - last_redraw).count();
    bool should_redraw = (last_percent < 0) || (elapsed_ms >= 200.0) ||
                         (std::abs(pct - last_percent) >= 0.5f);
    if (should_redraw) {
      last_percent = pct;
      last_redraw = now;
      std::string bar = FormatProgressBar(pct, current, total, stage);
      std::cerr << "\r\033[K" << bar << std::flush;
    }
  }
};

} // namespace

DigitalTwinClient::DigitalTwinClient(std::shared_ptr<::grpc::Channel> channel,
                                     bool force)
    : stub_(DTWorker::NewStub(channel)) {
  if (!Connect(force)) {
    throw std::runtime_error(
        "Connect failed (check logs for details). Common causes: server "
        "unreachable (wrong host/port) or server already has an active "
        "client.");
  }
  if (!NegotiateDataTransport()) {
    throw std::runtime_error("Transport negotiation failed");
  }
}

DigitalTwinClient::~DigitalTwinClient() {
  if (!client_id_.empty()) {
    DisconnectRequest request;
    request.set_client_id(client_id_);
    DisconnectReply reply;
    grpc::ClientContext ctx;
    ctx.set_deadline(std::chrono::system_clock::now() +
                     std::chrono::seconds(5));
    stub_->Disconnect(&ctx, request, &reply);
  }
  ucx_transport_.Disconnect();

  StopServerLogStreaming();
}

bool DigitalTwinClient::Connect(bool force) {
  LOG(INFO) << "\n=== Connect ===";

  ConnectRequest request;
  request.set_force(force);
  ConnectReply reply;
  ClientContext context;

  Status status = stub_->Connect(&context, request, &reply);
  if (!status.ok() || !reply.success()) {
    LOG(ERROR) << "Connect rejected: "
               << (status.ok() ? reply.message() : status.error_message());
    return false;
  }

  client_id_ = reply.client_id();
  LOG(INFO) << "Connected with session id: " << client_id_;
  return true;
}

bool DigitalTwinClient::NegotiateDataTransport() {
  LOG(INFO) << "\n=== Negotiate Data Transport ===";

  DataTransportRequest request;

  // Get client's routable IP for co-location detection.
  // AODT_HOST_IP takes priority: when running in a Docker bridge container
  // the UDP-to-8.8.8.8 trick returns the container's internal IP, which
  // won't match the server's host IP even when both are on the same machine.
  // container/run.sh sets AODT_HOST_IP to the host's routable IP so that
  // same-host detection works correctly regardless of container networking.
  {
    const char *explicit_host = std::getenv("AODT_HOST_IP");
    if (explicit_host && explicit_host[0] != '\0') {
      request.set_client_hostname(explicit_host);
    } else {
      int sock = socket(AF_INET, SOCK_DGRAM, 0);
      struct sockaddr_in serv = {};
      serv.sin_family = AF_INET;
      serv.sin_port = htons(80);
      inet_pton(AF_INET, "8.8.8.8", &serv.sin_addr);

      char ip[INET_ADDRSTRLEN] = {};
      if (sock >= 0 && connect(sock, reinterpret_cast<sockaddr *>(&serv),
                               sizeof(serv)) == 0) {
        struct sockaddr_in local = {};
        socklen_t len = sizeof(local);
        getsockname(sock, reinterpret_cast<sockaddr *>(&local), &len);
        inet_ntop(AF_INET, &local.sin_addr, ip, sizeof(ip));
      } else {
        char hostname[256];
        gethostname(hostname, sizeof(hostname));
        struct hostent *he = gethostbyname(hostname);
        if (he && he->h_addr_list[0]) {
          struct in_addr addr;
          memcpy(&addr, he->h_addr_list[0], sizeof(addr));
          strncpy(ip, inet_ntoa(addr), sizeof(ip) - 1);
        } else {
          strncpy(ip, hostname, sizeof(ip) - 1);
        }
      }
      if (sock >= 0)
        CLOSE_SOCKET(sock);
      request.set_client_hostname(ip);
    }
  }

#ifdef HAVE_CUDA
  // Detect client GPU: uses whichever device the caller has set
  // (via cudaSetDevice or CUDA
  int device_count = 0;
  cudaError_t cuda_err = cudaGetDeviceCount(&device_count);
  if (cuda_err == cudaSuccess && device_count > 0) {
    has_gpu_ = true;
    int device_id = -1;
    cudaGetDevice(&device_id);
    cudaDeviceProp props;
    cudaGetDeviceProperties(&props, device_id);
    LOG(INFO) << "Client GPU: device " << device_id << " (" << props.name
              << ")";
    request.set_client_gpu_uuid(std::string(
        reinterpret_cast<const char *>(&props.uuid), sizeof(props.uuid)));
  } else {
    has_gpu_ = false;
    cudaGetLastError();
    LOG(INFO) << "No GPU detected on client";
    request.set_client_gpu_uuid("");
  }
#else
  has_gpu_ = false;
  LOG(INFO) << "Built without CUDA — no GPU support";
  request.set_client_gpu_uuid("");
#endif

  DataTransportReply reply;
  ClientContext context;
  Status status = stub_->NegotiateDataTransport(&context, request, &reply);

  if (!status.ok() || !reply.success()) {
    LOG(ERROR) << "NegotiateDataTransport failed: " << status.error_message();
    if (!reply.message().empty())
      LOG(ERROR) << "Server: " << reply.message();
    return false;
  }

  mode_ = reply.mode();
  remote_transfer_protocol_ = reply.remote_transfer_protocol();

  LOG(INFO) << "Transport negotiated:";
  LOG(INFO) << "  Mode: "
            << (mode_ == dt_service::LOCAL_IPC ? "LOCAL_IPC (cuda_ipc)"
                                               : "REMOTE");
  if (mode_ == dt_service::REMOTE) {
    LOG(INFO) << "  Remote transfer protocol: "
              << (remote_transfer_protocol_ == dt_service::UCX ? "UCX"
                                                               : "gRPC");
  }
  LOG(INFO) << "  Client has CUDA: " << (has_gpu_ ? "yes" : "no");

  if (mode_ == dt_service::REMOTE &&
      remote_transfer_protocol_ == dt_service::UCX) {
    LOG(INFO) << "  UCX endpoint: " << reply.ucx_host() << ":"
              << reply.ucx_port();
    if (!ucx_transport_.Connect(reply.ucx_host(), reply.ucx_port())) {
      LOG(WARNING) << "UCX transport unavailable; remote UCX fetches will fail";
    }
  }

  return true;
}

bool DigitalTwinClient::Start(const std::string &yaml_content) {
  LOG(INFO) << "\n=== Start Scenario ===";
  LOG(INFO) << "Loading scenario from YAML content (" << yaml_content.size()
            << " bytes)";

  if (yaml_content.empty()) {
    LOG(ERROR) << "Error: YAML content is empty";
    return false;
  }

  // Prepare request with file content
  StartRequest request;
  request.set_yaml_config(yaml_content);

  StartReply reply;
  ClientContext context;

  // Make RPC call
  auto start = std::chrono::high_resolution_clock::now();
  Status status = stub_->Start(&context, request, &reply);
  auto end = std::chrono::high_resolution_clock::now();

  if (status.ok() && reply.success()) {
    auto total_time =
        std::chrono::duration<double, std::milli>(end - start).count();

    LOG(INFO) << "Success!";
    LOG(INFO) << "  Scenario loaded successfully";
    LOG(INFO) << "  Number of RUs: " << reply.num_rus();
    LOG(INFO) << "  Number of UEs: " << reply.num_ues();
    LOG(INFO) << "  Total batches: " << reply.total_batches();

    // Check which temporal mode field is set
    if (reply.temporal_steps_case() == StartReply::kSlotsPerBatch) {
      LOG(INFO) << "  Temporal Mode: Slot/Symbols";
      LOG(INFO) << "  Slots per batch: " << reply.slots_per_batch();
    } else if (reply.temporal_steps_case() == StartReply::kTimeStepsPerBatch) {
      LOG(INFO) << "  Temporal Mode: Duration/Interval";
      LOG(INFO) << "  Time steps per batch: " << reply.time_steps_per_batch();
    }

    LOG(INFO) << "  Loading time: " << total_time << " ms";
    LOG(INFO) << "  Message: " << reply.message();

    return true;
  } else {
    LOG(ERROR) << "Start failed: " << status.error_message();
    if (!reply.message().empty()) {
      LOG(ERROR) << "Server message: " << reply.message();
    }
    return false;
  }
}

bool DigitalTwinClient::GetScenarioStatus(
    bool &scenario_loaded, int &num_rus, int &num_ues, int &total_batches,
    bool &is_slot_symbol_mode, int &num_slots_or_timesteps_per_batch) {
  LOG(INFO) << "\n=== Get Scenario Status ===";

  // Prepare request (empty)
  ScenarioStatusRequest request;

  ScenarioStatusReply reply;
  ClientContext context;

  // Make RPC call
  Status status = stub_->GetScenarioStatus(&context, request, &reply);

  if (status.ok()) {
    // Extract status information
    scenario_loaded = reply.scenario_loaded();
    num_rus = reply.num_rus();
    num_ues = reply.num_ues();
    total_batches = reply.total_batches();

    // Check which temporal mode field is set
    if (reply.temporal_steps_case() == ScenarioStatusReply::kSlotsPerBatch) {
      is_slot_symbol_mode = true;
      num_slots_or_timesteps_per_batch = reply.slots_per_batch();
    } else if (reply.temporal_steps_case() ==
               ScenarioStatusReply::kTimeStepsPerBatch) {
      is_slot_symbol_mode = false;
      num_slots_or_timesteps_per_batch = reply.time_steps_per_batch();
    } else {
      is_slot_symbol_mode = true; // Default to slot mode
      num_slots_or_timesteps_per_batch = 0;
    }

    LOG(INFO) << "Success!";
    LOG(INFO) << "  Scenario loaded: " << (scenario_loaded ? "Yes" : "No");

    if (scenario_loaded) {
      LOG(INFO) << "  Number of RUs: " << num_rus;
      LOG(INFO) << "  Number of UEs: " << num_ues;
      LOG(INFO) << "  Total batches: " << total_batches;
      if (is_slot_symbol_mode) {
        LOG(INFO) << "  Temporal Mode: Slot/Symbols";
        LOG(INFO) << "  Slots per batch: " << num_slots_or_timesteps_per_batch;
      } else {
        LOG(INFO) << "  Temporal Mode: Duration/Interval";
        LOG(INFO) << "  Time steps per batch: "
                  << num_slots_or_timesteps_per_batch;
      }
      LOG(INFO) << "  Allocated memory blocks: "
                << reply.allocated_memory_blocks();
    }

    if (!reply.message().empty()) {
      LOG(INFO) << "  Message: " << reply.message();
    }

    return true;
  } else {
    LOG(ERROR) << "GetScenarioStatus failed: " << status.error_message();
    return false;
  }
}

bool DigitalTwinClient::RunFullSimulation(int &time_steps_completed,
                                          float &total_time_seconds) {
  LOG(INFO) << "\n=== Run Full Simulation ===";
  LOG(INFO) << "Starting full simulation run...";

  // Prepare request (empty - no fields needed)
  dt_service::RunFullSimulationRequest request;
  ClientContext context;

  // Server-side streaming: read progress messages until the stream ends
  auto start = std::chrono::high_resolution_clock::now();
  auto reader = stub_->RunFullSimulation(&context, request);

  dt_service::RunFullSimulationProgress progress;
  bool last_success = false;
  std::string last_message;
  ProgressBarTracker bar_tracker;

  while (reader->Read(&progress)) {
    time_steps_completed = progress.time_steps_completed();
    total_time_seconds = progress.elapsed_seconds();
    last_success = progress.success();
    last_message = progress.message();

    bar_tracker.MaybeRedraw(progress.percent_complete(),
                            progress.time_steps_completed(),
                            progress.total_time_steps(), progress.stage());
  }
  std::cerr << "\n";

  Status status = reader->Finish();
  auto end = std::chrono::high_resolution_clock::now();
  auto total_time =
      std::chrono::duration<double, std::milli>(end - start).count();

  if (status.ok() && last_success) {
    LOG(INFO) << "Success!";
    LOG(INFO) << "  Time steps completed: " << time_steps_completed;
    LOG(INFO) << "  Simulation time: " << total_time_seconds << " seconds";
    LOG(INFO) << "  Total round-trip time: " << total_time << " ms";
    LOG(INFO) << "  Message: " << last_message;
    return true;
  } else {
    LOG(ERROR) << "RunFullSimulation failed";
    if (!status.ok()) {
      LOG(ERROR) << "  gRPC error: " << status.error_message();
    }
    if (!last_message.empty()) {
      LOG(ERROR) << "  Server message: " << last_message;
    }
    return false;
  }
}

bool DigitalTwinClient::RunCalibration(float &total_time_seconds,
                                       std::string &final_stage,
                                       std::string &message) {
  LOG(INFO) << "\n=== Run Calibration ===";
  LOG(INFO) << "Starting calibration run...";

  dt_service::RunCalibrationRequest request;
  ClientContext context;

  auto start = std::chrono::high_resolution_clock::now();
  auto reader = stub_->RunCalibration(&context, request);

  dt_service::RunCalibrationProgress progress;
  bool last_success = false;
  ProgressBarTracker bar_tracker;
  std::atomic_bool spinner_stop{true};
  std::future<void> spinner_task;

  auto stop_spinner = [&]() {
    if (!spinner_stop.exchange(true) && spinner_task.valid()) {
      spinner_task.wait();
    }
  };

  auto start_spinner = [&](const std::string &stage) {
    stop_spinner();
    spinner_stop = false;
    spinner_task = std::async(std::launch::async, [&, stage]() {
      constexpr std::array<char, 4> frames{'|', '/', '-', '\\'};
      std::size_t frame = 0;
      while (!spinner_stop.load()) {
        std::cerr << "\r\033[K"
                  << FormatIndeterminateProgress(
                         stage, frames[frame++ % frames.size()])
                  << std::flush;
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
      }
    });
  };

  while (reader->Read(&progress)) {
    stop_spinner();
    total_time_seconds = progress.elapsed_seconds();
    final_stage = progress.stage();
    message = progress.message();
    last_success = progress.success();

    if (progress.stage() == "running" && !progress.success()) {
      start_spinner(progress.stage());
    } else {
      bar_tracker.MaybeRedraw(progress.percent_complete(), 0, 0,
                              progress.stage());
    }
  }
  stop_spinner();
  std::cerr << "\n";

  Status status = reader->Finish();
  auto end = std::chrono::high_resolution_clock::now();
  auto total_time =
      std::chrono::duration<double, std::milli>(end - start).count();

  if (status.ok() && last_success) {
    LOG(INFO) << "Success!";
    LOG(INFO) << "  Final stage: " << final_stage;
    LOG(INFO) << "  Calibration time: " << total_time_seconds << " seconds";
    LOG(INFO) << "  Total round-trip time: " << total_time << " ms";
    LOG(INFO) << "  Message: " << message;
    return true;
  }

  LOG(ERROR) << "RunCalibration failed";
  if (!status.ok()) {
    LOG(ERROR) << "  gRPC error: " << status.error_message();
  }
  if (!message.empty()) {
    LOG(ERROR) << "  Server message: " << message;
  }
  return false;
}

bool DigitalTwinClient::CancelSimulation(const std::string &reason) {
  LOG(INFO) << "\n=== Cancel Simulation ===";
  LOG(INFO) << "Requesting cancellation: "
            << (reason.empty() ? "(no reason)" : reason);

  CancelSimulationRequest request;
  if (!reason.empty()) {
    request.set_reason(reason);
  }

  CancelSimulationReply reply;
  ClientContext context;

  Status status = stub_->CancelSimulation(&context, request, &reply);

  if (status.ok() && reply.success()) {
    LOG(INFO) << "Cancellation accepted: " << reply.message();
    return true;
  } else {
    LOG(ERROR) << "CancelSimulation failed";
    if (!status.ok()) {
      LOG(ERROR) << "  gRPC error: " << status.error_message();
    }
    if (!reply.message().empty()) {
      LOG(ERROR) << "  Server message: " << reply.message();
    }
    return false;
  }
}

bool DigitalTwinClient::GetRUPositions(
    std::vector<std::array<float, 3>> &positions) {
  LOG(INFO) << "\n=== Get RU Positions ===";
  LOG(INFO) << "Requesting RU positions (static infrastructure)";

  // Prepare request (no fields needed for static RUs)
  RUPositionRequest request;

  RUPositionReply reply;
  ClientContext context;

  // Make RPC call
  auto start = std::chrono::high_resolution_clock::now();
  Status status = stub_->GetRUPositions(&context, request, &reply);
  auto end = std::chrono::high_resolution_clock::now();

  if (status.ok()) {
    // Clear output vector and resize
    positions.clear();
    positions.reserve(reply.count());

    // Extract positions from reply
    for (int i = 0; i < reply.positions_size(); i++) {
      const Position3D &pos = reply.positions(i);
      positions.push_back({pos.x(), pos.y(), pos.z()});
    }

    auto total_time =
        std::chrono::duration<double, std::milli>(end - start).count();

    LOG(INFO) << "Success!";
    LOG(INFO) << "  Number of RUs: " << reply.count();
    LOG(INFO) << "  Total round-trip time: " << total_time << " ms";

    return true;
  } else {
    LOG(ERROR) << "GetRUPositions failed: " << status.error_message();
    return false;
  }
}

bool DigitalTwinClient::GetUEPositions(
    int batch_index, const TemporalIndex &temporal_index,
    std::vector<std::array<float, 3>> &positions) {
  LOG(INFO) << "\n=== Get UE Positions ===";

  // Prepare request with appropriate temporal index
  UEPositionRequest request;
  request.set_batch_index(batch_index);

  // Use std::visit to handle the variant and set the appropriate field
  std::visit(
      [&](auto &&arg) {
        using T = std::decay_t<decltype(arg)>;
        if constexpr (std::is_same_v<T, SlotIndex>) {
          request.set_slot_index(arg.value);
          LOG(INFO) << "Requesting UE positions for batch: " << batch_index
                    << ", slot: " << arg.value << " (in slot/symbol mode)";
        } else if constexpr (std::is_same_v<T, TimeStepIndex>) {
          request.set_time_step_index(arg.value);
          LOG(INFO) << "Requesting UE positions for batch: " << batch_index
                    << ", time_step: " << arg.value
                    << " (in duration/interval mode)";
        }
      },
      temporal_index);

  UEPositionReply reply;
  ClientContext context;

  // Make RPC call
  auto start = std::chrono::high_resolution_clock::now();
  Status status = stub_->GetUEPositions(&context, request, &reply);
  auto end = std::chrono::high_resolution_clock::now();

  if (status.ok()) {
    // Clear output vector and resize
    positions.clear();
    positions.reserve(reply.count());

    // Extract positions from reply
    for (int i = 0; i < reply.positions_size(); i++) {
      const Position3D &pos = reply.positions(i);
      positions.push_back({pos.x(), pos.y(), pos.z()});
    }

    auto total_time =
        std::chrono::duration<double, std::milli>(end - start).count();

    LOG(INFO) << "Success!";
    LOG(INFO) << "  Number of UEs: " << reply.count();
    LOG(INFO) << "  Total round-trip time: " << total_time << " ms";

    return true;
  } else {
    LOG(ERROR) << "GetUEPositions failed: " << status.error_message();
    return false;
  }
}

// Helper function to set temporal indices in CIR request
static void SetMultiTemporalIndices(CIRResultsRequest &request,
                                    const MultiTemporalIndex &temporal_index) {
  std::visit(
      [&](auto &&arg) {
        using T = std::decay_t<decltype(arg)>;
        if constexpr (std::is_same_v<T, SlotIndex>) {
          request.set_slot_index(arg.value);
        } else if constexpr (std::is_same_v<T, TimeStepIndex>) {
          request.set_time_step_index(arg.value);
        } else if constexpr (std::is_same_v<T, SlotIndices>) {
          auto *slot_indices_msg = request.mutable_slot_indices();
          for (int idx : arg.values) {
            slot_indices_msg->add_values(idx);
          }
        } else if constexpr (std::is_same_v<T, TimeStepIndices>) {
          auto *time_step_indices_msg = request.mutable_time_step_indices();
          for (int idx : arg.values) {
            time_step_indices_msg->add_values(idx);
          }
        }
      },
      temporal_index);
}

// Helper function to get temporal index count
static size_t GetTemporalIndexCount(const MultiTemporalIndex &temporal_index) {
  return std::visit(
      [](auto &&arg) -> size_t {
        using T = std::decay_t<decltype(arg)>;
        if constexpr (std::is_same_v<T, SlotIndex> ||
                      std::is_same_v<T, TimeStepIndex>) {
          return 1;
        } else {
          return arg.values.size();
        }
      },
      temporal_index);
}

// Broadcast style: same config for all time steps
bool DigitalTwinClient::AllocateCIRResultsMemory(
    const std::vector<int> &ru_indices,
    const std::vector<std::vector<int>> &ue_indices_per_ru,
    bool is_full_antenna_pair, CIRBatchAllocation &allocation,
    int num_time_steps) {
  LOG(INFO) << "\n=== Allocate CIR Results Memory (Broadcast) ===";
  LOG(INFO) << "Allocating batch for " << num_time_steps
            << " time steps (same config)";
  LOG(INFO) << "  RU indices: " << ru_indices.size() << " RUs";

  if (num_time_steps <= 0) {
    LOG(ERROR) << "Error: num_time_steps must be positive";
    return false;
  }

  // Expand broadcast config to per-time-step format
  std::vector<std::vector<int>> ru_indices_per_ts(num_time_steps, ru_indices);
  std::vector<std::vector<std::vector<int>>> ue_indices_per_ts(
      num_time_steps, ue_indices_per_ru);

  // Delegate to per-time-step implementation
  return AllocateCIRResultsMemory(ru_indices_per_ts, ue_indices_per_ts,
                                  is_full_antenna_pair, allocation);
}

// Per-time-step style: variable config per time step
bool DigitalTwinClient::AllocateCIRResultsMemory(
    const std::vector<std::vector<int>> &ru_indices_per_ts,
    const std::vector<std::vector<std::vector<int>>> &ue_indices_per_ts,
    bool is_full_antenna_pair, CIRBatchAllocation &allocation) {
  int num_time_steps = static_cast<int>(ru_indices_per_ts.size());
  LOG(INFO) << "\n=== Allocate CIR Batch ===";
  LOG(INFO) << "Allocating batch for " << num_time_steps
            << " time steps (variable config)";

  // Validate input dimensions
  if (ru_indices_per_ts.size() != ue_indices_per_ts.size()) {
    LOG(ERROR) << "Error: Number of time steps in ru_indices_per_ts ("
               << ru_indices_per_ts.size() << ") must match ue_indices_per_ts ("
               << ue_indices_per_ts.size() << ")";
    return false;
  }

  // Prepare request with per-time-step config
  CIRResultsAllocRequest request;
  for (const auto &ru_list : ru_indices_per_ts) {
    auto *ru_list_msg = request.add_ru_indices_per_ts();
    for (int ru_idx : ru_list) {
      ru_list_msg->add_values(ru_idx);
    }
  }
  for (const auto &ue_list_per_ru : ue_indices_per_ts) {
    auto *ue_list_list_msg = request.add_ue_indices_per_ts();
    for (const auto &ue_list : ue_list_per_ru) {
      auto *ue_list_msg = ue_list_list_msg->add_lists();
      for (int ue_idx : ue_list) {
        ue_list_msg->add_values(ue_idx);
      }
    }
  }
  request.set_is_full_antenna_pair(is_full_antenna_pair);

  CIRResultsAllocReply reply;
  ClientContext context;

  auto start = std::chrono::high_resolution_clock::now();
  Status status = stub_->AllocateCIRResultsMemory(&context, request, &reply);
  auto end = std::chrono::high_resolution_clock::now();

  if (status.ok() && reply.success()) {
    // Populate allocation struct
    allocation.mode = reply.transport_mode();
    allocation.values_ipc_handle = reply.values_ipc_handle();
    allocation.delays_ipc_handle = reply.delays_ipc_handle();
    allocation.angles_of_departure_ipc_handle =
        reply.angles_of_departure_ipc_handle();
    allocation.angles_of_arrival_ipc_handle =
        reply.angles_of_arrival_ipc_handle();

    // Copy per-time-step shapes
    allocation.values_shapes_per_ts.clear();
    allocation.delays_shapes_per_ts.clear();
    allocation.angles_of_departure_shapes_per_ts.clear();
    allocation.angles_of_arrival_shapes_per_ts.clear();
    for (int ts = 0; ts < reply.values_shapes_per_ts_size(); ts++) {
      std::vector<dt_service::MatrixShape> ts_shapes;
      for (int ru = 0; ru < reply.values_shapes_per_ts(ts).shapes_size();
           ru++) {
        ts_shapes.push_back(reply.values_shapes_per_ts(ts).shapes(ru));
      }
      allocation.values_shapes_per_ts.push_back(ts_shapes);
    }
    for (int ts = 0; ts < reply.delays_shapes_per_ts_size(); ts++) {
      std::vector<dt_service::MatrixShape> ts_shapes;
      for (int ru = 0; ru < reply.delays_shapes_per_ts(ts).shapes_size();
           ru++) {
        ts_shapes.push_back(reply.delays_shapes_per_ts(ts).shapes(ru));
      }
      allocation.delays_shapes_per_ts.push_back(ts_shapes);
    }
    for (int ts = 0; ts < reply.angles_of_departure_shapes_per_ts_size();
         ts++) {
      std::vector<dt_service::MatrixShape> ts_shapes;
      for (int ru = 0;
           ru < reply.angles_of_departure_shapes_per_ts(ts).shapes_size();
           ru++) {
        ts_shapes.push_back(
            reply.angles_of_departure_shapes_per_ts(ts).shapes(ru));
      }
      allocation.angles_of_departure_shapes_per_ts.push_back(ts_shapes);
    }
    for (int ts = 0; ts < reply.angles_of_arrival_shapes_per_ts_size(); ts++) {
      std::vector<dt_service::MatrixShape> ts_shapes;
      for (int ru = 0;
           ru < reply.angles_of_arrival_shapes_per_ts(ts).shapes_size(); ru++) {
        ts_shapes.push_back(
            reply.angles_of_arrival_shapes_per_ts(ts).shapes(ru));
      }
      allocation.angles_of_arrival_shapes_per_ts.push_back(ts_shapes);
    }

    // Copy per-time-step offset metadata
    allocation.values_time_step_offsets.clear();
    allocation.delays_time_step_offsets.clear();
    allocation.angles_of_departure_time_step_offsets.clear();
    allocation.angles_of_arrival_time_step_offsets.clear();
    for (int i = 0; i < reply.values_time_step_offsets_size(); i++) {
      allocation.values_time_step_offsets.push_back(
          reply.values_time_step_offsets(i));
    }
    for (int i = 0; i < reply.delays_time_step_offsets_size(); i++) {
      allocation.delays_time_step_offsets.push_back(
          reply.delays_time_step_offsets(i));
    }
    for (int i = 0; i < reply.angles_of_departure_time_step_offsets_size();
         i++) {
      allocation.angles_of_departure_time_step_offsets.push_back(
          reply.angles_of_departure_time_step_offsets(i));
    }
    for (int i = 0; i < reply.angles_of_arrival_time_step_offsets_size(); i++) {
      allocation.angles_of_arrival_time_step_offsets.push_back(
          reply.angles_of_arrival_time_step_offsets(i));
    }

    // Copy per-time-step RU offsets
    allocation.values_ru_offsets_per_ts.clear();
    allocation.delays_ru_offsets_per_ts.clear();
    allocation.angles_of_departure_ru_offsets_per_ts.clear();
    allocation.angles_of_arrival_ru_offsets_per_ts.clear();
    for (int ts = 0; ts < reply.values_ru_offsets_per_ts_size(); ts++) {
      std::vector<int64_t> ts_offsets;
      for (int ru = 0; ru < reply.values_ru_offsets_per_ts(ts).values_size();
           ru++) {
        ts_offsets.push_back(reply.values_ru_offsets_per_ts(ts).values(ru));
      }
      allocation.values_ru_offsets_per_ts.push_back(ts_offsets);
    }
    for (int ts = 0; ts < reply.delays_ru_offsets_per_ts_size(); ts++) {
      std::vector<int64_t> ts_offsets;
      for (int ru = 0; ru < reply.delays_ru_offsets_per_ts(ts).values_size();
           ru++) {
        ts_offsets.push_back(reply.delays_ru_offsets_per_ts(ts).values(ru));
      }
      allocation.delays_ru_offsets_per_ts.push_back(ts_offsets);
    }
    for (int ts = 0; ts < reply.angles_of_departure_ru_offsets_per_ts_size();
         ts++) {
      std::vector<int64_t> ts_offsets;
      for (int ru = 0;
           ru < reply.angles_of_departure_ru_offsets_per_ts(ts).values_size();
           ru++) {
        ts_offsets.push_back(
            reply.angles_of_departure_ru_offsets_per_ts(ts).values(ru));
      }
      allocation.angles_of_departure_ru_offsets_per_ts.push_back(ts_offsets);
    }
    for (int ts = 0; ts < reply.angles_of_arrival_ru_offsets_per_ts_size();
         ts++) {
      std::vector<int64_t> ts_offsets;
      for (int ru = 0;
           ru < reply.angles_of_arrival_ru_offsets_per_ts(ts).values_size();
           ru++) {
        ts_offsets.push_back(
            reply.angles_of_arrival_ru_offsets_per_ts(ts).values(ru));
      }
      allocation.angles_of_arrival_ru_offsets_per_ts.push_back(ts_offsets);
    }

    // Copy total sizes
    allocation.total_values_bytes = reply.total_values_bytes();
    allocation.total_delays_bytes = reply.total_delays_bytes();
    allocation.total_angles_of_departure_bytes =
        reply.total_angles_of_departure_bytes();
    allocation.total_angles_of_arrival_bytes =
        reply.total_angles_of_arrival_bytes();

    // Store server-side allocation key for pull-based transfer
    allocation.allocation_key = reply.allocation_key();

    // Copy echoed config
    allocation.num_time_steps = reply.num_time_steps();
    allocation.ru_indices_per_ts.clear();
    for (int ts = 0; ts < reply.ru_indices_per_ts_size(); ts++) {
      std::vector<int> ru_list;
      for (int ru = 0; ru < reply.ru_indices_per_ts(ts).values_size(); ru++) {
        ru_list.push_back(reply.ru_indices_per_ts(ts).values(ru));
      }
      allocation.ru_indices_per_ts.push_back(ru_list);
    }
    allocation.ue_indices_per_ts.clear();
    for (int ts = 0; ts < reply.ue_indices_per_ts_size(); ts++) {
      std::vector<std::vector<int>> ue_per_ru;
      for (int ru = 0; ru < reply.ue_indices_per_ts(ts).lists_size(); ru++) {
        std::vector<int> ue_list;
        for (int ue = 0;
             ue < reply.ue_indices_per_ts(ts).lists(ru).values_size(); ue++) {
          ue_list.push_back(reply.ue_indices_per_ts(ts).lists(ru).values(ue));
        }
        ue_per_ru.push_back(ue_list);
      }
      allocation.ue_indices_per_ts.push_back(ue_per_ru);
    }
    allocation.is_full_antenna_pair = reply.is_full_antenna_pair();

    auto total_time =
        std::chrono::duration<double, std::milli>(end - start).count();

    LOG(INFO) << "Success!";
    LOG(INFO) << "  " << reply.message();
    LOG(INFO) << "  Total values buffer: " << allocation.total_values_bytes
              << " bytes";
    LOG(INFO) << "  Total delays buffer: " << allocation.total_delays_bytes
              << " bytes";
    LOG(INFO) << "  Total AOD buffer: "
              << allocation.total_angles_of_departure_bytes << " bytes";
    LOG(INFO) << "  Total AOA buffer: "
              << allocation.total_angles_of_arrival_bytes << " bytes";
    LOG(INFO) << "  Memory allocation time: " << total_time << " ms";

    return true;
  } else {
    LOG(ERROR) << "AllocateCIRResultsMemory failed: ";
    if (!status.ok()) {
      LOG(ERROR) << status.error_message();
    } else {
      LOG(ERROR) << reply.message();
    }
    return false;
  }
}

bool DigitalTwinClient::DeallocateCIRResultsMemory(
    CIRBatchAllocation &allocation) {
  LOG(INFO) << "\n=== Deallocate CIR Results Memory ===";
  LOG(INFO) << "Deallocating batch (values: " << allocation.total_values_bytes
            << " bytes, delays: " << allocation.total_delays_bytes
            << " bytes, AOD: " << allocation.total_angles_of_departure_bytes
            << " bytes, AOA: " << allocation.total_angles_of_arrival_bytes
            << " bytes)";

  // Free server-side GPU memory via gRPC
  CIRResultsDeallocRequest request;
  request.set_values_ipc_handle(allocation.values_ipc_handle);
  request.set_delays_ipc_handle(allocation.delays_ipc_handle);
  request.set_angles_of_departure_ipc_handle(
      allocation.angles_of_departure_ipc_handle);
  request.set_angles_of_arrival_ipc_handle(
      allocation.angles_of_arrival_ipc_handle);
  request.set_allocation_key(allocation.allocation_key);

  StatusReply reply;
  ClientContext context;

  auto start = std::chrono::high_resolution_clock::now();
  Status status = stub_->DeallocateCIRResultsMemory(&context, request, &reply);
  auto end = std::chrono::high_resolution_clock::now();

  if (!status.ok() || !reply.success()) {
    LOG(ERROR) << "DeallocateCIRResultsMemory failed: ";
    if (!status.ok()) {
      LOG(ERROR) << status.error_message();
    } else {
      LOG(ERROR) << reply.message();
    }
    return false;
  }

  // Free client-side local buffers (allocated by FetchBuffer in REMOTE mode)
  auto free_buf = [](void *&ptr, MemoryType mt) {
    if (!ptr)
      return;
#ifdef HAVE_CUDA
    if (mt == MemoryType::GPU)
      cudaFree(ptr);
    else
#endif
      free(ptr);
    ptr = nullptr;
  };
  if (allocation.mode == dt_service::REMOTE) {
    free_buf(allocation.local_values_ptr, allocation.values_mem_type);
    free_buf(allocation.local_delays_ptr, allocation.delays_mem_type);
    free_buf(allocation.local_angles_of_departure_ptr,
             allocation.angles_of_departure_mem_type);
    free_buf(allocation.local_angles_of_arrival_ptr,
             allocation.angles_of_arrival_mem_type);
  }
  allocation.values_fetched = false;
  allocation.delays_fetched = false;
  allocation.angles_of_departure_fetched = false;
  allocation.angles_of_arrival_fetched = false;

  auto total_time =
      std::chrono::duration<double, std::milli>(end - start).count();

  LOG(INFO) << "Success!";
  LOG(INFO) << "  " << reply.message();
  LOG(INFO) << "  Deallocation time: " << total_time << " ms";

  return true;
}

bool DigitalTwinClient::GetChannelImpulseResponse(
    CIRBatchAllocation &allocation, int batch_index,
    const MultiTemporalIndex &temporal_index) {
  LOG(INFO) << "\n=== Get CIR (Multi-Time-Step Style) ===";

  size_t num_time_steps = GetTemporalIndexCount(temporal_index);
  size_t num_rus_ts0 = allocation.ru_indices_per_ts.empty()
                           ? 0
                           : allocation.ru_indices_per_ts[0].size();
  LOG(INFO) << "Computing CIR for " << num_time_steps << " time step(s), "
            << num_rus_ts0 << " RU(s) (for time step 0)";

  CIRResultsRequest request;

  if (mode_ == dt_service::LOCAL_IPC) {
    request.set_values_ipc_handle(allocation.values_ipc_handle);
    request.set_delays_ipc_handle(allocation.delays_ipc_handle);
    request.set_angles_of_departure_ipc_handle(
        allocation.angles_of_departure_ipc_handle);
    request.set_angles_of_arrival_ipc_handle(
        allocation.angles_of_arrival_ipc_handle);
  }
  request.set_allocation_key(allocation.allocation_key);
  request.set_batch_index(batch_index);

  SetMultiTemporalIndices(request, temporal_index);

  ClientContext context;

  // Server-side streaming: read progress messages until the stream ends
  auto start = std::chrono::high_resolution_clock::now();
  auto reader = stub_->GetChannelImpulseResponse(&context, request);

  // Invalidate cached buffers so next FetchBuffer triggers a fresh pull
  allocation.values_fetched = false;
  allocation.delays_fetched = false;
  allocation.angles_of_departure_fetched = false;
  allocation.angles_of_arrival_fetched = false;

  dt_service::CIRResultsProgress progress;
  bool last_success = false;
  std::string last_message;
  ProgressBarTracker bar_tracker;

  while (reader->Read(&progress)) {
    // Update allocation's temporal_indices from latest progress
    allocation.temporal_indices.clear();
    for (int i = 0; i < progress.computed_temporal_indices_size(); i++) {
      allocation.temporal_indices.push_back(
          progress.computed_temporal_indices(i));
    }
    last_success = progress.success();
    last_message = progress.message();

    bar_tracker.MaybeRedraw(progress.percent_complete(),
                            progress.current_index(), progress.total_indices(),
                            progress.stage());
  }
  std::cerr << "\n";

  Status status = reader->Finish();
  auto end = std::chrono::high_resolution_clock::now();
  auto total_time =
      std::chrono::duration<double, std::milli>(end - start).count();

  if (status.ok() && last_success) {
    LOG(INFO) << "Success!";
    LOG(INFO) << "  " << last_message;
    LOG(INFO) << "  Computed " << allocation.temporal_indices.size()
              << " time steps";
    LOG(INFO) << "  CIR computation time: " << total_time << " ms";
    return true;
  } else {
    LOG(ERROR) << "GetCIRBatch failed: ";
    if (!status.ok()) {
      LOG(ERROR) << status.error_message();
    }
    if (!last_message.empty()) {
      LOG(ERROR) << "Server message: " << last_message;
    }
    return false;
  }
}

#ifdef HAVE_CUDA

void DigitalTwinClient::PrintCIRResultsSample(void *values_gpu_ptr,
                                              void *delays_gpu_ptr,
                                              const MatrixShape &shape,
                                              int ru_idx) {
  LOG(INFO) << "\n=== CIR Results Sample Data ===";
  LOG(INFO) << "Reading sample CIR data from separate GPU memory blocks (RU "
            << ru_idx << ")";

  // Calculate sample size (limit to first few elements)
  int sample_size = std::min(10, shape.total_elements());

  // Allocate host memory for sample
  std::vector<std::complex<float>> sample_coefficients(sample_size);
  std::vector<float> sample_delays(sample_size);

  // Copy coefficients from separate coefficients memory block
  cudaError_t err1 = cudaMemcpy(sample_coefficients.data(), values_gpu_ptr,
                                sample_size * sizeof(std::complex<float>),
                                cudaMemcpyDeviceToHost);
  if (err1 != cudaSuccess) {
    LOG(ERROR) << "Failed to copy CIR coefficients: "
               << cudaGetErrorString(err1);
    return;
  }

  // Copy delays from separate delays memory block
  cudaError_t err2 =
      cudaMemcpy(sample_delays.data(), delays_gpu_ptr,
                 sample_size * sizeof(float), cudaMemcpyDeviceToHost);
  if (err2 != cudaSuccess) {
    LOG(ERROR) << "Failed to copy CIR delays: " << cudaGetErrorString(err2);
    return;
  }

  LOG(INFO) << "CIR Value (complex, first " << sample_size << "):";
  std::stringstream ss;
  ss << std::scientific << std::setprecision(3);
  for (int i = 0; i < sample_size; i++) {
    float real = sample_coefficients[i].real();
    float imag = sample_coefficients[i].imag();

    ss << "  [" << i << "] " << real;
    if (imag >= 0)
      ss << " + ";
    else
      ss << " - ";
    ss << std::abs(imag) << "i \n";
  }
  LOG(INFO) << ss.str();

  LOG(INFO) << "\nCIR Delays (float, first " << sample_size << "):";
  ss.str(""); // Clear the stringstream
  ss.clear(); // Clear any error flags
  for (int i = 0; i < sample_size; i++) {
    ss << "  [" << i << "] " << sample_delays[i] << " s \n";
  }
  LOG(INFO) << ss.str();
}

#endif // HAVE_CUDA (PrintCIRResultsSample)

ScopedBuffer DigitalTwinClient::FetchBuffer(CIRBatchAllocation &alloc,
                                            const std::string &buffer_type,
                                            MemoryType target) {
#ifdef HAVE_CUDA
  if (mode_ == dt_service::LOCAL_IPC) {
    LOG(INFO) << "FetchBuffer " << buffer_type << " via CUDA IPC (zero-copy)";
    const std::string *handle = nullptr;
    if (buffer_type == "values") {
      handle = &alloc.values_ipc_handle;
    } else if (buffer_type == "delays") {
      handle = &alloc.delays_ipc_handle;
    } else if (buffer_type == "angles_of_departure") {
      handle = &alloc.angles_of_departure_ipc_handle;
    } else if (buffer_type == "angles_of_arrival") {
      handle = &alloc.angles_of_arrival_ipc_handle;
    } else {
      LOG(ERROR) << "Unknown CIR buffer_type: " << buffer_type;
      return ScopedBuffer::from_cpu(nullptr);
    }
    return ScopedBuffer::from_ipc(*handle);
  }
#endif

  // LOCAL_IPC returned above; anything below is REMOTE transport.
  void **local_ptr = nullptr;
  bool *fetched = nullptr;
  MemoryType *mem_type = nullptr;
  int64_t nbytes = 0;

  if (buffer_type == "values") {
    local_ptr = &alloc.local_values_ptr;
    fetched = &alloc.values_fetched;
    mem_type = &alloc.values_mem_type;
    nbytes = alloc.total_values_bytes;
  } else if (buffer_type == "delays") {
    local_ptr = &alloc.local_delays_ptr;
    fetched = &alloc.delays_fetched;
    mem_type = &alloc.delays_mem_type;
    nbytes = alloc.total_delays_bytes;
  } else if (buffer_type == "angles_of_departure") {
    local_ptr = &alloc.local_angles_of_departure_ptr;
    fetched = &alloc.angles_of_departure_fetched;
    mem_type = &alloc.angles_of_departure_mem_type;
    nbytes = alloc.total_angles_of_departure_bytes;
  } else if (buffer_type == "angles_of_arrival") {
    local_ptr = &alloc.local_angles_of_arrival_ptr;
    fetched = &alloc.angles_of_arrival_fetched;
    mem_type = &alloc.angles_of_arrival_mem_type;
    nbytes = alloc.total_angles_of_arrival_bytes;
  } else {
    LOG(ERROR) << "Unknown CIR buffer_type: " << buffer_type;
    return ScopedBuffer::from_cpu(nullptr);
  }

  if (!*fetched && nbytes > 0) {
    *mem_type = target;

    auto cleanup_failed_fetch = [&]() {
      if (*local_ptr) {
#ifdef HAVE_CUDA
        if (*mem_type == MemoryType::GPU)
          cudaFree(*local_ptr);
        else
#endif
          free(*local_ptr);
      }
      *local_ptr = nullptr;
      *fetched = false;
    };

    auto null_buffer = [&]() {
      return (target == MemoryType::GPU) ? ScopedBuffer::from_gpu(nullptr)
                                         : ScopedBuffer::from_cpu(nullptr);
    };

#ifdef HAVE_CUDA
    if (target == MemoryType::GPU) {
      cudaError_t alloc_err = cudaMalloc(local_ptr, nbytes);
      if (alloc_err != cudaSuccess) {
        LOG(ERROR) << "FetchBuffer failed: GPU allocation failed for " << nbytes
                   << " bytes: " << cudaGetErrorString(alloc_err);
        *local_ptr = nullptr;
        *fetched = false;
        return ScopedBuffer::from_gpu(nullptr);
      }
    } else
#else
    if (target == MemoryType::GPU) {
      LOG(ERROR)
          << "FetchBuffer requested GPU memory but this build has no CUDA";
      *fetched = false;
      return ScopedBuffer::from_gpu(nullptr);
    }
#endif
    {
      *local_ptr = malloc(nbytes);
      if (!*local_ptr) {
        LOG(ERROR) << "FetchBuffer failed: host allocation failed for "
                   << nbytes << " bytes";
        *fetched = false;
        return ScopedBuffer::from_cpu(nullptr);
      }
    }

    DataTransferPullRequest pull_req;
    pull_req.set_allocation_key(alloc.allocation_key);
    pull_req.set_buffer_type(buffer_type);

    if (remote_transfer_protocol_ == dt_service::UCX) {
#ifdef HAVE_UCX
      uint64_t tag = NextTag();
      bool is_gpu = (target == MemoryType::GPU);
      pull_req.set_tag(tag);

      LOG(INFO) << "FetchBuffer " << buffer_type << " via UCX"
                << " (tag=" << tag << ", " << nbytes
                << " bytes, remote server -> local " << (is_gpu ? "GPU" : "CPU")
                << ")";

      // Post the UCX receive BEFORE the gRPC request. For large buffers
      // (>256 KB) UCX uses the rendezvous protocol, which requires the
      // receiver to have a matching tag receive posted before the sender's
      // tag send can complete.
      void *recv_req = ucx_transport_.PostRecv(*local_ptr, nbytes, tag, is_gpu);

      // Run the gRPC call in a background thread so the main thread can
      // drive UCX progress (WaitRecv) concurrently. The server blocks
      // inside this RPC until its UCX tag send completes, which requires
      // our UCX worker to be progressed for the rendezvous handshake.
      DataTransferPullReply pull_reply;
      auto grpc_future = std::async(std::launch::async, [&]() {
        ClientContext ctx;
        ctx.set_deadline(std::chrono::system_clock::now() +
                         std::chrono::seconds(10));
        return stub_->RequestDataTransfer(&ctx, pull_req, &pull_reply);
      });

      LOG(INFO) << "  Waiting for UCX data transfer...";
      bool ok = ucx_transport_.WaitRecv(recv_req);

      Status st = grpc_future.get();
      if (!st.ok() || !pull_reply.success()) {
        LOG(ERROR) << "RequestDataTransfer failed for " << buffer_type << ": "
                   << (st.ok() ? pull_reply.message() : st.error_message());
        cleanup_failed_fetch();
        return null_buffer();
      }
      if (!ok) {
        LOG(ERROR) << "UCX recv failed for " << buffer_type << " buffer";
        cleanup_failed_fetch();
        return null_buffer();
      }
#else
      LOG(ERROR) << "FetchBuffer failed: server negotiated REMOTE (UCX), "
                    "but this client was built without UCX";
      cleanup_failed_fetch();
      return null_buffer();
#endif
    } else {
      LOG(INFO) << "FetchBuffer " << buffer_type << " via gRPC" << " ("
                << nbytes << " bytes, remote server -> local "
                << (target == MemoryType::GPU ? "GPU" : "CPU") << ")";

      ClientContext ctx;
      auto reader = stub_->StreamDataTransfer(&ctx, pull_req);
      DataTransferChunk chunk;
      int64_t received = 0;
      ProgressBarTracker bar_tracker;

      while (reader->Read(&chunk)) {
        const auto &data = chunk.data();
        const int64_t offset = chunk.offset();
        if (offset < 0 || offset + static_cast<int64_t>(data.size()) > nbytes) {
          LOG(ERROR) << "Invalid gRPC data chunk for " << buffer_type
                     << ": offset=" << offset << ", size=" << data.size()
                     << ", expected_total=" << nbytes;
          cleanup_failed_fetch();
          return null_buffer();
        }

        if (!data.empty()) {
#ifdef HAVE_CUDA
          if (target == MemoryType::GPU) {
            cudaError_t copy_err =
                cudaMemcpy(static_cast<char *>(*local_ptr) + offset,
                           data.data(), data.size(), cudaMemcpyHostToDevice);
            if (copy_err != cudaSuccess) {
              LOG(ERROR) << "CUDA copy failed during FetchBuffer: "
                         << cudaGetErrorString(copy_err);
              cleanup_failed_fetch();
              return null_buffer();
            }
          } else
#endif
          {
            std::memcpy(static_cast<char *>(*local_ptr) + offset, data.data(),
                        data.size());
          }
          received += static_cast<int64_t>(data.size());
        }
        float pct =
            nbytes > 0 ? static_cast<float>(received * 100.0 / nbytes) : 100.0f;
        bar_tracker.MaybeRedraw(pct, static_cast<int>(received),
                                static_cast<int>(nbytes), "grpc-transfer");
      }
      std::cerr << "\n";

      Status st = reader->Finish();
      if (!st.ok()) {
        LOG(ERROR) << "StreamDataTransfer failed for " << buffer_type << ": "
                   << st.error_message();
        cleanup_failed_fetch();
        return null_buffer();
      }
      if (received != nbytes) {
        LOG(ERROR) << "StreamDataTransfer received " << received
                   << " bytes for " << buffer_type << ", expected " << nbytes;
        cleanup_failed_fetch();
        return null_buffer();
      }
    }

    *fetched = true;
    LOG(INFO) << "  Remote transfer complete for " << buffer_type;
  }

  return (*mem_type == MemoryType::GPU) ? ScopedBuffer::from_gpu(*local_ptr)
                                        : ScopedBuffer::from_cpu(*local_ptr);
}

bool DigitalTwinClient::ExportResults(
    int &files_exported, int64_t &total_rows, float &elapsed_seconds,
    const std::vector<std::string> &tables,
    const std::variant<std::monostate, SlotIndices, TimeStepIndices>
        &temporal_index,
    int batch_index) {
  LOG(INFO) << "\n=== Export Results ===";

  ExportResultsRequest request;
  for (const auto &t : tables) {
    request.add_tables(t);
  }

  if (auto *si = std::get_if<SlotIndices>(&temporal_index)) {
    auto *proto_si = request.mutable_slot_indices();
    for (int idx : si->values) {
      proto_si->add_values(idx);
    }
    request.set_batch_index(batch_index);
  } else if (auto *tsi = std::get_if<TimeStepIndices>(&temporal_index)) {
    auto *proto_tsi = request.mutable_time_step_indices();
    for (int idx : tsi->values) {
      proto_tsi->add_values(idx);
    }
    request.set_batch_index(batch_index);
  }

  ClientContext context;
  auto reader = stub_->ExportResults(&context, request);

  ExportResultsProgress progress;
  bool last_success = false;
  std::string last_message;
  ProgressBarTracker bar_tracker;

  while (reader->Read(&progress)) {
    files_exported = progress.files_exported();
    total_rows = progress.total_rows();
    elapsed_seconds = progress.elapsed_seconds();
    last_success = progress.success();
    last_message = progress.message();

    bar_tracker.MaybeRedraw(progress.percent_complete(),
                            progress.files_exported(), progress.total_files(),
                            progress.stage());
  }
  std::cerr << "\n";

  Status status = reader->Finish();

  if (status.ok() && last_success) {
    LOG(INFO) << "Export completed: " << files_exported << " files, "
              << total_rows << " rows";
    return true;
  } else {
    LOG(ERROR) << "ExportResults failed";
    if (!status.ok()) {
      LOG(ERROR) << "  gRPC error: " << status.error_message();
    }
    if (!last_message.empty()) {
      LOG(ERROR) << "  Server message: " << last_message;
    }
    return false;
  }
}

bool DigitalTwinClient::ClearExportedResults(std::string &message,
                                             bool clear_database,
                                             bool clear_exported_files) {
  LOG(INFO) << "\n=== Clear Exported Results ===";

  ClearExportedResultsRequest request;
  request.set_clear_database(clear_database);
  request.set_clear_exported_files(clear_exported_files);

  ClientContext context;
  StatusReply reply;
  Status status = stub_->ClearExportedResults(&context, request, &reply);

  message = reply.message();

  if (status.ok() && reply.success()) {
    LOG(INFO) << "Success: " << message;
    return true;
  } else {
    LOG(ERROR) << "ClearExportedResults failed";
    if (!status.ok()) {
      LOG(ERROR) << "  gRPC error: " << status.error_message();
    }
    LOG(ERROR) << "  Message: " << message;
    return false;
  }
}

bool DigitalTwinClient::StartServerLogStreaming(
    const std::string &log_file_path, const std::string &min_level) {
  if (log_streaming_.load()) {
    LOG(WARNING) << "Log streaming is already running";
    return false;
  }

  if (log_stream_thread_.joinable() && !log_streaming_.load()) {
    log_stream_thread_.join();
  }

  log_stream_context_ = std::make_unique<ClientContext>();

  std::promise<bool> started;
  auto started_future = started.get_future();

  log_stream_thread_ = std::thread(
      [this, log_file_path, min_level, started = std::move(started)]() mutable {
        std::ofstream log_file(log_file_path, std::ios::out | std::ios::trunc);
        if (!log_file.is_open()) {
          LOG(ERROR) << "Failed to open log file: " << log_file_path;
          started.set_value(false);
          return;
        }

        log_streaming_ = true;
        started.set_value(true);

        dt_service::StreamLogsRequest request;
        request.set_min_level(min_level);

        auto reader = stub_->StreamLogs(log_stream_context_.get(), request);

        dt_service::ServerLogMessage msg;
        while (reader->Read(&msg)) {
          log_file << "[" << msg.timestamp() << "][" << msg.level()
                   << "]: " << msg.message() << "\n";
          log_file.flush();
        }

        Status status = reader->Finish();
        if (!status.ok() && status.error_code() != grpc::CANCELLED) {
          LOG(WARNING) << "Log stream ended: " << status.error_message();
        }

        log_file.close();
        log_streaming_ = false;
      });

  bool ok = started_future.get();
  if (ok) {
    LOG(INFO) << "Log streaming started -> " << log_file_path
              << " (min_level=" << min_level << ")";
  }
  return ok;
}

void DigitalTwinClient::StopServerLogStreaming() {
  if (!log_streaming_.load() && !log_stream_thread_.joinable()) {
    return;
  }

  log_streaming_ = false;

  if (log_stream_context_) {
    log_stream_context_->TryCancel();
  }

  if (log_stream_thread_.joinable()) {
    log_stream_thread_.join();
  }

  log_stream_context_.reset();
  LOG(INFO) << "Log streaming stopped";
}

// Internal helper: sends PrepareMapRequest and reads streaming progress.
static PrepareMapResult SendPrepareMap(dt_service::DTWorker::Stub &stub,
                                       const PrepareMapRequest &request) {
  LOG(INFO) << "\n=== Prepare Map ===";
  LOG(INFO) << "Task type: " << request.task_type()
            << ", request_id: " << request.request_id();

  ClientContext context;
  auto reader = stub.PrepareMap(&context, request);

  PrepareMapProgress progress;
  bool last_success = false;
  std::string last_message;
  std::string last_s3_url;
  std::string last_request_id;
  int dot_count = 0;

  while (reader->Read(&progress)) {
    last_success = progress.success();
    last_message = progress.message();
    last_s3_url = progress.s3_url();
    last_request_id = progress.request_id();

    if (progress.stage() == "processing") {
      dot_count = (dot_count % 3) + 1;
      std::string dots(dot_count, '.');
      std::string pad(3 - dot_count, ' ');
      std::cerr << "\rPrepareMap: processing" << dots << pad << " ("
                << static_cast<int>(progress.elapsed_seconds()) << "s)"
                << std::flush;
    }
  }
  std::cerr << "\n";

  Status status = reader->Finish();

  PrepareMapResult result;
  result.success = status.ok() && last_success;
  result.s3_url = last_s3_url;
  result.message = last_message;
  result.request_id = last_request_id;

  if (result.success) {
    LOG(INFO) << "PrepareMap: completed in "
              << static_cast<int>(progress.elapsed_seconds()) << "s - "
              << result.s3_url;
  } else {
    LOG(ERROR) << "PrepareMap failed: " << result.message;
  }

  return result;
}

static void ValidateTerraformConfig(const TerraformConfig &cfg) {
  if (cfg.building_base_method) {
    static const std::array<std::string_view, 5> kValid = {
        "min", "max", "average", "top10", "bottom10"};
    if (std::find(kValid.begin(), kValid.end(), *cfg.building_base_method) ==
        kValid.end()) {
      throw std::runtime_error(
          "TerraformConfig.building_base_method must be one of "
          "{min, max, average, top10, bottom10}, got: " +
          *cfg.building_base_method);
    }
  }
}

static void ValidatePrepareMapTask(const MapTask &task) {
  std::visit(
      [&](const auto &t) {
        if (t.output_folder_key.empty()) {
          throw std::runtime_error(
              "PrepareMap requires non-empty output_folder_key");
        }
        if (!t.include_elevation.has_value()) {
          throw std::runtime_error(
              "PrepareMap requires include_elevation to be set");
        }
        if (t.terraform_config) {
          ValidateTerraformConfig(*t.terraform_config);
        }
        if (t.terrain_clip_margin && *t.terrain_clip_margin < 0.0) {
          throw std::runtime_error(
              "PrepareMap terrain_clip_margin must be non-negative");
        }
        using T = std::decay_t<decltype(t)>;
        if constexpr (std::is_same_v<T, OSMTask>) {
          if (!(t.coords[0] < t.coords[2] && t.coords[1] < t.coords[3])) {
            throw std::runtime_error(
                "PrepareMap OSMTask requires coords=(min_lon, min_lat, "
                "max_lon, max_lat) with min < max");
          }
        } else if constexpr (std::is_same_v<T, GMLTask>) {
          if (t.input_files.empty()) {
            throw std::runtime_error(
                "PrepareMap GMLTask requires non-empty input_files");
          }
          if (t.epsg_in.empty()) {
            throw std::runtime_error(
                "PrepareMap GMLTask requires non-empty epsg_in");
          }
        }
      },
      task);
}

static void PopulateTerraformConfig(dt_service::TerraformConfig *proto,
                                    const TerraformConfig &cfg) {
  if (cfg.terraform)
    proto->set_terraform(*cfg.terraform);
  if (cfg.pad_radius)
    proto->set_pad_radius(*cfg.pad_radius);
  if (cfg.pre_tessellation_length)
    proto->set_pre_tessellation_length(*cfg.pre_tessellation_length);
  if (cfg.pre_smooth_terrain)
    proto->set_pre_smooth_terrain(*cfg.pre_smooth_terrain);
  if (cfg.pre_smooth_iters)
    proto->set_pre_smooth_iters(*cfg.pre_smooth_iters);
  if (cfg.pre_smooth_lambda)
    proto->set_pre_smooth_lambda(*cfg.pre_smooth_lambda);
  if (cfg.terraform_smooth)
    proto->set_terraform_smooth(*cfg.terraform_smooth);
  if (cfg.terraform_smooth_iters)
    proto->set_terraform_smooth_iters(*cfg.terraform_smooth_iters);
  if (cfg.terraform_smooth_lambda)
    proto->set_terraform_smooth_lambda(*cfg.terraform_smooth_lambda);
  if (cfg.terraform_smooth_radius)
    proto->set_terraform_smooth_radius(*cfg.terraform_smooth_radius);
  if (cfg.building_base_method)
    proto->set_building_base_method(*cfg.building_base_method);
  if (cfg.base_merge_distance)
    proto->set_base_merge_distance(*cfg.base_merge_distance);
  if (cfg.base_influence_radius)
    proto->set_base_influence_radius(*cfg.base_influence_radius);
  if (cfg.base_influence_sigma)
    proto->set_base_influence_sigma(*cfg.base_influence_sigma);
  if (cfg.base_smooth_iters)
    proto->set_base_smooth_iters(*cfg.base_smooth_iters);
  if (cfg.adaptive_bands)
    proto->set_adaptive_bands(*cfg.adaptive_bands);
  if (cfg.near_radius)
    proto->set_near_radius(*cfg.near_radius);
  if (cfg.near_tessellation_threshold)
    proto->set_near_tessellation_threshold(*cfg.near_tessellation_threshold);
  if (cfg.far_tessellation_threshold)
    proto->set_far_tessellation_threshold(*cfg.far_tessellation_threshold);
}

template <typename ProtoTask>
static void PopulateBaseTaskFields(ProtoTask *proto,
                                   const BaseTaskConfig &base) {
  if (base.ground_source)
    proto->set_ground_source(*base.ground_source);
  proto->set_vegetation_source(base.vegetation_source);
  proto->set_vegetation_density(base.vegetation_density);
  proto->set_vegetation_scale_min(base.vegetation_scale_min);
  proto->set_vegetation_scale_max(base.vegetation_scale_max);
  if (base.cesium3dtiles_b3dm)
    proto->set_cesium3dtiles_b3dm(*base.cesium3dtiles_b3dm);
  if (base.cesium3dtiles_draco)
    proto->set_cesium3dtiles_draco(*base.cesium3dtiles_draco);
  if (base.cesium3dtiles_gzip)
    proto->set_cesium3dtiles_gzip(*base.cesium3dtiles_gzip);
  if (base.cesium3dtiles_chunk_size)
    proto->set_cesium3dtiles_chunk_size(*base.cesium3dtiles_chunk_size);
  proto->set_cesium3dtiles_veg_instanced(base.cesium3dtiles_veg_instanced);
  proto->set_rough(base.rough);
  proto->set_include_elevation(*base.include_elevation);
  proto->set_disable_interiors(base.disable_interiors);
  if (base.terrain_clip_margin)
    proto->set_terrain_clip_margin(*base.terrain_clip_margin);
  if (base.terraform_config)
    PopulateTerraformConfig(proto->mutable_terraform_config(),
                            *base.terraform_config);
}

static void PopulateS3Config(dt_service::GisS3Config *cfg, const S3Config &s3) {
  cfg->set_bucket(s3.bucket);
  cfg->set_endpoint_url(s3.endpoint_url);
  cfg->set_region(s3.region);
  cfg->set_access_key(s3.access_key);
  cfg->set_secret_key(s3.secret_key);
  cfg->set_provider(s3.provider);
}

PrepareMapResult DigitalTwinClient::PrepareMap(const MapTask &task,
                                               const S3Config &s3) {
  ValidatePrepareMapTask(task);

  PrepareMapRequest request;
  PopulateS3Config(request.mutable_s3_config(), s3);

  std::visit(
      [&](auto &&t) {
        using T = std::decay_t<decltype(t)>;
        if constexpr (std::is_same_v<T, OSMTask>) {
          request.set_task_type("osm");
          request.set_request_id(
              "prepare-map-osm-" +
              std::to_string(
                  std::chrono::system_clock::now().time_since_epoch().count()));
          auto *osm = request.mutable_osm_task();
          osm->set_output_folder_key(t.output_folder_key);
          osm->set_min_lon(t.coords[0]);
          osm->set_min_lat(t.coords[1]);
          osm->set_max_lon(t.coords[2]);
          osm->set_max_lat(t.coords[3]);
          PopulateBaseTaskFields(osm, t);
        } else if constexpr (std::is_same_v<T, GMLTask>) {
          request.set_task_type("gml");
          request.set_request_id(
              "prepare-map-gml-" +
              std::to_string(
                  std::chrono::system_clock::now().time_since_epoch().count()));
          auto *gml = request.mutable_gml_task();
          gml->set_output_folder_key(t.output_folder_key);
          for (const auto &f : t.input_files) {
            gml->add_input_files(f);
          }
          gml->set_epsg_in(t.epsg_in);
          if (t.epsg_out)
            gml->set_epsg_out(*t.epsg_out);
          PopulateBaseTaskFields(gml, t);
        }
      },
      task);

  return SendPrepareMap(*stub_, request);
}
