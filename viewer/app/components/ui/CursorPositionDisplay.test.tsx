/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for CursorPositionDisplay component
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CursorPositionDisplay } from "./CursorPositionDisplay";

// Mock UI constants
vi.mock("../../constants/ui", () => ({
  UI_ELEMENT_OFFSET: 16,
}));

describe("CursorPositionDisplay", () => {
  const mockPosition = {
    latitude: 35.6624,
    longitude: 139.7437,
    altitude: 100.5,
  };

  it("should render nothing when not loaded", () => {
    const { container } = render(
      <CursorPositionDisplay cursorPosition={mockPosition} isLoaded={false} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when cursor position is null", () => {
    const { container } = render(
      <CursorPositionDisplay cursorPosition={null} isLoaded={true} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("should render position when loaded and position is available", () => {
    render(
      <CursorPositionDisplay cursorPosition={mockPosition} isLoaded={true} />,
    );

    expect(screen.getByText(/Lat: 35\.662400°/)).toBeInTheDocument();
    expect(screen.getByText(/Lng: 139\.743700°/)).toBeInTheDocument();
    expect(screen.getByText(/Alt: 100\.50 m/)).toBeInTheDocument();
  });

  it("should format latitude with 6 decimal places", () => {
    render(
      <CursorPositionDisplay cursorPosition={mockPosition} isLoaded={true} />,
    );

    const latText = screen.getByText(/Lat:/);
    expect(latText.textContent).toMatch(/35\.662400°/);
  });

  it("should format longitude with 6 decimal places", () => {
    render(
      <CursorPositionDisplay cursorPosition={mockPosition} isLoaded={true} />,
    );

    const lngText = screen.getByText(/Lng:/);
    expect(lngText.textContent).toMatch(/139\.743700°/);
  });

  it("should format altitude with 2 decimal places", () => {
    render(
      <CursorPositionDisplay cursorPosition={mockPosition} isLoaded={true} />,
    );

    const altText = screen.getByText(/Alt:/);
    expect(altText.textContent).toMatch(/100\.50 m/);
  });

  it("should handle negative coordinates", () => {
    const negativePosition = {
      latitude: -35.6624,
      longitude: -139.7437,
      altitude: -50.25,
    };

    render(
      <CursorPositionDisplay
        cursorPosition={negativePosition}
        isLoaded={true}
      />,
    );

    expect(screen.getByText(/Lat: -35\.662400°/)).toBeInTheDocument();
    expect(screen.getByText(/Lng: -139\.743700°/)).toBeInTheDocument();
    expect(screen.getByText(/Alt: -50\.25 m/)).toBeInTheDocument();
  });

  it("should handle zero coordinates", () => {
    const zeroPosition = {
      latitude: 0,
      longitude: 0,
      altitude: 0,
    };

    render(
      <CursorPositionDisplay cursorPosition={zeroPosition} isLoaded={true} />,
    );

    expect(screen.getByText(/Lat: 0\.000000°/)).toBeInTheDocument();
    expect(screen.getByText(/Lng: 0\.000000°/)).toBeInTheDocument();
    expect(screen.getByText(/Alt: 0\.00 m/)).toBeInTheDocument();
  });

  it("should have correct styling classes", () => {
    const { container } = render(
      <CursorPositionDisplay cursorPosition={mockPosition} isLoaded={true} />,
    );

    const displayDiv = container.firstChild as HTMLElement;
    expect(displayDiv).toHaveClass("absolute", "bottom-2", "bg-black/70");
    expect(displayDiv).toHaveClass("pointer-events-none");
  });
});
