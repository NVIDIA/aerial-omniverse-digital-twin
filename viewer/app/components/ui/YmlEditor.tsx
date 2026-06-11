/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import jsYaml from "js-yaml";
import { YML_STORAGE_UPDATED_EVENT } from "~/managers/ymlConfigLoader";

const LOCAL_STORAGE_KEY = "yml-editor-content";
const LOCAL_STORAGE_FILENAME_KEY = "yml-editor-filename";

/**
 * Load stored YML content from localStorage
 */
function loadFromStorage(): { content: string; filename: string } | null {
  try {
    const content = localStorage.getItem(LOCAL_STORAGE_KEY);
    const filename = localStorage.getItem(LOCAL_STORAGE_FILENAME_KEY);
    if (content) {
      return { content, filename: filename || "config.yml" };
    }
  } catch {
    // localStorage not available
  }
  return null;
}

/**
 * Save YML content to localStorage
 */
function saveToStorage(content: string, filename: string) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, content);
    localStorage.setItem(LOCAL_STORAGE_FILENAME_KEY, filename);
  } catch {
    // localStorage not available or full
  }
}

/**
 * Clear YML content from localStorage
 */
function clearStorage() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem(LOCAL_STORAGE_FILENAME_KEY);
  } catch {
    // localStorage not available
  }
}

/**
 * Check if a YML file exists in localStorage
 */
export function hasStoredYmlFile(): boolean {
  try {
    return !!localStorage.getItem(LOCAL_STORAGE_KEY);
  } catch {
    return false;
  }
}

/**
 * Get stored YML content from localStorage (if any)
 */
export function getStoredYmlContent(): string | null {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface YmlEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onFileChange?: (hasFile: boolean) => void;
  onConfigApply?: (content: string) => void;
}

export const YmlEditor: React.FC<YmlEditorProps> = ({
  isOpen,
  onClose,
  onFileChange,
  onConfigApply,
}) => {
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("config.yml");
  const [hasFile, setHasFile] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);

  // Load from localStorage on mount AND every time the editor is opened.
  // The component stays mounted (renders null when closed), so the [] effect
  // only fires once.  We also need to refresh when isOpen flips to true,
  // because entity-sync may have updated localStorage while the editor was
  // closed.  We skip the reload when there are unsaved edits so we don't
  // clobber them.
  useEffect(() => {
    if (!isOpen) return;
    // Always reload when opening — but only if the user hasn't made unsaved edits
    if (!isSaved) return;

    const stored = loadFromStorage();
    if (stored) {
      setContent(stored.content);
      setFilename(stored.filename);
      setHasFile(true);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload content when entities change outside the editor
  // (only when the editor is open and content is saved — don't overwrite unsaved edits)
  useEffect(() => {
    const handleExternalUpdate = () => {
      if (!isOpen) return;
      if (!isSaved) return; // don't clobber unsaved edits

      const stored = loadFromStorage();
      if (stored) {
        setContent(stored.content);
        setHasFile(true);
      }
    };

    window.addEventListener(YML_STORAGE_UPDATED_EVENT, handleExternalUpdate);
    return () =>
      window.removeEventListener(
        YML_STORAGE_UPDATED_EVENT,
        handleExternalUpdate,
      );
  }, [isOpen, isSaved]);

  // Validate YAML whenever content changes
  useEffect(() => {
    if (!content.trim()) {
      setValidationError(null);
      return;
    }
    try {
      jsYaml.load(content);
      setValidationError(null);
    } catch (e: any) {
      setValidationError(e.message || "Invalid YAML");
    }
  }, [content]);

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setContent(text);
        setFilename(file.name);
        setHasFile(true);
        setIsSaved(false);
        saveToStorage(text, file.name);
        setIsSaved(true);
        onFileChange?.(true);
        onConfigApply?.(text);
      };
      reader.readAsText(file);
    },
    [onFileChange, onConfigApply],
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      processFile(file);
      e.target.value = "";
    },
    [processFile],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      const name = file.name.toLowerCase();
      if (!name.endsWith(".yml") && !name.endsWith(".yaml")) return;

      processFile(file);
    },
    [processFile],
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      setIsSaved(false);
    },
    [],
  );

  const handleSave = useCallback(() => {
    saveToStorage(content, filename);
    setIsSaved(true);
  }, [content, filename]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, filename]);

  const handleClear = useCallback(() => {
    setContent("");
    setFilename("config.yml");
    setHasFile(false);
    setIsSaved(true);
    setValidationError(null);
    clearStorage();
    onFileChange?.(false);
  }, [onFileChange]);

  // Handle keyboard shortcut: Ctrl/Cmd+S to save
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleSave]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative w-[90vw] max-w-4xl h-[85vh] bg-gray-900 rounded-xl shadow-2xl border flex flex-col overflow-hidden transition-colors ${
          isDragging
            ? "border-[#76B900] ring-2 ring-[#76B900]/30"
            : "border-gray-700"
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-900/80">
          <div className="flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5 text-[#76B900]"
            >
              <path
                fillRule="evenodd"
                d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"
                clipRule="evenodd"
              />
            </svg>
            <h2 className="text-white font-semibold text-base">YML Editor</h2>
            {hasFile && (
              <span className="text-gray-400 text-sm font-mono">
                {filename}
                {!isSaved && (
                  <span
                    className="text-yellow-400 ml-1"
                    title="Unsaved changes"
                  >
                    *
                  </span>
                )}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
            title="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-800 bg-gray-900/50">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-md cursor-pointer transition-colors border border-gray-600 hover:border-gray-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
              <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
            </svg>
            Upload .yml
            <input
              type="file"
              accept=".yml,.yaml"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>

          {hasFile && (
            <>
              <button
                onClick={handleSave}
                disabled={isSaved}
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors border ${
                  isSaved
                    ? "bg-gray-800/50 text-gray-500 border-gray-700 cursor-default"
                    : "bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-600 hover:border-gray-500"
                }`}
                title="Save to browser storage (Ctrl+S)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path d="M13.75 7h-3v5.296l1.943-2.048a.75.75 0 011.114 1.004l-3.25 3.5a.75.75 0 01-1.114 0l-3.25-3.5a.75.75 0 111.114-1.004l1.943 2.048V7h1.5V1.75a.75.75 0 00-1.5 0V7h-3A2.25 2.25 0 004 9.25v7.5A2.25 2.25 0 006.25 19h7.5A2.25 2.25 0 0016 16.75v-7.5A2.25 2.25 0 0013.75 7z" />
                </svg>
                {isSaved ? "Saved" : "Save"}
              </button>

              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-md transition-colors border border-gray-600 hover:border-gray-500"
                title="Download file"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                  <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                </svg>
                Download
              </button>

              <div className="flex-1" />

              <button
                onClick={handleClear}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-red-900/50 text-gray-400 hover:text-red-300 text-sm rounded-md transition-colors border border-gray-700 hover:border-red-700"
                title="Remove file from storage"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                    clipRule="evenodd"
                  />
                </svg>
                Clear
              </button>
            </>
          )}
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {hasFile ? (
            <>
              {/* Line-numbered textarea */}
              <div className="flex-1 relative overflow-hidden">
                {isDragging && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10">
                    <p className="text-[#76B900] text-lg font-semibold">
                      Drop .yml file to replace
                    </p>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={handleContentChange}
                  spellCheck={false}
                  className="w-full h-full bg-gray-950 text-gray-100 font-mono text-sm leading-6 p-4 resize-none outline-none border-none placeholder:text-gray-600"
                  style={{ tabSize: 2 }}
                  placeholder="Paste or type YAML content here..."
                />
              </div>

              {/* Status bar */}
              <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-800 bg-gray-900/80 text-xs">
                <div className="flex items-center gap-4">
                  <span className="text-gray-500">
                    {content.split("\n").length} lines
                  </span>
                  <span className="text-gray-500">
                    {content.length} characters
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {validationError ? (
                    <span className="text-red-400 flex items-center gap-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="w-3.5 h-3.5"
                      >
                        <path
                          fillRule="evenodd"
                          d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 01-1.299 2.25H2.804a1.5 1.5 0 01-1.3-2.25l5.197-9zM8 4a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 4zm0 8a1 1 0 100-2 1 1 0 000 2z"
                          clipRule="evenodd"
                        />
                      </svg>
                      YAML Error: {validationError}
                    </span>
                  ) : content.trim() ? (
                    <span className="text-[#76B900] flex items-center gap-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="w-3.5 h-3.5"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Valid YAML
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4 relative">
              {isDragging && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10 rounded-b-xl">
                  <p className="text-[#76B900] text-lg font-semibold">
                    Drop .yml file here
                  </p>
                </div>
              )}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
                className="w-16 h-16 text-gray-700"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              <p className="text-sm">
                No file loaded. Upload a <code>.yml</code> file to get started.
              </p>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#76B900] hover:bg-[#6BA000] text-black font-semibold text-sm rounded-md cursor-pointer transition-colors">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
                  <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                </svg>
                Upload .yml file
                <input
                  type="file"
                  accept=".yml,.yaml"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
