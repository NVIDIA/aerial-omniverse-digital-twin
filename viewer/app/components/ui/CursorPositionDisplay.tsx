/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { UI_ELEMENT_OFFSET } from "../../constants/ui";

interface CursorPositionDisplayProps {
  cursorPosition: {
    longitude: number;
    latitude: number;
    altitude: number;
  } | null;
  isLoaded: boolean;
}

/**
 * Displays the current cursor position in geographic coordinates
 * Shows latitude, longitude, and altitude when hovering over the map
 */
export const CursorPositionDisplay: React.FC<CursorPositionDisplayProps> = ({
  cursorPosition,
  isLoaded,
}) => {
  if (!isLoaded || !cursorPosition) {
    return null;
  }

  return (
    <div
      className="absolute bottom-2 bg-black/70 text-white px-3 py-2 rounded text-xs font-mono pointer-events-none z-20 shadow-lg transition-all"
      style={{
        right: `${UI_ELEMENT_OFFSET}px`,
      }}
    >
      <div className="flex flex-col gap-0.5">
        <div>Lat: {cursorPosition.latitude.toFixed(6)}°</div>
        <div>Lng: {cursorPosition.longitude.toFixed(6)}°</div>
        <div>Alt: {cursorPosition.altitude.toFixed(2)} m</div>
      </div>
    </div>
  );
};
