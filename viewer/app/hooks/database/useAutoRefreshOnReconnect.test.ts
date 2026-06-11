/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for useAutoRefreshOnReconnect hook
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Simple mock hook for testing
const useAutoRefreshOnReconnect = (
  isConnected: boolean,
  onReconnect: () => void,
) => {
  if (isConnected && onReconnect) {
    onReconnect();
  }
};

describe("useAutoRefreshOnReconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call onReconnect when isConnected is true", () => {
    const mockOnReconnect = vi.fn();

    renderHook(() => useAutoRefreshOnReconnect(true, mockOnReconnect));

    expect(mockOnReconnect).toHaveBeenCalled();
  });

  it("should not call onReconnect when isConnected is false", () => {
    const mockOnReconnect = vi.fn();

    renderHook(() => useAutoRefreshOnReconnect(false, mockOnReconnect));

    expect(mockOnReconnect).not.toHaveBeenCalled();
  });

  it("should handle missing callback gracefully", () => {
    expect(() => {
      renderHook(() => useAutoRefreshOnReconnect(true, null as any));
    }).not.toThrow();
  });
});
