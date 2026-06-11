/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const minioMocks = vi.hoisted(() => ({
  createMinioProxyResource: vi.fn(() => ({ proxied: true })),
  readMinioProxyCredentialsFromStorage: vi.fn(),
  readMinioProxySettingsFromStorage: vi.fn(),
  shouldProxyTileUrlToMinio: vi.fn(),
}));

vi.mock("@/constants/baseLayers", () => ({
  DEFAULT_BASE_LAYER_ID: "sentinel2",
  getBaseLayerById: vi.fn(() => ({
    type: "url",
    url: "https://example.test/{z}/{x}/{y}.png",
  })),
  getCesiumIonToken: vi.fn(() => null),
}));

vi.mock("@/store/utils/localStorage", () => ({
  loadBaseLayerId: vi.fn(() => null),
}));

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: {
    getState: vi.fn(() => ({
      vizBaseUrl: null,
    })),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@/utils/minioProxyResource", () => ({
  createMinioProxyResource: minioMocks.createMinioProxyResource,
  readMinioProxyCredentialsFromStorage:
    minioMocks.readMinioProxyCredentialsFromStorage,
  readMinioProxySettingsFromStorage:
    minioMocks.readMinioProxySettingsFromStorage,
  shouldProxyTileUrlToMinio: minioMocks.shouldProxyTileUrlToMinio,
}));

describe("resolveMinioResourceForCesium", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a proxy resource for matching MinIO terrain URLs without credentials", async () => {
    const terrainUrl = "http://minio:9000/aerial-data/scene/viz/terrain/";
    const Cesium = {};

    minioMocks.readMinioProxySettingsFromStorage.mockReturnValue({
      accessKey: "",
      secretKey: "",
      s3Endpoint: "http://minio:9000",
    });
    minioMocks.shouldProxyTileUrlToMinio.mockReturnValue(true);

    const { resolveMinioResourceForCesium } = await import("./useCesiumViewer");

    expect(resolveMinioResourceForCesium(Cesium, terrainUrl)).toEqual({
      proxied: true,
    });
    expect(minioMocks.createMinioProxyResource).toHaveBeenCalledWith(
      Cesium,
      terrainUrl,
      "",
      "",
      "http://minio:9000",
    );
  });
});
