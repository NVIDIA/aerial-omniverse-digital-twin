cmake_minimum_required(VERSION 3.20)
project(dt_client LANGUAGES CXX)

include(ExternalProject)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---- Find dependencies (gRPC, protobuf) ----
# On MSVC/Windows use find_package (vcpkg), on Unix use pkg-config

if(MSVC)
    find_package(gRPC CONFIG REQUIRED)
    find_package(Protobuf CONFIG REQUIRED)
    set(GRPC_LIBRARIES gRPC::grpc++)
    set(PROTOBUF_LIBRARIES protobuf::libprotobuf)
else()
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(GRPC REQUIRED IMPORTED_TARGET grpc++)
    pkg_check_modules(PROTOBUF REQUIRED IMPORTED_TARGET protobuf)
    set(GRPC_LIBRARIES PkgConfig::GRPC)
    set(PROTOBUF_LIBRARIES PkgConfig::PROTOBUF)
endif()

find_program(_PROTOBUF_PROTOC protoc REQUIRED
    HINTS "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/protobuf"
          "${CMAKE_PREFIX_PATH}/tools/protobuf")
find_program(_GRPC_CPP_PLUGIN_EXECUTABLE grpc_cpp_plugin REQUIRED
    HINTS "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/grpc"
          "${CMAKE_PREFIX_PATH}/tools/grpc")

# ---- Optional: CUDA toolkit ----
find_package(CUDAToolkit QUIET)
if(CUDAToolkit_FOUND)
    message(STATUS "CUDA Toolkit found: ${CUDAToolkit_VERSION}")
else()
    message(STATUS "CUDA Toolkit not found — building without GPU support (REMOTE/CPU mode only)")
endif()

# ---- Optional: UCX ----
set(UCX_FOUND FALSE)
if(NOT MSVC)
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND)
        pkg_check_modules(UCX QUIET IMPORTED_TARGET ucx)
    endif()
endif()
if(UCX_FOUND)
    message(STATUS "UCX found — optional REMOTE UCX backend enabled")
else()
    message(STATUS "UCX not found — REMOTE uses gRPC backend")
endif()

# ---- yaml-cpp (ExternalProject, static build) ----

if(MSVC)
    set(_YAMLCPP_LIB_NAME "Release/yaml-cpp.lib")
    set(_YAMLCPP_BUILD_TYPE Release)
else()
    set(_YAMLCPP_LIB_NAME "libyaml-cpp.a")
    set(_YAMLCPP_BUILD_TYPE ${CMAKE_BUILD_TYPE})
endif()

ExternalProject_Add(
    yaml-cpp-client-build
    GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
    GIT_TAG        yaml-cpp-0.9.0
    GIT_SHALLOW    TRUE
    CMAKE_CACHE_ARGS
        -DCMAKE_CXX_COMPILER:FILEPATH=${CMAKE_CXX_COMPILER}
        -DCMAKE_BUILD_TYPE:STRING=${_YAMLCPP_BUILD_TYPE}
        -DCMAKE_POSITION_INDEPENDENT_CODE:BOOL=ON
        -DCMAKE_CXX_STANDARD:STRING=${CMAKE_CXX_STANDARD}
        -DCMAKE_CXX_STANDARD_REQUIRED:BOOL=ON
        -DCMAKE_CXX_EXTENSIONS:BOOL=OFF
        -DYAML_CPP_BUILD_TESTS:BOOL=OFF
        -DYAML_CPP_BUILD_TOOLS:BOOL=OFF
        -DBUILD_SHARED_LIBS:BOOL=OFF
    BUILD_COMMAND cmake --build <BINARY_DIR> --config ${_YAMLCPP_BUILD_TYPE}
    BUILD_BYPRODUCTS <BINARY_DIR>/${_YAMLCPP_LIB_NAME}
    INSTALL_COMMAND ""
)

ExternalProject_Get_Property(yaml-cpp-client-build source_dir binary_dir)
set(YAML_CPP_CLIENT_INCLUDE_DIR ${source_dir}/include)
set(YAML_CPP_CLIENT_LIBRARY ${binary_dir}/${_YAMLCPP_LIB_NAME})

add_library(yaml-cpp-client INTERFACE)
target_include_directories(yaml-cpp-client SYSTEM INTERFACE ${YAML_CPP_CLIENT_INCLUDE_DIR})
target_compile_definitions(yaml-cpp-client INTERFACE YAML_CPP_STATIC_DEFINE)
add_dependencies(yaml-cpp-client yaml-cpp-client-build)

# ---- Protobuf / gRPC code generation ----

set(PROTO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/protos")
set(PROTO "${PROTO_DIR}/service.proto")
set(GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}")
set(PROTO_SRCS "${GEN_DIR}/service.pb.cc")
set(PROTO_HDRS "${GEN_DIR}/service.pb.h")
set(GRPC_SRCS  "${GEN_DIR}/service.grpc.pb.cc")
set(GRPC_HDRS "${GEN_DIR}/service.grpc.pb.h")

add_custom_command(
    OUTPUT "${PROTO_SRCS}" "${PROTO_HDRS}" "${GRPC_SRCS}" "${GRPC_HDRS}"
    COMMAND ${_PROTOBUF_PROTOC}
    ARGS --experimental_allow_proto3_optional
         --grpc_out "${CMAKE_CURRENT_BINARY_DIR}"
         --cpp_out "${CMAKE_CURRENT_BINARY_DIR}"
         -I "${PROTO_DIR}"
         --plugin=protoc-gen-grpc=${_GRPC_CPP_PLUGIN_EXECUTABLE}
         "${PROTO}"
    DEPENDS "${PROTO}"
    COMMENT "Generating protobuf and gRPC C++ files"
)


# ---- Digital Twin Client static library ----

set(DT_CLIENT_SOURCES src/client.cpp ${PROTO_SRCS} ${GRPC_SRCS})
if(UCX_FOUND)
    list(APPEND DT_CLIENT_SOURCES src/ucx_transport.cpp)
endif()

add_library(dt_client_lib STATIC ${DT_CLIENT_SOURCES})

set_target_properties(dt_client_lib PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_include_directories(dt_client_lib PUBLIC
    "${GEN_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
)

if(CUDAToolkit_FOUND)
    target_compile_definitions(dt_client_lib PUBLIC HAVE_CUDA)
    target_include_directories(dt_client_lib PUBLIC ${CUDAToolkit_INCLUDE_DIRS})
    target_link_libraries(dt_client_lib PRIVATE CUDA::cudart)
endif()

if(UCX_FOUND)
    target_compile_definitions(dt_client_lib PUBLIC HAVE_UCX)
    target_link_libraries(dt_client_lib PRIVATE PkgConfig::UCX)
endif()

target_link_libraries(dt_client_lib PUBLIC ${GRPC_LIBRARIES} ${PROTOBUF_LIBRARIES})

find_package(Threads REQUIRED)
target_link_libraries(dt_client_lib PRIVATE Threads::Threads)

if(WIN32)
    target_link_libraries(dt_client_lib PRIVATE ws2_32)
endif()

# ---- Example executables ----

add_executable(dt_client_example examples/example.cpp)
target_link_libraries(dt_client_example PRIVATE dt_client_lib)

add_executable(dt_client_standalone_smoke tests/client_standalone_smoke.cpp)
target_link_libraries(dt_client_standalone_smoke PRIVATE dt_client_lib)

if(CUDAToolkit_FOUND)
    add_executable(dt_client_example_cir examples/example_cir.cpp)
    target_include_directories(dt_client_example_cir PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/config")
    target_link_libraries(dt_client_example_cir PRIVATE dt_client_lib yaml-cpp-client ${YAML_CPP_CLIENT_LIBRARY})

    add_executable(dt_client_example_multi_timesteps examples/example_multi_timesteps.cpp)
    target_include_directories(dt_client_example_multi_timesteps PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/config")
    target_link_libraries(dt_client_example_multi_timesteps PRIVATE dt_client_lib yaml-cpp-client ${YAML_CPP_CLIENT_LIBRARY})
else()
    message(STATUS "GPU examples (example_cir, example_multi_timesteps) skipped — require CUDA")
endif()

# ---- Python bindings (pybind11) ----

find_package(Python3 COMPONENTS Interpreter Development REQUIRED)

find_package(pybind11 CONFIG QUIET)

if(NOT pybind11_FOUND)
    message(STATUS "pybind11 not found via CMake, trying Python...")
    execute_process(
        COMMAND "${Python3_EXECUTABLE}" -c "import pybind11; print(pybind11.get_cmake_dir())"
        OUTPUT_VARIABLE PYBIND11_CMAKE_DIR
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )

    if(PYBIND11_CMAKE_DIR)
        message(STATUS "Found pybind11 via Python: ${PYBIND11_CMAKE_DIR}")
        set(pybind11_DIR "${PYBIND11_CMAKE_DIR}")
        find_package(pybind11 CONFIG REQUIRED)
    else()
        message(FATAL_ERROR "pybind11 not found. Install with: pip3 install pybind11")
    endif()
endif()

pybind11_add_module(dt_client MODULE src/client_bindings.cpp)

target_link_libraries(dt_client PRIVATE dt_client_lib)

message(STATUS "Digital Twin Client Python bindings enabled")

# ---- Config module (_config) ----

add_subdirectory(config)

# ---- Python install ----
if(DEFINED SKBUILD_PLATLIB_DIR)
    set(PYTHON_INSTALL_DIR "${SKBUILD_PLATLIB_DIR}")
elseif(NOT PYTHON_INSTALL_DIR)
    execute_process(
        COMMAND "${Python3_EXECUTABLE}" -c "import sysconfig; print(sysconfig.get_path('purelib'))"
        OUTPUT_VARIABLE PYTHON_INSTALL_DIR
        OUTPUT_STRIP_TRAILING_WHITESPACE
    )
endif()

install(TARGETS dt_client LIBRARY DESTINATION "${PYTHON_INSTALL_DIR}/dt_client")
install(TARGETS _config   LIBRARY DESTINATION "${PYTHON_INSTALL_DIR}/_config")
install(FILES src/__init__.py    DESTINATION "${PYTHON_INSTALL_DIR}/dt_client")
install(FILES config/__init__.py DESTINATION "${PYTHON_INSTALL_DIR}/_config")

message(STATUS "Python install path: ${PYTHON_INSTALL_DIR}")

# ---- Clang-format target ----

find_program(_CLANG_FORMAT clang-format)
if(_CLANG_FORMAT AND EXISTS "${PROJECT_SOURCE_DIR}/external/clang-format-tools/cmake/clang-format-util.cmake")
    include("${PROJECT_SOURCE_DIR}/external/clang-format-tools/cmake/clang-format-util.cmake")
    add_clang_format_target(TARGET_PREFIX client
                            DIRS          src examples config tests)
    message(STATUS "clang-format target enabled: client_format_all_source_files")
else()
    message(STATUS "clang-format not found or clang-format-tools missing, formatting target disabled")
endif()

# ---- Configuration summary ----

message(STATUS "")
message(STATUS "=== Digital Twin Client Build Configuration ===")
if(CUDAToolkit_FOUND)
    message(STATUS "  CUDA:       YES")
else()
    message(STATUS "  CUDA:       NO")
endif()
if(UCX_FOUND)
    message(STATUS "  UCX:        YES")
else()
    message(STATUS "  UCX:        NO")
endif()
message(STATUS "  Compiler:   ${CMAKE_CXX_COMPILER_ID}")
message(STATUS "  Platform:   ${CMAKE_SYSTEM_NAME}")
message(STATUS "===============================================")
message(STATUS "")
