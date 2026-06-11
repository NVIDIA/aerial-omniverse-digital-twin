/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface RotateToolProps {
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Rotate Tool: When enabled with an RU selected, shows azimuth and tilt rings (gizmo)
 * and allows dragging to rotate the RU (updates orientation, mech_azimuth, mech_tilt).
 */
export const RotateTool: React.FC<RotateToolProps> = ({
  enabled,
  onToggle,
}) => {
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
          ? "Disable rotate tool"
          : "Enable rotate tool (show rings, drag to rotate RU)"
      }
      aria-label="Toggle rotate tool"
    >
      {/* Rotate icon: circular arrow */}
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
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
    </button>
  );
};
