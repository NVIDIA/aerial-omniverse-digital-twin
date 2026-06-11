/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { useViewerStore } from "../../../store/viewerStore";
import type { TimeIndexedPosition } from "../../../store/types";
import * as Cesium from "cesium";
import { getEntityIdByType } from "@/services/cesium";
import { useScatterers } from "@/hooks/entities";
import { scattererManager } from "~/managers/scattererManager";

/** Sentinel used so the Entities tab stays on scatterers list when no scatterer is selected */
export const SCATTERERS_LIST_VIEW = { id: "scatterers-list" } as const;

export const ScattererProperties: React.FC = () => {
  const { selectedObject, setSelectedObject, zoomTo } = useViewerStore();

  const scatterers = useScatterers();

  const [positionDataMap, setPositionDataMap] = useState<
    Map<number, TimeIndexedPosition[]>
  >(new Map());
  const itemRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // Pagination state per scatterer
  const [paginationState, setPaginationState] = useState<
    Map<number, { currentPage: number; itemsPerPage: number }>
  >(new Map());

  const ITEMS_PER_PAGE_OPTIONS = [25, 50, 100, 250, 500];
  const DEFAULT_ITEMS_PER_PAGE = 50;

  // Extract scatterer ID from selected object if it's a scatterer entity
  const selectedScattererId = getEntityIdByType(selectedObject, "scatterer");

  // Load position data for all scatterers when component mounts
  useEffect(() => {
    const dataMap = new Map<number, TimeIndexedPosition[]>();
    for (const [scattererId, scatterer] of scatterers.entries()) {
      dataMap.set(scattererId, scatterer.positions);
    }
    setPositionDataMap(dataMap);
  }, [scatterers]);

  // Scroll to selected item when it changes
  useEffect(() => {
    if (selectedScattererId && itemRefs.current[selectedScattererId]) {
      itemRefs.current[selectedScattererId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedScattererId]);

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
          <h3 className="text-md font-medium text-white">Dynamic Scatterers</h3>
        </div>
      </div>

      {/* Scatterer List */}
      <div className="space-y-1.5">
        {scatterers.size === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            <svg
              className="w-12 h-auto mx-auto mb-3 opacity-50"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M 18.92,6.01 C 18.72,5.42 18.16,5 17.5,5 h -11 c -0.66,0 -1.21,0.42 -1.42,1.01 L 3,12 v 8 c 0,0.55 0.45,1 1,1 h 1 c 0.55,0 1,-0.45 1,-1 v -1 h 12 v 1 c 0,0.55 0.45,1 1,1 h 1 c 0.55,0 1,-0.45 1,-1 v -8 z M 6.5,16 c -0.83,0 -1.5,-0.67 -1.5,-1.5 0,-0.83 0.67,-1.5 1.5,-1.5 0.83,0 1.5,0.67 1.5,1.5 0,0.83 -0.67,1.5 -1.5,1.5 z m 11,0 c -0.83,0 -1.5,-0.67 -1.5,-1.5 0,-0.83 0.67,-1.5 1.5,-1.5 0.83,0 1.5,0.67 1.5,1.5 0,0.83 -0.67,1.5 -1.5,1.5 z M 5,11 6,6.5 h 12 l 1,4.5 z" />
            </svg>
            <p>No scatterers loaded yet</p>
          </div>
        ) : (
          Array.from(scatterers.values()).map((scatterer) => {
            const isSelected = selectedScattererId === scatterer.id;
            const positions = positionDataMap.get(scatterer.id) || [];

            return (
              <div
                key={scatterer.id}
                ref={(el) => {
                  itemRefs.current[scatterer.id] = el;
                }}
                className={`px-2.5 py-2 rounded border ${
                  isSelected
                    ? "border-[#76B900] bg-gray-800/60"
                    : "border-gray-800 bg-gray-800/40"
                }`}
              >
                {/* Scatterer Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      className="text-sm text-white font-medium hover:underline"
                      onClick={() =>
                        setSelectedObject(
                          selectedScattererId === scatterer.id
                            ? null
                            : `scatterer-${scatterer.id}`,
                        )
                      }
                    >
                      Scatterer {scatterer.id}
                    </button>
                    <button
                      className="text-xs text-gray-400 hover:text-[#76B900] transition-colors"
                      onClick={() => zoomTo(`scatterer-${scatterer.id}`)}
                      title="Zoom to scatterer"
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
                        scatterer.isIndoor
                          ? "bg-blue-900/30 text-blue-300"
                          : "bg-green-900/30 text-green-300"
                      }`}
                    >
                      {scatterer.isIndoor ? "Indoor" : "Outdoor"}
                    </span>
                    <button
                      className="text-xs text-red-400 hover:text-red-300"
                      onClick={() => {
                        if (selectedScattererId === scatterer.id) {
                          setSelectedObject(SCATTERERS_LIST_VIEW as any);
                        }
                        scattererManager.remove(scatterer.id);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* Expanded Details - shown only when selected */}
                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                    {/* ID and Environment */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          ID
                        </label>
                        <div className="text-white font-mono text-xs bg-gray-800 px-2 py-1 rounded">
                          {scatterer.id}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Environment
                        </label>
                        <div className="text-white text-xs bg-gray-800 px-2 py-1 rounded">
                          {scatterer.isIndoor ? "Indoor" : "Outdoor"}
                        </div>
                      </div>
                    </div>

                    {/* Route Positions Table */}
                    {positions.length > 0 &&
                      (() => {
                        const pagination = paginationState.get(
                          scatterer.id,
                        ) || {
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
                                      newMap.set(scatterer.id, {
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
                                        const current = newMap.get(
                                          scatterer.id,
                                        ) || {
                                          currentPage: 1,
                                          itemsPerPage: DEFAULT_ITEMS_PER_PAGE,
                                        };
                                        newMap.set(scatterer.id, {
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
                                        const current = newMap.get(
                                          scatterer.id,
                                        ) || {
                                          currentPage: 1,
                                          itemsPerPage: DEFAULT_ITEMS_PER_PAGE,
                                        };
                                        newMap.set(scatterer.id, {
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
