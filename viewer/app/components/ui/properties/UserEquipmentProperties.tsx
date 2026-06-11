/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { useViewerStore } from "../../../store/viewerStore";
import type { TimeIndexedPosition, Waypoint } from "../../../store/types";
import * as Cesium from "cesium";
import { getEntityIdByType } from "@/services/cesium";
import { usePanels, useUserEquipments } from "@/hooks/entities";
import { userEquipmentManager } from "~/managers/userEquipmentManager";

export const UserEquipmentProperties: React.FC = () => {
  const {
    selectedObject,
    setSelectedObject,
    zoomTo,
    startEditingWaypoints,
    waypointEditingId,
    commitWaypoints,
    cancelWaypoints,
  } = useViewerStore();

  const userEquipments = useUserEquipments();
  const panels = usePanels();
  const panelOptions = Array.from(panels.values()).sort((a, b) => a.id - b.id);

  const [positionDataMap, setPositionDataMap] = useState<
    Map<number, TimeIndexedPosition[]>
  >(new Map());
  const itemRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // Pagination state per UE
  const [paginationState, setPaginationState] = useState<
    Map<number, { currentPage: number; itemsPerPage: number }>
  >(new Map());

  const ITEMS_PER_PAGE_OPTIONS = [25, 50, 100, 250, 500];
  const DEFAULT_ITEMS_PER_PAGE = 50;

  // Extract UE ID from selected object if it's a UE entity
  const selectedUEId = getEntityIdByType(selectedObject, "ue");

  // Load position data for all user equipments when component mounts
  useEffect(() => {
    const dataMap = new Map<number, TimeIndexedPosition[]>();
    for (const [ueId, ue] of userEquipments.entries()) {
      dataMap.set(ueId, ue.positions);
    }
    setPositionDataMap(dataMap);
  }, [userEquipments]);

  // Scroll to selected item when it changes
  useEffect(() => {
    if (selectedUEId && itemRefs.current[selectedUEId]) {
      itemRefs.current[selectedUEId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedUEId]);

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
          <h3 className="text-md font-medium text-white">User Equipment</h3>
        </div>
      </div>

      {/* User Equipment List */}
      <div className="space-y-1.5">
        {userEquipments.size === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            <svg
              className="w-12 h-auto mx-auto mb-3 opacity-50"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M17 8h-1V6c0-2.76-2.24-5-5-5S6 3.24 6 6v2H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
            </svg>
            <p>No user equipment loaded yet</p>
          </div>
        ) : (
          Array.from(userEquipments.values()).map((ue) => {
            const isSelected = selectedUEId === ue.id;
            const positions = positionDataMap.get(ue.id) || [];
            const waypoints = userEquipmentManager.getWaypoints(ue.id) || [];

            return (
              <div
                key={ue.id}
                ref={(el) => {
                  itemRefs.current[ue.id] = el;
                }}
                className={`px-2.5 py-2 rounded border ${
                  isSelected
                    ? "border-[#76B900] bg-gray-800/60"
                    : "border-gray-800 bg-gray-800/40"
                }`}
              >
                {/* UE Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      className="text-sm text-white font-medium hover:underline"
                      onClick={() =>
                        setSelectedObject(
                          selectedUEId === ue.id ? null : `ue-${ue.id}`,
                        )
                      }
                    >
                      UE {ue.id}
                    </button>
                    <button
                      className="text-xs text-gray-400 hover:text-[#76B900] transition-colors"
                      onClick={() => zoomTo(`ue-${ue.id}`)}
                      title={`Zoom to UE ${ue.id}`}
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
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        ue.isManual
                          ? "bg-purple-900/30 text-purple-300"
                          : "bg-blue-900/30 text-blue-300"
                      }`}
                    >
                      {ue.isManual ? "Manual" : "Procedural"}
                    </span>
                    {ue.isManualMobility && (
                      <span className="px-2 py-0.5 text-xs rounded bg-green-900/30 text-green-300">
                        Manual Mobility
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        ue.isIndoorMobility
                          ? "bg-indigo-900/30 text-indigo-300"
                          : "bg-teal-900/30 text-teal-300"
                      }`}
                    >
                      {ue.isIndoorMobility ? "Indoor" : "Outdoor"}
                    </span>
                    <button
                      className="text-xs text-red-400 hover:text-red-300"
                      onClick={() => userEquipmentManager.remove(ue.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* Expanded Details - shown only when selected */}
                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                    {/* ID and Panel Configuration */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          ID
                        </label>
                        <div className="text-white font-mono text-xs bg-gray-800 px-2 py-1 rounded">
                          {ue.id}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Panel Type
                        </label>
                        <select
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                          value={String(ue.panel[0] ?? "")}
                          onChange={(e) =>
                            userEquipmentManager.update(ue.id, {
                              panel: [Number(e.target.value)],
                            })
                          }
                        >
                          {panelOptions.map((panel) => (
                            <option key={panel.id} value={panel.id}>
                              {String(panel.id).padStart(2, "0")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Position (first position only) */}
                    {positions.length > 0 && (
                      <div className="grid grid-cols-[2fr_2fr_1fr] gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Lat [°]
                          </label>
                          <input
                            key={positions[0].position.cartographic.latitude}
                            type="number"
                            step="0.000001"
                            className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                            defaultValue={Cesium.Math.toDegrees(
                              positions[0].position.cartographic.latitude,
                            ).toFixed(6)}
                            onBlur={(e) => {
                              const newPositions = [...ue.positions];
                              const first = newPositions[0];
                              if (first) {
                                newPositions[0] = {
                                  ...first,
                                  position: {
                                    ...first.position,
                                    cartographic: new Cesium.Cartographic(
                                      first.position.cartographic.longitude,
                                      Cesium.Math.toRadians(
                                        Number(e.target.value) || 0,
                                      ),
                                      first.position.cartographic.height,
                                    ),
                                  },
                                };
                                userEquipmentManager.update(ue.id, {
                                  positions: newPositions,
                                });
                              }
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Lon [°]
                          </label>
                          <input
                            key={positions[0].position.cartographic.longitude}
                            type="number"
                            step="0.000001"
                            className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                            defaultValue={Cesium.Math.toDegrees(
                              positions[0].position.cartographic.longitude,
                            ).toFixed(6)}
                            onBlur={(e) => {
                              const newPositions = [...ue.positions];
                              const first = newPositions[0];
                              if (first) {
                                newPositions[0] = {
                                  ...first,
                                  position: {
                                    ...first.position,
                                    cartographic: new Cesium.Cartographic(
                                      Cesium.Math.toRadians(
                                        Number(e.target.value) || 0,
                                      ),
                                      first.position.cartographic.latitude,
                                      first.position.cartographic.height,
                                    ),
                                  },
                                };
                                userEquipmentManager.update(ue.id, {
                                  positions: newPositions,
                                });
                              }
                            }}
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
                            value={(
                              positions[0].position.cartographic.height +
                              positions[0].position.terrainHeight
                            ).toFixed(1)}
                            onChange={(e) => {
                              const newPositions = [...ue.positions];
                              const first = newPositions[0];
                              if (first) {
                                const newAlt = Number(e.target.value) || 0;
                                const terrainHeight =
                                  first.position.terrainHeight ?? 0;
                                newPositions[0] = {
                                  ...first,
                                  position: {
                                    ...first.position,
                                    cartographic: new Cesium.Cartographic(
                                      first.position.cartographic.longitude,
                                      first.position.cartographic.latitude,
                                      newAlt - terrainHeight,
                                    ),
                                  },
                                };
                                userEquipmentManager.update(ue.id, {
                                  positions: newPositions,
                                });
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Configuration Details Grid */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Type
                        </label>
                        <div className="text-white text-xs bg-gray-800 px-2 py-1 rounded">
                          {ue.isManual ? "Manual" : "Procedural"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Mobility
                        </label>
                        <div className="text-white text-xs bg-gray-800 px-2 py-1 rounded">
                          {ue.isManualMobility ? "Manual" : "Automatic"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Environment
                        </label>
                        <div className="text-white text-xs bg-gray-800 px-2 py-1 rounded">
                          {ue.isIndoorMobility ? "Indoor" : "Outdoor"}
                        </div>
                      </div>
                    </div>

                    {/* Technical Parameters */}
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: "1fr 1fr 80px" }}
                    >
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
                          value={ue.radiatedPower}
                          onChange={(e) =>
                            userEquipmentManager.update(ue.id, {
                              radiatedPower: parseFloat(e.target.value) || 0,
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
                          value={ue.mechTilt}
                          onChange={(e) =>
                            userEquipmentManager.update(ue.id, {
                              mechTilt: parseFloat(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Height [m]
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="10"
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                          value={ue.height}
                          onChange={(e) =>
                            userEquipmentManager.update(ue.id, {
                              height: parseFloat(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    </div>

                    {/* Waypoints */}
                    {(() => {
                      const inputCls =
                        "w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-mono";
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <h5 className="text-xs font-semibold text-white flex items-center gap-1">
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                              </svg>
                              Waypoints ({waypoints.length})
                            </h5>
                            {waypointEditingId === ue.id ? (
                              <div className="flex gap-1">
                                <button
                                  onClick={commitWaypoints}
                                  className="text-xs px-2 py-0.5 rounded font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                                >
                                  Done
                                </button>
                                <button
                                  onClick={cancelWaypoints}
                                  className="text-xs px-2 py-0.5 rounded font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEditingWaypoints(ue.id)}
                                disabled={waypointEditingId !== null}
                                className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${waypointEditingId !== null ? "text-gray-500 cursor-not-allowed" : "text-blue-400 hover:text-blue-300"}`}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                            {waypoints.map((wp, wpIndex) => (
                              <div
                                key={wp.id}
                                className="bg-gray-800/40 border border-gray-700 rounded p-2 space-y-2"
                              >
                                {/* Card header */}
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-gray-300">
                                    Waypoint {wp.id}
                                  </span>
                                  <button
                                    onClick={() =>
                                      userEquipmentManager.removeWaypoint(
                                        ue.id,
                                        wpIndex,
                                      )
                                    }
                                    className="text-gray-500 hover:text-red-400 transition-colors"
                                    title="Remove waypoint"
                                  >
                                    <svg
                                      className="w-3.5 h-3.5"
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
                                  </button>
                                </div>
                                {/* Position row */}
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      Lon [°]
                                    </label>
                                    <input
                                      type="number"
                                      step="0.00001"
                                      className={inputCls}
                                      defaultValue={Cesium.Math.toDegrees(
                                        wp.position.cartographic.longitude,
                                      ).toFixed(5)}
                                      onBlur={(e) => {
                                        const lon = parseFloat(e.target.value);
                                        if (!isNaN(lon))
                                          userEquipmentManager.updateWaypoint(
                                            ue.id,
                                            wpIndex,
                                            {
                                              position: {
                                                ...wp.position,
                                                cartographic:
                                                  Cesium.Cartographic.fromDegrees(
                                                    lon,
                                                    Cesium.Math.toDegrees(
                                                      wp.position.cartographic
                                                        .latitude,
                                                    ),
                                                    wp.position.cartographic
                                                      .height,
                                                  ),
                                              },
                                            },
                                          );
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      Lat [°]
                                    </label>
                                    <input
                                      type="number"
                                      step="0.00001"
                                      className={inputCls}
                                      defaultValue={Cesium.Math.toDegrees(
                                        wp.position.cartographic.latitude,
                                      ).toFixed(5)}
                                      onBlur={(e) => {
                                        const lat = parseFloat(e.target.value);
                                        if (!isNaN(lat))
                                          userEquipmentManager.updateWaypoint(
                                            ue.id,
                                            wpIndex,
                                            {
                                              position: {
                                                ...wp.position,
                                                cartographic:
                                                  Cesium.Cartographic.fromDegrees(
                                                    Cesium.Math.toDegrees(
                                                      wp.position.cartographic
                                                        .longitude,
                                                    ),
                                                    lat,
                                                    wp.position.cartographic
                                                      .height,
                                                  ),
                                              },
                                            },
                                          );
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      Alt [m]
                                    </label>
                                    <input
                                      type="number"
                                      step="0.00001"
                                      className={inputCls}
                                      defaultValue={wp.position.terrainHeight}
                                      onBlur={(e) => {
                                        const alt = parseFloat(e.target.value);
                                        if (!isNaN(alt))
                                          userEquipmentManager.updateWaypoint(
                                            ue.id,
                                            wpIndex,
                                            {
                                              position: {
                                                ...wp.position,
                                                terrainHeight: alt,
                                              },
                                            },
                                          );
                                      }}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-400 mb-1">
                                    Altitude Offset [m] —{" "}
                                    {Math.round(
                                      wp.position.cartographic.height,
                                    )}{" "}
                                    m
                                  </label>
                                  <input
                                    type="range"
                                    min="0"
                                    max="500"
                                    step="1"
                                    className="w-full accent-blue-500"
                                    value={wp.position.cartographic.height}
                                    onChange={(e) => {
                                      const offset = parseFloat(e.target.value);
                                      if (!isNaN(offset))
                                        userEquipmentManager.updateWaypoint(
                                          ue.id,
                                          wpIndex,
                                          {
                                            position: {
                                              terrainHeight:
                                                wp.position.terrainHeight,
                                              cartographic:
                                                Cesium.Cartographic.fromDegrees(
                                                  Cesium.Math.toDegrees(
                                                    wp.position.cartographic
                                                      .longitude,
                                                  ),
                                                  Cesium.Math.toDegrees(
                                                    wp.position.cartographic
                                                      .latitude,
                                                  ),
                                                  offset,
                                                ),
                                            },
                                          },
                                        );
                                    }}
                                  />
                                </div>
                                {/* Metadata row */}
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      Speed [m/s]
                                    </label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      className={inputCls}
                                      defaultValue={wp.speed}
                                      onBlur={(e) => {
                                        const v = parseFloat(e.target.value);
                                        if (!isNaN(v))
                                          userEquipmentManager.updateWaypoint(
                                            ue.id,
                                            wpIndex,
                                            { speed: v },
                                          );
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      Stop [s]
                                    </label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      className={inputCls}
                                      defaultValue={wp.stop}
                                      onBlur={(e) => {
                                        const v = parseFloat(e.target.value);
                                        if (!isNaN(v))
                                          userEquipmentManager.updateWaypoint(
                                            ue.id,
                                            wpIndex,
                                            { stop: v },
                                          );
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                      Azimuth [°]
                                    </label>
                                    <input
                                      type="number"
                                      step="1"
                                      className={inputCls}
                                      defaultValue={wp.azimuth_offset}
                                      onBlur={(e) => {
                                        const v = parseFloat(e.target.value);
                                        if (!isNaN(v))
                                          userEquipmentManager.updateWaypoint(
                                            ue.id,
                                            wpIndex,
                                            { azimuth_offset: v },
                                          );
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Route Positions Table */}
                    {positions.length > 0 &&
                      (() => {
                        const pagination = paginationState.get(ue.id) || {
                          currentPage: 1,
                          itemsPerPage: DEFAULT_ITEMS_PER_PAGE,
                        };
                        const totalPages = Math.ceil(
                          positions.length / pagination.itemsPerPage,
                        );
                        const startIndex =
                          (pagination.currentPage - 1) *
                          pagination.itemsPerPage;
                        const endIndex = startIndex + pagination.itemsPerPage;
                        const paginatedPositions = positions.slice(
                          startIndex,
                          endIndex,
                        );

                        return (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <h5 className="text-xs font-semibold text-white flex items-center gap-1">
                                <svg
                                  className="w-3 h-3"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                                  />
                                </svg>
                                Route Positions ({positions.length} points)
                              </h5>
                              {positions.length > DEFAULT_ITEMS_PER_PAGE && (
                                <select
                                  value={pagination.itemsPerPage}
                                  onChange={(e) => {
                                    const newItemsPerPage = parseInt(
                                      e.target.value,
                                    );
                                    setPaginationState((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.set(ue.id, {
                                        currentPage: 1,
                                        itemsPerPage: newItemsPerPage,
                                      });
                                      return newMap;
                                    });
                                  }}
                                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-white"
                                >
                                  {ITEMS_PER_PAGE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                      {option} per page
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                            <div className="bg-gray-800/40 border border-gray-700 rounded overflow-hidden">
                              <div className="max-h-64 overflow-y-auto">
                                <table className="w-full text-xs table-fixed">
                                  <colgroup>
                                    <col style={{ width: "15%" }} />
                                    <col style={{ width: "31%" }} />
                                    <col style={{ width: "31%" }} />
                                    <col style={{ width: "23%" }} />
                                  </colgroup>
                                  <thead className="bg-gray-800 sticky top-0">
                                    <tr className="text-gray-400">
                                      <th className="px-1.5 py-1.5 text-left font-medium">
                                        Time
                                      </th>
                                      <th className="px-2 py-1.5 text-right font-medium">
                                        Lon [°]
                                      </th>
                                      <th className="px-2 py-1.5 text-right font-medium">
                                        Lat [°]
                                      </th>
                                      <th className="px-2 py-1.5 text-right font-medium">
                                        Alt (m)
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-700">
                                    {paginatedPositions.map((position) => (
                                      <tr
                                        key={position.timeIdx}
                                        className="hover:bg-gray-800/60 transition-colors"
                                      >
                                        <td className="px-1.5 py-1 text-gray-300 font-mono">
                                          {position.timeIdx}
                                        </td>
                                        <td className="px-2 py-1 text-right text-gray-300 font-mono">
                                          {Cesium.Math.toDegrees(
                                            position.position.cartographic
                                              .longitude,
                                          ).toFixed(5)}
                                        </td>
                                        <td className="px-2 py-1 text-right text-gray-300 font-mono">
                                          {Cesium.Math.toDegrees(
                                            position.position.cartographic
                                              .latitude,
                                          ).toFixed(6)}
                                        </td>
                                        <td className="px-2 py-1 text-right text-gray-300 font-mono">
                                          {position.position.cartographic.height.toFixed(
                                            2,
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                            {totalPages > 1 && (
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <div>
                                  Showing {startIndex + 1}-
                                  {Math.min(endIndex, positions.length)} of{" "}
                                  {positions.length} points
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      setPaginationState((prev) => {
                                        const newMap = new Map(prev);
                                        const current = newMap.get(ue.id) || {
                                          currentPage: 1,
                                          itemsPerPage: DEFAULT_ITEMS_PER_PAGE,
                                        };
                                        newMap.set(ue.id, {
                                          ...current,
                                          currentPage: Math.max(
                                            1,
                                            current.currentPage - 1,
                                          ),
                                        });
                                        return newMap;
                                      });
                                    }}
                                    disabled={pagination.currentPage === 1}
                                    className="px-2 py-1 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Previous
                                  </button>
                                  <span className="text-gray-300">
                                    Page {pagination.currentPage} of{" "}
                                    {totalPages}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setPaginationState((prev) => {
                                        const newMap = new Map(prev);
                                        const current = newMap.get(ue.id) || {
                                          currentPage: 1,
                                          itemsPerPage: DEFAULT_ITEMS_PER_PAGE,
                                        };
                                        newMap.set(ue.id, {
                                          ...current,
                                          currentPage: Math.min(
                                            totalPages,
                                            current.currentPage + 1,
                                          ),
                                        });
                                        return newMap;
                                      });
                                    }}
                                    disabled={
                                      pagination.currentPage >= totalPages
                                    }
                                    className="px-2 py-1 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Next
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
