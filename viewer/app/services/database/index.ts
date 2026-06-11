/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Database Services Barrel Export
 */

export type { QueryResult } from "./minioClient";
export {
  minioClient,
  normalizeIcebergNamespace,
  parseIcebergQualifiedName,
  resolveAvailableNamespaceSelection,
  resolveCatalogTableRef,
} from "./minioClient";
