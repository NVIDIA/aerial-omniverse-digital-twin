/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for YmlEditor component
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { YmlEditor, hasStoredYmlFile } from "./YmlEditor";
import { YML_STORAGE_UPDATED_EVENT } from "~/managers/ymlConfigLoader";

// Mock js-yaml
vi.mock("js-yaml", () => ({
  default: {
    load: (content: string) => {
      // Simulate basic YAML validation
      if (content.includes("{invalid yaml")) {
        throw new Error("bad indentation");
      }
      return { parsed: true };
    },
  },
}));

// Mock ymlConfigLoader to avoid pulling in Cesium
vi.mock("~/managers/ymlConfigLoader", () => ({
  YML_STORAGE_UPDATED_EVENT: "yml-storage-updated",
}));

const VALID_YAML = `db:
  db_name: test
  db_host: 10.0.0.1
`;

const INVALID_YAML = `{invalid yaml
  broken: [`;

/**
 * Helper to create a File object for upload testing
 */
function createYmlFile(content: string, name = "test.yml"): File {
  return new File([content], name, { type: "application/x-yaml" });
}

describe("hasStoredYmlFile", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should return false when no file is stored", () => {
    expect(hasStoredYmlFile()).toBe(false);
  });

  it("should return true when a file is stored", () => {
    localStorage.setItem("yml-editor-content", VALID_YAML);
    expect(hasStoredYmlFile()).toBe(true);
  });
});

describe("YmlEditor", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onFileChange: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should not render when isOpen is false", () => {
      render(<YmlEditor isOpen={false} onClose={vi.fn()} />);
      expect(screen.queryByText("YML Editor")).not.toBeInTheDocument();
    });

    it("should render the modal when isOpen is true", () => {
      render(<YmlEditor {...defaultProps} />);
      expect(screen.getByText("YML Editor")).toBeInTheDocument();
    });

    it("should show empty state when no file is loaded", () => {
      render(<YmlEditor {...defaultProps} />);
      expect(screen.getByText(/No file loaded/)).toBeInTheDocument();
      expect(screen.getByText("Upload .yml file")).toBeInTheDocument();
    });

    it("should show editor when a file is in localStorage", () => {
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "config.yml");

      render(<YmlEditor {...defaultProps} />);

      expect(screen.queryByText(/No YML file loaded/)).not.toBeInTheDocument();
      expect(screen.getByText("config.yml")).toBeInTheDocument();
    });
  });

  describe("File upload", () => {
    it("should display file content after upload", async () => {
      const user = userEvent.setup();
      render(<YmlEditor {...defaultProps} />);

      // The empty state has a file input
      const fileInputs = document.querySelectorAll('input[type="file"]');
      const file = createYmlFile(VALID_YAML, "my_config.yml");

      await user.upload(fileInputs[fileInputs.length - 1], file);

      await waitFor(() => {
        const textarea = screen.getByRole("textbox");
        expect(textarea).toHaveValue(VALID_YAML);
      });

      expect(screen.getByText("my_config.yml")).toBeInTheDocument();
    });

    it("should save uploaded file to localStorage", async () => {
      const user = userEvent.setup();
      render(<YmlEditor {...defaultProps} />);

      const fileInputs = document.querySelectorAll('input[type="file"]');
      const file = createYmlFile(VALID_YAML, "saved.yml");

      await user.upload(fileInputs[fileInputs.length - 1], file);

      await waitFor(() => {
        expect(localStorage.getItem("yml-editor-content")).toBe(VALID_YAML);
        expect(localStorage.getItem("yml-editor-filename")).toBe("saved.yml");
      });
    });

    it("should call onFileChange(true) after upload", async () => {
      const user = userEvent.setup();
      const onFileChange = vi.fn();
      render(
        <YmlEditor
          isOpen={true}
          onClose={vi.fn()}
          onFileChange={onFileChange}
        />,
      );

      const fileInputs = document.querySelectorAll('input[type="file"]');
      const file = createYmlFile(VALID_YAML);

      await user.upload(fileInputs[fileInputs.length - 1], file);

      await waitFor(() => {
        expect(onFileChange).toHaveBeenCalledWith(true);
      });
    });
  });

  describe("Editing", () => {
    it("should allow editing the YAML content", async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      const textarea = screen.getByRole("textbox");
      await user.click(textarea);
      await user.type(textarea, "\nnew_key: value");

      expect(textarea).toHaveValue(VALID_YAML + "\nnew_key: value");
    });

    it("should show unsaved indicator after editing", async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "x");

      expect(screen.getByTitle("Unsaved changes")).toBeInTheDocument();
    });
  });

  describe("YAML validation", () => {
    it("should show Valid YAML for valid content", async () => {
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Valid YAML")).toBeInTheDocument();
      });
    });

    it("should show YAML Error for invalid content", async () => {
      localStorage.setItem("yml-editor-content", INVALID_YAML);
      localStorage.setItem("yml-editor-filename", "broken.yml");

      render(<YmlEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/YAML Error/)).toBeInTheDocument();
      });
    });
  });

  describe("Save", () => {
    it("should save content to localStorage when Save is clicked", async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      // Edit content so Save becomes enabled
      const textarea = screen.getByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "key: newvalue");

      const saveButton = screen.getByTitle("Save to browser storage (Ctrl+S)");
      await user.click(saveButton);

      expect(localStorage.getItem("yml-editor-content")).toBe("key: newvalue");
    });

    it("should disable Save button when no unsaved changes", () => {
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      const saveButton = screen.getByTitle("Save to browser storage (Ctrl+S)");
      expect(saveButton).toBeDisabled();
    });
  });

  describe("Download", () => {
    it("should trigger a file download when Download is clicked", async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "download_me.yml");

      // Mock URL.createObjectURL and URL.revokeObjectURL
      const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
      const mockRevokeObjectURL = vi.fn();
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      render(<YmlEditor {...defaultProps} />);

      const downloadButton = screen.getByTitle("Download file");
      await user.click(downloadButton);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  describe("Clear", () => {
    it("should clear content and localStorage when Clear is clicked", async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      const clearButton = screen.getByTitle("Remove file from storage");
      await user.click(clearButton);

      expect(localStorage.getItem("yml-editor-content")).toBeNull();
      expect(localStorage.getItem("yml-editor-filename")).toBeNull();
      expect(screen.getByText(/No file loaded/)).toBeInTheDocument();
    });

    it("should call onFileChange(false) when Clear is clicked", async () => {
      const user = userEvent.setup();
      const onFileChange = vi.fn();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(
        <YmlEditor
          isOpen={true}
          onClose={vi.fn()}
          onFileChange={onFileChange}
        />,
      );

      const clearButton = screen.getByTitle("Remove file from storage");
      await user.click(clearButton);

      expect(onFileChange).toHaveBeenCalledWith(false);
    });
  });

  describe("Close", () => {
    it("should call onClose when the close button is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<YmlEditor isOpen={true} onClose={onClose} />);

      const closeButton = screen.getByTitle("Close");
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("should call onClose when the backdrop is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<YmlEditor isOpen={true} onClose={onClose} />);

      // The backdrop is the first child div with the bg-black/60 class
      const backdrop = document.querySelector(".backdrop-blur-sm");
      expect(backdrop).toBeInTheDocument();
      await user.click(backdrop!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Status bar", () => {
    it("should display line and character counts", () => {
      const threeLineYaml = "line1:\nline2:\nline3:";
      localStorage.setItem("yml-editor-content", threeLineYaml);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      expect(screen.getByText("3 lines")).toBeInTheDocument();
      expect(
        screen.getByText(`${threeLineYaml.length} characters`),
      ).toBeInTheDocument();
    });
  });

  describe("Reload on reopen", () => {
    it("should reload content from localStorage when isOpen changes from false to true", async () => {
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "original.yml");

      const { rerender } = render(
        <YmlEditor isOpen={true} onClose={vi.fn()} />,
      );

      // Verify initial content loaded
      await waitFor(() => {
        const textarea = screen.getByRole("textbox");
        expect(textarea).toHaveValue(VALID_YAML);
      });

      // Close the editor
      rerender(<YmlEditor isOpen={false} onClose={vi.fn()} />);

      // While closed, update localStorage (simulating a sync)
      const updatedYaml = "db:\n  db_name: updated\n  db_host: 10.0.0.2\n";
      localStorage.setItem("yml-editor-content", updatedYaml);
      localStorage.setItem("yml-editor-filename", "updated.yml");

      // Reopen the editor
      rerender(<YmlEditor isOpen={true} onClose={vi.fn()} />);

      // Should show the updated content
      await waitFor(() => {
        const textarea = screen.getByRole("textbox");
        expect(textarea).toHaveValue(updatedYaml);
      });
    });

    it("should NOT reload content when there are unsaved edits on reopen", async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      const { rerender } = render(
        <YmlEditor isOpen={true} onClose={vi.fn()} />,
      );

      // Make an edit (marks as unsaved)
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "x");

      // Close the editor
      rerender(<YmlEditor isOpen={false} onClose={vi.fn()} />);

      // Update localStorage
      localStorage.setItem(
        "yml-editor-content",
        "db:\n  db_name: external_change\n",
      );

      // Reopen the editor
      rerender(<YmlEditor isOpen={true} onClose={vi.fn()} />);

      // Content should still be the user's unsaved edit, not the external change
      await waitFor(() => {
        const textareaAfter = screen.getByRole("textbox");
        expect(textareaAfter).toHaveValue(VALID_YAML + "x");
      });
    });
  });

  describe("External update event", () => {
    it("should refresh content when YML_STORAGE_UPDATED_EVENT fires while open and saved", async () => {
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).toHaveValue(VALID_YAML);
      });

      // Update localStorage and fire the event
      const updatedYaml = "db:\n  db_name: synced\n";
      localStorage.setItem("yml-editor-content", updatedYaml);

      act(() => {
        window.dispatchEvent(new CustomEvent(YML_STORAGE_UPDATED_EVENT));
      });

      await waitFor(() => {
        expect(screen.getByRole("textbox")).toHaveValue(updatedYaml);
      });
    });

    it("should NOT refresh content when there are unsaved edits", async () => {
      const user = userEvent.setup();
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      render(<YmlEditor {...defaultProps} />);

      // Make an edit to mark as unsaved
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "z");

      // Update localStorage and fire the event
      localStorage.setItem(
        "yml-editor-content",
        "db:\n  db_name: should_not_show\n",
      );

      act(() => {
        window.dispatchEvent(new CustomEvent(YML_STORAGE_UPDATED_EVENT));
      });

      // Content should still be the user's unsaved edit
      await waitFor(() => {
        expect(screen.getByRole("textbox")).toHaveValue(VALID_YAML + "z");
      });
    });

    it("should NOT refresh content when the editor is closed", async () => {
      localStorage.setItem("yml-editor-content", VALID_YAML);
      localStorage.setItem("yml-editor-filename", "test.yml");

      const { rerender } = render(
        <YmlEditor isOpen={true} onClose={vi.fn()} />,
      );

      await waitFor(() => {
        expect(screen.getByRole("textbox")).toHaveValue(VALID_YAML);
      });

      // Close the editor
      rerender(<YmlEditor isOpen={false} onClose={vi.fn()} />);

      // Update localStorage and fire the event while closed
      localStorage.setItem(
        "yml-editor-content",
        "db:\n  db_name: closed_update\n",
      );

      act(() => {
        window.dispatchEvent(new CustomEvent(YML_STORAGE_UPDATED_EVENT));
      });

      // Reopen — should pick up the update from localStorage (via the reopen effect)
      rerender(<YmlEditor isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByRole("textbox")).toHaveValue(
          "db:\n  db_name: closed_update\n",
        );
      });
    });
  });
});
