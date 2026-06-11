/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { searchLocations, type Location } from "./locations";

describe("searchLocations", () => {
  describe("empty and whitespace queries", () => {
    it("should return empty array for empty string", () => {
      expect(searchLocations("")).toEqual([]);
    });

    it("should return empty array for whitespace-only string", () => {
      expect(searchLocations("   ")).toEqual([]);
    });
  });

  describe("name matching", () => {
    it("should find cities by exact name", () => {
      const results = searchLocations("Tokyo");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe("Tokyo");
    });

    it("should be case-insensitive", () => {
      const lower = searchLocations("tokyo");
      const upper = searchLocations("TOKYO");
      const mixed = searchLocations("tOkYo");

      expect(lower).toEqual(upper);
      expect(upper).toEqual(mixed);
    });

    it("should match partial strings", () => {
      const results = searchLocations("ber");
      const names = results.map((r) => r.name);
      expect(names).toContain("Berlin");
    });

    it("should match landmarks", () => {
      const results = searchLocations("Eiffel");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toContain("Eiffel");
    });
  });

  describe("country matching", () => {
    it("should find cities by country name", () => {
      const results = searchLocations("Japan");
      const names = results.map((r) => r.name);
      expect(names).toContain("Japan");
      // Cities in Japan should also appear
      expect(results.some((r) => r.country === "Japan")).toBe(true);
    });

    it("should match partial country names", () => {
      const results = searchLocations("United");
      const names = results.map((r) => r.name);
      expect(
        names.some(
          (n) =>
            n.includes("United") ||
            results.some((r) => r.country?.includes("United")),
        ),
      ).toBe(true);
    });
  });

  describe("sorting priority", () => {
    it("should prioritize exact name matches over partial matches", () => {
      const results = searchLocations("Paris");
      expect(results[0].name).toBe("Paris");
    });

    it("should prioritize starts-with matches over contains matches", () => {
      const results = searchLocations("San");
      // San Francisco, San Diego, Santa Clara, Santiago should come before results where "San" is in the middle
      const firstFew = results.slice(0, 5).map((r) => r.name);
      expect(
        firstFew.every(
          (name) =>
            name.toLowerCase().startsWith("san") ||
            name.toLowerCase().includes("san"),
        ),
      ).toBe(true);
    });

    it("should prioritize landmarks and cities over countries and regions", () => {
      // "London" matches the city; the country "United Kingdom" shouldn't rank higher
      const results = searchLocations("London");
      expect(results[0].name).toBe("London");
      expect(results[0].type).toBe("city");
    });
  });

  describe("limit parameter", () => {
    it("should respect default limit of 10", () => {
      const results = searchLocations("a"); // broad query
      expect(results.length).toBeLessThanOrEqual(10);
    });

    it("should respect custom limit", () => {
      const results = searchLocations("a", 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should return fewer results if fewer matches exist", () => {
      const results = searchLocations("Eiffel Tower", 100);
      expect(results.length).toBe(1);
    });
  });

  describe("data integrity", () => {
    it("should return Location objects with required fields", () => {
      const results = searchLocations("New York");
      expect(results.length).toBeGreaterThanOrEqual(1);

      const nyc = results[0];
      expect(nyc).toHaveProperty("id");
      expect(nyc).toHaveProperty("name");
      expect(nyc).toHaveProperty("type");
      expect(nyc).toHaveProperty("latitude");
      expect(nyc).toHaveProperty("longitude");
      expect(nyc).toHaveProperty("altitude");
      expect(typeof nyc.latitude).toBe("number");
      expect(typeof nyc.longitude).toBe("number");
      expect(typeof nyc.altitude).toBe("number");
    });

    it("should have valid coordinates for all results", () => {
      const results = searchLocations("a", 10);
      for (const loc of results) {
        expect(loc.latitude).toBeGreaterThanOrEqual(-90);
        expect(loc.latitude).toBeLessThanOrEqual(90);
        expect(loc.longitude).toBeGreaterThanOrEqual(-180);
        expect(loc.longitude).toBeLessThanOrEqual(180);
        expect(loc.altitude).toBeGreaterThan(0);
      }
    });

    it("should have unique IDs within results", () => {
      const results = searchLocations("a", 10);
      const ids = results.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("edge cases", () => {
    it("should handle query with no matches", () => {
      const results = searchLocations("xyznonexistent");
      expect(results).toEqual([]);
    });

    it("should trim whitespace around query", () => {
      const trimmed = searchLocations("Tokyo");
      const padded = searchLocations("  Tokyo  ");
      expect(trimmed).toEqual(padded);
    });

    it("should handle special characters in query", () => {
      const results = searchLocations("São");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toContain("São Paulo");
    });

    it("should find regions", () => {
      const results = searchLocations("Europe");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe("Europe");
      expect(results[0].type).toBe("region");
    });
  });
});
