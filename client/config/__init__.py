# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""AODT YAML config module - High-level domain API for simulation configuration."""

try:
    from ._config import *  # noqa: F403, F401
except ImportError:
    from _config import *  # noqa: F403, F401
