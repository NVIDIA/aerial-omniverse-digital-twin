/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { awsCanonicalQueryString, awsCanonicalUri } from "./s3SigV4";

describe("awsCanonicalUri", () => {
  it("encodes path segments", () => {
    expect(awsCanonicalUri("/my-bucket/foo bar/obj.json")).toBe(
      "/my-bucket/foo%20bar/obj.json",
    );
  });

  it("handles root path", () => {
    expect(awsCanonicalUri("/")).toBe("/");
  });
});

describe("awsCanonicalQueryString", () => {
  it("sorts keys and empty when no query", () => {
    expect(awsCanonicalQueryString(new URLSearchParams())).toBe("");
  });

  it("sorts lexicographically", () => {
    const q = new URLSearchParams("z=1&a=2&a=1");
    expect(awsCanonicalQueryString(q)).toBe("a=1&a=2&z=1");
  });
});
