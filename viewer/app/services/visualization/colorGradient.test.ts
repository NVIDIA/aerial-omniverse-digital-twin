/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for colorGradient utilities
 */
import { describe, it, expect, vi } from "vitest";
import {
  getViridisColor,
  getViridisGradientCSS,
  SIGNAL_MIN,
  SIGNAL_MAX,
} from "./colorGradient";

// Mock the constants
vi.mock("@/constants", () => ({
  SIGNAL_RANGE: {
    MIN: -180,
    MAX: -40,
  },
}));

describe("colorGradient", () => {
  describe("getViridisColor", () => {
    it("should return valid RGB color for signal strength", () => {
      const color = getViridisColor(-100);

      expect(Array.isArray(color)).toBe(true);
      expect(color).toHaveLength(3);
      expect(color[0]).toBeGreaterThanOrEqual(0);
      expect(color[0]).toBeLessThanOrEqual(255);
      expect(color[1]).toBeGreaterThanOrEqual(0);
      expect(color[1]).toBeLessThanOrEqual(255);
      expect(color[2]).toBeGreaterThanOrEqual(0);
      expect(color[2]).toBeLessThanOrEqual(255);
    });

    it("should return first color for minimum signal strength", () => {
      const color = getViridisColor(-180);

      // Should return darkest color (first in viridis map)
      expect(color[0]).toBeLessThan(100);
      expect(color[2]).toBeGreaterThan(50);
    });

    it("should return last color for maximum signal strength", () => {
      const color = getViridisColor(-40);

      // Should return brightest color (last in viridis map)
      expect(color[0]).toBeGreaterThan(200);
      expect(color[1]).toBeGreaterThan(200);
    });

    it("should clamp values below minimum", () => {
      const colorBelowMin = getViridisColor(-200);
      const colorAtMin = getViridisColor(-180);

      expect(colorBelowMin).toEqual(colorAtMin);
    });

    it("should clamp values above maximum", () => {
      const colorAboveMax = getViridisColor(-20);
      const colorAtMax = getViridisColor(-40);

      expect(colorAboveMax).toEqual(colorAtMax);
    });

    it("should return different colors for different signal strengths", () => {
      const color1 = getViridisColor(-150);
      const color2 = getViridisColor(-100);
      const color3 = getViridisColor(-50);

      expect(color1).not.toEqual(color2);
      expect(color2).not.toEqual(color3);
      expect(color1).not.toEqual(color3);
    });

    it("should handle mid-range values", () => {
      const midSignal = (-180 + -40) / 2;
      const color = getViridisColor(midSignal);

      expect(color).toBeDefined();
      expect(Array.isArray(color)).toBe(true);
      expect(color).toHaveLength(3);
    });
  });

  describe("getViridisGradientCSS", () => {
    it("should return valid CSS gradient string", () => {
      const gradient = getViridisGradientCSS();

      expect(gradient).toContain("linear-gradient");
      expect(gradient).toContain("to right");
      expect(gradient).toContain("rgb(");
    });

    it("should contain multiple color stops", () => {
      const gradient = getViridisGradientCSS();

      // Should have at least 10 samples (11 including start and end)
      const rgbMatches = gradient.match(/rgb\(/g);
      expect(rgbMatches).toBeTruthy();
      expect(rgbMatches!.length).toBeGreaterThanOrEqual(10);
    });

    it("should start with dark color", () => {
      const gradient = getViridisGradientCSS();

      // First color should be dark (viridis starts with dark purple)
      expect(gradient).toMatch(/rgb\(\d+,\s*\d+,\s*\d+\)/);
    });

    it("should end with bright color", () => {
      const gradient = getViridisGradientCSS();

      // Last color should be bright (viridis ends with yellow)
      const colors = gradient.match(/rgb\(\d+,\s*\d+,\s*\d+\)/g);
      expect(colors).toBeTruthy();
      expect(colors!.length).toBeGreaterThan(0);
    });
  });

  describe("SIGNAL constants", () => {
    it("should export SIGNAL_MIN", () => {
      expect(SIGNAL_MIN).toBeDefined();
      expect(typeof SIGNAL_MIN).toBe("number");
    });

    it("should export SIGNAL_MAX", () => {
      expect(SIGNAL_MAX).toBeDefined();
      expect(typeof SIGNAL_MAX).toBe("number");
    });
  });
});
