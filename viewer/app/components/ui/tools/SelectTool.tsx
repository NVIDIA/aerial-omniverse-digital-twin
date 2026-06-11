/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface SelectToolProps {
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Select Tool: Enables building selection and hover highlighting
 * When enabled, hover over buildings to see blue highlights and click to select (green).
 */
export const SelectTool: React.FC<SelectToolProps> = ({
  enabled,
  onToggle,
}) => {
  return (
    <button
      onClick={onToggle}
      className={`p-2 rounded transition-all ${
        enabled
          ? "bg-blue-600 text-white shadow-lg"
          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
      }`}
      title={enabled ? "Disable select tool" : "Enable select tool"}
      aria-label="Toggle select tool"
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"
        />
      </svg>
    </button>
  );
};
