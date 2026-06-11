# NVIDIA Aerial Omniverse Digital Twin (AODT)

## Overview

NVIDIA Aerial™ Omniverse Digital Twin (AODT) is a collection of frameworks and software tools for next-generation digital twins, enabling cutting-edge research and development of 5G and 6G wireless systems.

AODT enables physically accurate simulations of complete 5G and 6G systems, from a single tower to city scale. It incorporates software-defined radio access network (RAN) and user-equipment simulators, along with realistic terrain and object properties. Researchers can use AODT to simulate and build base-station algorithms from site-specific data and train models in real time to improve transmission efficiency.

This repository provides the simulation client, Digital Twin worker, 3D viewer, and Docker-based development environment used to configure, run, and visualize AODT simulations.

## Client

The client provides C++ and Python libraries for configuring and running AODT simulations over gRPC, with support for Linux, macOS, and Windows client workflows. Examples, build instructions, dependencies, usage, code formatting, and tests are documented in [`client/README.md`](client/README.md).

## Worker

The worker runs the AODT Digital Twin simulation service using Docker Compose. Setup instructions and runtime requirements are documented in [`worker/README.md`](worker/README.md).

## Container

A Docker-based development environment with client build/test prerequisites pre-installed, primarily supported on Linux hosts. See [`container/README.md`](container/README.md).

## Viewer

The viewer visualizes AODT simulations in a 3D geospatial interface. Setup, usage, and development instructions are documented in [`viewer/README.md`](viewer/README.md).

## Resources

Updates on new software releases, NVIDIA 6G events, and technical training for AI Aerial™ are available via the [NVIDIA 6G Developer Program](https://developer.nvidia.com/6g-program).

The Aerial Omniverse Digital Twin collection is available on [NVIDIA NGC](https://catalog.ngc.nvidia.com/orgs/nvidia/teams/aerial/collections/aerial-omniverse-digital-twin).

Full documentation is available at [NVIDIA Docs Hub](https://docs.nvidia.com/aerial/).
