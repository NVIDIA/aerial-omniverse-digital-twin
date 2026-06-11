/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  isRfc1918IPv4Host,
  readMinioProxySettingsFromStorage,
  resolveMinioProxyHttpUrl,
  shouldProxyTileUrlToMinio,
} from "./minioProxyResource";

describe("shouldProxyTileUrlToMinio", () => {
  const creds = {
    accessKey: "k",
    secretKey: "s",
    s3Endpoint: "http://minio.example.com:9000",
  };

  it("returns true when tile URL origin matches configured endpoint", () => {
    expect(
      shouldProxyTileUrlToMinio(
        "http://minio.example.com:9000/warehouse/scene/viz/tiles/exterior/tileset.json",
        creds,
      ),
    ).toBe(true);
  });

  it("returns false for different host", () => {
    expect(
      shouldProxyTileUrlToMinio(
        "http://other.example.com/bucket/o.json",
        creds,
      ),
    ).toBe(false);
  });

  it("returns true when same host but different port (viz vs API endpoint)", () => {
    expect(
      shouldProxyTileUrlToMinio(
        "http://minio.example.com:9002/warehouse/scene/viz/tiles/exterior/tileset.json",
        creds,
      ),
    ).toBe(true);
  });

  it("normalizes endpoint without scheme like gisTilesets", () => {
    expect(
      shouldProxyTileUrlToMinio("http://192.0.2.10:9000/b/t.json", {
        ...creds,
        s3Endpoint: "192.0.2.10:9000",
      }),
    ).toBe(true);
  });

  it("returns true for two different RFC1918 hosts (e.g. terrain IP vs S3 API IP)", () => {
    expect(
      shouldProxyTileUrlToMinio(
        "http://10.152.138.172:9002/parquet-export-test/scene/viz/terrain/layer.json",
        {
          ...creds,
          s3Endpoint: "http://10.152.138.173:9000",
        },
      ),
    ).toBe(true);
  });

  it("returns false when endpoint is public DNS but tile host is private", () => {
    expect(
      shouldProxyTileUrlToMinio("http://10.0.0.5:9000/b/x.json", {
        ...creds,
        s3Endpoint: "http://minio.example.com:9000",
      }),
    ).toBe(false);
  });
});

describe("isRfc1918IPv4Host", () => {
  it("recognizes 10/8 and 192.168/16", () => {
    expect(isRfc1918IPv4Host("10.152.138.172")).toBe(true);
    expect(isRfc1918IPv4Host("192.168.1.1")).toBe(true);
  });

  it("recognizes 172.16–31", () => {
    expect(isRfc1918IPv4Host("172.20.0.1")).toBe(true);
    expect(isRfc1918IPv4Host("172.32.0.1")).toBe(false);
  });
});

describe("readMinioProxySettingsFromStorage", () => {
  it("returns the endpoint even when access credentials are omitted", () => {
    localStorage.setItem(
      "minio_settings",
      JSON.stringify({ s3Endpoint: "http://minio:9000" }),
    );

    expect(readMinioProxySettingsFromStorage()).toEqual({
      accessKey: "",
      secretKey: "",
      s3Endpoint: "http://minio:9000",
    });
  });
});

describe("resolveMinioProxyHttpUrl", () => {
  const Cesium = {
    RuntimeError: class extends Error {
      name = "RuntimeError";
    },
  };

  it("returns http URL from resource.url when already absolute", () => {
    const resource = {
      url: "http://minio.example.com:9000/bucket/obj/tileset.json",
      _url: "ignored",
      getBaseUri: () => "",
      _minioRoot: {},
    };
    expect(resolveMinioProxyHttpUrl(Cesium, resource)).toBe(
      "http://minio.example.com:9000/bucket/obj/tileset.json",
    );
  });

  it("resolves relative _url using getBaseUri", () => {
    const resource = {
      url: "layer.json",
      _url: "layer.json",
      getBaseUri: (includeQuery: boolean) =>
        includeQuery
          ? "http://192.0.2.1:9002/w/scene/viz/terrain/"
          : "http://192.0.2.1:9002/w/scene/viz/terrain/",
      _minioRoot: { _minioS3EndpointBase: "http://192.0.2.1:9002/" },
    };
    expect(resolveMinioProxyHttpUrl(Cesium, resource)).toBe(
      "http://192.0.2.1:9002/w/scene/viz/terrain/layer.json",
    );
  });

  it("falls back to _minioS3EndpointBase when getBaseUri is missing", () => {
    const resource = {
      url: "bucket/key/obj.b3dm",
      _url: "bucket/key/obj.b3dm",
      _minioRoot: {
        _minioS3EndpointBase: "http://192.0.2.1:9002/",
      },
    };
    expect(resolveMinioProxyHttpUrl(Cesium, resource)).toBe(
      "http://192.0.2.1:9002/bucket/key/obj.b3dm",
    );
  });
});
