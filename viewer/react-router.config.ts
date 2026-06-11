/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from "@react-router/dev/config";

export default {
  // SSR must be enabled so that /api/minio and /api/iceberg
  // route actions run on the server (POST requests would otherwise get 405 with ssr: false).
  ssr: true,
} satisfies Config;
