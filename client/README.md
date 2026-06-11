# NVIDIA Aerial Digital Twin Client

C++ and Python client libraries for configuring and running AODT simulations over gRPC. They support remote data transfer over gRPC and optional CUDA IPC for local GPU transfers.

## Platform Support

| Platform            | CUDA | gRPC | Transport mode                   |
| ------------------- | ---- | ---- | -------------------------------- |
| Linux with GPU      | yes  | yes  | LOCAL_IPC (co-located) or REMOTE |
| WSL2 with GPU       | yes  | yes  | LOCAL_IPC (co-located) or REMOTE |
| Linux / WSL2 no GPU | no   | yes  | REMOTE (CPU only)                |
| macOS               | no   | yes  | REMOTE (CPU only)                |
| Windows (MSVC)      | no   | yes  | REMOTE (CPU only)                |

CUDA is detected automatically at configure time. The build adapts to what's available.

**In-memory data transfer** (`fetch_buffer`, `to_numpy`, `to_numpy_all_cir`) is available through gRPC in `REMOTE` mode. When the client and worker are co-located on the same GPU, `LOCAL_IPC` can use CUDA IPC for zero-copy local GPU access.

**Running the examples requires a worker.** The client connects to a Digital Twin server managed by the worker stack. See [`worker/README.md`](../worker/README.md) for setup instructions.

## Quickstart via Container

If you have Docker, this is the easiest path on Linux systems. The CI image ships with all build and runtime prerequisites pre-installed — no manual dependency setup required.

```bash
# From the repository root — open an interactive shell inside the container
./container/run.sh

# Or run a single command directly, e.g. build the client
./container/run.sh cmake -B client/build -DCMAKE_BUILD_TYPE=Release client/
./container/run.sh cmake --build client/build -j$(nproc)
```

See [container/README.md](../container/README.md) for full details including how to rebuild the image.

If you prefer to install directly on your system instead of using the container, for easier integration into your own application, follow the instructions below.

## Linux

### Prerequisites

From the `client/` directory:

```bash
sudo apt-get update
sudo apt-get install -y cmake protobuf-compiler-grpc libgrpc++-dev pkg-config python3-dev python3-venv
python3 -m venv .venv
source .venv/bin/activate
pip install pybind11 pyyaml omegaconf pytest numpy
```

Docker and the NVIDIA Container Toolkit are required to run the worker. See [worker/README.md](../worker/README.md) for installation instructions.

CUDA Toolkit is optional. If present, it enables CUDA IPC for local GPU transfers.

To enable CUDA for co-located `LOCAL_IPC` transport mode:

```bash
# Install NVIDIA driver (skip if already installed — check with `nvidia-smi`)
# Use `apt-cache search nvidia-driver` to list available versions.
# Install using the driver series number (e.g. nvidia-driver-525, nvidia-driver-535, nvidia-driver-545).
# Do NOT supply a patch-level version number like 590.48.01 — use only the series number.
# The driver version must be compatible with your CUDA Toolkit — CUDA 12.x requires driver 525+.
sudo apt-get install -y nvidia-driver-<driver-series>
sudo reboot
```

```bash
# Install CUDA Toolkit (example for Ubuntu 22.04)
# See https://developer.nvidia.com/cuda-downloads for the latest version and installer options.
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt-get update
sudo apt-get install -y cuda-toolkit
```

Verify the install with `nvidia-smi` (driver) and `nvcc --version` (toolkit). See the [CUDA compatibility guide](https://docs.nvidia.com/deploy/cuda-compatibility/) for driver/toolkit version requirements.

### Build

From the `client/` directory:

```bash
source .venv/bin/activate
cmake -B build -DCMAKE_BUILD_TYPE=Release -DPython3_EXECUTABLE=$(which python3) .
cmake --build build -j$(nproc)
```

The configure step prints a summary of detected features:

```
=== Digital Twin Client Build Configuration ===
  CUDA:       YES
  Compiler:   GNU
  Platform:   Linux
===============================================
```

### Install

From the `client/` directory:

```bash
sudo cmake --install build
```

Then `import dt_client` and `import _config` work from anywhere without `PYTHONPATH`.

### Example

All commands below assume you are in the `client/` directory.

Python:

```bash
source .venv/bin/activate
python3 examples/example_client.py
```

For development without installing:

```bash
source .venv/bin/activate
export PYTHONPATH=build/:build/config/
python3 examples/example_client.py
```

C++:

```bash
./build/dt_client_example --server localhost:50051
```

## WSL2

### Prerequisites

From the `client/` directory inside WSL2:

```bash
sudo apt-get update
sudo apt-get install -y cmake protobuf-compiler-grpc libgrpc++-dev pkg-config python3-dev python3-venv
python3 -m venv .venv
source .venv/bin/activate
pip install pybind11 pyyaml omegaconf pytest numpy
```

No WSL2-specific transport setup is required beyond normal network reachability to the server address used by the client.

### Build

From the `client/` directory inside WSL2:

```bash
source .venv/bin/activate
cmake -B build -DCMAKE_BUILD_TYPE=Release -DPython3_EXECUTABLE=$(which python3) .
cmake --build build -j$(nproc)
```

### Example

All commands below assume you are in the `client/` directory.

```bash
source .venv/bin/activate
export PYTHONPATH=build/:build/config/
python3 examples/example_client.py
```

## macOS

### Prerequisites

```bash
brew install grpc protobuf cmake pkg-config
python3 -m venv .venv
source .venv/bin/activate
pip3 install pybind11 pyyaml omegaconf pytest numpy
```

### Build

From the `client/` directory:

```bash
source .venv/bin/activate
cmake -B build -DCMAKE_BUILD_TYPE=Release -DPython3_EXECUTABLE=$(which python3) .
cmake --build build -j$(nproc)
```

### Example

All commands below assume you are in the `client/` directory.

```bash
source .venv/bin/activate
export PYTHONPATH=build/:build/config/
python3 examples/example_client.py
```

macOS uses gRPC for both request/control APIs and remote memory transfer. CUDA IPC and `LOCAL_IPC` mode are not supported.

## Windows (MSVC)

### Prerequisites

- **Visual Studio 2022** with the "Desktop development with C++" workload, or **Visual C++ Build Tools** from https://visualstudio.microsoft.com/visual-cpp-build-tools/ (select "C++ build tools")
- **CMake** from https://cmake.org/download/ (check "Add CMake to system PATH" during install)
- **Git** from https://git-scm.com/download/win

Install vcpkg and C++ dependencies:

```
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
```

Bootstrap (run one depending on your terminal):

```
.\bootstrap-vcpkg.bat          # PowerShell / Command Prompt
./bootstrap-vcpkg.sh           # Git Bash / WSL
```

Install dependencies (includes Python 3 and pybind11):

```
.\vcpkg install grpc protobuf yaml-cpp pybind11
```

Set up Python. vcpkg installs its own Python — the built Python modules are only compatible with this Python, not a separately installed one. Enable pip and install Python packages:

```
<vcpkg-root>\installed\x64-windows\tools\python3\python.exe -m ensurepip --upgrade
<vcpkg-root>\installed\x64-windows\tools\python3\python.exe -m pip install pyyaml omegaconf pytest numpy
```

Add vcpkg's Python to PATH for convenience:

```
$env:PATH = "<vcpkg-root>\installed\x64-windows\tools\python3;<vcpkg-root>\installed\x64-windows\tools\python3\Scripts;$env:PATH"
```

### Build

From the `client/` directory:

```
cmake -B build -DCMAKE_TOOLCHAIN_FILE=<vcpkg-root>\scripts\buildsystems\vcpkg.cmake -DCMAKE_PREFIX_PATH=<vcpkg-root>\installed\x64-windows .
cmake --build build --config Release
```

### Example

```
$env:PATH = "..\vcpkg\installed\x64-windows\tools\python3;$env:PATH"; $env:PYTHONPATH = "build\Release;build\config\Release"; python examples\example_client.py
```

Windows uses gRPC for both request/control APIs and remote memory transfer. CUDA IPC and `LOCAL_IPC` mode are not supported.

## Config Builder Documentation

The `config/` module includes Sphinx documentation covering the configuration
builder API, quickstart guide, and advanced features. The RST sources live in
`config/docs/` and are synced into the unified docs site at `docs/config/`.

Build the full documentation site from the repository root:

```bash
sphinx-build docs docs/_build/html
```

Then open `docs/_build/html/config/index.html` in a browser.

## Code Formatting

Format all C++ source files:

```bash
cmake --build build --target client_format_all_source_files
```

This uses the `.clang-format` configuration at the repository root.

## Tests

Run local tests (no server required):

```bash
bash tests/mr_tests.sh
```

Or using the CI container to match the exact CI environment (run from the repo root):

```bash
./container/run.sh bash -ex client/tests/mr_tests.sh
```

This builds all targets and runs config unit tests and Python import smoke tests.

To check C++ formatting locally against `main` (run from the repo root):

```bash
./container/run.sh python3 client/external/clang-format-tools/scripts/check_format.py . main
```

Returns `0` if all changed files are correctly formatted.

## Container

See [container/README.md](../container/README.md) for building and running the development container.