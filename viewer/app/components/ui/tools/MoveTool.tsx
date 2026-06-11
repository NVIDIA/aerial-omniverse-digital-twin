/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface MoveToolProps {
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Move Tool: When enabled with an entity selected, shows axis arrows (gizmo)
 * and allows dragging to move the object (Blender-style translate).
 */
export const MoveTool: React.FC<MoveToolProps> = ({ enabled, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      className={`p-2 rounded transition-all ${
        enabled
          ? "bg-amber-600 text-white shadow-lg"
          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
      }`}
      title={
        enabled
          ? "Disable move tool"
          : "Enable move tool (show arrows, drag to move)"
      }
      aria-label="Toggle move tool"
    >
      {/* Move/translate icon: cross arrows (Blender G-style) */}
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
          d="M5 19L19 5M19 5h-6m6 0v6M5 19h6m-6 0v-6"
        />
      </svg>
    </button>
  );
};
