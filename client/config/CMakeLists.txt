cmake_minimum_required(VERSION 3.20)
project(_config_standalone LANGUAGES CXX) # this is a standalone build of the config module for the dt client

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(ExternalProject)

# Find Python and pybind11
find_package(Python3 REQUIRED COMPONENTS Interpreter Development)

# Try to find pybind11 - if not found via CMake, use Python to locate it
find_package(pybind11 CONFIG QUIET)
if(NOT pybind11_FOUND)
    message(STATUS "pybind11 not found via CMake, trying Python...")
    execute_process(
        COMMAND ${Python3_EXECUTABLE} -m pybind11 --cmakedir
        OUTPUT_VARIABLE pybind11_DIR
        OUTPUT_STRIP_TRAILING_WHITESPACE
        RESULT_VARIABLE pybind11_RESULT
    )
    if(pybind11_RESULT EQUAL 0)
        message(STATUS "Found pybind11 via Python at: ${pybind11_DIR}")
        set(pybind11_DIR "${pybind11_DIR}" CACHE PATH "Path to pybind11 CMake files")
        find_package(pybind11 REQUIRED)
    else()
        message(FATAL_ERROR "pybind11 not found. Install with: pip3 install pybind11")
    endif()
endif()

if(MSVC)
    set(_YAMLCPP_CONFIG_LIB "Release/yaml-cpp.lib")
    set(_YAMLCPP_CONFIG_BUILD_TYPE Release)
else()
    set(_YAMLCPP_CONFIG_LIB "libyaml-cpp.a")
    set(_YAMLCPP_CONFIG_BUILD_TYPE ${CMAKE_BUILD_TYPE})
endif()
ExternalProject_Add(
    yaml-cpp-config-build
    GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
    GIT_TAG        yaml-cpp-0.9.0
    GIT_SHALLOW    TRUE
    CMAKE_CACHE_ARGS
        -DCMAKE_CXX_COMPILER:FILEPATH=${CMAKE_CXX_COMPILER}
        -DCMAKE_BUILD_TYPE:STRING=${_YAMLCPP_CONFIG_BUILD_TYPE}
        -DCMAKE_POSITION_INDEPENDENT_CODE:BOOL=ON
        -DCMAKE_CXX_STANDARD:STRING=${CMAKE_CXX_STANDARD}
        -DCMAKE_CXX_STANDARD_REQUIRED:BOOL=ON
        -DCMAKE_CXX_EXTENSIONS:BOOL=OFF
        -DYAML_CPP_BUILD_TESTS:BOOL=OFF
        -DYAML_CPP_BUILD_TOOLS:BOOL=OFF
        -DBUILD_SHARED_LIBS:BOOL=OFF
    BUILD_COMMAND cmake --build <BINARY_DIR> --config ${_YAMLCPP_CONFIG_BUILD_TYPE}
    BUILD_BYPRODUCTS <BINARY_DIR>/${_YAMLCPP_CONFIG_LIB}
    INSTALL_COMMAND ""
)

ExternalProject_Get_Property(yaml-cpp-config-build source_dir binary_dir)
set(YAML_CPP_CONFIG_INCLUDE_DIR ${source_dir}/include)
set(YAML_CPP_CONFIG_LIBRARY ${binary_dir}/${_YAMLCPP_CONFIG_LIB})

# Create an INTERFACE library to represent our private yaml-cpp
add_library(yaml-cpp-config INTERFACE)
target_include_directories(yaml-cpp-config SYSTEM INTERFACE ${YAML_CPP_CONFIG_INCLUDE_DIR})
target_link_libraries(yaml-cpp-config INTERFACE ${YAML_CPP_CONFIG_LIBRARY})
add_dependencies(yaml-cpp-config yaml-cpp-config-build)

# Build the _config Python module
pybind11_add_module(_config aodt_config_bindings.cpp)
target_compile_features(_config PRIVATE cxx_std_20)

# Required when using yaml-cpp as a static lib on Windows (avoids __declspec(dllimport) linker errors)
target_compile_definitions(_config PRIVATE YAML_CPP_STATIC_DEFINE)

# Our yaml-cpp include must come first so we use the static-build headers, not vcpkg's (which may be DLL)
target_include_directories(_config PRIVATE ${YAML_CPP_CONFIG_INCLUDE_DIR} ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(_config PRIVATE yaml-cpp-config)
add_dependencies(_config yaml-cpp-config)

message(STATUS "Config module will be built at: ${CMAKE_CURRENT_BINARY_DIR}/_config*.so")

