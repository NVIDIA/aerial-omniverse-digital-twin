/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/viewer.tsx"),
  route("api/minio", "routes/api.minio.ts"),
  route("api/iceberg", "routes/api.iceberg.ts"),
] satisfies RouteConfig;
