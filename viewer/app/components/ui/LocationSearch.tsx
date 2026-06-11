/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useViewerStore } from "@/store/viewerStore";
import { searchLocations, type Location } from "@/constants/locations";

/** Parse "lat, lon" or "lat, lon, alt" from query (space-insensitive). Altitude defaults to 0 when not set. Returns null if not valid. */
export function parseLatLonQuery(
  query: string,
): { lat: number; lon: number; altitude: number } | null {
  const parts = query
    .trim()
    .split(",")
    .map((p) => p.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const altitude =
    parts.length === 3 && !Number.isNaN(parseFloat(parts[2]))
      ? parseFloat(parts[2])
      : 0;
  return { lat, lon, altitude };
}

/**
 * Icon for each location type
 */
const LocationTypeIcon: React.FC<{ type: Location["type"] }> = ({ type }) => {
  switch (type) {
    case "landmark":
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </svg>
      );
    case "city":
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
      );
    case "country":
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
          />
        </svg>
      );
    case "region":
      return (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
  }
};

export const LocationSearch: React.FC = () => {
  const { cesiumViewer } = useViewerStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search when query changes (name/country search or lat, lon)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const latLon = parseLatLonQuery(trimmed);
    if (latLon) {
      const coordLocation: Location = {
        id: "coord",
        name: `Coordinates (${latLon.lat.toFixed(4)}, ${latLon.lon.toFixed(4)})`,
        type: "landmark",
        latitude: latLon.lat,
        longitude: latLon.lon,
        altitude: latLon.altitude,
      };
      setResults([coordLocation]);
      setIsOpen(true);
      setSelectedIndex(-1);
      return;
    }

    const found = searchLocations(query, 8);
    setResults(found);
    setIsOpen(found.length > 0);
    setSelectedIndex(-1);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Navigate to location
  const navigateToLocation = useCallback(
    (location: Location) => {
      if (!cesiumViewer || cesiumViewer.isDestroyed()) return;

      const Cesium = window.Cesium;
      if (!Cesium) return;

      // Top-down view: camera directly above target looking straight down
      cesiumViewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          location.longitude,
          location.latitude,
          location.altitude,
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90), // Straight down
          roll: 0,
        },
        duration: 2.0,
      });

      setQuery("");
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [cesiumViewer],
  );

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const latLon = parseLatLonQuery(query);
      if (latLon && (!isOpen || results.length === 0)) {
        e.preventDefault();
        navigateToLocation({
          id: "coord",
          name: `Coordinates (${latLon.lat}, ${latLon.lon})`,
          type: "landmark",
          latitude: latLon.lat,
          longitude: latLon.lon,
          altitude: latLon.altitude,
        });
        return;
      }
    }

    if (!isOpen || results.length === 0) {
      if (e.key === "Escape") {
        setQuery("");
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          navigateToLocation(results[selectedIndex]);
        } else if (results.length > 0) {
          navigateToLocation(results[0]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setQuery("");
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim() && results.length > 0 && setIsOpen(true)}
          placeholder="Search location..."
          className="w-64 pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-white"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 max-h-80 overflow-y-auto">
          {results.map((location, index) => (
            <button
              key={location.id}
              onClick={() => navigateToLocation(location)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${
                index === selectedIndex
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              <div
                className={`flex-shrink-0 ${
                  index === selectedIndex ? "text-white" : "text-gray-500"
                }`}
              >
                <LocationTypeIcon type={location.type} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{location.name}</div>
                {location.country && (
                  <div
                    className={`text-xs truncate ${
                      index === selectedIndex
                        ? "text-blue-200"
                        : "text-gray-500"
                    }`}
                  >
                    {location.country}
                  </div>
                )}
              </div>
              <div
                className={`text-xs px-2 py-0.5 rounded ${
                  index === selectedIndex
                    ? "bg-blue-500 text-white"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {location.type}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results message */}
      {isOpen && query.trim() && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 text-center text-gray-400 text-sm">
          No locations found for "{query}"
        </div>
      )}
    </div>
  );
};
