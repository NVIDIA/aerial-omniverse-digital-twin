/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cesium Resource that loads MinIO-hosted assets via same-origin POST /api/minio
 * (browser GETs to MinIO are blocked by CORS). Anonymous proxy works for public buckets;
 * when MinIO settings include access/secret keys, the proxy signs with AWS SigV4 for private buckets.
 */
import { normalizeS3EndpointForTiles } from "./gisTilesets";

const MINIO_SETTINGS_KEY = "minio_settings";

/** True if hostname is an RFC1918 private IPv4 address (10/8, 172.16–31/12, 192.168/16). */
export function isRfc1918IPv4Host(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export type MinioProxyCredentials = {
  accessKey: string;
  secretKey: string;
  s3Endpoint: string;
};

export function readMinioProxySettingsFromStorage(): MinioProxyCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MINIO_SETTINGS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as {
      s3Endpoint?: string;
      accessKey?: string;
      secretKey?: string;
    };
    const accessKey = p.accessKey?.trim() ?? "";
    const secretKey = p.secretKey?.trim() ?? "";
    const s3Endpoint = p.s3Endpoint?.trim() ?? "";
    if (!s3Endpoint) return null;
    return { accessKey, secretKey, s3Endpoint };
  } catch {
    return null;
  }
}

export function readMinioProxyCredentialsFromStorage(): MinioProxyCredentials | null {
  const settings = readMinioProxySettingsFromStorage();
  if (!settings?.accessKey || !settings.secretKey) return null;
  return settings;
}

export function shouldProxyTileUrlToMinio(
  tilesetUrl: string,
  creds: MinioProxyCredentials,
): boolean {
  try {
    const configured = new URL(normalizeS3EndpointForTiles(creds.s3Endpoint));
    const target = new URL(tilesetUrl);
    if (configured.protocol !== target.protocol) return false;
    // Same hostname; ports may differ (e.g. API on 9000, console on 9002).
    if (configured.hostname === target.hostname) return true;
    // GIS/terrain URLs often use a different private IP than s3Endpoint (e.g. .172 vs .173);
    // still proxy so SigV4 applies and the browser does not hit MinIO directly (403).
    if (
      isRfc1918IPv4Host(configured.hostname) &&
      isRfc1918IPv4Host(target.hostname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function readCesiumResourceUrlString(resource: any): string {
  if (resource == null) return "";
  try {
    const u = resource.url;
    if (typeof u === "string" && u.length) return u.trim();
  } catch {
    /* Cesium Resource.url getter can throw in edge cases */
  }
  try {
    const u = resource._url;
    if (typeof u === "string" && u.length) return u.trim();
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * Cesium sometimes keeps relative paths in `_url`; the MinIO proxy API requires an absolute http(s) URL.
 * `JSON.stringify` also drops `undefined`, which produced POST bodies without `url` → 400 Bad Request.
 */
export function resolveMinioProxyHttpUrl(Cesium: any, resource: any): string {
  const raw = readCesiumResourceUrlString(resource);
  if (!raw) {
    throw new Cesium.RuntimeError("MinIO proxy: missing resource URL");
  }

  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return u.href;
    }
  } catch {
    // resolve below
  }

  try {
    const baseUri = resource.getBaseUri?.(true);
    if (baseUri) {
      return new URL(raw, baseUri).href;
    }
  } catch {
    /* continue */
  }

  const root = resource._minioRoot ?? resource;
  const base = root._minioS3EndpointBase;
  if (base) {
    try {
      return new URL(raw, base).href;
    } catch {
      /* continue */
    }
  }

  throw new Cesium.RuntimeError(
    `MinIO proxy: could not resolve absolute URL for: ${raw}`,
  );
}

async function fetchViaMinioProxy(
  Cesium: any,
  resource: any,
  options: {
    responseType?: string;
    method?: string;
    overrideMimeType?: string;
  },
): Promise<any> {
  const root = resource._minioRoot ?? resource;
  const method = Cesium.defaultValue(options.method, "GET");
  const responseType = options.responseType;
  const targetUrl = resolveMinioProxyHttpUrl(Cesium, resource);

  const controller = new AbortController();
  resource.request.cancelFunction = () => {
    controller.abort();
  };

  const creds = readMinioProxyCredentialsFromStorage();
  const proxyBody: Record<string, string> = {
    url: targetUrl,
    method,
  };
  if (creds) {
    proxyBody.accessKey = creds.accessKey;
    proxyBody.secretKey = creds.secretKey;
  }

  try {
    const r = await fetch("/api/minio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proxyBody),
      signal: controller.signal,
    });

    if (!r.ok) {
      let errBody: unknown;
      try {
        errBody = await r.json();
      } catch {
        errBody = await r.text();
      }
      throw new Cesium.RequestErrorEvent(r.status, errBody, {});
    }

    if (method === "HEAD" || method === "OPTIONS") {
      const responseHeaders: Record<string, string> = {};
      r.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return responseHeaders;
    }

    if (r.status === 204) {
      return undefined;
    }

    switch (responseType) {
      case "text":
        return await r.text();
      case "json":
        return await r.json();
      case "document": {
        const text = await r.text();
        const parser = new DOMParser();
        const mime = Cesium.defaultValue(
          options.overrideMimeType,
          "application/xml",
        );
        return parser.parseFromString(text, mime);
      }
      case "blob":
        return await r.blob();
      case "arraybuffer":
      default:
        return await r.arrayBuffer();
    }
  } finally {
    resource.request.cancelFunction = undefined;
  }
}

/**
 * Returns a Cesium Resource that performs HTTP via POST /api/minio (same-origin; no Basic auth on S3 GET).
 * Derived resources (tile content URLs) keep the same credentials via clone().
 * @param s3EndpointForResolution - stored endpoint (e.g. minio_settings.s3Endpoint) used to resolve relative paths
 */
export function createMinioProxyResource(
  Cesium: any,
  url: string,
  accessKey: string,
  secretKey: string,
  s3EndpointForResolution?: string,
): any {
  const Resource = Cesium.Resource;
  const endpointBase =
    typeof s3EndpointForResolution === "string" &&
    s3EndpointForResolution.trim()
      ? `${normalizeS3EndpointForTiles(s3EndpointForResolution).replace(/\/+$/, "")}/`
      : undefined;

  function MinioProxyResource(this: any, urlString: string) {
    Resource.call(this, { url: urlString });
    this._minioRoot = this;
    this._minioAccessKey = accessKey;
    this._minioSecretKey = secretKey;
    this._minioS3EndpointBase = endpointBase;
  }

  MinioProxyResource.prototype = Object.create(Resource.prototype);
  (MinioProxyResource.prototype as any).constructor = MinioProxyResource;

  (MinioProxyResource.prototype as any).clone = function (
    this: any,
    result?: any,
  ) {
    const root = this._minioRoot || this;
    if (!result) {
      result = new (MinioProxyResource as any)(this._url);
      result._minioRoot = root;
      result._minioAccessKey = root._minioAccessKey;
      result._minioSecretKey = root._minioSecretKey;
      result._minioS3EndpointBase = root._minioS3EndpointBase;
    }
    Resource.prototype.clone.call(this, result);
    result._minioRoot = root;
    result._minioAccessKey = root._minioAccessKey;
    result._minioSecretKey = root._minioSecretKey;
    result._minioS3EndpointBase = root._minioS3EndpointBase;
    return result;
  };

  (MinioProxyResource.prototype as any).fetchImage = function (
    this: any,
    options: any,
  ) {
    options = Cesium.defaultValue(options, {});
    return Resource.prototype.fetchImage.call(this, {
      ...options,
      preferBlob: true,
    });
  };

  (MinioProxyResource.prototype as any)._makeRequest = function (
    this: any,
    options: any,
  ) {
    const resource = this;
    const request = resource.request;
    if (
      request.state === Cesium.RequestState.ISSUED ||
      request.state === Cesium.RequestState.ACTIVE
    ) {
      throw new Cesium.RuntimeError("The Resource is already being fetched.");
    }
    request.state = Cesium.RequestState.UNISSUED;
    request.deferred = undefined;

    const url2 = resource.url;
    request.url = url2;
    request.requestFunction = function () {
      return fetchViaMinioProxy(Cesium, resource, options);
    };

    const promise = Cesium.RequestScheduler.request(request);
    if (!Cesium.defined(promise)) {
      return;
    }
    return promise
      .then(function (data: any) {
        request.cancelFunction = undefined;
        return data;
      })
      .catch(function (e: any) {
        request.cancelFunction = undefined;
        if (request.state !== Cesium.RequestState.FAILED) {
          return Promise.reject(e);
        }
        return resource.retryOnError(e).then(function (retry: boolean) {
          if (retry) {
            request.state = Cesium.RequestState.UNISSUED;
            request.deferred = undefined;
            return resource.fetch(options);
          }
          return Promise.reject(e);
        });
      });
  };

  return new (MinioProxyResource as any)(url);
}
