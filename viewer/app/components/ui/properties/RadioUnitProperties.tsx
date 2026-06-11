/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useMemo } from "react";
import { useViewerStore } from "../../../store/viewerStore";
import * as Cesium from "cesium";
import { getEntityIdByType } from "@/services/cesium";
import { useRadioUnits, usePanels } from "@/hooks/entities";
import { radioUnitManager } from "~/managers/radioUnitManager";
import { normalizeRuPanelTypeKey } from "@/utils/ruDuAutoAssign";

export const RadioUnitProperties: React.FC = () => {
  const { selectedObject, setSelectedObject, zoomTo } = useViewerStore();

  const radioUnits = useRadioUnits();
  const panels = usePanels();

  const panelsSorted = useMemo(
    () => Array.from(panels.values()).sort((a, b) => a.id - b.id),
    [panels],
  );

  const itemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Extract radio unit ID from selected object if it's a radio unit entity
  const selectedRuId = getEntityIdByType(selectedObject, "ru");

  // Scroll to selected item when it changes
  useEffect(() => {
    if (selectedRuId && itemRefs.current[selectedRuId]) {
      itemRefs.current[selectedRuId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedRuId]);

  return (
    <div className="p-4 space-y-4">
      {/* Header with Back Button and Add Button */}
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
          <h3 className="text-md font-medium text-white">Radio Units</h3>
        </div>
      </div>

      {/* Radio Unit List */}
      <div className="space-y-1.5">
        {Array.from(radioUnits.values()).map((ru) => {
          const definedPanelNames = new Set(panelsSorted.map((p) => p.name));
          const panelTypeKey = normalizeRuPanelTypeKey(ru.panelType);
          const orphanPanelType =
            panelTypeKey && !definedPanelNames.has(panelTypeKey)
              ? panelTypeKey
              : null;

          return (
            <div
              key={ru.id}
              ref={(el) => {
                itemRefs.current[ru.id] = el;
              }}
              className={`px-2.5 py-2 rounded border ${
                selectedRuId === ru.id
                  ? "border-[#76B900] bg-gray-800/60"
                  : "border-gray-800 bg-gray-800/40"
              }`}
            >
              {/* Radio Unit Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    className="text-sm text-white font-medium hover:underline"
                    onClick={() =>
                      setSelectedObject(
                        selectedRuId === ru.id ? null : `ru-${ru.id}`,
                      )
                    }
                  >
                    RU {ru.id}
                  </button>
                  <button
                    className="text-xs text-gray-400 hover:text-[#76B900] transition-colors"
                    onClick={() => zoomTo(`ru-${ru.id}`)}
                    title="Zoom to radio unit"
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
                </div>
                <button
                  className="text-xs text-red-400 hover:text-red-300"
                  onClick={() => {
                    if (selectedRuId === ru.id) {
                      setSelectedObject(null);
                    }
                    radioUnitManager.remove(ru.id);
                  }}
                >
                  Remove
                </button>
              </div>

              {/* Expanded Properties Editor */}
              {selectedRuId === ru.id && (
                <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                  {/* Basic Info */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        ID
                      </label>
                      <input
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                        value={ru.id}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            id: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Cell ID
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                        value={ru.cellId}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            cellId: parseInt(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Rays
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          radioUnitManager.update(ru.id, {
                            enableRays: !ru.enableRays,
                          })
                        }
                        className={
                          "w-full h-7 rounded border border-gray-700 flex items-center justify-center font-medium text-xs transition-all cursor-pointer"
                        }
                      >
                        {ru.enableRays ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                  </div>

                  {/* Position */}
                  <div className="grid grid-cols-[2fr_2fr_1fr] gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Lat [°]
                      </label>
                      <input
                        key={ru.position.cartographic.latitude}
                        type="number"
                        step="0.000001"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        defaultValue={Cesium.Math.toDegrees(
                          ru.position.cartographic.latitude,
                        ).toFixed(6)}
                        onBlur={(e) =>
                          radioUnitManager.update(ru.id, {
                            position: {
                              ...ru.position,
                              cartographic: new Cesium.Cartographic(
                                ru.position.cartographic.longitude,
                                Cesium.Math.toRadians(
                                  Number(e.target.value) || 0,
                                ),
                                ru.position.cartographic.height,
                              ),
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Lon [°]
                      </label>
                      <input
                        key={ru.position.cartographic.longitude}
                        type="number"
                        step="0.000001"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        defaultValue={Cesium.Math.toDegrees(
                          ru.position.cartographic.longitude,
                        ).toFixed(6)}
                        onBlur={(e) =>
                          radioUnitManager.update(ru.id, {
                            position: {
                              ...ru.position,
                              cartographic: new Cesium.Cartographic(
                                Cesium.Math.toRadians(
                                  Number(e.target.value) || 0,
                                ),
                                ru.position.cartographic.latitude,
                                ru.position.cartographic.height,
                              ),
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Alt [m]
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        value={ru.position.cartographic.height.toFixed(1)}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            position: {
                              ...ru.position,
                              cartographic: new Cesium.Cartographic(
                                ru.position.cartographic.longitude,
                                ru.position.cartographic.latitude,
                                Number(e.target.value) || 0,
                              ),
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* DU Assignment */}
                  <div className="grid grid-cols-[1fr_2fr] gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        DU ID
                      </label>
                      <input
                        type="number"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                        value={ru.duId}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            duId: parseInt(e.target.value) || -1,
                          })
                        }
                        disabled={!ru.duManualAssign}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        DU Assignment
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          radioUnitManager.update(ru.id, {
                            duManualAssign: !ru.duManualAssign,
                          })
                        }
                        className={
                          "w-full h-7 rounded border border-gray-700 flex items-center justify-center font-medium text-xs transition-all cursor-pointer"
                        }
                      >
                        {ru.duManualAssign ? "Manual" : "Automatic"}
                      </button>
                    </div>
                  </div>

                  {/* Technical Parameters */}
                  <div className="grid grid-cols-[1fr_2fr] gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Panel Type
                      </label>
                      <select
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                        value={panelTypeKey}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            panelType: e.target.value,
                          })
                        }
                      >
                        {orphanPanelType && (
                          <option value={orphanPanelType}>
                            {orphanPanelType} (not in panel list)
                          </option>
                        )}
                        {panelsSorted.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                        {panelsSorted.length === 0 && !orphanPanelType && (
                          <option value="" disabled>
                            No panels — add under Entities
                          </option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Radiated Power [dBm]
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="-20"
                        max="80"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        value={ru.radiatedPower}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            radiatedPower: parseFloat(e.target.value) || 43.0,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Antenna Configuration */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Height [m]
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="100"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        value={ru.height}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            height: parseFloat(e.target.value) || 2.5,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Mechanical Azimuth [°]
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="360"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        value={ru.mechAzimuth}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            mechAzimuth: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Mechanical Tilt [°]
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="360"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        value={ru.mechTilt}
                        onChange={(e) =>
                          radioUnitManager.update(ru.id, {
                            mechTilt: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
