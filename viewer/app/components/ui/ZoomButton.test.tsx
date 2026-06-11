/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for ZoomButton component
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ZoomButton } from "./ZoomButton";

describe("ZoomButton", () => {
  it("should render button with title", () => {
    const mockOnClick = vi.fn();

    render(<ZoomButton onClick={mockOnClick} title="Zoom to location" />);

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Zoom to location");
  });

  it("should call onClick when clicked", async () => {
    const user = userEvent.setup();
    const mockOnClick = vi.fn();

    render(<ZoomButton onClick={mockOnClick} title="Zoom" />);

    const button = screen.getByRole("button");
    await user.click(button);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it("should render SVG icon", () => {
    const mockOnClick = vi.fn();

    render(<ZoomButton onClick={mockOnClick} title="Zoom" />);

    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("w-4", "h-4");
  });

  it("should have hover styles", () => {
    const mockOnClick = vi.fn();

    render(<ZoomButton onClick={mockOnClick} title="Zoom" />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("hover:text-[#76B900]");
  });

  it("should pass mouse event to onClick handler", async () => {
    const user = userEvent.setup();
    const mockOnClick = vi.fn();

    render(<ZoomButton onClick={mockOnClick} title="Zoom" />);

    const button = screen.getByRole("button");
    await user.click(button);

    expect(mockOnClick).toHaveBeenCalled();
    const callArgs = mockOnClick.mock.calls[0];
    expect(callArgs[0]).toBeDefined();
  });
});
