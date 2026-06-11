/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for CreateTool component
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateTool } from "./CreateTool";

const {
  mockSetSelectedObject,
  mockSetActiveRightTab,
  mockCommitSpawnZone,
  mockGetAll,
  mockSetAll,
} = vi.hoisted(() => ({
  mockSetSelectedObject: vi.fn(),
  mockSetActiveRightTab: vi.fn(),
  mockCommitSpawnZone: vi.fn(),
  mockGetAll: vi.fn(() => new Map()),
  mockSetAll: vi.fn(),
}));

vi.mock("../../../store/viewerStore", () => ({
  useViewerStore: () => ({
    setSelectedObject: mockSetSelectedObject,
    setActiveRightTab: mockSetActiveRightTab,
    spawnZoneCreationPoints: [],
    commitSpawnZone: mockCommitSpawnZone,
    editingSpawnZone: false,
  }),
}));

vi.mock("../../../managers/panelManager", () => ({
  panelManager: {
    getAll: () => mockGetAll(),
    setAll: (panels: Map<number, unknown>) => mockSetAll(panels),
  },
}));

describe("CreateTool", () => {
  const onStartCreating = vi.fn();
  const onCancelCreating = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render create button with aria-label when not creating", () => {
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    const button = screen.getByRole("button", { name: /create new entity/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Create new entity");
  });

  it("should show cancel aria-label when in creation mode", () => {
    render(
      <CreateTool
        creatingEntityType="radioUnit"
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    const button = screen.getByRole("button", {
      name: /cancel entity creation/i,
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Cancel creation (Esc)");
  });

  it("should open dropdown when create button clicked and not creating", async () => {
    const user = userEvent.setup();
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /create new entity/i }),
    );

    expect(screen.getByText("Create New Entity")).toBeInTheDocument();
    expect(screen.getByText("Radio Unit")).toBeInTheDocument();
    expect(screen.getByText("Distributed Unit")).toBeInTheDocument();
    expect(screen.getByText("User Equipment")).toBeInTheDocument();
    expect(screen.getByText("Panel")).toBeInTheDocument();
    expect(screen.getByText("Spawn Zone")).toBeInTheDocument();
  });

  it("should call onStartCreating when selecting Radio Unit from dropdown", async () => {
    const user = userEvent.setup();
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /create new entity/i }),
    );
    await user.click(screen.getByText("Radio Unit"));

    expect(onStartCreating).toHaveBeenCalledWith("radioUnit");
  });

  it("should call onStartCreating when selecting Distributed Unit", async () => {
    const user = userEvent.setup();
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /create new entity/i }),
    );
    await user.click(screen.getByText("Distributed Unit"));

    expect(onStartCreating).toHaveBeenCalledWith("distributedUnit");
  });

  it("should call onStartCreating when selecting User Equipment", async () => {
    const user = userEvent.setup();
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /create new entity/i }),
    );
    await user.click(screen.getByText("User Equipment"));

    expect(onStartCreating).toHaveBeenCalledWith("userEquipment");
  });

  it("should call onStartCreating when selecting Spawn Zone", async () => {
    const user = userEvent.setup();
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /create new entity/i }),
    );
    await user.click(screen.getByText("Spawn Zone"));

    expect(onStartCreating).toHaveBeenCalledWith("spawnZone");
  });

  it("should create panel via panelManager when selecting Panel (no onStartCreating)", async () => {
    mockGetAll.mockReturnValue(new Map());
    const user = userEvent.setup();
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /create new entity/i }),
    );
    await user.click(screen.getByText("Panel"));

    expect(onStartCreating).not.toHaveBeenCalled();
    expect(mockSetAll).toHaveBeenCalled();
    const panels = mockSetAll.mock.calls[0][0];
    expect(panels).toBeInstanceOf(Map);
    expect(panels.get(1)).toMatchObject({
      id: 1,
      name: "panel_01",
      antennaNames: Array(4).fill("halfwave_dipole"),
      frequencies: [3600e6],
      referenceFreq: 3600e6,
    });
    expect(mockSetActiveRightTab).toHaveBeenCalledWith("Entities");
    // setSelectedObject is called in setTimeout(100); wait for it
    await vi.waitFor(() => {
      expect(mockSetSelectedObject).toHaveBeenCalledWith({ id: "panel-1" });
    });
  });

  it("should call onCancelCreating when cancel button clicked while creating", () => {
    render(
      <CreateTool
        creatingEntityType="radioUnit"
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /cancel entity creation/i }),
    );

    expect(onCancelCreating).toHaveBeenCalledTimes(1);
  });

  it("should show placement hint when creating radioUnit", () => {
    render(
      <CreateTool
        creatingEntityType="radioUnit"
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    expect(screen.getByText(/click to place/i)).toHaveTextContent(
      "Click to place Radio Unit",
    );
  });

  it("should show placement hint when creating distributedUnit", () => {
    render(
      <CreateTool
        creatingEntityType="distributedUnit"
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    expect(screen.getByText(/click to place/i)).toHaveTextContent(
      "Click to place Distributed Unit",
    );
  });

  it("should show placement hint when creating userEquipment", () => {
    render(
      <CreateTool
        creatingEntityType="userEquipment"
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    expect(screen.getByText(/click to place/i)).toHaveTextContent(
      "Click to place User Equipment",
    );
  });

  it("should call onCancelCreating on Escape key when creating", async () => {
    render(
      <CreateTool
        creatingEntityType="radioUnit"
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await userEvent.keyboard("{Escape}");

    expect(onCancelCreating).toHaveBeenCalledTimes(1);
  });

  it("should render tip about snapping in dropdown", async () => {
    const user = userEvent.setup();
    render(
      <CreateTool
        creatingEntityType={null}
        onStartCreating={onStartCreating}
        onCancelCreating={onCancelCreating}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /create new entity/i }),
    );

    expect(
      screen.getByText(/entities snap to building surfaces/i),
    ).toBeInTheDocument();
  });
});
