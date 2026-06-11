#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# MR Tests - Local tests that run without a server
# Validates: build, config unit tests, Python import smoke tests
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${CLIENT_DIR}/build"

echo "=== MR Tests ==="
echo "Client dir: ${CLIENT_DIR}"
echo "Build dir:  ${BUILD_DIR}"
echo ""

# ---- Step 1: Build all targets (including _config) ----
echo "--- Step 1: Build all targets ---"
cmake -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release "${CLIENT_DIR}"
cmake --build "${BUILD_DIR}" -j$(nproc)
echo "Build: PASSED"
echo ""

# ---- Step 2: Python import smoke tests ----
echo "--- Step 2: Python import smoke tests ---"
PYTHONPATH="${BUILD_DIR}:${BUILD_DIR}/config" python3 -c "import dt_client; print('  dt_client import: OK')"
PYTHONPATH="${BUILD_DIR}:${BUILD_DIR}/config" python3 -c "import _config; print('  _config import: OK')"
echo "Python imports: PASSED"
echo ""

# ---- Step 3: Python config tests ----
echo "--- Step 3: Python config tests ---"
if python3 -c "import pytest" 2>/dev/null; then
    PYTHONPATH="${BUILD_DIR}:${BUILD_DIR}/config" python3 -m pytest "${CLIENT_DIR}/config/test_aodt_config.py" -v --import-mode=importlib
    echo "Python config tests: PASSED"
else
    echo "  pytest not installed, skipping Python config tests"
    echo "  Install with: pip3 install pytest"
fi
echo ""

# ---- Step 4: Python standalone client tests ----
echo "--- Step 4: Python standalone client tests ---"
if python3 -c "import pytest" 2>/dev/null; then
    PYTHONPATH="${BUILD_DIR}:${BUILD_DIR}/config:${CLIENT_DIR}/examples" \
        python3 -m pytest "${CLIENT_DIR}/tests/test_client_standalone.py" -v --import-mode=importlib
    echo "Python standalone client tests: PASSED"
else
    echo "  pytest not installed, skipping Python standalone client tests"
    echo "  Install with: pip3 install pytest"
fi
echo ""

# ---- Step 4b: PrepareMap client API tests ----
echo "--- Step 4b: PrepareMap client API tests ---"
if python3 -c "import pytest" 2>/dev/null; then
    PYTHONPATH="${BUILD_DIR}:${BUILD_DIR}/config" \
        python3 -m pytest "${CLIENT_DIR}/tests/test_prepare_map_api.py" -v --import-mode=importlib
    echo "PrepareMap client API tests: PASSED"
else
    echo "  pytest not installed, skipping PrepareMap client API tests"
    echo "  Install with: pip3 install pytest"
fi
echo ""

# ---- Step 5: C++ standalone client smoke test ----
echo "--- Step 5: C++ standalone client smoke test ---"
timeout 20s "${BUILD_DIR}/dt_client_standalone_smoke"
echo "C++ standalone client smoke test: PASSED"
echo ""

echo "=== All MR Tests PASSED ==="
