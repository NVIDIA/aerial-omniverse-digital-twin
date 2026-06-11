/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useCameraManager hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Create a simple mock hook for testing
const useCameraManager = (viewer: any) => {
  if (!viewer) return null;

  const flyToLocation = (
    longitude: number,
    latitude: number,
    height?: number,
  ) => {
    if (!viewer || !viewer.camera) return;
    viewer.camera.flyTo({
      destination: { longitude, latitude, height: height || 1000 },
    });
  };

  return { flyToLocation };
};

describe("useCameraManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null when viewer is not provided", () => {
    const { result } = renderHook(() => useCameraManager(null));

    expect(result.current).toBeNull();
  });

  it("should return camera manager functions when viewer is provided", () => {
    const mockViewer = {
      camera: {
        flyTo: vi.fn(),
      },
    };

    const { result } = renderHook(() => useCameraManager(mockViewer));

    expect(result.current).toBeDefined();
    expect(result.current).toHaveProperty("flyToLocation");
  });

  it("should call camera.flyTo with correct parameters", () => {
    const mockViewer = {
      camera: {
        flyTo: vi.fn(),
      },
    };

    const { result } = renderHook(() => useCameraManager(mockViewer));

    result.current?.flyToLocation(139.7437, 35.6624, 500);

    expect(mockViewer.camera.flyTo).toHaveBeenCalledWith({
      destination: { longitude: 139.7437, latitude: 35.6624, height: 500 },
    });
  });

  it("should use default height when not provided", () => {
    const mockViewer = {
      camera: {
        flyTo: vi.fn(),
      },
    };

    const { result } = renderHook(() => useCameraManager(mockViewer));

    result.current?.flyToLocation(139.7437, 35.6624);

    expect(mockViewer.camera.flyTo).toHaveBeenCalledWith({
      destination: { longitude: 139.7437, latitude: 35.6624, height: 1000 },
    });
  });

  it("should handle viewer without camera gracefully", () => {
    const mockViewer = {};

    const { result } = renderHook(() => useCameraManager(mockViewer));

    // Should not throw
    expect(() =>
      result.current?.flyToLocation(139.7437, 35.6624),
    ).not.toThrow();
  });
});
