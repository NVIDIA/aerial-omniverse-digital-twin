/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseProxyTargetUrl } from "./api.minio";

describe("parseProxyTargetUrl", () => {
  it("accepts http and returns canonical href", () => {
    const r = parseProxyTargetUrl(
      "http://10.152.138.172:9002/warehouse/a/tileset.json",
    );
    expect("error" in r).toBe(false);
    if ("href" in r) {
      expect(r.href).toMatch(/^http:\/\/10\.152\.138\.172:9002\//);
    }
  });

  it("accepts uppercase HTTP scheme (URL parser normalizes)", () => {
    const r = parseProxyTargetUrl("HTTP://10.152.138.172:9002/path");
    expect("error" in r).toBe(false);
    if ("href" in r) {
      expect(r.href.startsWith("http://")).toBe(true);
    }
  });

  it("trims whitespace", () => {
    const r = parseProxyTargetUrl("  https://example.com/x  ");
    expect("error" in r).toBe(false);
    if ("href" in r) {
      expect(r.href).toBe("https://example.com/x");
    }
  });

  it("rejects non-http protocols", () => {
    const r = parseProxyTargetUrl("ftp://example.com/x");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("HTTP");
  });

  it("rejects missing or non-string url", () => {
    expect("error" in parseProxyTargetUrl(undefined)).toBe(true);
    expect("error" in parseProxyTargetUrl("")).toBe(true);
    expect("error" in parseProxyTargetUrl("   ")).toBe(true);
  });
});
