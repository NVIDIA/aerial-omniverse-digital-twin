/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from "react";
import { useViewerStore } from "../../../store/viewerStore";
import { usePanels } from "@/hooks/entities";
import { panelManager } from "~/managers/panelManager";
import { PanelLayoutVisualizer } from "./PanelLayoutVisualizer";
import { ANTENNA_TYPES } from "~/constants/antennaTypes";

export const PanelProperties: React.FC = () => {
  const { selectedObject, setSelectedObject } = useViewerStore();

  const panels = usePanels();

  const itemRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // Extract panel ID from selected object if it's a panel pseudo-entity
  const selectedPanelId = (selectedObject as any)?.id?.startsWith("panel-")
    ? parseInt((selectedObject as any).id.replace("panel-", ""))
    : null;

  // Scroll to selected item when it changes
  useEffect(() => {
    if (selectedPanelId && itemRefs.current[selectedPanelId]) {
      itemRefs.current[selectedPanelId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedPanelId]);

  return (
    <div className="p-4 space-y-4">
      {/* Header with Back Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="text-gray-400 hover:text-white transition-colors"
            onClick={() => setSelectedObject(null)}
            title="Back to entities list"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h3 className="text-md font-medium text-white">Panels</h3>
        </div>
      </div>

      {/* Panel List */}
      <div className="space-y-1.5">
        {Array.from(panels.values()).map((panel) => (
          <div
            key={panel.id}
            ref={(el) => {
              itemRefs.current[panel.id] = el;
            }}
            className={`px-2.5 py-2 rounded border ${
              selectedPanelId === panel.id
                ? "border-[#76B900] bg-gray-800/60"
                : "border-gray-800 bg-gray-800/40"
            }`}
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  className="text-sm text-white font-medium hover:underline"
                  onClick={() =>
                    setSelectedObject(
                      selectedPanelId === panel.id
                        ? null
                        : ({ id: `panel-${panel.id}` } as any),
                    )
                  }
                >
                  Panel {panel.id}
                </button>
                <button
                  className="text-xs text-red-400 hover:text-red-300"
                  onClick={() => {
                    if (selectedPanelId === panel.id) {
                      setSelectedObject(null);
                    }
                    panelManager.remove(panel.id);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Expanded Properties Editor */}
            {selectedPanelId === panel.id && (
              <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                {/* Panel Layout Visualizer */}
                <PanelLayoutVisualizer panel={panel} />

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Panel ID
                    </label>
                    <input
                      type="number"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                      value={panel.id}
                      onChange={(e) =>
                        panelManager.update(panel.id, {
                          id: parseInt(e.target.value) || panel.id,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="block text-xs text-gray-400 mb-1">
                      Polarization
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        panelManager.update(panel.id, {
                          dualPolarized: panel.dualPolarized === 2 ? 0 : 2,
                        })
                      }
                      className={
                        "w-full h-7 rounded border border-gray-700 flex items-center justify-center font-medium text-xs transition-all cursor-pointer mt-auto"
                      }
                    >
                      {panel.dualPolarized === 2 ? "Dual" : "Single"}
                    </button>
                  </div>
                </div>

                {/* Antenna Configuration */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Horz Antennas
                    </label>
                    <input
                      type="number"
                      min="1"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                      value={panel.numLocAntennaHorz}
                      onChange={(e) =>
                        panelManager.update(panel.id, {
                          numLocAntennaHorz: parseInt(e.target.value) || 1,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Vert Antennas
                    </label>
                    <input
                      type="number"
                      min="1"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                      value={panel.numLocAntennaVert}
                      onChange={(e) =>
                        panelManager.update(panel.id, {
                          numLocAntennaVert: parseInt(e.target.value) || 1,
                        })
                      }
                    />
                  </div>
                </div>

                {/* Antenna Spacing */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Horizontal Spacing (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                      value={panel.antennaSpacingHorzCm}
                      onChange={(e) =>
                        panelManager.update(panel.id, {
                          antennaSpacingHorzCm:
                            parseFloat(e.target.value) ||
                            panel.antennaSpacingHorzCm,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Vertical Spacing (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                      value={panel.antennaSpacingVertCm}
                      onChange={(e) =>
                        panelManager.update(panel.id, {
                          antennaSpacingVertCm:
                            parseFloat(e.target.value) ||
                            panel.antennaSpacingVertCm,
                        })
                      }
                    />
                  </div>
                </div>

                {/* Roll Angles */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Roll of 1st Pol. [°]
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                      value={(
                        panel.antennaRollAngleFirstPolz *
                        (180 / Math.PI)
                      ).toFixed(1)}
                      onChange={(e) =>
                        panelManager.update(panel.id, {
                          antennaRollAngleFirstPolz:
                            (parseFloat(e.target.value) || 0) * (Math.PI / 180),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Roll of 2nd Pol. [°]
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                      value={(
                        panel.antennaRollAngleSecondPolz *
                        (180 / Math.PI)
                      ).toFixed(1)}
                      onChange={(e) =>
                        panelManager.update(panel.id, {
                          antennaRollAngleSecondPolz:
                            (parseFloat(e.target.value) || 0) * (Math.PI / 180),
                        })
                      }
                    />
                  </div>
                </div>

                {/* Reference Frequency */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Reference Frequency (GHz)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                    value={(panel.referenceFreq / 1e9).toFixed(2)}
                    onChange={(e) =>
                      panelManager.update(panel.id, {
                        referenceFreq: (parseFloat(e.target.value) || 0) * 1e9,
                      })
                    }
                  />
                </div>

                {/* Antenna Type */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Antenna Type
                  </label>
                  <select
                    className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                    value={
                      panel.antennaNames.length > 0 &&
                      panel.antennaNames.every(
                        (name) => name === panel.antennaNames[0],
                      )
                        ? panel.antennaNames[0]
                        : ""
                    }
                    onChange={(e) => {
                      const selectedType = e.target.value;
                      const numElements =
                        panel.numLocAntennaHorz * panel.numLocAntennaVert;

                      // Create array of antenna names with the selected type
                      const antennaNames =
                        Array(numElements).fill(selectedType);

                      panelManager.update(panel.id, {
                        antennaNames,
                      });
                    }}
                  >
                    <option value="">Select antenna type...</option>
                    {ANTENNA_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
