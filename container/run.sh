#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Run a command inside the CI container with the repo mounted.
# Usage: ./container/run.sh <command> [args...]
# Examples:
#   ./container/run.sh bash -ex client/tests/mr_tests.sh
#   ./container/run.sh cmake --build client/build
#   ./container/run.sh python3 client/external/clang-format-tools/scripts/check_format.py . main

IMAGE="aodt-client-devel:latest"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_ID="${CI_JOB_ID:-${USER}}"

AODT_HOST_IP="${AODT_HOST_IP:-$(hostname -I | awk '{print $1}')}"

# Pass GPU access when available
if nvidia-smi &>/dev/null 2>&1; then
    GPU_FLAGS="--gpus all"
else
    GPU_FLAGS=""
fi

if [ $# -eq 0 ]; then
    exec docker run --rm -it \
        --name "c_aodt_client_${CONTAINER_ID}" \
        --user "$(id -u):$(id -g)" \
        --hostname devel \
        --network host \
        -e "AODT_HOST_IP=${AODT_HOST_IP}" \
        -v "${REPO_ROOT}:${REPO_ROOT}" \
        -w "${REPO_ROOT}" \
        ${GPU_FLAGS} \
        "${IMAGE}" \
        bash
else
    exec docker run --rm \
        --name "c_aodt_client_${CONTAINER_ID}" \
        --user "$(id -u):$(id -g)" \
        --hostname devel \
        --network host \
        -e "AODT_HOST_IP=${AODT_HOST_IP}" \
        -v "${REPO_ROOT}:${REPO_ROOT}" \
        -w "${REPO_ROOT}" \
        ${GPU_FLAGS} \
        "${IMAGE}" \
        "$@"
fi
