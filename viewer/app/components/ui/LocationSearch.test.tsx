/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for LocationSearch component and parseLatLonQuery
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationSearch, parseLatLonQuery } from "./LocationSearch";

const mockFlyTo = vi.fn();

vi.mock("@/store/viewerStore", () => ({
  useViewerStore: () => ({
    cesiumViewer: {
      isDestroyed: () => false,
      camera: { flyTo: mockFlyTo },
    },
  }),
}));

vi.mock("@/constants/locations", () => ({
  searchLocations: vi.fn((query: string) => {
    if (query.toLowerCase().includes("berlin"))
      return [
        {
          id: "berlin",
          name: "Berlin",
          type: "city" as const,
          country: "Germany",
          latitude: 52.52,
          longitude: 13.405,
          altitude: 0,
        },
      ];
    return [];
  }),
}));

// Cesium is used in navigateToLocation; mock it so flyTo destination can be built
beforeEach(() => {
  mockFlyTo.mockClear();
  (window as any).Cesium = {
    Cartesian3: {
      fromDegrees: (lon: number, lat: number, alt: number) => ({
        lon,
        lat,
        alt,
      }),
    },
    Math: { toRadians: (deg: number) => deg * (Math.PI / 180) },
  };
});

describe("parseLatLonQuery", () => {
  describe("valid lat, lon (2 parts)", () => {
    it("parses with space after comma", () => {
      expect(parseLatLonQuery("37.7749, -122.4194")).toEqual({
        lat: 37.7749,
        lon: -122.4194,
        altitude: 0,
      });
    });

    it("parses without space (space-insensitive)", () => {
      expect(parseLatLonQuery("37.7749,-122.4194")).toEqual({
        lat: 37.7749,
        lon: -122.4194,
        altitude: 0,
      });
    });

    it("trims outer and inner whitespace", () => {
      expect(parseLatLonQuery("  52.52 ,  13.405  ")).toEqual({
        lat: 52.52,
        lon: 13.405,
        altitude: 0,
      });
    });

    it("defaults altitude to 0 when not provided", () => {
      const result = parseLatLonQuery("0, 0");
      expect(result).not.toBeNull();
      expect(result!.altitude).toBe(0);
    });
  });

  describe("valid lat, lon, alt (3 parts)", () => {
    it("parses altitude when provided", () => {
      expect(parseLatLonQuery("37, -122, 500")).toEqual({
        lat: 37,
        lon: -122,
        altitude: 500,
      });
    });

    it("trims altitude", () => {
      expect(parseLatLonQuery("37, -122,  100  ")).toEqual({
        lat: 37,
        lon: -122,
        altitude: 100,
      });
    });
  });

  describe("invalid input", () => {
    it("returns null for single number", () => {
      expect(parseLatLonQuery("37")).toBeNull();
    });

    it("returns null for four parts", () => {
      expect(parseLatLonQuery("37, -122, 100, 1")).toBeNull();
    });

    it("returns null for non-numeric lat", () => {
      expect(parseLatLonQuery("abc, -122")).toBeNull();
    });

    it("returns null for non-numeric lon", () => {
      expect(parseLatLonQuery("37, abc")).toBeNull();
    });

    it("returns null for lat out of range (> 90)", () => {
      expect(parseLatLonQuery("91, 0")).toBeNull();
    });

    it("returns null for lat out of range (< -90)", () => {
      expect(parseLatLonQuery("-91, 0")).toBeNull();
    });

    it("returns null for lon out of range (> 180)", () => {
      expect(parseLatLonQuery("0, 181")).toBeNull();
    });

    it("returns null for lon out of range (< -180)", () => {
      expect(parseLatLonQuery("0, -181")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseLatLonQuery("")).toBeNull();
    });

    it("defaults altitude to 0 when third part is invalid", () => {
      const result = parseLatLonQuery("37, -122, x");
      expect(result).toEqual({ lat: 37, lon: -122, altitude: 0 });
    });
  });
});

describe("LocationSearch", () => {
  it("renders search input with placeholder", () => {
    render(<LocationSearch />);
    expect(
      screen.getByPlaceholderText("Search location..."),
    ).toBeInTheDocument();
  });

  it("shows no results when query is empty", async () => {
    render(<LocationSearch />);
    const input = screen.getByPlaceholderText("Search location...");
    await userEvent.clear(input);
    await userEvent.type(input, "x");
    await userEvent.clear(input);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /coordinates|berlin/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows name search results when typing a location name", async () => {
    render(<LocationSearch />);
    const input = screen.getByPlaceholderText("Search location...");
    await userEvent.type(input, "Berlin");
    await waitFor(() => {
      expect(screen.getByText("Berlin")).toBeInTheDocument();
    });
  });

  it("shows coordinates result when typing lat, lon", async () => {
    render(<LocationSearch />);
    const input = screen.getByPlaceholderText("Search location...");
    await userEvent.type(input, "37.7749, -122.4194");
    await waitFor(() => {
      expect(
        screen.getByText(/Coordinates \(37\.7749, -122\.4194\)/),
      ).toBeInTheDocument();
    });
  });

  it("shows coordinates result with space-insensitive lat,lon", async () => {
    render(<LocationSearch />);
    const input = screen.getByPlaceholderText("Search location...");
    await userEvent.type(input, "52.52,13.405");
    await waitFor(() => {
      expect(
        screen.getByText(/Coordinates \(52\.5200, 13\.4050\)/),
      ).toBeInTheDocument();
    });
  });

  it("navigates to coordinate when selecting coordinates result", async () => {
    render(<LocationSearch />);
    const input = screen.getByPlaceholderText("Search location...");
    await userEvent.type(input, "37, -122");
    await waitFor(() => {
      expect(screen.getByText(/Coordinates/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText(/Coordinates/));
    expect(mockFlyTo).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: { lon: -122, lat: 37, alt: 0 },
      }),
    );
  });

  it("navigates with altitude when lat, lon, alt is entered", async () => {
    render(<LocationSearch />);
    const input = screen.getByPlaceholderText("Search location...");
    await userEvent.type(input, "37, -122, 500");
    await waitFor(() => {
      expect(screen.getByText(/Coordinates/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText(/Coordinates/));
    expect(mockFlyTo).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: { lon: -122, lat: 37, alt: 500 },
      }),
    );
  });

  it("clears query when clear button is clicked", async () => {
    render(<LocationSearch />);
    const input = screen.getByPlaceholderText("Search location...");
    await userEvent.type(input, "Berlin");
    await waitFor(() => {
      expect(screen.getByText("Berlin")).toBeInTheDocument();
    });
    const clearButton = input.parentElement?.querySelector("button");
    if (clearButton) await userEvent.click(clearButton);
    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });
});
