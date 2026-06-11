/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface ZoomButtonProps {
  onClick: (e: React.MouseEvent) => void;
  title: string;
}

export const ZoomButton: React.FC<ZoomButtonProps> = ({ onClick, title }) => {
  return (
    <button
      className="ml-2 text-gray-400 hover:text-[#76B900] transition-colors"
      onClick={onClick}
      title={title}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
        />
      </svg>
    </button>
  );
};
