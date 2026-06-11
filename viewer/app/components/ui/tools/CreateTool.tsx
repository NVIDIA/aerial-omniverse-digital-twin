/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import type { CreatableEntityType } from "../../../store/slices/objectSlice";
import {
  RadioUnitIcon,
  DistributedUnitIcon,
  UserEquipmentIcon,
  PanelIcon,
} from "@/constants/icons";
import { panelManager } from "../../../managers/panelManager";
import { useViewerStore } from "../../../store/viewerStore";

/**
 * Entity type configuration for the creation menu
 */
interface EntityTypeConfig {
  type: CreatableEntityType;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const ENTITY_TYPES: EntityTypeConfig[] = [
  {
    type: "radioUnit",
    label: "Radio Unit",
    icon: <RadioUnitIcon />,
    description: "Place a radio unit on rooftops or towers",
  },
  {
    type: "distributedUnit",
    label: "Distributed Unit",
    icon: <DistributedUnitIcon />,
    description: "Place a distributed unit in the scene",
  },
  {
    type: "userEquipment",
    label: "User Equipment",
    icon: <UserEquipmentIcon />,
    description: "Place user equipment in the scene",
  },
  {
    type: "panel",
    label: "Panel",
    icon: <PanelIcon />,
    description: "Create a new antenna panel",
  },
  {
    type: "spawnZone",
    label: "Spawn Zone",
    icon: <PanelIcon />,
    description: "Define a spawn area on the terrain",
  },
];

interface CreateToolProps {
  creatingEntityType: CreatableEntityType | null;
  onStartCreating: (entityType: CreatableEntityType) => void;
  onCancelCreating: () => void;
}

/**
 * Create Tool: Opens a dropdown to create new entities (Radio Units, UE, etc.)
 * Uses ghost preview with smart snapping to surfaces for precise placement.
 */
export const CreateTool: React.FC<CreateToolProps> = ({
  creatingEntityType,
  onStartCreating,
  onCancelCreating,
}) => {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    setSelectedObject,
    setActiveRightTab,
    spawnZoneCreationPoints,
    commitSpawnZone,
    editingSpawnZone,
    waypointEditingId,
    waypointEditingPoints,
    commitWaypoints,
  } = useViewerStore();

  const isCreating = creatingEntityType !== null;

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setCreateMenuOpen(false);
      }
    };

    if (createMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [createMenuOpen]);

  // Handle escape key to cancel creation mode
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && creatingEntityType) {
        onCancelCreating();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [creatingEntityType, onCancelCreating]);

  const handleEntityTypeSelect = (entityType: CreatableEntityType) => {
    // Handle panel creation immediately without entering creation mode
    if (entityType === "panel") {
      // Generate unique ID incrementally
      const panels = panelManager.getAll();
      const existingIds = Array.from(panels.keys());
      const newId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

      // Create a new panel with default values
      const newPanel = {
        id: newId,
        name: `panel_${String(newId).padStart(2, "0")}`,
        antennaNames: Array(4).fill("halfwave_dipole"),
        frequencies: [3600e6], // 3600 MHz default (3.6 GHz)
        referenceFreq: 3600e6,
        dualPolarized: 0,
        numLocAntennaHorz: 2,
        numLocAntennaVert: 2,
        antennaSpacingHorzCm: 4.6,
        antennaSpacingVertCm: 4.6,
        antennaRollAngleFirstPolz: 0,
        antennaRollAngleSecondPolz: Math.PI / 2,
      };

      // Add to panel manager
      const updatedPanels = new Map(panels);
      updatedPanels.set(newId, newPanel);
      panelManager.setAll(updatedPanels);

      // Close menu
      setCreateMenuOpen(false);

      // Switch to Entities tab first, then select the panel
      setActiveRightTab("Entities");
      setTimeout(() => {
        setSelectedObject({ id: `panel-${newId}` } as any);
      }, 100);

      return;
    }

    // For other entity types, enter creation mode
    onStartCreating(entityType);
    setCreateMenuOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => {
          if (isCreating) {
            onCancelCreating();
          } else {
            setCreateMenuOpen(!createMenuOpen);
          }
        }}
        className={`p-2 rounded transition-all flex items-center gap-1 ${
          isCreating
            ? "bg-emerald-600 text-white shadow-lg ring-2 ring-emerald-400/50"
            : createMenuOpen
              ? "bg-gray-700 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
        }`}
        title={isCreating ? "Cancel creation (Esc)" : "Create new entity"}
        aria-label={isCreating ? "Cancel entity creation" : "Create new entity"}
      >
        {isCreating ? (
          // X icon when in creation mode
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          // Plus icon when not in creation mode
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
              d="M12 4v16m8-8H4"
            />
          </svg>
        )}
        {!isCreating && (
          <svg
            className={`w-3 h-3 transition-transform ${
              createMenuOpen ? "rotate-180" : ""
            }`}
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
        )}
      </button>

      {/* Creation Mode Indicator - only show for entities that need placement */}
      {isCreating && creatingEntityType !== "panel" && (
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap">
          {creatingEntityType === "spawnZone" ? (
            <div className="flex items-center gap-2">
              <div className="bg-yellow-600 text-white text-xs px-2 py-1 rounded shadow-lg shrink-0">
                {editingSpawnZone
                  ? `Editing spawn zone (${spawnZoneCreationPoints.length} pts)`
                  : `Click terrain to add points (${spawnZoneCreationPoints.length})`}
              </div>
              <button
                onClick={() => {
                  commitSpawnZone();
                  setActiveRightTab("Entities");
                }}
                disabled={spawnZoneCreationPoints.length < 3}
                className={`text-xs px-3 py-1 rounded shadow-lg font-medium ${
                  spawnZoneCreationPoints.length >= 3
                    ? "bg-yellow-500 hover:bg-yellow-400 text-black"
                    : "bg-gray-600 text-gray-400 cursor-not-allowed"
                }`}
              >
                Done
              </button>
            </div>
          ) : (
            <div className="bg-emerald-600 text-white text-xs px-2 py-1 rounded shadow-lg">
              Click to place{" "}
              {creatingEntityType === "radioUnit"
                ? "Radio Unit"
                : creatingEntityType === "distributedUnit"
                  ? "Distributed Unit"
                  : "User Equipment"}
            </div>
          )}
        </div>
      )}

      {/* Dropdown Menu */}
      {createMenuOpen && !isCreating && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-gray-900/98 rounded-lg shadow-2xl border border-gray-700 overflow-hidden backdrop-blur-sm">
          <div className="px-3 py-2 border-b border-gray-700">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Create New Entity
            </h3>
          </div>
          <div className="py-1">
            {ENTITY_TYPES.map((entityConfig) => (
              <button
                key={entityConfig.type}
                data-testid={entityConfig.type}
                onClick={() => handleEntityTypeSelect(entityConfig.type)}
                className="w-full px-3 py-2 flex items-start gap-3 hover:bg-gray-800 transition-colors text-left group"
              >
                <div className="p-2 rounded bg-gray-800 text-gray-400 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  {entityConfig.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">
                    {entityConfig.label}
                  </div>
                  <div className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">
                    {entityConfig.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-gray-700 bg-gray-800/50">
            <p className="text-xs text-gray-500">
              <span className="text-emerald-400">Tip:</span> Entities snap to
              building surfaces
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
