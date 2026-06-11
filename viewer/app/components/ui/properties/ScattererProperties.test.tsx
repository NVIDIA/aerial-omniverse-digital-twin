/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for ScattererProperties component
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ScattererProperties,
  SCATTERERS_LIST_VIEW,
} from "./ScattererProperties";
import { useScatterers } from "@/hooks/entities";
import { getEntityIdByType } from "@/services/cesium";

const mockSetSelectedObject = vi.hoisted(() => vi.fn());
const mockZoomTo = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());

vi.mock("../../../store/viewerStore", () => ({
  useViewerStore: () => ({
    selectedObject: null,
    setSelectedObject: mockSetSelectedObject,
    zoomTo: mockZoomTo,
  }),
}));

vi.mock("@/hooks/entities", () => ({
  useScatterers: vi.fn(() => new Map()),
}));

vi.mock("@/services/cesium", () => ({
  getEntityIdByType: vi.fn(() => null),
}));

vi.mock("~/managers/scattererManager", () => ({
  scattererManager: {
    remove: mockRemove,
  },
}));

describe("ScattererProperties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useScatterers).mockReturnValue(new Map());
    vi.mocked(getEntityIdByType).mockReturnValue(null);
  });

  describe("SCATTERERS_LIST_VIEW", () => {
    it("should export sentinel with id scatterers-list", () => {
      expect(SCATTERERS_LIST_VIEW).toEqual({ id: "scatterers-list" });
      expect(SCATTERERS_LIST_VIEW.id).toBe("scatterers-list");
    });
  });

  describe("render", () => {
    it("should render Dynamic Scatterers header", () => {
      render(<ScattererProperties />);
      expect(
        screen.getByRole("heading", { name: /dynamic scatterers/i }),
      ).toBeInTheDocument();
    });

    it("should show empty state when no scatterers", () => {
      render(<ScattererProperties />);
      expect(screen.getByText(/no scatterers loaded yet/i)).toBeInTheDocument();
    });

    it("should list scatterers and show Remove button for each", () => {
      const scattererMap = new Map([
        [
          1,
          {
            id: 1,
            isIndoor: false,
            positions: [],
            orientations: [],
          },
        ],
        [
          2,
          {
            id: 2,
            isIndoor: true,
            positions: [],
            orientations: [],
          },
        ],
      ]);
      vi.mocked(useScatterers).mockReturnValue(scattererMap);

      render(<ScattererProperties />);

      expect(screen.getByText("Scatterer 1")).toBeInTheDocument();
      expect(screen.getByText("Scatterer 2")).toBeInTheDocument();

      const removeButtons = screen.getAllByRole("button", { name: /remove/i });
      expect(removeButtons).toHaveLength(2);
    });
  });

  describe("Remove button", () => {
    it("should call scattererManager.remove with scatterer id when Remove is clicked", async () => {
      const user = userEvent.setup();
      const scattererMap = new Map([
        [
          42,
          {
            id: 42,
            isIndoor: false,
            positions: [],
            orientations: [],
          },
        ],
      ]);
      vi.mocked(useScatterers).mockReturnValue(scattererMap);

      render(<ScattererProperties />);

      const removeButton = screen.getByRole("button", { name: /remove/i });
      await user.click(removeButton);

      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith(42);
    });

    it("should call setSelectedObject(SCATTERERS_LIST_VIEW) when removing the selected scatterer", async () => {
      const user = userEvent.setup();
      const scattererMap = new Map([
        [
          1,
          {
            id: 1,
            isIndoor: false,
            positions: [],
            orientations: [],
          },
        ],
      ]);
      vi.mocked(useScatterers).mockReturnValue(scattererMap);
      vi.mocked(getEntityIdByType).mockReturnValue(1);

      render(<ScattererProperties />);

      const removeButton = screen.getByRole("button", { name: /remove/i });
      await user.click(removeButton);

      expect(mockRemove).toHaveBeenCalledWith(1);
      expect(mockSetSelectedObject).toHaveBeenCalledWith(SCATTERERS_LIST_VIEW);
    });

    it("should not call setSelectedObject when removing a non-selected scatterer", async () => {
      const user = userEvent.setup();
      const scattererMap = new Map([
        [
          1,
          {
            id: 1,
            isIndoor: false,
            positions: [],
            orientations: [],
          },
        ],
        [
          2,
          {
            id: 2,
            isIndoor: false,
            positions: [],
            orientations: [],
          },
        ],
      ]);
      vi.mocked(useScatterers).mockReturnValue(scattererMap);
      vi.mocked(getEntityIdByType).mockReturnValue(2);

      render(<ScattererProperties />);

      const removeButtons = screen.getAllByRole("button", { name: /remove/i });
      await user.click(removeButtons[0]);

      expect(mockRemove).toHaveBeenCalledWith(1);
      expect(mockSetSelectedObject).not.toHaveBeenCalled();
    });
  });
});
