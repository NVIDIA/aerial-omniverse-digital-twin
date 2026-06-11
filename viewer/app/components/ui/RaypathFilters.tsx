/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from "react";
import { raypathManager } from "../../managers/raypathManager";
import type { RaypathFilterState } from "@/store/utils/localStorage";

interface RaypathFiltersProps {
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * Expand/collapse button for raypath filters
 * Renders inline with the Ray Paths label
 */
export const RaypathFilterToggle: React.FC<RaypathFiltersProps> = ({
  expanded,
  onToggleExpanded,
}) => {
  const [hasFilters, setHasFilters] = useState(false);

  useEffect(() => {
    const checkFilters = () => {
      const ruIds = raypathManager.getAvailableRuIds();
      const ueIds = raypathManager.getAvailableUeIds();
      setHasFilters(ruIds.length > 0 || ueIds.length > 0);
    };

    checkFilters();
    const unsubscribe = raypathManager.subscribe(checkFilters);
    return () => unsubscribe();
  }, []);

  if (!hasFilters) {
    return null;
  }

  return (
    <button
      onClick={onToggleExpanded}
      className="p-1 text-gray-400 hover:text-white transition-colors"
      title={expanded ? "Collapse filters" : "Expand filters"}
    >
      <svg
        className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
  );
};

/**
 * Raypath filter panel content
 * Renders the RU and UE filter buttons
 */
export const RaypathFilterPanel: React.FC = () => {
  // Initialize state with current values from manager to avoid empty state on remount
  const [availableRuIds, setAvailableRuIds] = useState<number[]>(() =>
    raypathManager.getAvailableRuIds(),
  );
  const [availableUeIds, setAvailableUeIds] = useState<number[]>(() =>
    raypathManager.getAvailableUeIds(),
  );
  const [filters, setFilters] = useState<RaypathFilterState>(() =>
    raypathManager.getFilters(),
  );

  useEffect(() => {
    const updateAvailableIds = () => {
      setAvailableRuIds(raypathManager.getAvailableRuIds());
      setAvailableUeIds(raypathManager.getAvailableUeIds());
    };

    const updateFilters = (newFilters: RaypathFilterState) => {
      setFilters(newFilters);
    };

    const unsubscribeRaypaths = raypathManager.subscribe(updateAvailableIds);
    const unsubscribeFilters = raypathManager.subscribeToFilters(updateFilters);

    return () => {
      unsubscribeRaypaths();
      unsubscribeFilters();
    };
  }, []);

  const handleToggleRu = useCallback((ruId: number) => {
    const isEnabled = raypathManager.isRuEnabled(ruId);
    raypathManager.setRuFilter(ruId, !isEnabled);
  }, []);

  const handleToggleUe = useCallback((ueId: number) => {
    const isEnabled = raypathManager.isUeEnabled(ueId);
    raypathManager.setUeFilter(ueId, !isEnabled);
  }, []);

  const handleToggleAllRu = useCallback(() => {
    const allEnabled =
      filters.allRuEnabled ||
      availableRuIds.every((id) => filters.enabledRuIds.includes(id));
    raypathManager.setAllRuEnabled(!allEnabled);
  }, [filters.allRuEnabled, filters.enabledRuIds, availableRuIds]);

  const handleToggleAllUe = useCallback(() => {
    const allEnabled =
      filters.allUeEnabled ||
      availableUeIds.every((id) => filters.enabledUeIds.includes(id));
    raypathManager.setAllUeEnabled(!allEnabled);
  }, [filters.allUeEnabled, filters.enabledUeIds, availableUeIds]);

  if (availableRuIds.length === 0 && availableUeIds.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-3">
      {/* RU Filters */}
      {availableRuIds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400 font-medium">
              Radio Units
            </span>
            <button
              onClick={handleToggleAllRu}
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              {filters.allRuEnabled ||
              availableRuIds.every((id) => filters.enabledRuIds.includes(id))
                ? "None"
                : "All"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {availableRuIds.map((ruId) => {
              const isEnabled = raypathManager.isRuEnabled(ruId);
              return (
                <button
                  key={`ru-${ruId}`}
                  onClick={() => handleToggleRu(ruId)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors cursor-pointer ${
                    isEnabled
                      ? "bg-red-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                  title={`RU ${ruId}: ${isEnabled ? "Click to hide" : "Click to show"}`}
                >
                  RU{ruId}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* UE Filters */}
      {availableUeIds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400 font-medium">
              User Equipment
            </span>
            <button
              onClick={handleToggleAllUe}
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              {filters.allUeEnabled ||
              availableUeIds.every((id) => filters.enabledUeIds.includes(id))
                ? "None"
                : "All"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {availableUeIds.map((ueId) => {
              const isEnabled = raypathManager.isUeEnabled(ueId);
              return (
                <button
                  key={`ue-${ueId}`}
                  onClick={() => handleToggleUe(ueId)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors cursor-pointer ${
                    isEnabled
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                  title={`UE ${ueId}: ${isEnabled ? "Click to hide" : "Click to show"}`}
                >
                  UE{ueId}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
