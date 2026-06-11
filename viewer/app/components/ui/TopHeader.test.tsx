/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for TopHeader component - YML upload button behavior
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopHeader } from "./TopHeader";

// Mock LocationSearch to avoid its Zustand store dependency
vi.mock("./LocationSearch", () => ({
  LocationSearch: () => <div data-testid="location-search">Search</div>,
}));

// Mock ymlConfigLoader to avoid pulling in Cesium and all managers
vi.mock("~/managers/ymlConfigLoader", () => ({
  applyYmlConfig: vi.fn(() => ({
    distributedUnits: 0,
    panels: 0,
    radioUnits: 0,
    userEquipments: 0,
    scenarioUpdated: false,
    timeIndices: 0,
  })),
  clearAllEntities: vi.fn(),
  initEntitySync: vi.fn(),
  YML_STORAGE_UPDATED_EVENT: "yml-storage-updated",
}));

// Mock YmlEditor so we can control its behavior and avoid js-yaml import
vi.mock("./YmlEditor", () => {
  let fileChangeCallback: ((hasFile: boolean) => void) | undefined;

  return {
    hasStoredYmlFile: () => !!localStorage.getItem("yml-editor-content"),
    getStoredYmlContent: () => localStorage.getItem("yml-editor-content"),
    YmlEditor: ({
      isOpen,
      onClose,
      onFileChange,
      onConfigApply,
    }: {
      isOpen: boolean;
      onClose: () => void;
      onFileChange?: (hasFile: boolean) => void;
      onConfigApply?: (content: string) => void;
    }) => {
      // Capture callback for external triggering
      fileChangeCallback = onFileChange;

      if (!isOpen) return null;
      return (
        <div data-testid="yml-editor-modal">
          <button
            data-testid="mock-upload-trigger"
            onClick={() => {
              localStorage.setItem("yml-editor-content", "key: value");
              onFileChange?.(true);
              onConfigApply?.("key: value");
            }}
          >
            Mock Upload
          </button>
          <button
            data-testid="mock-clear-trigger"
            onClick={() => {
              localStorage.removeItem("yml-editor-content");
              onFileChange?.(false);
            }}
          >
            Mock Clear
          </button>
          <button data-testid="mock-close" onClick={onClose}>
            Close
          </button>
        </div>
      );
    },
  };
});

describe("TopHeader - YML Button", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("Initial state", () => {
    it('should show "Upload YML" when no file is stored', () => {
      render(<TopHeader />);

      const button = screen.getByText("Upload YML");
      expect(button).toBeInTheDocument();
      expect(
        screen.getByTitle("Upload a YML configuration file"),
      ).toBeInTheDocument();
    });

    it('should show "Edit YML" when a file exists in localStorage', () => {
      localStorage.setItem("yml-editor-content", "db:\n  name: test");

      render(<TopHeader />);

      // useEffect runs async, wait for it
      waitFor(() => {
        expect(screen.getByText("Edit YML")).toBeInTheDocument();
        expect(
          screen.getByTitle("Edit YML configuration file"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Cached config loading on mount", () => {
    it("should apply cached YML config on mount when file exists in localStorage", async () => {
      const { applyYmlConfig } = await import("~/managers/ymlConfigLoader");
      localStorage.setItem("yml-editor-content", "sim:\n  RUs:\n    add: []");

      render(<TopHeader />);

      await waitFor(() => {
        expect(applyYmlConfig).toHaveBeenCalledWith(
          "sim:\n  RUs:\n    add: []",
          { preferExistingMinioSettings: true },
        );
      });
    });

    it("should not call applyYmlConfig on mount when no cached file exists", async () => {
      const { applyYmlConfig } = await import("~/managers/ymlConfigLoader");
      (applyYmlConfig as ReturnType<typeof vi.fn>).mockClear();

      render(<TopHeader />);

      // Give the effect a tick to run
      await waitFor(() => {
        expect(screen.getByText("Upload YML")).toBeInTheDocument();
      });

      expect(applyYmlConfig).not.toHaveBeenCalled();
    });
  });

  describe("Button interaction", () => {
    it("should open the YML editor modal when clicked", async () => {
      const user = userEvent.setup();

      render(<TopHeader />);

      const button = screen.getByText("Upload YML");
      await user.click(button);

      expect(screen.getByTestId("yml-editor-modal")).toBeInTheDocument();
    });

    it("should close the YML editor modal when close is triggered", async () => {
      const user = userEvent.setup();

      render(<TopHeader />);

      // Open modal
      await user.click(screen.getByText("Upload YML"));
      expect(screen.getByTestId("yml-editor-modal")).toBeInTheDocument();

      // Close modal
      await user.click(screen.getByTestId("mock-close"));
      expect(screen.queryByTestId("yml-editor-modal")).not.toBeInTheDocument();
    });

    it("should re-apply YML config when editor is closed after content changed", async () => {
      const { applyYmlConfig } = await import("~/managers/ymlConfigLoader");
      (applyYmlConfig as ReturnType<typeof vi.fn>).mockClear();

      const user = userEvent.setup();
      render(<TopHeader />);

      // Open modal — snapshot captured as null (no file stored yet)
      await user.click(screen.getByText("Upload YML"));
      // Simulate a file being uploaded (changes localStorage + calls onFileChange)
      await user.click(screen.getByTestId("mock-upload-trigger"));
      (applyYmlConfig as ReturnType<typeof vi.fn>).mockClear();

      // Close the editor — content changed from snapshot, so config is re-applied
      await user.click(screen.getByTestId("mock-close"));

      // onClose defers via requestAnimationFrame; flush
      await waitFor(() => {
        expect(applyYmlConfig).toHaveBeenCalledWith("key: value");
      });
    });

    it("should clear all entities when editor is closed after file was cleared", async () => {
      const { clearAllEntities } = await import("~/managers/ymlConfigLoader");
      (clearAllEntities as ReturnType<typeof vi.fn>).mockClear();

      // Start with a stored file so the snapshot captures it on open
      localStorage.setItem("yml-editor-content", "key: value");

      const user = userEvent.setup();
      render(<TopHeader />);

      await waitFor(() => {
        expect(screen.getByText("Edit YML")).toBeInTheDocument();
      });
      (clearAllEntities as ReturnType<typeof vi.fn>).mockClear();

      // Open modal — snapshot is "key: value"
      await user.click(screen.getByText("Edit YML"));
      // Clear the file — removes localStorage + calls onFileChange(false)
      await user.click(screen.getByTestId("mock-clear-trigger"));
      // Close the editor — content changed (was "key: value", now null)
      await user.click(screen.getByTestId("mock-close"));

      // onClose defers via requestAnimationFrame; flush
      await waitFor(() => {
        expect(clearAllEntities).toHaveBeenCalled();
      });
    });
  });

  describe("Button label change on file change", () => {
    it('should switch to "Edit YML" after a file is uploaded', async () => {
      const user = userEvent.setup();

      render(<TopHeader />);

      // Initially shows Upload
      expect(screen.getByText("Upload YML")).toBeInTheDocument();

      // Open modal and trigger upload
      await user.click(screen.getByText("Upload YML"));
      await user.click(screen.getByTestId("mock-upload-trigger"));

      await waitFor(() => {
        expect(screen.getByText("Edit YML")).toBeInTheDocument();
      });
    });

    it('should switch back to "Upload YML" after file is cleared', async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", "key: value");

      render(<TopHeader />);

      await waitFor(() => {
        expect(screen.getByText("Edit YML")).toBeInTheDocument();
      });

      // Open modal and trigger clear
      await user.click(screen.getByText("Edit YML"));
      await user.click(screen.getByTestId("mock-clear-trigger"));

      await waitFor(() => {
        expect(screen.getByText("Upload YML")).toBeInTheDocument();
      });
    });
  });

  describe("Config apply on upload", () => {
    it("should call applyYmlConfig when a file is uploaded", async () => {
      const { applyYmlConfig } = await import("~/managers/ymlConfigLoader");
      const user = userEvent.setup();

      render(<TopHeader />);

      await user.click(screen.getByText("Upload YML"));
      await user.click(screen.getByTestId("mock-upload-trigger"));

      expect(applyYmlConfig).toHaveBeenCalledWith("key: value");
    });
  });

  describe("Entity sync initialization", () => {
    it("should call initEntitySync on mount", async () => {
      const { initEntitySync } = await import("~/managers/ymlConfigLoader");
      (initEntitySync as ReturnType<typeof vi.fn>).mockClear();

      render(<TopHeader />);

      await waitFor(() => {
        expect(initEntitySync).toHaveBeenCalled();
      });
    });

    it("should call initEntitySync even when no cached file exists", async () => {
      const { initEntitySync } = await import("~/managers/ymlConfigLoader");
      (initEntitySync as ReturnType<typeof vi.fn>).mockClear();

      // Ensure no cached file
      localStorage.clear();

      render(<TopHeader />);

      await waitFor(() => {
        expect(initEntitySync).toHaveBeenCalled();
      });
    });
  });

  describe("Other header elements", () => {
    it('should render the "Upload YML" button in the header actions', () => {
      render(<TopHeader />);

      const buttons = screen
        .getByText("Upload YML")
        .closest("div")!
        .querySelectorAll("button, a");
      const labels = Array.from(buttons).map((el) => el.textContent?.trim());

      expect(labels).toEqual(["Upload YML", "Material Assignment"]);
    });

    it("should render the NVIDIA branding", () => {
      render(<TopHeader />);
      expect(screen.getByText("Aerial Digital Twin")).toBeInTheDocument();
    });

    it("should render the location search", () => {
      render(<TopHeader />);
      expect(screen.getByTestId("location-search")).toBeInTheDocument();
    });
  });
});
