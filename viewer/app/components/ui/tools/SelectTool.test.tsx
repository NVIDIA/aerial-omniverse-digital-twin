/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for SelectTool component
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectTool } from "./SelectTool";

describe("SelectTool", () => {
  it("should render button with aria-label", () => {
    const onToggle = vi.fn();
    render(<SelectTool enabled={false} onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: /toggle select tool/i });
    expect(button).toBeInTheDocument();
  });

  it("should show enable title when disabled", () => {
    const onToggle = vi.fn();
    render(<SelectTool enabled={false} onToggle={onToggle} />);

    expect(screen.getByTitle("Enable select tool")).toBeInTheDocument();
  });

  it("should show disable title when enabled", () => {
    const onToggle = vi.fn();
    render(<SelectTool enabled={true} onToggle={onToggle} />);

    expect(screen.getByTitle("Disable select tool")).toBeInTheDocument();
  });

  it("should apply enabled styles when enabled", () => {
    const onToggle = vi.fn();
    render(<SelectTool enabled={true} onToggle={onToggle} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("bg-blue-600", "text-white");
  });

  it("should apply disabled styles when disabled", () => {
    const onToggle = vi.fn();
    render(<SelectTool enabled={false} onToggle={onToggle} />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("bg-gray-800", "text-gray-400");
  });

  it("should call onToggle when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<SelectTool enabled={false} onToggle={onToggle} />);

    await user.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("should render SVG icon", () => {
    const onToggle = vi.fn();
    render(<SelectTool enabled={false} onToggle={onToggle} />);

    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("w-5", "h-5");
  });
});
