#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Run fixuid only when running as a non-root user (local dev with --user flag).
# In CI the runner uses root, so fixuid is skipped and git permissions work fine.
if [ "$(id -u)" != "0" ]; then
    exec fixuid -q "$@"
else
    exec "$@"
fi
