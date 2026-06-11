// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "client.h"
#include <cstddef>
#include <pybind11/complex.h>
#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <set>

namespace py = pybind11;

// Helper function to convert MatrixShape to Python dict
py::dict matrix_shape_to_dict(const dt_service::MatrixShape &shape) {
  py::dict result;
  py::list dims;
  for (int i = 0; i < shape.dimensions_size(); i++) {
    dims.append(shape.dimensions(i));
  }
  result["dimensions"] = dims;
  result["total_elements"] = shape.total_elements();
  result["dtype"] = shape.dtype();
  return result;
}

// Helper function to convert py::list of py::bytes to std::vector<std::string>
std::vector<std::string>
bytes_list_to_string_vector(const py::list &bytes_list) {
  std::vector<std::string> result;
  for (const auto &item : bytes_list) {
    result.push_back(item.cast<std::string>());
  }
  return result;
}

// Helper function to convert Python object to TemporalIndex
TemporalIndex py_to_temporal_index(const py::object &obj) {
  if (py::isinstance<SlotIndex>(obj)) {
    return obj.cast<SlotIndex>();
  } else if (py::isinstance<TimeStepIndex>(obj)) {
    return obj.cast<TimeStepIndex>();
  } else {
    throw std::runtime_error(
        "temporal_index must be either SlotIndex or TimeStepIndex");
  }
}

// Helper function to convert Python object to MultiTemporalIndex
MultiTemporalIndex py_to_multi_temporal_index(const py::object &obj) {
  if (py::isinstance<SlotIndex>(obj)) {
    return obj.cast<SlotIndex>();
  } else if (py::isinstance<TimeStepIndex>(obj)) {
    return obj.cast<TimeStepIndex>();
  } else if (py::isinstance<SlotIndices>(obj)) {
    return obj.cast<SlotIndices>();
  } else if (py::isinstance<TimeStepIndices>(obj)) {
    return obj.cast<TimeStepIndices>();
  } else {
    throw std::runtime_error("temporal_index must be SlotIndex, TimeStepIndex, "
                             "SlotIndices, or TimeStepIndices");
  }
}

// Helper to check if list is 2D (list of lists of int)
// e.g., [[0, 1], [2, 3]]
bool is_2d_int_list(const py::object &obj) {
  if (!py::isinstance<py::list>(obj))
    return false;
  py::list lst = obj.cast<py::list>();
  if (lst.empty())
    return false;
  return py::isinstance<py::list>(lst[0]);
}

// Helper to check if list is 3D (list of lists of lists of int)
// e.g., [[[0, 1], [2, 3]], [[4, 5]]]
bool is_3d_int_list(const py::object &obj) {
  if (!py::isinstance<py::list>(obj))
    return false;
  py::list lst = obj.cast<py::list>();
  if (lst.empty())
    return false;
  if (!py::isinstance<py::list>(lst[0]))
    return false;
  py::list inner = lst[0].cast<py::list>();
  if (inner.empty())
    return false;
  return py::isinstance<py::list>(inner[0]);
}

// Helper to check if temporal index is for multiple time steps
bool is_multi_temporal(const py::object &obj) {
  return py::isinstance<SlotIndices>(obj) ||
         py::isinstance<TimeStepIndices>(obj);
}

// Get count from temporal index
size_t get_temporal_count(const py::object &obj) {
  if (py::isinstance<SlotIndex>(obj) || py::isinstance<TimeStepIndex>(obj)) {
    return 1;
  } else if (py::isinstance<SlotIndices>(obj)) {
    return obj.cast<SlotIndices>().values.size();
  } else if (py::isinstance<TimeStepIndices>(obj)) {
    return obj.cast<TimeStepIndices>().values.size();
  }
  throw std::runtime_error("temporal_index must be SlotIndex, TimeStepIndex, "
                           "SlotIndices, or TimeStepIndices");
}

// === CIRBatchAllocation helper functions ===

// Find (ts_pos, ru_pos) from (slot_idx, ru_idx)
inline std::pair<int, int>
find_positions(const DigitalTwinClient::CIRBatchAllocation &alloc, int slot_idx,
               int ru_idx) {
  const auto &ti = alloc.temporal_indices;
  auto slot_it = std::find(ti.begin(), ti.end(), slot_idx);
  if (slot_it == ti.end()) {
    throw std::runtime_error("Slot " + std::to_string(slot_idx) +
                             " not computed in allocation");
  }
  int ts_pos = std::distance(ti.begin(), slot_it);

  const auto &rus = alloc.ru_indices_per_ts[ts_pos];
  auto ru_it = std::find(rus.begin(), rus.end(), ru_idx);
  if (ru_it == rus.end()) {
    throw std::runtime_error("RU " + std::to_string(ru_idx) +
                             " not found at slot " + std::to_string(slot_idx));
  }
  int ru_pos = std::distance(rus.begin(), ru_it);

  return {ts_pos, ru_pos};
}

// Extract dimensions from MatrixShape (ptrdiff_t is portable; ssize_t is not on
// MSVC)
inline std::vector<std::ptrdiff_t>
get_dims(const dt_service::MatrixShape &shape) {
  std::vector<std::ptrdiff_t> dims;
  for (int i = 0; i < shape.dimensions_size(); ++i) {
    dims.push_back(static_cast<std::ptrdiff_t>(shape.dimensions(i)));
  }
  return dims;
}

#ifdef HAVE_CUDA
// IpcMemHandle kept for backward-compatible overloads (raw gpu_ptr access)
class IpcMemHandle {
public:
  IpcMemHandle(const std::string &handle_str) : ptr_(nullptr) {
    cudaIpcMemHandle_t handle;
    memcpy(&handle, handle_str.data(), sizeof(cudaIpcMemHandle_t));
    cudaError_t err =
        cudaIpcOpenMemHandle(&ptr_, handle, cudaIpcMemLazyEnablePeerAccess);
    if (err != cudaSuccess) {
      throw std::runtime_error(std::string("Failed to open IPC handle: ") +
                               cudaGetErrorString(err));
    }
  }
  ~IpcMemHandle() {
    if (ptr_)
      cudaIpcCloseMemHandle(ptr_);
  }
  void *get() const { return ptr_; }
  IpcMemHandle(const IpcMemHandle &) = delete;
  IpcMemHandle &operator=(const IpcMemHandle &) = delete;

private:
  void *ptr_;
};
#endif

// Copy buffer data to numpy array — GPU buffers use cudaMemcpy, CPU buffers use
// memcpy
inline py::object buffer_to_numpy(const ScopedBuffer &buf,
                                  int64_t element_offset,
                                  const dt_service::MatrixShape &shape) {
  if (!buf.ptr) {
    throw std::runtime_error(
        "FetchBuffer failed: null buffer (data transfer error)");
  }
  int total = shape.total_elements();
  auto dims = get_dims(shape);
  std::string dtype = shape.dtype();

  auto copy = [&](void *dst, const void *src, size_t nbytes) {
#ifdef HAVE_CUDA
    if (buf.is_gpu()) {
      cudaError_t err = cudaMemcpy(dst, src, nbytes, cudaMemcpyDeviceToHost);
      if (err != cudaSuccess) {
        throw std::runtime_error(std::string("Failed to copy GPU data: ") +
                                 cudaGetErrorString(err));
      }
    } else
#endif
    {
      std::memcpy(dst, src, nbytes);
    }
  };

  if (dtype == "complex64") {
    void *ptr = static_cast<char *>(buf.ptr) +
                element_offset * sizeof(std::complex<float>);
    py::array_t<std::complex<float>> arr(total);
    copy(arr.mutable_data(), ptr, total * sizeof(std::complex<float>));
    return arr.reshape(dims);
  } else if (dtype == "float32") {
    void *ptr = static_cast<char *>(buf.ptr) + element_offset * sizeof(float);
    py::array_t<float> arr(total);
    copy(arr.mutable_data(), ptr, total * sizeof(float));
    return arr.reshape(dims);
  } else {
    throw std::runtime_error("Unsupported dtype: " + dtype);
  }
}

PYBIND11_MODULE(dt_client, m) {
  m.doc() = "Digital Twin Client Python Bindings";
  const BaseTaskConfig base_defaults{};

  // TerraformConfig wrapper. All fields default to None; asim_gis owns the
  // effective defaults. building_base_method is validated at PrepareMap time.
  py::class_<TerraformConfig>(m, "TerraformConfig",
                              "Terrain shaping / building-base harmonization "
                              "parameters. All fields are optional; None means "
                              "'use the asim_gis default'.")
      .def(
          py::init([](const std::optional<bool> &terraform,
                      const std::optional<double> &pad_radius,
                      const std::optional<double> &pre_tessellation_length,
                      const std::optional<bool> &pre_smooth_terrain,
                      const std::optional<int> &pre_smooth_iters,
                      const std::optional<double> &pre_smooth_lambda,
                      const std::optional<bool> &terraform_smooth,
                      const std::optional<int> &terraform_smooth_iters,
                      const std::optional<double> &terraform_smooth_lambda,
                      const std::optional<double> &terraform_smooth_radius,
                      const std::optional<std::string> &building_base_method,
                      const std::optional<double> &base_merge_distance,
                      const std::optional<double> &base_influence_radius,
                      const std::optional<double> &base_influence_sigma,
                      const std::optional<int> &base_smooth_iters,
                      const std::optional<bool> &adaptive_bands,
                      const std::optional<double> &near_radius,
                      const std::optional<double> &near_tessellation_threshold,
                      const std::optional<double> &far_tessellation_threshold) {
            TerraformConfig c;
            c.terraform = terraform;
            c.pad_radius = pad_radius;
            c.pre_tessellation_length = pre_tessellation_length;
            c.pre_smooth_terrain = pre_smooth_terrain;
            c.pre_smooth_iters = pre_smooth_iters;
            c.pre_smooth_lambda = pre_smooth_lambda;
            c.terraform_smooth = terraform_smooth;
            c.terraform_smooth_iters = terraform_smooth_iters;
            c.terraform_smooth_lambda = terraform_smooth_lambda;
            c.terraform_smooth_radius = terraform_smooth_radius;
            c.building_base_method = building_base_method;
            c.base_merge_distance = base_merge_distance;
            c.base_influence_radius = base_influence_radius;
            c.base_influence_sigma = base_influence_sigma;
            c.base_smooth_iters = base_smooth_iters;
            c.adaptive_bands = adaptive_bands;
            c.near_radius = near_radius;
            c.near_tessellation_threshold = near_tessellation_threshold;
            c.far_tessellation_threshold = far_tessellation_threshold;
            return c;
          }),
          py::arg("terraform") = py::none(), py::arg("pad_radius") = py::none(),
          py::arg("pre_tessellation_length") = py::none(),
          py::arg("pre_smooth_terrain") = py::none(),
          py::arg("pre_smooth_iters") = py::none(),
          py::arg("pre_smooth_lambda") = py::none(),
          py::arg("terraform_smooth") = py::none(),
          py::arg("terraform_smooth_iters") = py::none(),
          py::arg("terraform_smooth_lambda") = py::none(),
          py::arg("terraform_smooth_radius") = py::none(),
          py::arg("building_base_method") = py::none(),
          py::arg("base_merge_distance") = py::none(),
          py::arg("base_influence_radius") = py::none(),
          py::arg("base_influence_sigma") = py::none(),
          py::arg("base_smooth_iters") = py::none(),
          py::arg("adaptive_bands") = py::none(),
          py::arg("near_radius") = py::none(),
          py::arg("near_tessellation_threshold") = py::none(),
          py::arg("far_tessellation_threshold") = py::none())
      .def_readwrite("terraform", &TerraformConfig::terraform,
                     "Change the shape of the terrain.")
      .def_readwrite("pad_radius", &TerraformConfig::pad_radius,
                     "Building footprint padding radius in meters.")
      .def_readwrite("pre_tessellation_length",
                     &TerraformConfig::pre_tessellation_length,
                     "Target edge length (m) for pre-terraform tessellation.")
      .def_readwrite("pre_smooth_terrain", &TerraformConfig::pre_smooth_terrain,
                     "Smooth the terrain before terraforming.")
      .def_readwrite("pre_smooth_iters", &TerraformConfig::pre_smooth_iters,
                     "Number of pre-smooth iterations.")
      .def_readwrite("pre_smooth_lambda", &TerraformConfig::pre_smooth_lambda,
                     "Smoothing lambda for the pre-smooth pass.")
      .def_readwrite("terraform_smooth", &TerraformConfig::terraform_smooth,
                     "Smooth the terrain after terraforming.")
      .def_readwrite("terraform_smooth_iters",
                     &TerraformConfig::terraform_smooth_iters,
                     "Number of post-terraform smooth iterations.")
      .def_readwrite("terraform_smooth_lambda",
                     &TerraformConfig::terraform_smooth_lambda,
                     "Smoothing lambda for the post-terraform pass.")
      .def_readwrite("terraform_smooth_radius",
                     &TerraformConfig::terraform_smooth_radius,
                     "Smooth radius in meters (0 = global).")
      .def_readwrite("building_base_method",
                     &TerraformConfig::building_base_method,
                     "How to set building base height: 'min' | 'max' | "
                     "'average' | 'top10' | 'bottom10'.")
      .def_readwrite("base_merge_distance",
                     &TerraformConfig::base_merge_distance,
                     "Distance threshold (m) for merging nearby building "
                     "bases.")
      .def_readwrite("base_influence_radius",
                     &TerraformConfig::base_influence_radius,
                     "Radius of influence (m) for base-height blending.")
      .def_readwrite("base_influence_sigma",
                     &TerraformConfig::base_influence_sigma,
                     "Gaussian sigma (m) for base-height blending.")
      .def_readwrite("base_smooth_iters", &TerraformConfig::base_smooth_iters,
                     "Number of base-height smoothing iterations.")
      .def_readwrite("adaptive_bands", &TerraformConfig::adaptive_bands,
                     "Use adaptive near/far tessellation bands.")
      .def_readwrite("near_radius", &TerraformConfig::near_radius,
                     "Near-band radius in meters.")
      .def_readwrite("near_tessellation_threshold",
                     &TerraformConfig::near_tessellation_threshold,
                     "Edge-length threshold (m) for near-band tessellation.")
      .def_readwrite("far_tessellation_threshold",
                     &TerraformConfig::far_tessellation_threshold,
                     "Edge-length threshold (m) for far-band tessellation.");

  // OSMTask wrapper
  py::class_<OSMTask>(
      m, "OSMTask",
      "PrepareMap task configuration for generating map assets from OSM "
      "data.\n\n"
      "Use this class with DigitalTwinClient.prepare_map(). The coords "
      "argument is a bounding box in (min_lon, min_lat, max_lon, max_lat) "
      "order.\n\n"
      "Example:\n"
      "    task = OSMTask(output_folder_key='maps/seattle', "
      "coords=(-122.34, 47.60, -122.33, 47.61), include_elevation=True)\n"
      "    result = client.prepare_map(task, s3_config)")
      .def(py::init([](const std::string &output_folder_key,
                       const std::tuple<double, double, double, double> &coords,
                       bool include_elevation,
                       const std::optional<std::string> &ground_source,
                       const std::string &vegetation_source,
                       double vegetation_density, double vegetation_scale_min,
                       double vegetation_scale_max,
                       const std::optional<bool> &cesium3dtiles_b3dm,
                       const std::optional<bool> &cesium3dtiles_draco,
                       const std::optional<bool> &cesium3dtiles_gzip,
                       const std::optional<int> &cesium3dtiles_chunk_size,
                       bool cesium3dtiles_veg_instanced, bool rough,
                       bool disable_interiors,
                       const std::optional<double> &terrain_clip_margin,
                       const std::optional<TerraformConfig> &terraform_config) {
             OSMTask t;
             t.output_folder_key = output_folder_key;
             t.coords = {std::get<0>(coords), std::get<1>(coords),
                         std::get<2>(coords), std::get<3>(coords)};
             t.include_elevation = include_elevation;
             t.ground_source = ground_source;
             t.vegetation_source = vegetation_source;
             t.vegetation_density = vegetation_density;
             t.vegetation_scale_min = vegetation_scale_min;
             t.vegetation_scale_max = vegetation_scale_max;
             t.cesium3dtiles_b3dm = cesium3dtiles_b3dm;
             t.cesium3dtiles_draco = cesium3dtiles_draco;
             t.cesium3dtiles_gzip = cesium3dtiles_gzip;
             t.cesium3dtiles_chunk_size = cesium3dtiles_chunk_size;
             t.cesium3dtiles_veg_instanced = cesium3dtiles_veg_instanced;
             t.rough = rough;
             t.disable_interiors = disable_interiors;
             t.terrain_clip_margin = terrain_clip_margin;
             t.terraform_config = terraform_config;
             return t;
           }),
           py::arg("output_folder_key"), py::arg("coords"),
           py::arg("include_elevation"),
           py::arg("ground_source") = base_defaults.ground_source,
           py::arg("vegetation_source") = base_defaults.vegetation_source,
           py::arg("vegetation_density") = base_defaults.vegetation_density,
           py::arg("vegetation_scale_min") = base_defaults.vegetation_scale_min,
           py::arg("vegetation_scale_max") = base_defaults.vegetation_scale_max,
           py::arg("cesium3dtiles_b3dm") = py::none(),
           py::arg("cesium3dtiles_draco") = py::none(),
           py::arg("cesium3dtiles_gzip") = py::none(),
           py::arg("cesium3dtiles_chunk_size") = py::none(),
           py::arg("cesium3dtiles_veg_instanced") =
               base_defaults.cesium3dtiles_veg_instanced,
           py::arg("rough") = base_defaults.rough,
           py::arg("disable_interiors") = base_defaults.disable_interiors,
           py::arg("terrain_clip_margin") = py::none(),
           py::arg("terraform_config") = py::none())
      .def_readwrite("output_folder_key", &OSMTask::output_folder_key,
                     "S3 key prefix under the bucket; pipeline writes /sim "
                     "and /viz subfolders here.")
      .def_readwrite("coords", &OSMTask::coords,
                     "Bounding box in degrees as "
                     "(min_lon, min_lat, max_lon, max_lat).")
      .def_readwrite("ground_source", &OSMTask::ground_source,
                     "Terrain source: 'terrarium' (default) or 'srtm'. None "
                     "lets asim_gis choose; for GML jobs the input CityGML's "
                     "TINRelief is used when present, with terrarium as a "
                     "fallback.")
      .def_readwrite("vegetation_source", &OSMTask::vegetation_source,
                     "Vegetation source method. Only 'procedural' is "
                     "currently supported via the client; other values are "
                     "accepted but produce no vegetation.")
      .def_readwrite("vegetation_density", &OSMTask::vegetation_density,
                     "Trees per hectare for procedural vegetation.")
      .def_readwrite("vegetation_scale_min", &OSMTask::vegetation_scale_min,
                     "Minimum random scale for procedural vegetation.")
      .def_readwrite("vegetation_scale_max", &OSMTask::vegetation_scale_max,
                     "Maximum random scale for procedural vegetation.")
      .def_readwrite("cesium3dtiles_b3dm", &OSMTask::cesium3dtiles_b3dm,
                     "Emit B3DM tiles instead of GLB.")
      .def_readwrite("cesium3dtiles_draco", &OSMTask::cesium3dtiles_draco,
                     "Apply Draco mesh compression to GLB tiles. Requires "
                     "cesium3dtiles_b3dm=false; auto-enabled when b3dm=false "
                     "and this flag is not set explicitly.")
      .def_readwrite("cesium3dtiles_gzip", &OSMTask::cesium3dtiles_gzip,
                     "Gzip-compress tile payloads. The hosting layer must "
                     "set Content-Encoding: gzip.")
      .def_readwrite("cesium3dtiles_chunk_size",
                     &OSMTask::cesium3dtiles_chunk_size,
                     "Chunk size in meters for spatial partitioning "
                     "(omit/None to disable).")
      .def_readwrite("cesium3dtiles_veg_instanced",
                     &OSMTask::cesium3dtiles_veg_instanced,
                     "Use GPU instancing for vegetation tiles (faster, "
                     "smaller). Set false to fall back to baked mesh tiles.")
      .def_readwrite("rough", &OSMTask::rough,
                     "Legacy option. If creating a mobility mesh, make cuts "
                     "inexact for better performance in some cases.")
      .def_readwrite("include_elevation", &OSMTask::include_elevation,
                     "Whether generated output includes elevation data.")
      .def_readwrite("disable_interiors", &OSMTask::disable_interiors,
                     "Skip interior floor-slice generation for buildings.")
      .def_readwrite("terrain_clip_margin", &OSMTask::terrain_clip_margin,
                     "Clipping margin in meters beyond the building extent. "
                     "None uses the asim_gis job default (200 m).")
      .def_readwrite("terraform_config", &OSMTask::terraform_config,
                     "Optional TerraformConfig overrides. None lets asim_gis "
                     "use its terrain-shaping defaults.");

  // GMLTask wrapper
  py::class_<GMLTask>(
      m, "GMLTask",
      "PrepareMap task configuration for generating map assets from GML "
      "files.\n\n"
      "Use this class with DigitalTwinClient.prepare_map(). The input_files "
      "argument contains server-accessible GML input file paths. epsg_in is "
      "the input coordinate reference system, and epsg_out optionally "
      "requests a different output coordinate reference system.\n\n"
      "Example:\n"
      "    task = GMLTask(output_folder_key='maps/city', "
      "input_files=['/data/city.gml'], epsg_in='4326', "
      "include_elevation=True)\n"
      "    result = client.prepare_map(task, s3_config)")
      .def(py::init([](const std::string &output_folder_key,
                       const std::vector<std::string> &input_files,
                       const std::string &epsg_in, bool include_elevation,
                       const std::optional<std::string> &epsg_out,
                       const std::optional<std::string> &ground_source,
                       const std::string &vegetation_source,
                       double vegetation_density, double vegetation_scale_min,
                       double vegetation_scale_max,
                       const std::optional<bool> &cesium3dtiles_b3dm,
                       const std::optional<bool> &cesium3dtiles_draco,
                       const std::optional<bool> &cesium3dtiles_gzip,
                       const std::optional<int> &cesium3dtiles_chunk_size,
                       bool cesium3dtiles_veg_instanced, bool rough,
                       bool disable_interiors,
                       const std::optional<double> &terrain_clip_margin,
                       const std::optional<TerraformConfig> &terraform_config) {
             GMLTask t;
             t.output_folder_key = output_folder_key;
             t.input_files = input_files;
             t.epsg_in = epsg_in;
             t.include_elevation = include_elevation;
             t.epsg_out = epsg_out;
             t.ground_source = ground_source;
             t.vegetation_source = vegetation_source;
             t.vegetation_density = vegetation_density;
             t.vegetation_scale_min = vegetation_scale_min;
             t.vegetation_scale_max = vegetation_scale_max;
             t.cesium3dtiles_b3dm = cesium3dtiles_b3dm;
             t.cesium3dtiles_draco = cesium3dtiles_draco;
             t.cesium3dtiles_gzip = cesium3dtiles_gzip;
             t.cesium3dtiles_chunk_size = cesium3dtiles_chunk_size;
             t.cesium3dtiles_veg_instanced = cesium3dtiles_veg_instanced;
             t.rough = rough;
             t.disable_interiors = disable_interiors;
             t.terrain_clip_margin = terrain_clip_margin;
             t.terraform_config = terraform_config;
             return t;
           }),
           py::arg("output_folder_key"), py::arg("input_files"),
           py::arg("epsg_in"), py::arg("include_elevation"),
           py::arg("epsg_out") = py::none(),
           py::arg("ground_source") = base_defaults.ground_source,
           py::arg("vegetation_source") = base_defaults.vegetation_source,
           py::arg("vegetation_density") = base_defaults.vegetation_density,
           py::arg("vegetation_scale_min") = base_defaults.vegetation_scale_min,
           py::arg("vegetation_scale_max") = base_defaults.vegetation_scale_max,
           py::arg("cesium3dtiles_b3dm") = py::none(),
           py::arg("cesium3dtiles_draco") = py::none(),
           py::arg("cesium3dtiles_gzip") = py::none(),
           py::arg("cesium3dtiles_chunk_size") = py::none(),
           py::arg("cesium3dtiles_veg_instanced") =
               base_defaults.cesium3dtiles_veg_instanced,
           py::arg("rough") = base_defaults.rough,
           py::arg("disable_interiors") = base_defaults.disable_interiors,
           py::arg("terrain_clip_margin") = py::none(),
           py::arg("terraform_config") = py::none())
      .def_readwrite("output_folder_key", &GMLTask::output_folder_key,
                     "S3 key prefix under the bucket; pipeline writes /sim "
                     "and /viz subfolders here.")
      .def_readwrite("input_files", &GMLTask::input_files,
                     "Server-accessible GML input file paths.")
      .def_readwrite("epsg_in", &GMLTask::epsg_in, "Input EPSG code.")
      .def_readwrite("epsg_out", &GMLTask::epsg_out,
                     "Optional output EPSG code.")
      .def_readwrite("ground_source", &GMLTask::ground_source,
                     "Terrain source: 'terrarium' (default) or 'srtm'. None "
                     "lets asim_gis choose; for GML jobs the input CityGML's "
                     "TINRelief is used when present, with terrarium as a "
                     "fallback.")
      .def_readwrite("vegetation_source", &GMLTask::vegetation_source,
                     "Vegetation source method. Only 'procedural' is "
                     "currently supported via the client; other values are "
                     "accepted but produce no vegetation.")
      .def_readwrite("vegetation_density", &GMLTask::vegetation_density,
                     "Trees per hectare for procedural vegetation.")
      .def_readwrite("vegetation_scale_min", &GMLTask::vegetation_scale_min,
                     "Minimum random scale for procedural vegetation.")
      .def_readwrite("vegetation_scale_max", &GMLTask::vegetation_scale_max,
                     "Maximum random scale for procedural vegetation.")
      .def_readwrite("cesium3dtiles_b3dm", &GMLTask::cesium3dtiles_b3dm,
                     "Emit B3DM tiles instead of GLB.")
      .def_readwrite("cesium3dtiles_draco", &GMLTask::cesium3dtiles_draco,
                     "Apply Draco mesh compression to GLB tiles. Requires "
                     "cesium3dtiles_b3dm=false; auto-enabled when b3dm=false "
                     "and this flag is not set explicitly.")
      .def_readwrite("cesium3dtiles_gzip", &GMLTask::cesium3dtiles_gzip,
                     "Gzip-compress tile payloads. The hosting layer must "
                     "set Content-Encoding: gzip.")
      .def_readwrite("cesium3dtiles_chunk_size",
                     &GMLTask::cesium3dtiles_chunk_size,
                     "Chunk size in meters for spatial partitioning "
                     "(omit/None to disable).")
      .def_readwrite("cesium3dtiles_veg_instanced",
                     &GMLTask::cesium3dtiles_veg_instanced,
                     "Use GPU instancing for vegetation tiles (faster, "
                     "smaller). Set false to fall back to baked mesh tiles.")
      .def_readwrite("rough", &GMLTask::rough,
                     "Legacy option. If creating a mobility mesh, make cuts "
                     "inexact for better performance in some cases.")
      .def_readwrite("include_elevation", &GMLTask::include_elevation,
                     "Whether generated output includes elevation data.")
      .def_readwrite("disable_interiors", &GMLTask::disable_interiors,
                     "Skip interior floor-slice generation for buildings.")
      .def_readwrite("terrain_clip_margin", &GMLTask::terrain_clip_margin,
                     "Clipping margin in meters beyond the building extent. "
                     "None uses the asim_gis job default (200 m).")
      .def_readwrite("terraform_config", &GMLTask::terraform_config,
                     "Optional TerraformConfig overrides. None lets asim_gis "
                     "use its terrain-shaping defaults.");

  // Expose temporal index types for type-safe mode selection
  // Single temporal indices
  py::class_<SlotIndex>(
      m, "SlotIndex",
      "Single temporal index for Slot/Symbols mode.\n\n"
      "Use this wrapper when a client API expects one slot in a scenario that\n"
      "uses slot-based timing.\n\n"
      "Example:\n"
      "    SlotIndex(5)")
      .def(py::init<int>(), py::arg("value"))
      .def_readonly("value", &SlotIndex::value, "Underlying slot index value.");

  py::class_<TimeStepIndex>(
      m, "TimeStepIndex",
      "Single temporal index for Duration/Interval mode.\n\n"
      "Use this wrapper when a client API expects one time step in a scenario\n"
      "that uses duration/interval timing.\n\n"
      "Example:\n"
      "    TimeStepIndex(12)")
      .def(py::init<int>(), py::arg("value"))
      .def_readonly("value", &TimeStepIndex::value,
                    "Underlying time-step index value.");

  // Multiple temporal indices (for multi-time-step queries)
  py::class_<SlotIndices>(
      m, "SlotIndices",
      "Multiple temporal indices for Slot/Symbols mode.\n\n"
      "Use this wrapper when a client API accepts multiple slots in one call,\n"
      "such as batched CIR computation.\n\n"
      "Example:\n"
      "    SlotIndices([0, 1, 2])")
      .def(py::init<const std::vector<int> &>(), py::arg("values"))
      .def_readonly("values", &SlotIndices::values,
                    "Underlying slot index values.")
      .def("__len__", &SlotIndices::size);

  py::class_<TimeStepIndices>(
      m, "TimeStepIndices",
      "Multiple temporal indices for Duration/Interval mode.\n\n"
      "Use this wrapper when a client API accepts multiple time steps in one\n"
      "call, such as batched CIR computation.\n\n"
      "Example:\n"
      "    TimeStepIndices([0, 1, 2])")
      .def(py::init<const std::vector<int> &>(), py::arg("values"))
      .def_readonly("values", &TimeStepIndices::values,
                    "Underlying time-step index values.")
      .def("__len__", &TimeStepIndices::size);

  // CIR Batch Allocation - exposes C++ struct directly to Python
  py::class_<DigitalTwinClient::CIRBatchAllocation>(
      m, "CIRAllocation",
      "CIR batch allocation returned by "
      "`DigitalTwinClient.allocate_cirs_memory()`.\n\n"
      "The primary payload is four CIR result buffers: `values`, `delays`,\n"
      "`angles_of_departure`, and `angles_of_arrival`. The allocation also\n"
      "stores the transport handles, per-time-step/per-RU shapes and offsets,\n"
      "the RU/UE configuration used for allocation, and lazy-fetch state for\n"
      "those buffers.\n\n"
      "The allocation is reused by `get_cirs()`, `to_numpy()`,\n"
      "`to_numpy_all_cir()`, and `deallocate_cirs_memory()`. Users normally "
      "do not\n"
      "construct this class directly.\n\n"
      "Buffer layout:\n"
      "    Shapes and offsets are organized as "
      "`[time_step_position][ru_position]`.\n"
      "    After `get_cirs()` succeeds, `temporal_indices` maps each "
      "time-step position to the actual slot or time-step index requested by "
      "`SlotIndex`,\n"
      "    `TimeStepIndex`, `SlotIndices`, or `TimeStepIndices`.\n\n"
      "    Absolute buffer offsets are formed as "
      "`*_time_step_offsets[ts_pos] + *_ru_offsets_per_ts[ts_pos][ru_pos]`.\n"
      "    Angle offsets are measured in float32 scalar elements because "
      "solver `float2`\n"
      "    entries are exposed as `float32[..., 2]` arrays.\n\n"
      "    NumPy tensor layouts are:\n"
      "    - `values`: "
      "`[rx][sample][rx_h][rx_v][rx_p][tx_h][tx_v][tx_p][tap]`\n"
      "    - `delays`: "
      "`[rx][sample][rx_h][rx_v][tx_h][tx_v][tap]`\n"
      "    - `angles_of_departure` and `angles_of_arrival`: "
      "`[rx][sample][rx_h][rx_v][tx_h][tx_v][tap][angle_component]`\n\n"
      "    `angle_component` has size 2: index 0 is azimuth and index 1 is "
      "zenith,\n"
      "    both in radians. `angles_of_departure` is defined in the TX "
      "panel's local coordinate system; `angles_of_arrival` is defined in the "
      "RX panel's local coordinate system. These layouts match the EM Solver "
      "API "
      "`CIRResult` indexing; the Python client exposes solver `float2` angle "
      "entries "
      "as `float32[..., 2]` arrays and uses float32 scalar offsets for angle "
      "buffers.\n\n"
      "    Use `get_values_shape()`, `get_delays_shape()`,\n"
      "    `get_angles_of_departure_shape()`, and "
      "`get_angles_of_arrival_shape()`\n"
      "    to inspect the concrete shape for an actual `(temporal, RU)` pair.\n"
      "    Shape dictionaries contain `dimensions`, `total_elements`, and "
      "`dtype`.\n"
      "    The dtype is `complex64` for `values` and `float32` for `delays` "
      "and angle buffers.\n\n"
      "    Advanced helpers: use `slot_to_pos(actual_temporal_index)` and\n"
      "    `ru_to_pos(time_step_position, actual_ru_index)` only when "
      "manually indexing the per-time-step, per-RU metadata arrays.")
      .def_property_readonly(
          "transport_mode",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            switch (self.mode) {
            case dt_service::LOCAL_IPC:
              return "LOCAL_IPC";
            case dt_service::REMOTE:
              return "REMOTE";
            default:
              return "UNKNOWN";
            }
          },
          "Transport mode: 'LOCAL_IPC' or 'REMOTE'")
      // IPC handles (as bytes)
      .def_property_readonly(
          "values_handle",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            return py::bytes(self.values_ipc_handle);
          },
          "IPC handle for values buffer (bytes)")
      .def_property_readonly(
          "delays_handle",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            return py::bytes(self.delays_ipc_handle);
          },
          "IPC handle for delays buffer (bytes)")
      .def_property_readonly(
          "angles_of_departure_handle",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            return py::bytes(self.angles_of_departure_ipc_handle);
          },
          "IPC handle for AOD buffer (bytes)")
      .def_property_readonly(
          "angles_of_arrival_handle",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            return py::bytes(self.angles_of_arrival_ipc_handle);
          },
          "IPC handle for AOA buffer (bytes)")
      // Shapes (convert MatrixShape to dict)
      .def_property_readonly(
          "values_shapes_per_ts",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            py::list result;
            for (const auto &ts_shapes : self.values_shapes_per_ts) {
              py::list ts_list;
              for (const auto &s : ts_shapes)
                ts_list.append(matrix_shape_to_dict(s));
              result.append(ts_list);
            }
            return result;
          },
          "Per-time-step, per-RU value shapes: list[list[dict]]")
      .def_property_readonly(
          "delays_shapes_per_ts",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            py::list result;
            for (const auto &ts_shapes : self.delays_shapes_per_ts) {
              py::list ts_list;
              for (const auto &s : ts_shapes)
                ts_list.append(matrix_shape_to_dict(s));
              result.append(ts_list);
            }
            return result;
          },
          "Per-time-step, per-RU delay shapes: list[list[dict]]")
      .def_property_readonly(
          "angles_of_departure_shapes_per_ts",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            py::list result;
            for (const auto &ts_shapes :
                 self.angles_of_departure_shapes_per_ts) {
              py::list ts_list;
              for (const auto &s : ts_shapes)
                ts_list.append(matrix_shape_to_dict(s));
              result.append(ts_list);
            }
            return result;
          },
          "Per-time-step, per-RU AOD shapes: list[list[dict]]")
      .def_property_readonly(
          "angles_of_arrival_shapes_per_ts",
          [](const DigitalTwinClient::CIRBatchAllocation &self) {
            py::list result;
            for (const auto &ts_shapes : self.angles_of_arrival_shapes_per_ts) {
              py::list ts_list;
              for (const auto &s : ts_shapes)
                ts_list.append(matrix_shape_to_dict(s));
              result.append(ts_list);
            }
            return result;
          },
          "Per-time-step, per-RU AOA shapes: list[list[dict]]")
      // Offsets
      .def_readonly(
          "values_time_step_offsets",
          &DigitalTwinClient::CIRBatchAllocation::values_time_step_offsets,
          "Cumulative element offset for each time step from buffer start "
          "(values)")
      .def_readonly(
          "delays_time_step_offsets",
          &DigitalTwinClient::CIRBatchAllocation::delays_time_step_offsets,
          "Cumulative element offset for each time step from buffer start "
          "(delays)")
      .def_readonly(
          "angles_of_departure_time_step_offsets",
          &DigitalTwinClient::CIRBatchAllocation::
              angles_of_departure_time_step_offsets,
          "Cumulative float32 element offsets for each time step from buffer "
          "start (AOD)")
      .def_readonly(
          "angles_of_arrival_time_step_offsets",
          &DigitalTwinClient::CIRBatchAllocation::
              angles_of_arrival_time_step_offsets,
          "Cumulative float32 element offsets for each time step from buffer "
          "start (AOA)")
      .def_readonly(
          "values_ru_offsets_per_ts",
          &DigitalTwinClient::CIRBatchAllocation::values_ru_offsets_per_ts,
          "Per-time-step, per-RU element offsets (values)")
      .def_readonly(
          "delays_ru_offsets_per_ts",
          &DigitalTwinClient::CIRBatchAllocation::delays_ru_offsets_per_ts,
          "Per-time-step, per-RU element offsets (delays)")
      .def_readonly("angles_of_departure_ru_offsets_per_ts",
                    &DigitalTwinClient::CIRBatchAllocation::
                        angles_of_departure_ru_offsets_per_ts,
                    "Per-time-step, per-RU float32 element offsets (AOD)")
      .def_readonly("angles_of_arrival_ru_offsets_per_ts",
                    &DigitalTwinClient::CIRBatchAllocation::
                        angles_of_arrival_ru_offsets_per_ts,
                    "Per-time-step, per-RU float32 element offsets (AOA)")
      // Sizes
      .def_readonly("total_values_bytes",
                    &DigitalTwinClient::CIRBatchAllocation::total_values_bytes,
                    "Total byte size of the values buffer")
      .def_readonly("total_delays_bytes",
                    &DigitalTwinClient::CIRBatchAllocation::total_delays_bytes,
                    "Total byte size of the delays buffer")
      .def_readonly("total_angles_of_departure_bytes",
                    &DigitalTwinClient::CIRBatchAllocation::
                        total_angles_of_departure_bytes,
                    "Total byte size of the AOD buffer")
      .def_readonly(
          "total_angles_of_arrival_bytes",
          &DigitalTwinClient::CIRBatchAllocation::total_angles_of_arrival_bytes,
          "Total byte size of the AOA buffer")
      // Config
      .def_readonly("num_time_steps",
                    &DigitalTwinClient::CIRBatchAllocation::num_time_steps,
                    "Number of time-step positions in the allocation")
      .def_readonly("ru_indices_per_ts",
                    &DigitalTwinClient::CIRBatchAllocation::ru_indices_per_ts,
                    "RU indices for each time step position: list[list[int]]")
      .def_readonly(
          "ue_indices_per_ts",
          &DigitalTwinClient::CIRBatchAllocation::ue_indices_per_ts,
          "UE indices per RU for each time step: list[list[list[int]]]")
      .def_readonly(
          "is_full_antenna_pair",
          &DigitalTwinClient::CIRBatchAllocation::is_full_antenna_pair,
          "Whether the allocation stores full antenna-pair outputs")
      .def_readonly("allocation_key",
                    &DigitalTwinClient::CIRBatchAllocation::allocation_key,
                    "Server-side allocation key (for pull-based transfer)")
      .def_readonly("values_fetched",
                    &DigitalTwinClient::CIRBatchAllocation::values_fetched,
                    "Whether the values buffer has been fetched locally")
      .def_readonly("delays_fetched",
                    &DigitalTwinClient::CIRBatchAllocation::delays_fetched,
                    "Whether the delays buffer has been fetched locally")
      .def_readonly(
          "angles_of_departure_fetched",
          &DigitalTwinClient::CIRBatchAllocation::angles_of_departure_fetched,
          "Whether the AOD buffer has been fetched locally")
      .def_readonly(
          "angles_of_arrival_fetched",
          &DigitalTwinClient::CIRBatchAllocation::angles_of_arrival_fetched,
          "Whether the AOA buffer has been fetched locally")
      // Temporal indices (set after get_cirs)
      .def_readwrite("temporal_indices",
                     &DigitalTwinClient::CIRBatchAllocation::temporal_indices,
                     "Actual slot/timestep indices (set after get_cirs)")
      // Helper methods for index mapping
      .def(
          "slot_to_pos",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx) {
            const auto &ti = self.temporal_indices;
            auto it = std::find(ti.begin(), ti.end(), slot_idx);
            if (it == ti.end()) {
              throw std::runtime_error("Slot " + std::to_string(slot_idx) +
                                       " not found in allocation");
            }
            return static_cast<int>(std::distance(ti.begin(), it));
          },
          py::arg("slot_idx"), "Convert actual slot/timestep index to position")
      .def(
          "ru_to_pos",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int ts_pos,
             int ru_idx) {
            if (ts_pos < 0 ||
                ts_pos >= static_cast<int>(self.ru_indices_per_ts.size())) {
              throw std::runtime_error("Time step position out of range");
            }
            const auto &rus = self.ru_indices_per_ts[ts_pos];
            auto it = std::find(rus.begin(), rus.end(), ru_idx);
            if (it == rus.end()) {
              throw std::runtime_error("RU " + std::to_string(ru_idx) +
                                       " not found at time step position " +
                                       std::to_string(ts_pos));
            }
            return static_cast<int>(std::distance(rus.begin(), it));
          },
          py::arg("ts_pos"), py::arg("ru_idx"),
          "Convert RU index to position within a time step")
      .def(
          "has_slot",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx) {
            const auto &ti = self.temporal_indices;
            return std::find(ti.begin(), ti.end(), slot_idx) != ti.end();
          },
          py::arg("slot_idx"),
          "Check if a slot/timestep index exists in the allocation")
      .def(
          "has_ru",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            const auto &ti = self.temporal_indices;
            auto slot_it = std::find(ti.begin(), ti.end(), slot_idx);
            if (slot_it == ti.end())
              return false;
            int ts_pos = std::distance(ti.begin(), slot_it);
            const auto &rus = self.ru_indices_per_ts[ts_pos];
            return std::find(rus.begin(), rus.end(), ru_idx) != rus.end();
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Check if an RU exists for a given slot")
      .def(
          "get_values_offset",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return self.values_ru_offsets_per_ts[ts_pos][ru_pos];
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get per-RU element offset for values within the time step")
      .def(
          "get_delays_offset",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return self.delays_ru_offsets_per_ts[ts_pos][ru_pos];
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get per-RU element offset for delays within the time step")
      .def(
          "get_angles_of_departure_offset",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return self.angles_of_departure_ru_offsets_per_ts[ts_pos][ru_pos];
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get per-RU float32 element offset for AOD within the time step")
      .def(
          "get_angles_of_arrival_offset",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return self.angles_of_arrival_ru_offsets_per_ts[ts_pos][ru_pos];
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get per-RU float32 element offset for AOA within the time step")
      .def(
          "get_values_shape",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return matrix_shape_to_dict(
                self.values_shapes_per_ts[ts_pos][ru_pos]);
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get shape dict for values at (slot, ru)")
      .def(
          "get_delays_shape",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return matrix_shape_to_dict(
                self.delays_shapes_per_ts[ts_pos][ru_pos]);
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get shape dict for delays at (slot, ru)")
      .def(
          "get_angles_of_departure_shape",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return matrix_shape_to_dict(
                self.angles_of_departure_shapes_per_ts[ts_pos][ru_pos]);
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get shape dict for AOD at (slot, ru)")
      .def(
          "get_angles_of_arrival_shape",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx,
             int ru_idx) {
            auto [ts_pos, ru_pos] = find_positions(self, slot_idx, ru_idx);
            return matrix_shape_to_dict(
                self.angles_of_arrival_shapes_per_ts[ts_pos][ru_pos]);
          },
          py::arg("slot_idx"), py::arg("ru_idx"),
          "Get shape dict for AOA at (slot, ru)")
      .def(
          "get_ru_indices_for_slot",
          [](const DigitalTwinClient::CIRBatchAllocation &self, int slot_idx) {
            const auto &ti = self.temporal_indices;
            auto it = std::find(ti.begin(), ti.end(), slot_idx);
            if (it == ti.end())
              throw std::runtime_error("Slot " + std::to_string(slot_idx) +
                                       " not found");
            return self.ru_indices_per_ts[std::distance(ti.begin(), it)];
          },
          py::arg("slot_idx"), "Get RU indices for a specific slot");

  py::class_<DigitalTwinClient>(
      m, "DigitalTwinClient",
      "Client for interacting with the Digital Twin server.\n\n"
      "Use this class to load scenarios from YAML, inspect scenario metadata,\n"
      "query infrastructure and mobility positions, allocate CIR result\n"
      "buffers, compute channel responses, fetch data into NumPy arrays, and\n"
      "export server-side results.\n\n"
      "Typical workflow:\n"
      "\n"
      "1. Construct the client and verify `is_connected`.\n"
      "2. Call `start()` with the full scenario YAML string.\n"
      "3. Inspect `get_status()` or the position query helpers.\n"
      "4. Allocate CIR memory with `allocate_cirs_memory()`.\n"
      "5. Compute results with `get_cirs()` and fetch them with `to_numpy()`\n"
      "   or `to_numpy_all_cir()`.\n\n"
      "The constructor negotiates the transport mode exposed by\n"
      "`transport_mode`.")
      .def(
          py::init([](const std::string &server_address, bool force) {
            return new DigitalTwinClient(
                grpc::CreateChannel(server_address,
                                    grpc::InsecureChannelCredentials()),
                force);
          }),
          py::arg("server_address") = "localhost:50051",
          py::arg("force") = false,
          "__init__(server_address: str = \"localhost:50051\", "
          "force: bool = False) -> None\n\n"
          "Create a Digital Twin client connected to the specified server.\n\n"
          "Args:\n"
          "    server_address (str): gRPC endpoint for the Digital Twin "
          "server.\n"
          "    force (bool): If true, replace an existing connected client "
          "and cancel its ongoing work on the server.\n\n"
          "Returns:\n"
          "    None\n\n"
          "Notes:\n"
          "    Construction acquires the single-client lock on the server and\n"
          "    negotiates the available data transport.\n"
          "    If `force` is true, any existing client session is "
          "disconnected and any ongoing server work for that session is "
          "canceled so this client can take ownership.")

      .def_property_readonly(
          "is_connected",
          [](const DigitalTwinClient &self) { return self.IsConnected(); },
          "Whether the client has an active session with the server")
      .def_property_readonly(
          "transport_mode",
          [](const DigitalTwinClient &self) {
            return (self.GetTransportMode() == dt_service::LOCAL_IPC)
                       ? "LOCAL_IPC"
                       : "REMOTE";
          },
          "Negotiated transport mode: 'LOCAL_IPC' or 'REMOTE'")
      .def_property_readonly(
          "has_gpu",
          [](const DigitalTwinClient &self) { return self.HasGPU(); },
          "Whether the client has a GPU")
      .def(
          "start",
          [](DigitalTwinClient &self, const std::string &yaml_content) {
            return self.Start(yaml_content);
          },
          py::arg("yaml_content"),
          "start(yaml_content: str) -> bool\n\n"
          "Load or replace the active scenario on the server from a YAML "
          "string.\n\n"
          "Args:\n"
          "    yaml_content (str): Complete scenario configuration serialized "
          "as YAML.\n\n"
          "Returns:\n"
          "    bool: True if the server accepted and loaded the scenario.")

      .def(
          "get_status",
          [](DigitalTwinClient &self) {
            bool scenario_loaded, is_slot_symbol_mode;
            int num_rus, num_ues, total_batches,
                num_slots_or_timesteps_per_batch;
            bool success = self.GetScenarioStatus(
                scenario_loaded, num_rus, num_ues, total_batches,
                is_slot_symbol_mode, num_slots_or_timesteps_per_batch);
            if (!success) {
              throw std::runtime_error("Failed to get scenario status");
            }
            py::dict result;
            result["scenario_loaded"] = scenario_loaded;
            result["num_rus"] = num_rus;
            result["num_ues"] = num_ues;
            result["total_batches"] = total_batches;
            result["is_slot_symbol_mode"] = is_slot_symbol_mode;
            result["num_slots_or_timesteps_per_batch"] =
                num_slots_or_timesteps_per_batch;
            return result;
          },
          "get_status() -> dict\n\n"
          "Return summary metadata for the currently loaded scenario.\n\n"
          "Raises:\n"
          "    RuntimeError: If the scenario status cannot be retrieved from "
          "the server.\n\n"
          "Returns:\n"
          "    dict: Dictionary with the keys `scenario_loaded`, `num_rus`,\n"
          "        `num_ues`, `total_batches`, `is_slot_symbol_mode`, and\n"
          "        `num_slots_or_timesteps_per_batch`. The final field is\n"
          "        interpreted as slots per batch in slot/symbol mode and "
          "time steps per batch in duration/interval mode.")

      .def(
          "run_full_simulation",
          [](DigitalTwinClient &self) {
            int time_steps_completed{};
            float total_time_seconds{};
            bool success;

            // Release GIL during blocking gRPC stream so other Python
            // threads can run (e.g., to call cancel_simulation).
            {
              py::gil_scoped_release release;
              success = self.RunFullSimulation(time_steps_completed,
                                               total_time_seconds);
            }

            if (!success) {
              throw std::runtime_error("Failed to run full simulation");
            }
            py::dict result;
            result["time_steps_completed"] = time_steps_completed;
            result["total_time_seconds"] = total_time_seconds;
            return result;
          },
          "run_full_simulation() -> dict\n\n"
          "Run the full server-side simulation loop for all remaining batches "
          "and time steps.\n\n"
          "This is a blocking streaming RPC. While it is running, other "
          "Python\n"
          "threads in the same process can still run, so one of them can call\n"
          "`cancel_simulation()`.\n\n"
          "Notes:\n"
          "    Start this call on a worker thread if you want to cancel it "
          "from\n"
          "    the same Python process. If the simulation was started on the\n"
          "    main thread and you cannot issue a cancellation call from that\n"
          "    process, a second process can construct\n"
          "    `DigitalTwinClient(..., force=True)` to take over the single-\n"
          "    client session. The server cancels in-flight streaming RPCs\n"
          "    before transferring ownership.\n\n"
          "Raises:\n"
          "    RuntimeError: If the simulation stream cannot be completed or "
          "is rejected by the server.\n\n"
          "Returns:\n"
          "    dict: Dictionary with `time_steps_completed` and "
          "`total_time_seconds`.")

      .def(
          "run_calibration",
          [](DigitalTwinClient &self) {
            float total_time_seconds{};
            std::string final_stage;
            std::string message;
            bool success;

            {
              py::gil_scoped_release release;
              success =
                  self.RunCalibration(total_time_seconds, final_stage, message);
            }

            if (!success) {
              throw std::runtime_error("Failed to run calibration");
            }
            py::dict result;
            result["total_time_seconds"] = total_time_seconds;
            result["stage"] = final_stage;
            result["message"] = message;
            return result;
          },
          "run_calibration() -> dict\n\n"
          "Run calibration for the loaded calibration scenario.\n\n"
          "This is a blocking streaming RPC that reports coarse progress "
          "stages: `started`, `building_edges`, `running`, and `completed`.\n\n"
          "Raises:\n"
          "    RuntimeError: If calibration is rejected by the server or the "
          "stream cannot be completed.\n\n"
          "Returns:\n"
          "    dict: Dictionary with `total_time_seconds`, `stage`, and "
          "`message`.")

      .def(
          "cancel_simulation",
          [](DigitalTwinClient &self, const std::string &reason) {
            bool success = self.CancelSimulation(reason);
            if (!success) {
              throw std::runtime_error("Failed to cancel simulation");
            }
          },
          py::arg("reason") = "",
          "cancel_simulation(reason: str = \"\") -> None\n\n"
          "Cancel an in-progress streaming operation on the server.\n\n"
          "This is typically used to stop `run_full_simulation()` or "
          "`get_cirs()` from another thread while the blocking RPC is still "
          "running.\n\n"
          "Args:\n"
          "    reason (str, optional): Human-readable reason for the "
          "cancellation request.\n\n"
          "Raises:\n"
          "    RuntimeError: If the cancellation request cannot be delivered "
          "or the server reports failure.\n\n"
          "Notes:\n"
          "    To cancel a blocking streaming RPC from the same Python "
          "process, start that RPC on a worker thread and call "
          "`cancel_simulation()` from another thread.\n"
          "    If that is not possible, another process can construct\n"
          "    `DigitalTwinClient(..., force=True)` to take over the session "
          "and trigger cancellation.")

      .def(
          "get_ru_positions",
          [](DigitalTwinClient &self) {
            std::vector<std::array<float, 3>> positions;
            bool success = self.GetRUPositions(positions);
            if (!success) {
              throw std::runtime_error("Failed to get RU positions");
            }
            py::list result;
            for (const auto &pos : positions) {
              py::list p;
              p.append(pos[0]);
              p.append(pos[1]);
              p.append(pos[2]);
              result.append(p);
            }
            return result;
          },
          "get_ru_positions() -> list[list[float]]\n\n"
          "Return the static infrastructure positions for every RU in the "
          "loaded scenario.\n\n"
          "Raises:\n"
          "    RuntimeError: If RU positions cannot be retrieved from the "
          "server.\n\n"
          "Returns:\n"
          "    list: List of `[x, y, z]` positions ordered by RU index.")

      .def(
          "get_ue_positions",
          [](DigitalTwinClient &self, int batch_index,
             const py::object &temporal_index_obj) {
            TemporalIndex temporal_index =
                py_to_temporal_index(temporal_index_obj);
            std::vector<std::array<float, 3>> positions;
            bool success =
                self.GetUEPositions(batch_index, temporal_index, positions);
            if (!success) {
              throw std::runtime_error("Failed to get UE positions");
            }
            py::list result;
            for (const auto &pos : positions) {
              py::list p;
              p.append(pos[0]);
              p.append(pos[1]);
              p.append(pos[2]);
              result.append(p);
            }
            return result;
          },
          py::arg("batch_index"), py::arg("temporal_index"),
          "get_ue_positions(batch_index: int, temporal_index) -> "
          "list[list[float]]\n\n"
          "Return UE positions for one slot or time step in a specific "
          "batch.\n\n"
          "Use `SlotIndex` when the scenario is configured in slot/symbol "
          "mode\n"
          "and `TimeStepIndex` when the scenario uses duration/interval "
          "mode.\n\n"
          "Args:\n"
          "    batch_index (int): Batch index within the loaded scenario.\n"
          "    temporal_index (SlotIndex|TimeStepIndex): Temporal location to\n"
          "        sample.\n\n"
          "Raises:\n"
          "    RuntimeError: If `temporal_index` has the wrong type or UE "
          "positions cannot be retrieved from the server.\n\n"
          "Returns:\n"
          "    list: UE positions as `[[x, y, z], ...]`.")

      .def(
          "allocate_cirs_memory",
          [](DigitalTwinClient &self, const py::object &ru_indices_obj,
             const py::object &ue_indices_obj, bool is_full_antenna_pair,
             const py::object &num_time_steps_obj) {
            // Detect input style and convert to per-time-step format
            std::vector<std::vector<int>> ru_indices_per_ts;
            std::vector<std::vector<std::vector<int>>> ue_indices_per_ts;

            py::list ru_list = ru_indices_obj.cast<py::list>();
            py::list ue_list = ue_indices_obj.cast<py::list>();

            // Detect mode: broadcast vs per-time-step
            // - Broadcast: ru_indices=List[int], ue_indices=List[List[int]]
            // - Per-time-step: ru_indices=List[List[int]],
            // ue_indices=List[List[List[int]]]
            bool ru_is_per_ts = is_2d_int_list(ru_indices_obj);
            bool ue_is_per_ts = is_3d_int_list(ue_indices_obj);

            if (ru_is_per_ts != ue_is_per_ts) {
              throw std::runtime_error(
                  "ru_indices and ue_indices_per_ru must be in the same mode. "
                  "ru_indices is " +
                  std::string(ru_is_per_ts ? "per-time-step (List[List[int]])"
                                           : "broadcast (List[int])") +
                  " but ue_indices_per_ru is " +
                  std::string(ue_is_per_ts
                                  ? "per-time-step (List[List[List[int]]])"
                                  : "broadcast (List[List[int]])"));
            }

            bool is_broadcast = !ru_is_per_ts;

            if (is_broadcast) {
              // Broadcast style: ru_indices is List[int], ue_indices is
              // List[List[int]]
              // Default to 1 time step for backward compatibility
              int num_time_steps = num_time_steps_obj.is_none()
                                       ? 1
                                       : num_time_steps_obj.cast<int>();
              if (num_time_steps <= 0) {
                throw std::runtime_error("num_time_steps must be positive");
              }

              // Parse broadcast config
              std::vector<int> ru_indices = ru_list.cast<std::vector<int>>();
              std::vector<std::vector<int>> ue_indices_per_ru;
              for (auto &ue_ru : ue_list) {
                ue_indices_per_ru.push_back(ue_ru.cast<std::vector<int>>());
              }

              // Expand to per-time-step format
              for (int ts = 0; ts < num_time_steps; ++ts) {
                ru_indices_per_ts.push_back(ru_indices);
                ue_indices_per_ts.push_back(ue_indices_per_ru);
              }
            } else {
              // Per-time-step style: ru_indices is List[List[int]], ue_indices
              // is List[List[List[int]]]
              // The number of time steps is determined by the length of ru_list
              size_t num_time_steps_from_ru = ru_list.size();

              // If num_time_steps is explicitly provided, validate it matches
              if (!num_time_steps_obj.is_none()) {
                int provided_num_time_steps = num_time_steps_obj.cast<int>();
                if (static_cast<size_t>(provided_num_time_steps) !=
                    num_time_steps_from_ru) {
                  throw std::runtime_error(
                      "num_time_steps (" +
                      std::to_string(provided_num_time_steps) +
                      ") does not match the length of ru_indices (" +
                      std::to_string(num_time_steps_from_ru) +
                      ") in per-time-step mode");
                }
              }

              for (auto &ts_ru : ru_list) {
                ru_indices_per_ts.push_back(ts_ru.cast<std::vector<int>>());
              }
              for (auto &ts_ue : ue_list) {
                std::vector<std::vector<int>> ue_per_ru;
                py::list ts_ue_list = ts_ue.cast<py::list>();
                for (auto &ru_ue : ts_ue_list) {
                  ue_per_ru.push_back(ru_ue.cast<std::vector<int>>());
                }
                ue_indices_per_ts.push_back(ue_per_ru);
              }
            }

            // Use batch allocation with per-time-step config
            auto allocation =
                std::make_unique<DigitalTwinClient::CIRBatchAllocation>();

            bool success = self.AllocateCIRResultsMemory(
                ru_indices_per_ts, ue_indices_per_ts, is_full_antenna_pair,
                *allocation);

            if (!success) {
              throw std::runtime_error("Failed to allocate CIR results memory");
            }

            // Return the allocation object directly (pybind11 handles
            // conversion)
            return allocation.release();
          },
          py::arg("ru_indices"), py::arg("ue_indices_per_ru"),
          py::arg("is_full_antenna_pair") = false,
          py::arg("num_time_steps") = py::none(),
          py::return_value_policy::take_ownership,
          "allocate_cirs_memory(ru_indices, ue_indices_per_ru, "
          "is_full_antenna_pair: bool = False, num_time_steps = None) -> "
          "CIRAllocation\n\n"
          "Allocate result buffers for later CIR computation.\n\n"
          "The returned `CIRAllocation` captures the buffer layout and is "
          "reused\n"
          "by `get_cirs()`, `to_numpy()`, and `to_numpy_all_cir()`.\n\n"
          "Supports two input styles:\n\n"
          "1. Broadcast style\n"
          "   Use this when every time step uses the same RU list and the "
          "same\n"
          "   UE-per-RU layout.\n"
          "   - ru_indices: list[int]\n"
          "   - ue_indices_per_ru: list[list[int]]\n"
          "   - num_time_steps: optional, defaults to 1 and repeats the same\n"
          "     layout for each time step\n\n"
          "2. Per-time-step style\n"
          "   Use this when different time steps need different RU or UE "
          "sets.\n"
          "   - ru_indices: list[list[int]]\n"
          "   - ue_indices_per_ru: list[list[list[int]]]\n"
          "   - num_time_steps: optional; if omitted, it is inferred from the\n"
          "     length of `ru_indices`. If provided, it must match that "
          "length.\n\n"
          "Args:\n"
          "    ru_indices: RU indices (1D for broadcast, 2D for "
          "per-time-step)\n"
          "    ue_indices_per_ru: UE indices per RU (2D for broadcast, 3D for "
          "per-time-step)\n"
          "    is_full_antenna_pair (bool): True for full antenna-pair "
          "outputs,\n"
          "        false for single antenna-pair outputs.\n"
          "    num_time_steps (int, optional): Number of repeated time steps "
          "in broadcast mode, or an optional consistency check in "
          "per-time-step mode.\n\n"
          "Raises:\n"
          "    RuntimeError: If the RU and UE index layouts are invalid, "
          "`num_time_steps` is inconsistent, or the server cannot allocate "
          "CIR buffers.\n\n"
          "Returns:\n"
          "    CIRAllocation: Allocation object containing metadata, offsets,\n"
          "        shapes, and lazy-fetch state.\n\n"
          "Notes:\n"
          "    `ru_indices` and `ue_indices_per_ru` must use matching\n"
          "    dimensionality. Mixing broadcast and per-time-step layouts is\n"
          "    rejected.\n\n"
          "Example:\n"
          "    # Broadcast style: same RU/UE layout replicated for 3 time "
          "steps\n"
          "    # RU 0 serves UEs [0,1,2], RU 1 serves UEs [0,1,2] -- at every "
          "time step\n"
          "    alloc = client.allocate_cirs_memory(\n"
          "        [0, 1],                       # ru_indices (1D = same for "
          "all time steps)\n"
          "        [[0, 1, 2], [0, 1, 2]],       # UEs for RU 0, UEs for RU 1\n"
          "        is_full_antenna_pair=False,\n"
          "        num_time_steps=3,              # replicate this layout for "
          "3 time steps\n"
          "    )\n"
          "\n"
          "    # Per-time-step style: different RU/UE layout at each time "
          "step\n"
          "    # 3 time steps (inferred from the outer list length):\n"
          "    #   t=0: RU 0 serves UEs [0,1,2], RU 1 serves UEs [3,4]\n"
          "    #   t=1: RU 0 serves UEs [0,1]\n"
          "    #   t=2: RU 1 serves UEs [2,3,4]\n"
          "    alloc = client.allocate_cirs_memory(\n"
          "        [[0, 1], [0], [1]],          # ru_indices per time step\n"
          "        [[[0, 1, 2], [3, 4]],         # t=0: UEs for RU 0, UEs for "
          "RU 1\n"
          "         [[0, 1]],                    # t=1: UEs for RU 0\n"
          "         [[2, 3, 4]]],                # t=2: UEs for RU 1\n"
          "        is_full_antenna_pair=True,\n"
          "    )")

      .def(
          "deallocate_cirs_memory",
          [](DigitalTwinClient &self,
             DigitalTwinClient::CIRBatchAllocation &allocation) {
            bool success = self.DeallocateCIRResultsMemory(allocation);
            if (!success) {
              throw std::runtime_error(
                  "Failed to deallocate CIR results memory");
            }
          },
          py::arg("allocation"),
          "deallocate_cirs_memory(allocation: CIRAllocation) -> None\n\n"
          "Release the resources associated with a CIR allocation on both the\n"
          "client and server.\n\n"
          "Args:\n"
          "    allocation (CIRAllocation): The allocation returned by "
          "allocate_cirs_memory\n\n"
          "Raises:\n"
          "    RuntimeError: If the allocation cannot be released on the "
          "client or server.")

      .def(
          "get_cirs",
          [](DigitalTwinClient &self,
             DigitalTwinClient::CIRBatchAllocation &allocation, int batch_index,
             const py::object &temporal_index_obj) {
            MultiTemporalIndex temporal_index =
                py_to_multi_temporal_index(temporal_index_obj);

            // Release GIL during blocking gRPC stream so other Python
            // threads can run (e.g., to call cancel_simulation).
            bool success;
            {
              py::gil_scoped_release release;
              success = self.GetChannelImpulseResponse(allocation, batch_index,
                                                       temporal_index);
            }

            if (!success) {
              throw std::runtime_error(
                  "Failed to get channel impulse response");
            }
          },
          py::arg("allocation"), py::arg("batch_index"),
          py::arg("temporal_index"),
          "get_cirs(allocation: CIRAllocation, batch_index: int, "
          "temporal_index) -> None\n\n"
          "Compute channel impulse responses into an existing allocation.\n\n"
          "This method requires a loaded scenario and an allocation "
          "previously returned by `allocate_cirs_memory()`. While this "
          "blocking "
          "streaming RPC is running, other Python threads in the same process "
          "can still\n"
          "run.\n\n"
          "After a successful call, `allocation.temporal_indices` is updated "
          "so the fetched tensors can be addressed by actual slot or time "
          "step\n"
          "index.\n\n"
          "Args:\n"
          "    allocation (CIRAllocation): The allocation from "
          "allocate_cirs_memory\n"
          "    batch_index (int): Batch index\n"
          "    temporal_index: SlotIndex(n), TimeStepIndex(n), "
          "SlotIndices([...]), or TimeStepIndices([...])\n\n"
          "Raises:\n"
          "    RuntimeError: If `temporal_index` has the wrong type or the "
          "server cannot compute CIR data for the requested batch and temporal "
          "indices.\n\n"
          "Example:\n"
          "    client.get_cirs(alloc, 0, SlotIndices([3, 7]))\n"
          "    print(alloc.temporal_indices)  # [3, 7]")

      // Mode-aware CIR data access: fetches from server on first access
      .def(
          "to_numpy",
          [](DigitalTwinClient &self,
             DigitalTwinClient::CIRBatchAllocation &allocation,
             int temporal_idx, int ru_idx, const std::string &data_type) {
            auto [ts_pos, ru_pos] =
                find_positions(allocation, temporal_idx, ru_idx);

            const dt_service::MatrixShape *shape = nullptr;
            int64_t offset = 0;
            if (data_type == "values") {
              shape = &allocation.values_shapes_per_ts[ts_pos][ru_pos];
              offset = allocation.values_time_step_offsets[ts_pos] +
                       allocation.values_ru_offsets_per_ts[ts_pos][ru_pos];
            } else if (data_type == "delays") {
              shape = &allocation.delays_shapes_per_ts[ts_pos][ru_pos];
              offset = allocation.delays_time_step_offsets[ts_pos] +
                       allocation.delays_ru_offsets_per_ts[ts_pos][ru_pos];
            } else if (data_type == "angles_of_departure") {
              shape =
                  &allocation.angles_of_departure_shapes_per_ts[ts_pos][ru_pos];
              offset =
                  allocation.angles_of_departure_time_step_offsets[ts_pos] +
                  allocation
                      .angles_of_departure_ru_offsets_per_ts[ts_pos][ru_pos];
            } else if (data_type == "angles_of_arrival") {
              shape =
                  &allocation.angles_of_arrival_shapes_per_ts[ts_pos][ru_pos];
              offset = allocation.angles_of_arrival_time_step_offsets[ts_pos] +
                       allocation
                           .angles_of_arrival_ru_offsets_per_ts[ts_pos][ru_pos];
            } else {
              throw std::runtime_error("Unsupported CIR data_type: " +
                                       data_type);
            }

            auto buf = self.FetchBuffer(allocation, data_type, MemoryType::CPU);
            return buffer_to_numpy(buf, offset, *shape);
          },
          py::arg("allocation"), py::arg("temporal_idx"), py::arg("ru_idx"),
          py::arg("data_type") = "values",
          "to_numpy(allocation: CIRAllocation, temporal_idx: int, ru_idx: int, "
          "data_type: str = \"values\") -> numpy.ndarray\n\n"
          "Copy one CIR tensor into a NumPy array for a specific temporal "
          "index and RU.\n\n"
          "Transparently handles all transport modes. On first access for a\n"
          "given buffer type, pulls data from the server via gRPC in REMOTE "
          "mode. Always fetches to CPU since the output is a numpy array.\n\n"
          "Args:\n"
          "    allocation (CIRAllocation): The allocation (must have called "
          "get_cirs first)\n"
          "    temporal_idx (int): Actual slot or timestep index\n"
          "    ru_idx (int): Actual RU index\n"
          "    data_type (str): 'values', 'delays', "
          "'angles_of_departure', or 'angles_of_arrival'\n\n"
          "Raises:\n"
          "    RuntimeError: If the requested temporal index or RU is not "
          "present in the allocation, `data_type` is unsupported, or the "
          "buffer cannot be fetched.\n\n"
          "Returns:\n"
          "    numpy.ndarray: CIR data for that `(temporal, RU)` pair. Angle\n"
          "        outputs use a trailing size-2 axis for `(azimuth, "
          "zenith)`.\n\n"
          "Example:\n"
          "    values = client.to_numpy(alloc, 3, 40)\n"
          "    delays = client.to_numpy(alloc, 3, 40, data_type='delays')\n"
          "    aod = client.to_numpy(alloc, 3, 40, "
          "data_type='angles_of_departure')\n"
          "    aoa = client.to_numpy(alloc, 3, 40, "
          "data_type='angles_of_arrival')")

      // Return all CIR data as nested dict: {slot: {ru: numpy_array}}
      .def(
          "to_numpy_all_cir",
          [](DigitalTwinClient &self,
             DigitalTwinClient::CIRBatchAllocation &allocation) {
            if (allocation.temporal_indices.empty()) {
              throw std::runtime_error(
                  "allocation.temporal_indices is empty. Call get_cirs first.");
            }

            auto values_buf =
                self.FetchBuffer(allocation, "values", MemoryType::CPU);
            auto delays_buf =
                self.FetchBuffer(allocation, "delays", MemoryType::CPU);
            auto aod_buf = self.FetchBuffer(allocation, "angles_of_departure",
                                            MemoryType::CPU);
            auto aoa_buf = self.FetchBuffer(allocation, "angles_of_arrival",
                                            MemoryType::CPU);

            py::dict values_dict, delays_dict, aod_dict, aoa_dict;

            for (size_t ts_pos = 0; ts_pos < allocation.temporal_indices.size();
                 ++ts_pos) {
              int slot_idx = allocation.temporal_indices[ts_pos];
              py::dict slot_values, slot_delays, slot_aod, slot_aoa;

              const auto &ru_indices = allocation.ru_indices_per_ts[ts_pos];
              for (size_t ru_pos = 0; ru_pos < ru_indices.size(); ++ru_pos) {
                int ru_idx = ru_indices[ru_pos];

                int64_t values_offset =
                    allocation.values_time_step_offsets[ts_pos] +
                    allocation.values_ru_offsets_per_ts[ts_pos][ru_pos];
                int64_t delays_offset =
                    allocation.delays_time_step_offsets[ts_pos] +
                    allocation.delays_ru_offsets_per_ts[ts_pos][ru_pos];
                int64_t aod_offset =
                    allocation.angles_of_departure_time_step_offsets[ts_pos] +
                    allocation
                        .angles_of_departure_ru_offsets_per_ts[ts_pos][ru_pos];
                int64_t aoa_offset =
                    allocation.angles_of_arrival_time_step_offsets[ts_pos] +
                    allocation
                        .angles_of_arrival_ru_offsets_per_ts[ts_pos][ru_pos];

                slot_values[py::int_(ru_idx)] = buffer_to_numpy(
                    values_buf, values_offset,
                    allocation.values_shapes_per_ts[ts_pos][ru_pos]);

                slot_delays[py::int_(ru_idx)] = buffer_to_numpy(
                    delays_buf, delays_offset,
                    allocation.delays_shapes_per_ts[ts_pos][ru_pos]);
                slot_aod[py::int_(ru_idx)] = buffer_to_numpy(
                    aod_buf, aod_offset,
                    allocation
                        .angles_of_departure_shapes_per_ts[ts_pos][ru_pos]);
                slot_aoa[py::int_(ru_idx)] = buffer_to_numpy(
                    aoa_buf, aoa_offset,
                    allocation.angles_of_arrival_shapes_per_ts[ts_pos][ru_pos]);
              }

              values_dict[py::int_(slot_idx)] = slot_values;
              delays_dict[py::int_(slot_idx)] = slot_delays;
              aod_dict[py::int_(slot_idx)] = slot_aod;
              aoa_dict[py::int_(slot_idx)] = slot_aoa;
            }

            py::dict result;
            result["values"] = values_dict;
            result["delays"] = delays_dict;
            result["angles_of_departure"] = aod_dict;
            result["angles_of_arrival"] = aoa_dict;
            return result;
          },
          py::arg("allocation"),
          "to_numpy_all_cir(allocation: CIRAllocation) -> dict\n\n"
          "Copy every computed CIR tensor into nested NumPy dictionaries.\n\n"
          "Transparently handles all transport modes. Pulls data from server\n"
          "via gRPC in REMOTE mode.\n"
          "Always fetches to CPU since the output is numpy arrays.\n\n"
          "Args:\n"
          "    allocation (CIRAllocation): The allocation (must have called "
          "get_cirs first)\n\n"
          "Raises:\n"
          "    RuntimeError: If `get_cirs()` has not populated the allocation "
          "yet or the CIR buffers cannot be fetched.\n\n"
          "Returns:\n"
          "    dict: Nested dictionaries keyed by actual temporal index and "
          "RU\n"
          "        index. The top-level keys are `values`, `delays`,\n"
          "        `angles_of_departure`, and `angles_of_arrival`.\n\n"
          "Example:\n"
          "    cir = client.to_numpy_all_cir(alloc)\n"
          "    values = cir['values'][3][40]  # CIR values for slot 3, RU 40\n"
          "    aod = cir['angles_of_departure'][3][40]\n"
          "    aoa = cir['angles_of_arrival'][3][40]")

      .def(
          "export_results",
          [](DigitalTwinClient &self, const std::vector<std::string> &tables,
             const py::object &temporal_index_obj, int batch_index) {
            int files_exported{};
            int64_t total_rows{};
            float elapsed_seconds{};

            std::variant<std::monostate, SlotIndices, TimeStepIndices> filter;
            if (!temporal_index_obj.is_none()) {
              if (py::isinstance<SlotIndices>(temporal_index_obj)) {
                filter = temporal_index_obj.cast<SlotIndices>();
              } else if (py::isinstance<TimeStepIndices>(temporal_index_obj)) {
                filter = temporal_index_obj.cast<TimeStepIndices>();
              } else {
                throw std::runtime_error(
                    "temporal_index must be SlotIndices or TimeStepIndices");
              }
            }

            // Release GIL during blocking gRPC stream so other Python
            // threads can run (e.g., to call cancel_simulation).
            bool success;
            {
              py::gil_scoped_release release;
              success = self.ExportResults(files_exported, total_rows,
                                           elapsed_seconds, tables, filter,
                                           batch_index);
            }
            if (!success) {
              throw std::runtime_error("Failed to export results");
            }
            py::dict result;
            result["files_exported"] = files_exported;
            result["total_rows"] = total_rows;
            result["elapsed_seconds"] = elapsed_seconds;
            return result;
          },
          py::arg("tables") = std::vector<std::string>{},
          py::arg("temporal_index") = py::none(), py::arg("batch_index") = 0,
          "Export result data to Parquet files on S3\n\n"
          "Args:\n"
          "    tables (list[str]): Tables to export (e.g. ['cirs', "
          "'raypaths']).\n"
          "        Empty list uses scenario defaults from opt_in_db_tables.\n"
          "    temporal_index (SlotIndices|TimeStepIndices|None): "
          "Temporal index. None = export all.\n"
          "    batch_index (int): Batch index (only used with temporal "
          "filter, default 0)\n\n"
          "Raises:\n"
          "    RuntimeError: If `temporal_index` has the wrong type or the "
          "server cannot export the requested results.\n\n"
          "Returns:\n"
          "    dict: files_exported, total_rows, elapsed_seconds\n\n"
          "Example:\n"
          "    result = client.export_results()  # export all configured "
          "tables\n"
          "    # and all time steps\n"
          "    result = client.export_results(['cirs', 'raypaths'])\n"
          "    # export only the selected tables\n"
          "    result = client.export_results(temporal_index=SlotIndices([0, "
          "1, 2]))\n"
          "    # export only the selected time steps")

      .def(
          "clear_exported_results",
          [](DigitalTwinClient &self, bool clear_database,
             bool clear_exported_files) {
            std::string message;
            bool success = self.ClearExportedResults(message, clear_database,
                                                     clear_exported_files);
            if (!success) {
              throw std::runtime_error("Failed to clear exported results: " +
                                       message);
            }
            py::dict result;
            result["success"] = true;
            result["message"] = message;
            return result;
          },
          py::arg("clear_database") = true,
          py::arg("clear_exported_files") = true,
          "Clear result data from ClickHouse and/or S3\n\n"
          "Args:\n"
          "    clear_database (bool): Clear result tables in ClickHouse "
          "(default True)\n"
          "    clear_exported_files (bool): Delete Parquet files from S3 "
          "(default True)\n\n"
          "Raises:\n"
          "    RuntimeError: If the server cannot clear the requested result "
          "data.\n\n"
          "Returns:\n"
          "    dict: Dictionary containing a success flag and a "
          "human-readable\n"
          "        status message from the server.\n\n"
          "Example:\n"
          "    client.clear_exported_results()  # clear both DB and S3\n"
          "    client.clear_exported_results(clear_database=False)  # S3 only")

      .def(
          "prepare_map",
          [](DigitalTwinClient &self, const py::object &task_obj,
             const py::object &s3_obj) {
            // Extract S3 config from Python object
            S3Config s3;
            s3.bucket = s3_obj.attr("bucket").cast<std::string>();
            s3.endpoint_url = s3_obj.attr("endpoint_url").cast<std::string>();
            s3.region = s3_obj.attr("region").cast<std::string>();
            s3.access_key = s3_obj.attr("access_key").cast<std::string>();
            s3.secret_key = s3_obj.attr("secret_key").cast<std::string>();
            s3.provider = s3_obj.attr("provider").cast<std::string>();

            MapTask task;
            if (py::isinstance<OSMTask>(task_obj)) {
              task = task_obj.cast<OSMTask>();
            } else if (py::isinstance<GMLTask>(task_obj)) {
              task = task_obj.cast<GMLTask>();
            } else {
              throw std::runtime_error(
                  "task must be an OSMTask or GMLTask object");
            }

            PrepareMapResult result;
            {
              py::gil_scoped_release release;
              result = self.PrepareMap(task, s3);
            }

            py::dict ret;
            ret["success"] = result.success;
            ret["s3_url"] = result.s3_url;
            ret["message"] = result.message;
            ret["request_id"] = result.request_id;
            return ret;
          },
          py::arg("task"), py::arg("s3_config"),
          "Prepare a GIS map from OSM or GML data\n\n"
          "Does not require a loaded scenario. The server proxies this\n"
          "request to a Temporal workflow internally.\n\n"
          "Args:\n"
          "    task (OSMTask|GMLTask): Task configuration\n"
          "    s3_config (S3Config): S3 connection credentials\n\n"
          "Raises:\n"
          "    RuntimeError: If `task` is not an `OSMTask` or `GMLTask` "
          "instance.\n\n"
          "Returns:\n"
          "    dict: success, s3_url, message, request_id\n\n"
          "Example:\n"
          "    from _config import S3Config\n"
          "    from dt_client import OSMTask\n"
          "    s3 = S3Config(bucket='warehouse', provider='minio', "
          "endpoint_url='http://...')\n"
          "    task = OSMTask(output_folder_key='test', "
          "coords=(-122.34, 47.60, -122.33, 47.61), "
          "include_elevation=True)\n"
          "    result = client.prepare_map(task, s3)")

      .def(
          "start_server_log_streaming",
          &DigitalTwinClient::StartServerLogStreaming,
          py::arg("log_file_path") = "dt_server.log",
          py::arg("min_level") = "INFO",
          "Start streaming server logs to a local file on a background "
          "thread\n\n"
          "Non-blocking: returns immediately. Server log lines are written\n"
          "to the specified file as they arrive.\n\n"
          "Args:\n"
          "    log_file_path (str): Local file path (default 'dt_server.log')\n"
          "    min_level (str): Minimum level filter: 'DEBUG', 'INFO', "
          "'WARNING', 'ERROR' (default 'INFO')\n\n"
          "Returns:\n"
          "    bool: True if streaming thread started successfully\n\n"
          "Example:\n"
          "    client.start_server_log_streaming('server.log', 'DEBUG')")

      .def("stop_server_log_streaming",
           &DigitalTwinClient::StopServerLogStreaming,
           "Stop the server log streaming background thread\n\n"
           "Cancels the gRPC stream and waits for the thread to finish.\n"
           "Safe to call even if streaming was never started.");
}
