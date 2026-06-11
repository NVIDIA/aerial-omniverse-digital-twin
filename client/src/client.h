// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#pragma once

#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <complex>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <variant>
#include <vector>

#include "logger.hpp"
#include "service.grpc.pb.h"
#include "ucx_transport.h"
#include <grpcpp/grpcpp.h>

#ifdef HAVE_CUDA
#include <cuda_runtime.h>
#define CHECK_CUDA(call)                                                       \
  do {                                                                         \
    cudaError_t err = call;                                                    \
    if (err != cudaSuccess) {                                                  \
      std::string error_msg =                                                  \
          std::string("CUDA error: ") + cudaGetErrorString(err);               \
      LOG(ERROR) << error_msg;                                                 \
      throw std::runtime_error(error_msg);                                     \
    }                                                                          \
  } while (0)
#endif

// Forward declarations for protobuf types
namespace dt_service {
class DTWorker;
class MatrixShape;
} // namespace dt_service

// Strong types for temporal indices
// To support Mode 1 (Slot/Symbols) and Mode 2 (Duration/Interval)

// Single temporal index types
struct SlotIndex {
  int value;
  explicit SlotIndex(int v) : value(v) {}
};

struct TimeStepIndex {
  int value;
  explicit TimeStepIndex(int v) : value(v) {}
};

// Multiple temporal indices types (for multi-time-step queries)
struct SlotIndices {
  std::vector<int> values;
  explicit SlotIndices(const std::vector<int> &v) : values(v) {}
  explicit SlotIndices(std::initializer_list<int> v) : values(v) {}
  size_t size() const { return values.size(); }
};

struct TimeStepIndices {
  std::vector<int> values;
  explicit TimeStepIndices(const std::vector<int> &v) : values(v) {}
  explicit TimeStepIndices(std::initializer_list<int> v) : values(v) {}
  size_t size() const { return values.size(); }
};

// Variant type that can only hold ONE of the temporal index types
// This enforces at compile time that only one mode can be selected
using TemporalIndex = std::variant<SlotIndex, TimeStepIndex>;

// Multi-temporal variant - supports both single and multiple indices
using MultiTemporalIndex =
    std::variant<SlotIndex, TimeStepIndex, SlotIndices, TimeStepIndices>;

enum class MemoryType { GPU, CPU };

struct S3Config {
  std::string bucket;
  std::string endpoint_url;
  std::string region = "us-east-1";
  std::string access_key;
  std::string secret_key;
  std::string provider; // "minio", "aws"
};

struct PrepareMapResult {
  bool success{};
  std::string s3_url;
  std::string message;
  std::string request_id;
};

// Mirrors HARMONIZE_PARAMS in the GIS pipeline. All fields optional;
// std::nullopt means "let asim_gis decide".
struct TerraformConfig {
  std::optional<bool> terraform = std::nullopt;
  std::optional<double> pad_radius = std::nullopt;
  std::optional<double> pre_tessellation_length = std::nullopt;
  std::optional<bool> pre_smooth_terrain = std::nullopt;
  std::optional<int> pre_smooth_iters = std::nullopt;
  std::optional<double> pre_smooth_lambda = std::nullopt;
  std::optional<bool> terraform_smooth = std::nullopt;
  std::optional<int> terraform_smooth_iters = std::nullopt;
  std::optional<double> terraform_smooth_lambda = std::nullopt;
  std::optional<double> terraform_smooth_radius = std::nullopt;
  std::optional<std::string> building_base_method = std::nullopt;
  std::optional<double> base_merge_distance = std::nullopt;
  std::optional<double> base_influence_radius = std::nullopt;
  std::optional<double> base_influence_sigma = std::nullopt;
  std::optional<int> base_smooth_iters = std::nullopt;
  std::optional<bool> adaptive_bands = std::nullopt;
  std::optional<double> near_radius = std::nullopt;
  std::optional<double> near_tessellation_threshold = std::nullopt;
  std::optional<double> far_tessellation_threshold = std::nullopt;
};

struct BaseTaskConfig {
  std::optional<std::string> ground_source = "terrarium";
  std::string vegetation_source = "procedural";
  double vegetation_density = 50.0;
  double vegetation_scale_min = 0.8;
  double vegetation_scale_max = 1.2;
  // Defaults are owned by asim_gis; std::nullopt means "let GIS decide".
  std::optional<bool> cesium3dtiles_b3dm = std::nullopt;
  std::optional<bool> cesium3dtiles_draco = std::nullopt;
  std::optional<bool> cesium3dtiles_gzip = std::nullopt;
  std::optional<int> cesium3dtiles_chunk_size = std::nullopt;
  bool cesium3dtiles_veg_instanced = true;
  bool rough = true;
  std::optional<bool> include_elevation = std::nullopt;
  bool disable_interiors = false;
  std::optional<double> terrain_clip_margin = std::nullopt;
  std::optional<TerraformConfig> terraform_config = std::nullopt;
};

struct OSMTask : BaseTaskConfig {
  std::string output_folder_key;
  std::array<double, 4> coords{};
};

struct GMLTask : BaseTaskConfig {
  std::string output_folder_key;
  std::vector<std::string> input_files;
  std::string epsg_in;
  std::optional<std::string> epsg_out = std::nullopt;
};

using MapTask = std::variant<OSMTask, GMLTask>;

/**
 * RAII wrapper that abstracts buffer access across all transport modes.
 * LOCAL_IPC: opens an IPC handle (GPU, owns close).
 * REMOTE + GPU: wraps a locally-allocated GPU pointer (non-owning).
 * REMOTE + CPU: wraps a locally-allocated CPU pointer (non-owning).
 */
class ScopedBuffer {
public:
  void *ptr = nullptr;
  MemoryType memory_type() const { return mem_type_; }
  bool is_gpu() const { return mem_type_ == MemoryType::GPU; }

#ifdef HAVE_CUDA
  static ScopedBuffer from_ipc(const std::string &ipc_handle) {
    ScopedBuffer b(MemoryType::GPU, /*owns_ipc=*/true);
    cudaIpcMemHandle_t h{};
    std::memcpy(&h, ipc_handle.data(), sizeof(h));
    CHECK_CUDA(cudaIpcOpenMemHandle(&b.ptr, h, cudaIpcMemLazyEnablePeerAccess));
    return b;
  }
#endif

  static ScopedBuffer from_gpu(void *gpu_ptr) {
    ScopedBuffer b(MemoryType::GPU, /*owns_ipc=*/false);
    b.ptr = gpu_ptr;
    return b;
  }

  static ScopedBuffer from_cpu(void *cpu_ptr) {
    ScopedBuffer b(MemoryType::CPU, /*owns_ipc=*/false);
    b.ptr = cpu_ptr;
    return b;
  }

  ~ScopedBuffer() {
#ifdef HAVE_CUDA
    if (owns_ipc_ && ptr) {
      cudaIpcCloseMemHandle(ptr);
    }
#endif
  }

  ScopedBuffer(ScopedBuffer &&o) noexcept
      : ptr(o.ptr), mem_type_(o.mem_type_), owns_ipc_(o.owns_ipc_) {
    o.ptr = nullptr;
    o.owns_ipc_ = false;
  }
  ScopedBuffer &operator=(ScopedBuffer &&o) noexcept {
    if (this != &o) {
#ifdef HAVE_CUDA
      if (owns_ipc_ && ptr)
        cudaIpcCloseMemHandle(ptr);
#endif
      ptr = o.ptr;
      mem_type_ = o.mem_type_;
      owns_ipc_ = o.owns_ipc_;
      o.ptr = nullptr;
      o.owns_ipc_ = false;
    }
    return *this;
  }

  ScopedBuffer(const ScopedBuffer &) = delete;
  ScopedBuffer &operator=(const ScopedBuffer &) = delete;

private:
  explicit ScopedBuffer(MemoryType mt = MemoryType::GPU, bool owns_ipc = false)
      : mem_type_(mt), owns_ipc_(owns_ipc) {}
  MemoryType mem_type_ = MemoryType::GPU;
  bool owns_ipc_ = false;
};

/**
 * Digital Twin Client Class
 *
 * Provides high-level interface for interacting with GPU Digital Twin server.
 * Handles gRPC communication, CUDA IPC memory management, and data processing.
 */
class DigitalTwinClient {
public:
  /**
   * Constructor
   * @param channel gRPC channel to the server
   * @param force if true, kick out any existing client on the server
   */
  explicit DigitalTwinClient(std::shared_ptr<::grpc::Channel> channel,
                             bool force = false);

  /**
   * Destructor
   */
  ~DigitalTwinClient();

  /**
   * Start a new scenario with YAML configuration content
   * @param yaml_content YAML configuration content as string
   * @return true if successful
   */
  bool Start(const std::string &yaml_content);

  /**
   * Get scenario status information
   * @param scenario_loaded Output whether a scenario is currently loaded
   * @param num_rus Output number of RUs in the loaded scenario
   * @param num_ues Output number of UEs in the loaded scenario
   * @param total_batches Output total number of batches
   * @param is_slot_symbol_mode Output true for Slot/Symbols mode, false for
   * Duration/Interval mode
   * @param num_slots_or_timesteps_per_batch Output slots per batch (Mode 1) or
   * time steps per batch (Mode 2)
   * @return true if successful
   */
  bool GetScenarioStatus(bool &scenario_loaded, int &num_rus, int &num_ues,
                         int &total_batches, bool &is_slot_symbol_mode,
                         int &num_slots_or_timesteps_per_batch);

  /**
   * Run the full simulation loop (all batches, all time steps)
   * Uses server-side streaming to receive progress updates.
   * @param time_steps_completed Output number of time steps completed
   * @param total_time_seconds Output total simulation time in seconds
   * @return true if successful
   */
  bool RunFullSimulation(int &time_steps_completed, float &total_time_seconds);

  /**
   * Run the calibration setup/pipeline for a calibration scenario.
   * Uses server-side streaming to receive coarse progress updates.
   * @param total_time_seconds Output total calibration time in seconds
   * @param final_stage Output final progress stage
   * @param message Output final server message
   * @return true if successful
   */
  bool RunCalibration(float &total_time_seconds, std::string &final_stage,
                      std::string &message);

  /**
   * Cancel any in-progress streaming operation on the server.
   * This is a separate unary RPC that can be called concurrently from
   * another thread while RunFullSimulation or GetChannelImpulseResponse
   * is in progress.
   * @param reason Optional human-readable reason for cancellation
   * @return true if the cancellation request was accepted by the server
   */
  bool CancelSimulation(const std::string &reason = "");

  /**
   * Get RU positions (static infrastructure)
   * @param positions Output vector of RU positions [x, y, z]
   * @return true if successful
   */
  bool GetRUPositions(std::vector<std::array<float, 3>> &positions);

  /**
   * Get UE positions for a specific temporal index (slot or time step)
   * @param batch_index Batch index
   * @param temporal_index Temporal index - either SlotIndex or TimeStepIndex
   * @param positions Output vector of UE positions [x, y, z]
   * @return true if successful
   *
   * Example usage:
   *   client.GetUEPositions(0, SlotIndex{5}, positions);      // Mode 1
   *   client.GetUEPositions(0, TimeStepIndex{15}, positions); // Mode 2
   */
  bool GetUEPositions(int batch_index, const TemporalIndex &temporal_index,
                      std::vector<std::array<float, 3>> &positions);

  /**
   * CIR Batch Allocation Result
   * Contains all metadata needed to access CIR results for any time step
   */
  struct CIRBatchAllocation {
    dt_service::TransportMode mode = dt_service::LOCAL_IPC;

    // LOCAL_IPC fields: IPC handles for the entire contiguous buffers
    std::string values_ipc_handle;
    std::string delays_ipc_handle;
    std::string angles_of_departure_ipc_handle;
    std::string angles_of_arrival_ipc_handle;

    // Server-side allocation key (for pull-based transfer)
    std::string allocation_key;

    // Lazily-allocated local receive buffers (populated by FetchBuffer)
    void *local_values_ptr = nullptr;
    void *local_delays_ptr = nullptr;
    void *local_angles_of_departure_ptr = nullptr;
    void *local_angles_of_arrival_ptr = nullptr;
    bool values_fetched = false;
    bool delays_fetched = false;
    bool angles_of_departure_fetched = false;
    bool angles_of_arrival_fetched = false;
    MemoryType values_mem_type = MemoryType::GPU;
    MemoryType delays_mem_type = MemoryType::GPU;
    MemoryType angles_of_departure_mem_type = MemoryType::GPU;
    MemoryType angles_of_arrival_mem_type = MemoryType::GPU;

    // Per-time-step, per-RU shape info (variable per time step)
    std::vector<std::vector<dt_service::MatrixShape>>
        values_shapes_per_ts; // [num_time_steps][num_rus]
    std::vector<std::vector<dt_service::MatrixShape>>
        delays_shapes_per_ts; // [num_time_steps][num_rus]
    std::vector<std::vector<dt_service::MatrixShape>>
        angles_of_departure_shapes_per_ts; // [num_time_steps][num_rus]
    std::vector<std::vector<dt_service::MatrixShape>>
        angles_of_arrival_shapes_per_ts; // [num_time_steps][num_rus]

    // Buffer layout metadata - per-time-step offsets (variable sizes)
    // All offsets are in ELEMENTS (not bytes)
    std::vector<int64_t>
        values_time_step_offsets; // Cumulative element offset for each time
                                  // step from buffer start
    std::vector<int64_t>
        delays_time_step_offsets; // Cumulative element offset for each time
                                  // step from buffer start
    std::vector<int64_t> angles_of_departure_time_step_offsets;
    std::vector<int64_t> angles_of_arrival_time_step_offsets;
    std::vector<std::vector<int64_t>>
        values_ru_offsets_per_ts; // Element offset for each RU within each ts
                                  // (relative to ts start)
    std::vector<std::vector<int64_t>>
        delays_ru_offsets_per_ts; // Element offset for each RU within each ts
                                  // (relative to ts start)
    std::vector<std::vector<int64_t>> angles_of_departure_ru_offsets_per_ts;
    std::vector<std::vector<int64_t>> angles_of_arrival_ru_offsets_per_ts;

    // Total buffer sizes
    int64_t total_values_bytes{};
    int64_t total_delays_bytes{};
    int64_t total_angles_of_departure_bytes{};
    int64_t total_angles_of_arrival_bytes{};

    // Allocation config (echoed back for reference)
    int num_time_steps{};
    std::vector<std::vector<int>>
        ru_indices_per_ts; // [num_time_steps][num_rus]
    std::vector<std::vector<std::vector<int>>>
        ue_indices_per_ts; // [num_time_steps][num_rus][num_ues]
    bool is_full_antenna_pair{};

    // Index mapping: position -> actual slot/timestep index
    // Set after get_cirs is called (e.g., SlotIndices([3, 7]) -> {3, 7})
    // Enables access by actual indices: values[slot][ru]
    std::vector<int> temporal_indices;

    // Safety net: frees client-side receive buffers if
    // DeallocateCIRResultsMemory was not called.
    ~CIRBatchAllocation() {
      auto free_buf = [](void *ptr, MemoryType mt) {
        if (!ptr)
          return;
#ifdef HAVE_CUDA
        if (mt == MemoryType::GPU)
          cudaFree(ptr);
        else
#endif
          free(ptr);
      };
      if (mode == dt_service::REMOTE) {
        free_buf(local_values_ptr, values_mem_type);
        free_buf(local_delays_ptr, delays_mem_type);
        free_buf(local_angles_of_departure_ptr, angles_of_departure_mem_type);
        free_buf(local_angles_of_arrival_ptr, angles_of_arrival_mem_type);
      }
    }

    CIRBatchAllocation() = default;
    CIRBatchAllocation(CIRBatchAllocation &&) = delete;
    CIRBatchAllocation &operator=(CIRBatchAllocation &&) = delete;
    CIRBatchAllocation(const CIRBatchAllocation &) = delete;
    CIRBatchAllocation &operator=(const CIRBatchAllocation &) = delete;
  };

  /**
   * Allocate GPU memory for CIR results as a batch allocation (broadcast style)
   * Same RU/UE configuration is used for all time steps.
   *
   * @param ru_indices RU indices (same for all time steps)
   * @param ue_indices_per_ru UE indices per RU (same for all time steps)
   * @param num_time_steps Number of time steps to allocate
   * @param is_full_antenna_pair true for full antenna pairs, false for single
   * @param allocation Output: Batch allocation with metadata
   * @return true if successful
   *
   * Example usage (broadcast - same config for 10 time steps):
   *   CIRBatchAllocation alloc;
   *   client.AllocateCIRResultsMemory(
   *       {0, 1},                    // RU indices
   *       {{0, 1, 2}, {0, 1, 2}},    // UE indices per RU
   *       true, alloc, 10);          // is_full_antenna_pair, alloc,
   * num_time_steps
   */
  bool AllocateCIRResultsMemory(
      const std::vector<int> &ru_indices,
      const std::vector<std::vector<int>> &ue_indices_per_ru,
      bool is_full_antenna_pair, CIRBatchAllocation &allocation,
      int num_time_steps = 1);

  /**
   * Allocate GPU memory for CIR results as a batch allocation (per-time-step
   * style) Each time step can have different RU/UE configurations (variable
   * sizes per time step).
   *
   * @param ru_indices_per_ts RU indices for each time step
   * [num_time_steps][num_rus]
   * @param ue_indices_per_ts UE indices per RU for each time step
   * [num_time_steps][num_rus][num_ues]
   * @param is_full_antenna_pair true for full antenna pairs, false for single
   * @param allocation Output: Batch allocation with metadata
   * @return true if successful
   *
   * Example usage (3 time steps with different configs):
   *   CIRBatchAllocation alloc;
   *   client.AllocateCIRResultsMemory(
   *       {{0, 1}, {0}, {0, 1, 2}},  // Different RUs per time step
   *       {{{0,1,2}, {0,1}}, {{0,1,2,3}}, {{0}, {0,1}, {0}}},  // Different UEs
   * per RU per ts true, alloc);
   */
  bool AllocateCIRResultsMemory(
      const std::vector<std::vector<int>> &ru_indices_per_ts,
      const std::vector<std::vector<std::vector<int>>> &ue_indices_per_ts,
      bool is_full_antenna_pair, CIRBatchAllocation &allocation);

  /**
   * Deallocate GPU memory for CIR batch allocation
   * @param allocation The allocation to deallocate
   * @return true if successful
   */
  bool DeallocateCIRResultsMemory(CIRBatchAllocation &allocation);

  /**
   * Get CIR for one or more time steps using batch allocation
   * Computes CIR and writes results into the appropriate slots of the
   * pre-allocated batch. Uses server-side streaming to receive progress
   * updates.
   *
   * @param allocation The batch allocation (from AllocateCIRResultsMemory).
   *        Updated with temporal_indices after computation.
   * @param batch_index Batch index
   * @param temporal_index Temporal indices to compute - can be single
   * (SlotIndex/TimeStepIndex) or multiple (SlotIndices/TimeStepIndices)
   * @return true if successful
   *
   * Example usage (single time step):
   *   client.GetChannelImpulseResponse(alloc, 0, SlotIndex{5});
   *   // alloc.temporal_indices now contains {5}
   *
   * Example usage (multiple time steps):
   *   client.GetChannelImpulseResponse(alloc, 0, SlotIndices{0, 1, 2});
   *   // alloc.temporal_indices now contains {0, 1, 2}
   */
  bool GetChannelImpulseResponse(CIRBatchAllocation &allocation,
                                 int batch_index,
                                 const MultiTemporalIndex &temporal_index);

#ifdef HAVE_CUDA
  /**
   * Print sample elements from CIR results to verify values (requires both
   * pointers)
   * @param values_gpu_ptr GPU memory pointer for cir value
   * @param delays_gpu_ptr GPU memory pointer for delays
   * @param shape CIR shape information
   * @param ru_idx RU index for display purposes
   */
  void PrintCIRResultsSample(void *values_gpu_ptr, void *delays_gpu_ptr,
                             const dt_service::MatrixShape &shape, int ru_idx);
#endif

  /**
   * Fetch a buffer from the server. For LOCAL_IPC, opens the IPC handle
   * (always GPU). For REMOTE, lazily allocates a local buffer (GPU or CPU as
   * specified) and pulls data via gRPC by default, or UCX when explicitly
   * negotiated; subsequent calls return the cached buffer.
   *
   * @param alloc The CIR batch allocation
   * @param buffer_type "values", "delays", "angles_of_departure", or
   * "angles_of_arrival"
   * @param target Where to place the receive buffer (default: GPU if client has
   * one)
   * @return ScopedBuffer wrapping the accessible pointer
   */
  ScopedBuffer FetchBuffer(CIRBatchAllocation &alloc,
                           const std::string &buffer_type, MemoryType target);

  /**
   * Get the negotiated transport mode (LOCAL_IPC or REMOTE)
   */
  dt_service::TransportMode GetTransportMode() const { return mode_; }

  /**
   * Whether the client has a GPU (detected during negotiation)
   */
  bool HasGPU() const { return has_gpu_; }

  /**
   * Export result data to Parquet files on S3.
   *
   * Server-side streaming RPC: receives progress updates until export
   * completes.
   *
   * @param files_exported Output: number of Parquet files written
   * @param total_rows Output: total rows exported
   * @param elapsed_seconds Output: wall-clock time
   * @param tables Table names to export (default empty = scenario defaults)
   * @param temporal_index SlotIndices or TimeStepIndices (default = all)
   * @param batch_index Batch index (only used with temporal index)
   * @return true if successful
   */
  bool
  ExportResults(int &files_exported, int64_t &total_rows,
                float &elapsed_seconds,
                const std::vector<std::string> &tables = {},
                const std::variant<std::monostate, SlotIndices, TimeStepIndices>
                    &temporal_index = std::monostate{},
                int batch_index = 0);

  /**
   * Clear exported result data from ClickHouse and/or S3
   * @param message Output: human-readable result message
   * @param clear_database Truncate result tables in ClickHouse (default true)
   * @param clear_exported_files Delete Parquet files from S3 (default true)
   * @return true if successful
   */
  bool ClearExportedResults(std::string &message, bool clear_database = true,
                            bool clear_exported_files = true);

  /**
   * Prepare a GIS map via the server's Temporal workflow.
   * Does not require a loaded scenario.
   *
   * @param task OSMTask or GMLTask (via MapTask variant)
   * @param s3 S3 connection credentials
   * @return PrepareMapResult with success, s3_url, message, request_id
   *
   * Example:
   *   client.PrepareMap(OSMTask{...}, s3);
   *   client.PrepareMap(GMLTask{...}, s3);
   */
  PrepareMapResult PrepareMap(const MapTask &task, const S3Config &s3);

  /**
   * Whether the client is connected (has an active session with the server)
   */
  bool IsConnected() const { return !client_id_.empty(); }

  /**
   * Start streaming server logs to a local file on a background thread.
   * Non-blocking: returns immediately after launching the reader thread.
   * @param log_file_path Local file path to write server logs to
   * @param min_level Minimum log level filter: "DEBUG", "INFO", "WARNING",
   *        "ERROR". Acts as a client-side filter; cannot go below the
   *        server's configured --log level.
   * @return true if the streaming thread was started successfully
   */
  bool
  StartServerLogStreaming(const std::string &log_file_path = "dt_server.log",
                          const std::string &min_level = "INFO");

  /**
   * Stop the server log streaming background thread.
   * Cancels the gRPC stream and joins the thread. Safe to call even if
   * streaming was never started.
   */
  void StopServerLogStreaming();

private:
  bool Connect(bool force = false);
  bool NegotiateDataTransport();

  std::unique_ptr<dt_service::DTWorker::Stub> stub_;
  std::string client_id_;
  dt_service::TransportMode mode_ = dt_service::LOCAL_IPC;
  dt_service::RemoteTransferProtocol remote_transfer_protocol_ =
      dt_service::GRPC;
  bool has_gpu_ = false;
  UCXTransport ucx_transport_;
  uint64_t next_tag_counter_ = 1;

  uint64_t NextTag() { return next_tag_counter_++; }

  // Log streaming state
  std::thread log_stream_thread_;
  std::atomic<bool> log_streaming_{false};
  std::unique_ptr<grpc::ClientContext> log_stream_context_;
};
