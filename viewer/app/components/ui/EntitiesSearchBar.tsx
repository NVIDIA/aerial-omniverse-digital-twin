/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { useViewerStore } from "../../store/viewerStore";
import {
  useRadioUnits,
  useScatterers,
  useUserEquipments,
  usePanels,
} from "@/hooks/entities";
import {
  RadioUnitIcon,
  UserEquipmentIcon,
  ScattererIcon,
  PanelIcon,
} from "@/constants/icons";

interface SearchResult {
  id: string;
  type: "radioUnit" | "userEquipment" | "scatterer" | "panel";
  label: string;
  entityId: string | number;
}

export const EntitiesSearchBar: React.FC = () => {
  const { setSelectedObject } = useViewerStore();

  // Use manager hooks for entity data
  const radioUnits = useRadioUnits();
  const scatterers = useScatterers();
  const userEquipments = useUserEquipments();
  const panels = usePanels();

  const [searchQuery, setSearchQuery] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Build search results from all entities
  const getSearchResults = (): SearchResult[] => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    // Search Radio Units (matches "RU" or "Radio Unit")
    const ruAliases = ["ru", "radio unit", "radiounit"];
    for (const id of radioUnits.keys()) {
      const label = `RU ${id}`;
      const matchesLabel = label.toLowerCase().includes(query);
      const matchesAlias = ruAliases.some((alias) => alias.includes(query));
      if (matchesLabel || matchesAlias) {
        results.push({
          id: `ru-${id}`,
          type: "radioUnit",
          label,
          entityId: id,
        });
      }
    }

    // Search User Equipments (matches "UE" or "User Equipment")
    const ueAliases = ["ue", "user equipment", "userequipment"];
    for (const id of userEquipments.keys()) {
      const label = `UE ${id}`;
      const matchesLabel = label.toLowerCase().includes(query);
      const matchesAlias = ueAliases.some((alias) => alias.includes(query));
      if (matchesLabel || matchesAlias) {
        results.push({
          id: `ue-${id}`,
          type: "userEquipment",
          label,
          entityId: id,
        });
      }
    }

    // Search Scatterers
    for (const id of scatterers.keys()) {
      const label = `Scatterer ${id}`;
      if (label.toLowerCase().includes(query)) {
        results.push({
          id: `scatterer-${id}`,
          type: "scatterer",
          label,
          entityId: id,
        });
      }
    }

    // Search Panels
    panels.forEach((panel) => {
      const labelById = `Panel ${panel.id}`;
      if (labelById.toLowerCase().includes(query)) {
        results.push({
          id: `panel-${panel.id}`,
          type: "panel",
          label: `Panel ${panel.id}`,
          entityId: panel.id,
        });
      }
    });

    return results.slice(0, 10); // Limit to 10 results
  };

  const searchResults = getSearchResults();

  const handleSelectResult = (result: SearchResult) => {
    if (result.type === "panel") {
      setSelectedObject({ id: result.id } as any);
    } else {
      setSelectedObject(result.id);
    }
    setSearchQuery("");
    setShowAutocomplete(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showAutocomplete || searchResults.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < searchResults.length - 1 ? prev + 1 : 0,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : searchResults.length - 1,
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
          handleSelectResult(searchResults[highlightedIndex]);
        }
        break;
      case "Escape":
        setShowAutocomplete(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 p-4">
      <div className="relative">
        <div className="relative">
          <input
            type="text"
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowAutocomplete(true);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setShowAutocomplete(true)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Delay to allow clicking on results
              setTimeout(() => setShowAutocomplete(false), 200);
            }}
            className="w-full px-3 py-2 pl-9 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#76B900] placeholder-gray-500"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Autocomplete Dropdown */}
        {showAutocomplete && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg max-h-64 overflow-y-auto z-20">
            {searchResults.map((result, index) => (
              <div
                key={result.id}
                className={`px-3 py-2 cursor-pointer transition-colors flex items-center justify-between group ${
                  index === highlightedIndex
                    ? "bg-gray-700"
                    : "hover:bg-gray-700"
                }`}
                onMouseDown={() => handleSelectResult(result)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <div className="flex items-center gap-2">
                  {result.type === "radioUnit" && (
                    <RadioUnitIcon className="w-4 h-4 text-gray-400" />
                  )}
                  {result.type === "userEquipment" && (
                    <UserEquipmentIcon className="w-4 h-4 text-gray-400" />
                  )}
                  {result.type === "scatterer" && (
                    <ScattererIcon className="w-4 h-4 text-gray-400" />
                  )}
                  {result.type === "panel" && (
                    <PanelIcon className="w-4 h-4 text-gray-400" />
                  )}
                  <span className="text-sm text-white">{result.label}</span>
                </div>
                <span className="text-xs text-gray-400 capitalize">
                  {result.type === "radioUnit" && "Radio Unit"}
                  {result.type === "userEquipment" && "User Equipment"}
                  {result.type === "scatterer" && "Scatterer"}
                  {result.type === "panel" && "Panel"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
