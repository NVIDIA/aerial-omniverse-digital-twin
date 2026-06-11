/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for ObjectToolbar component and its tools integration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectToolbar } from "./ObjectToolbar";

const mockSetSelectToolEnabled = vi.fn();
const mockSetTransformTool = vi.fn();
const mockStartCreatingEntity = vi.fn();
const mockCancelCreatingEntity = vi.fn();

vi.mock("../../../store/viewerStore", () => ({
  useViewerStore: () => ({
    selectToolEnabled: true,
    setSelectToolEnabled: mockSetSelectToolEnabled,
    moveToolEnabled: false,
    rotateToolEnabled: false,
    setTransformTool: mockSetTransformTool,
    creatingEntityType: null,
    startCreatingEntity: mockStartCreatingEntity,
    cancelCreatingEntity: mockCancelCreatingEntity,
  }),
}));

// CreateTool uses viewerStore and panelManager; keep minimal for toolbar test
vi.mock("./CreateTool", () => ({
  CreateTool: ({
    creatingEntityType,
    onStartCreating,
    onCancelCreating,
  }: {
    creatingEntityType: string | null;
    onStartCreating: (t: string) => void;
    onCancelCreating: () => void;
  }) => (
    <div data-testid="create-tool">
      <button
        data-testid="create-tool-button"
        onClick={() =>
          creatingEntityType ? onCancelCreating() : onStartCreating("radioUnit")
        }
      >
        Create
      </button>
    </div>
  ),
}));

describe("ObjectToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render toolbar container with correct positioning", () => {
    const { container } = render(<ObjectToolbar />);

    const toolbar = container.querySelector('[style*="left"]');
    expect(toolbar).toBeInTheDocument();
    expect(toolbar).toHaveStyle({ left: "8px" });
  });

  it("should render SelectTool and toggle calls setSelectToolEnabled", async () => {
    const user = userEvent.setup();
    render(<ObjectToolbar />);

    const selectButton = screen.getByRole("button", {
      name: /toggle select tool/i,
    });
    expect(selectButton).toBeInTheDocument();

    await user.click(selectButton);
    expect(mockSetSelectToolEnabled).toHaveBeenCalledWith(false);
  });

  it("should render MoveTool and toggle calls setTransformTool", async () => {
    const user = userEvent.setup();
    render(<ObjectToolbar />);

    const moveButton = screen.getByRole("button", {
      name: /toggle move tool/i,
    });
    expect(moveButton).toBeInTheDocument();

    await user.click(moveButton);
    expect(mockSetTransformTool).toHaveBeenCalledWith("move");
  });

  it("should render RotateTool and toggle calls setTransformTool", async () => {
    const user = userEvent.setup();
    render(<ObjectToolbar />);

    const rotateButton = screen.getByRole("button", {
      name: /toggle rotate tool/i,
    });
    expect(rotateButton).toBeInTheDocument();

    await user.click(rotateButton);
    expect(mockSetTransformTool).toHaveBeenCalledWith("rotate");
  });

  it("should render CreateTool", () => {
    render(<ObjectToolbar />);

    expect(screen.getByTestId("create-tool")).toBeInTheDocument();
    expect(screen.getByTestId("create-tool-button")).toHaveTextContent(
      "Create",
    );
  });

  it("should render divider between transform tools and CreateTool", () => {
    render(<ObjectToolbar />);

    const divider = document.querySelector(".h-px.w-6.bg-gray-600");
    expect(divider).toBeInTheDocument();
  });

  it("should render all four tool buttons", () => {
    render(<ObjectToolbar />);

    const buttons = screen.getAllByRole("button");
    // Select, Move, Rotate, plus CreateTool's mock button
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it("should render with correct z-index and pointer events", () => {
    render(<ObjectToolbar />);

    const toolbar = document.querySelector(".absolute.z-10");
    expect(toolbar).toBeInTheDocument();
    expect(toolbar).toHaveStyle({ pointerEvents: "auto" });
  });
});
