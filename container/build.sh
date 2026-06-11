#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -e

IMAGE="${1:-aodt-client-devel:latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Building CI container image: ${IMAGE}"
docker build -t "${IMAGE}" -f "${SCRIPT_DIR}/Dockerfile" "${REPO_ROOT}"
echo "Done. Image: ${IMAGE}"
