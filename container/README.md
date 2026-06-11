# Development Container

A pre-built Docker image that contains all build and test dependencies for the
Digital Twin client. It is the fastest way to get a working environment on any
platform that runs Docker.

## What is included

- CMake, gRPC, protobuf, UCX, clang-format
- Python 3 with pybind11, omegaconf, pytest, numpy
- The `dt_client` Python package pre-built and installed
- `fixuid` so the container user matches your host UID/GID (avoids permission issues on bind-mounted files)

## Using the container

`container/run.sh` runs any command inside the CI image with the repository
mounted at its host path. Run it from the **repository root**.

```bash
# Open an interactive shell
./container/run.sh

# Build the client
./container/run.sh cmake -B client/build -DCMAKE_BUILD_TYPE=Release client/
./container/run.sh cmake --build client/build -j$(nproc)

# Run local tests
./container/run.sh bash -ex client/tests/mr_tests.sh

# Check C++ formatting
./container/run.sh python3 client/external/clang-format-tools/scripts/check_format.py . main
```

## Building the image

If you are building from source, run `build.sh` first to create the image locally.
To rebuild it (e.g. after changing the `Dockerfile`):

```bash
./container/build.sh
```

This tags the image as `aodt-client-devel:latest`.
Pass a custom tag as the first argument to override:

```bash
./container/build.sh my-custom-tag
```
