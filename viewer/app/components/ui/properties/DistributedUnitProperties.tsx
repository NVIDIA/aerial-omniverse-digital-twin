/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from "react";
import { useViewerStore } from "../../../store/viewerStore";
import * as Cesium from "cesium";
import { getEntityIdByType } from "@/services/cesium";
import { useDistributedUnits } from "@/hooks/entities";
import { distributedUnitManager } from "~/managers/distributedUnitManager";
import { duReferenceCarrierHz } from "@/utils/ruDuAutoAssign";

// DU FFT options: 2^8 to 2^12
const DU_FFT_OPTIONS = [256, 512, 1024, 2048, 4096];

// DU Subcarrier Spacing options in kHz: 15 * 2^k for k in range(7)
const DU_SCS_KHZ_OPTIONS = [15, 30, 60, 120, 240, 480, 960];

export const DistributedUnitProperties: React.FC = () => {
  const { selectedObject, setSelectedObject, zoomTo } = useViewerStore();

  const distributedUnits = useDistributedUnits();

  const itemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Extract distributed unit ID from selected object if it's a distributed unit entity
  const selectedDuId = getEntityIdByType(selectedObject, "du");

  // Scroll to selected item when it changes
  useEffect(() => {
    if (selectedDuId && itemRefs.current[selectedDuId]) {
      itemRefs.current[selectedDuId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedDuId]);

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
          <h3 className="text-md font-medium text-white">Distributed Units</h3>
        </div>
      </div>

      {/* Distributed Unit List */}
      <div className="space-y-1.5">
        {Array.from(distributedUnits.values()).map((du) => {
          const refCarrierHz = duReferenceCarrierHz(du);
          const refGhzDisplay = Number.isFinite(refCarrierHz)
            ? (refCarrierHz / 1e9).toFixed(2)
            : "0.00";

          return (
            <div
              key={du.id}
              ref={(el) => {
                itemRefs.current[du.id] = el;
              }}
              className={`px-2.5 py-2 rounded border ${
                selectedDuId === du.id
                  ? "border-[#76B900] bg-gray-800/60"
                  : "border-gray-800 bg-gray-800/40"
              }`}
            >
              {/* Distributed Unit Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    className="text-sm text-white font-medium hover:underline"
                    onClick={() =>
                      setSelectedObject(
                        selectedDuId === du.id ? null : `du-${du.id}`,
                      )
                    }
                  >
                    DU {du.id}
                  </button>
                  <button
                    className="text-xs text-gray-400 hover:text-[#76B900] transition-colors"
                    onClick={() => zoomTo(`du-${du.id}`)}
                    title="Zoom to distributed unit"
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
                  onClick={() => distributedUnitManager.remove(du.id)}
                >
                  Remove
                </button>
              </div>

              {/* Expanded Properties Editor */}
              {selectedDuId === du.id && (
                <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                  {/* Basic Info */}
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        ID
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                        value={du.id}
                        onChange={(e) =>
                          distributedUnitManager.update(du.id, {
                            id: Math.max(
                              0,
                              Math.min(10000, Number(e.target.value) || 0),
                            ),
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Technical Parameters */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Subcarrier Spacing [kHz]
                      </label>
                      <select
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                        value={du.subcarrierSpacing / 1000}
                        onChange={(e) =>
                          distributedUnitManager.update(du.id, {
                            subcarrierSpacing: parseInt(e.target.value) * 1000,
                          })
                        }
                      >
                        {DU_SCS_KHZ_OPTIONS.map((scs) => (
                          <option key={scs} value={scs}>
                            {scs}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        FFT Size
                      </label>
                      <select
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                        value={du.fftSize}
                        onChange={(e) =>
                          distributedUnitManager.update(du.id, {
                            fftSize: parseInt(e.target.value),
                          })
                        }
                      >
                        {DU_FFT_OPTIONS.map((fft) => (
                          <option key={fft} value={fft}>
                            {fft}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Reference Frequency (GHz)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                      value={refGhzDisplay}
                      onChange={(e) => {
                        const ghz = parseFloat(e.target.value) || 0;
                        distributedUnitManager.update(du.id, {
                          referenceFreq: ghz * 1000,
                        });
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Number of Antennas
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="64"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        value={du.numAntennas}
                        onChange={(e) =>
                          distributedUnitManager.update(du.id, {
                            numAntennas: Math.max(
                              1,
                              Math.min(64, parseInt(e.target.value) || 1),
                            ),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Max Channel BW [MHz]
                      </label>
                      <input
                        type="number"
                        disabled
                        className="w-full text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-400 font-mono cursor-not-allowed"
                        value={du.maxChannelBandwidth}
                        title="This RAN-specific field is currently read-only"
                      />
                    </div>
                  </div>

                  {/* Position */}
                  <div className="grid grid-cols-[2fr_2fr_1fr] gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Lat [°]
                      </label>
                      <input
                        key={du.position.cartographic.latitude}
                        type="number"
                        step="0.000001"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        defaultValue={Cesium.Math.toDegrees(
                          du.position.cartographic.latitude,
                        ).toFixed(6)}
                        onBlur={(e) =>
                          distributedUnitManager.update(du.id, {
                            position: {
                              ...du.position,
                              cartographic: new Cesium.Cartographic(
                                du.position.cartographic.longitude,
                                Cesium.Math.toRadians(
                                  Number(e.target.value) || 0,
                                ),
                                du.position.cartographic.height,
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
                        key={du.position.cartographic.longitude}
                        type="number"
                        step="0.000001"
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                        defaultValue={Cesium.Math.toDegrees(
                          du.position.cartographic.longitude,
                        ).toFixed(6)}
                        onBlur={(e) =>
                          distributedUnitManager.update(du.id, {
                            position: {
                              ...du.position,
                              cartographic: new Cesium.Cartographic(
                                Cesium.Math.toRadians(
                                  Number(e.target.value) || 0,
                                ),
                                du.position.cartographic.latitude,
                                du.position.cartographic.height,
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
                        value={du.position.cartographic.height.toFixed(1)}
                        onChange={(e) =>
                          distributedUnitManager.update(du.id, {
                            position: {
                              ...du.position,
                              cartographic: new Cesium.Cartographic(
                                du.position.cartographic.longitude,
                                du.position.cartographic.latitude,
                                Number(e.target.value) || 0,
                              ),
                            },
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
