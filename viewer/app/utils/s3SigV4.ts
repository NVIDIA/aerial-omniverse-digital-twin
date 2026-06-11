/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AWS Signature Version 4 for S3-compatible APIs (MinIO, etc.).
 * Used by the MinIO proxy so private buckets work without public read policies.
 */
import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const TERMINATOR = "aws4_request";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, SERVICE);
  return hmacSha256(kService, TERMINATOR);
}

/** ISO8601 basic: 20230101T120000Z */
function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "Z");
  const amzDate = iso;
  const dateStamp = amzDate.slice(0, 8);
  return { amzDate, dateStamp };
}

/** Path-style S3 URI: encode each segment. */
export function awsCanonicalUri(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const segments = pathname.split("/").filter((s) => s.length > 0);
  return "/" + segments.map((s) => encodeURIComponent(s)).join("/");
}

/** Canonical query string: sort by parameter name, then value (S3 SigV4). */
export function awsCanonicalQueryString(searchParams: URLSearchParams): string {
  const keys = [...new Set([...searchParams.keys()])].sort();
  const parts: string[] = [];
  for (const key of keys) {
    const values = searchParams.getAll(key).sort();
    for (const value of values) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join("&");
}

export type SignS3RequestOptions = {
  method: string;
  url: URL;
  accessKey: string;
  secretKey: string;
  /** S3 region for SigV4 (MinIO accepts us-east-1 by default). */
  region: string;
};

/**
 * Returns headers to add to the outbound HTTP request (Authorization, x-amz-date, x-amz-content-sha256).
 */
export function signS3Request(
  opts: SignS3RequestOptions,
): Record<string, string> {
  const { method, url, accessKey, secretKey, region } = opts;
  const now = new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);

  const canonicalUri = awsCanonicalUri(url.pathname);
  const canonicalQueryString = awsCanonicalQueryString(url.searchParams);

  const hostHeader = url.host;

  const canonicalHeaders =
    `host:${hostHeader}\n` +
    `x-amz-content-sha256:${UNSIGNED_PAYLOAD}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/${TERMINATOR}`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(secretKey, dateStamp, region);
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization = [
    `${ALGORITHM} Credential=${accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": UNSIGNED_PAYLOAD,
    Authorization: authorization,
  };
}
