/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LoaderFunctionArgs } from "react-router";
import { gunzipSync } from "node:zlib";
import { signS3Request } from "~/utils/s3SigV4";

/**
 * MinIO Proxy API
 * Proxies requests to any MinIO server to avoid CORS issues
 *
 * Usage: POST /api/minio with { url: "http://..." }
 * Optional: accessKey, secretKey, region — AWS SigV4 signing for private buckets (same keys as Iceberg/S3).
 */

interface ProxyRequest {
  url: string;
  method?: string;
  /** When set with secretKey, requests are signed with AWS SigV4 (S3). Not HTTP Basic. */
  accessKey?: string;
  secretKey?: string;
  /** SigV4 region (default: AWS_REGION / AWS_DEFAULT_REGION / us-east-1). MinIO accepts us-east-1. */
  region?: string;
}

/** Exported for unit tests; validates and canonicalizes proxy target URLs. */
export function parseProxyTargetUrl(
  raw: unknown,
): { href: string } | { error: string } {
  if (typeof raw !== "string") {
    return { error: "URL is required" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "URL is required" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "Invalid URL format" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only HTTP and HTTPS protocols are allowed" };
  }
  return { href: parsed.href };
}

async function handleRequest(request: Request) {
  let body: ProxyRequest;
  try {
    body = (await request.json()) as ProxyRequest;
  } catch (e) {
    if (e instanceof SyntaxError) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    throw e;
  }

  try {
    const { url, method = "GET", accessKey, secretKey, region } = body;

    const target = parseProxyTargetUrl(url);
    if ("error" in target) {
      return Response.json({ error: target.error }, { status: 400 });
    }
    const fetchUrl = target.href;
    const parsedTarget = new URL(fetchUrl);
    const upperMethod = String(method).toUpperCase();
    if (upperMethod !== "GET" && upperMethod !== "HEAD") {
      return Response.json(
        { error: "Only GET and HEAD are supported" },
        { status: 400 },
      );
    }

    try {
      const headers: Record<string, string> = {
        Accept: "*/*",
      };

      const ak = typeof accessKey === "string" ? accessKey.trim() : "";
      const sk = typeof secretKey === "string" ? secretKey.trim() : "";
      if (ak && sk) {
        const sigRegion =
          (typeof region === "string" && region.trim()) ||
          process.env.AWS_REGION ||
          process.env.AWS_DEFAULT_REGION ||
          "us-east-1";
        Object.assign(
          headers,
          signS3Request({
            method: upperMethod,
            url: parsedTarget,
            accessKey: ak,
            secretKey: sk,
            region: sigRegion,
          }),
        );
      }

      const response = await fetch(fetchUrl, {
        method: upperMethod,
        headers,
      });

      if (!response.ok) {
        // Get detailed error response from MinIO
        let minioErrorDetails = "";
        try {
          const errorText = await response.text();
          minioErrorDetails = errorText;
          console.error(
            `[MinIO Proxy] MinIO returned error (${response.status}):`,
            errorText,
          );
        } catch {
          console.error(
            `[MinIO Proxy] MinIO returned error (${response.status}) - no body`,
          );
        }

        return Response.json(
          {
            error: `Failed to fetch from MinIO: HTTP ${response.status}`,
            status: response.status,
            statusText: response.statusText,
            minioError: minioErrorDetails,
            url: fetchUrl, // Include URL for debugging
          },
          { status: response.status },
        );
      }

      const raw = Buffer.from(await response.arrayBuffer());

      // 3D Tiles tileset.json and tile content are often stored pre-gzipped;
      // decompress so browser consumers (Cesium JSON parsing) get usable data.
      let finalBuf: Buffer;
      if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
        try {
          finalBuf = gunzipSync(raw);
        } catch {
          finalBuf = raw;
        }
      } else {
        finalBuf = raw;
      }

      return new Response(finalBuf, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("Content-Type") || "application/octet-stream",
          "Content-Length": String(finalBuf.byteLength),
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          // Preserve important headers from the original response
          ...(response.headers.get("ETag") && {
            ETag: response.headers.get("ETag")!,
          }),
          ...(response.headers.get("Last-Modified") && {
            "Last-Modified": response.headers.get("Last-Modified")!,
          }),
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("[MinIO Proxy] Fetch failed:", errorMessage, error);
      return Response.json(
        { error: `Failed to fetch from MinIO: ${errorMessage}` },
        { status: 500 },
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[MinIO Proxy] Request processing failed:", errorMessage);
    return Response.json(
      { error: `Request processing failed: ${errorMessage}` },
      { status: 500 },
    );
  }
}

// Handle OPTIONS for CORS preflight
async function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400", // 24 hours
    },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method === "GET") {
    return Response.json({
      message: "MinIO Proxy API - use POST requests with url parameter",
      usage: {
        method: "POST",
        body: {
          url: "http://your-minio-server:9003/path/to/file.parquet",
          method: "GET",
          accessKey: "optional — SigV4 for private buckets",
          secretKey: "optional",
          region: "optional — defaults to AWS_REGION or us-east-1",
        },
      },
    });
  }

  return handleRequest(request);
}

export async function action({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  return handleRequest(request);
}
