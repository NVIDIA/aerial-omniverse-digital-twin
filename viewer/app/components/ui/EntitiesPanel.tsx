/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { useViewerStore } from "../../store/viewerStore";
import { ZoomButton } from "./ZoomButton";
import { EntitiesSearchBar } from "./EntitiesSearchBar";
import {
  isEntity as isCesiumEntity,
  is3DTileFeature as isCesium3DTileFeature,
} from "@/services/cesium";
import {
  useRadioUnits,
  useDistributedUnits,
  useScatterers,
  useUserEquipments,
  usePanels,
  useSpawnZone,
} from "@/hooks/entities";
import { spawnZoneManager } from "~/managers/spawnZoneManager";
import {
  RadioUnitIcon,
  DistributedUnitIcon,
  UserEquipmentIcon,
  ScattererIcon,
  PanelIcon,
} from "@/constants/icons";

export const EntitiesPanel: React.FC = () => {
  const {
    selectedObject,
    setSelectedObject,
    zoomTo,
    startEditingSpawnZone,
    editingSpawnZone,
  } = useViewerStore();

  const { points: spawnZonePoints, altitude: spawnZoneAltitude } =
    useSpawnZone();

  // Use manager hooks for entity data
  const radioUnits = useRadioUnits();
  const distributedUnits = useDistributedUnits();
  const scatterers = useScatterers();
  const userEquipments = useUserEquipments();
  const panels = usePanels();

  const [expandedSections, setExpandedSections] = useState({
    buildings: true,
    radioUnits: true,
    distributedUnits: true,
    scatterers: true,
    userEquipments: true,
    panels: true,
    spawnZone: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Search Bar */}
      <EntitiesSearchBar />

      {/* Entities List */}
      <div className="flex-1 overflow-y-auto">
        {/* Buildings Section */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("buildings")}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
          >
            <span className="text-sm font-semibold text-[#76B900]">
              Buildings
            </span>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.buildings ? "rotate-180" : ""}`}
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
          {expandedSections.buildings && (
            <div className="p-4 bg-gray-850/30">
              <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 text-xs text-blue-200">
                <div className="flex items-start">
                  <div>
                    <p className="font-medium mb-1">
                      Building list not displayed
                    </p>
                    <p className="text-blue-300/80">
                      The building list is too large to display. To view
                      building properties:
                    </p>
                    <ol className="mt-2 ml-4 space-y-1 list-decimal text-blue-300/80">
                      <li>Enable Select tool in toolbar</li>
                      <li>Click a building</li>
                      <li>Properties will appear here</li>
                    </ol>
                  </div>
                </div>
              </div>

              {/* Show selected building if any (selectedObject is a 3D tile feature) */}
              {selectedObject && isCesium3DTileFeature(selectedObject) && (
                <div className="mt-3 p-3 bg-gray-800/60 border border-[#76B900] rounded-lg">
                  <div className="text-xs text-gray-300">
                    {/* Extract properties from 3D tile feature */}
                    {isCesium3DTileFeature(selectedObject) &&
                      selectedObject.getProperty("BIN") && (
                        <p>
                          <span className="text-gray-400">BIN:</span>{" "}
                          {selectedObject.getProperty("BIN")}
                        </p>
                      )}
                    {isCesium3DTileFeature(selectedObject) &&
                      selectedObject.getProperty("name") && (
                        <p>
                          <span className="text-gray-400">Name:</span>{" "}
                          {selectedObject.getProperty("name")}
                        </p>
                      )}
                    {isCesium3DTileFeature(selectedObject) &&
                      selectedObject.featureId !== undefined && (
                        <p className="mt-1 text-gray-500">
                          Feature ID: {selectedObject.featureId}
                        </p>
                      )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Radio Units Section */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("radioUnits")}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#76B900]">
                Radio Units
              </span>
              <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">
                {radioUnits.size}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.radioUnits ? "rotate-180" : ""}`}
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
          {expandedSections.radioUnits && (
            <div className="p-4 bg-gray-850/30">
              {radioUnits.size === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <RadioUnitIcon className="w-10 h-auto mx-auto mb-2 opacity-50" />
                  <p>No radio units added yet</p>
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto pr-1">
                  {Array.from(radioUnits.keys()).map((ruId) => (
                    <div
                      key={ruId}
                      className={`px-2 py-1.5 rounded border cursor-pointer transition-all ${
                        isCesiumEntity(selectedObject) &&
                        selectedObject.id === `ru-${ruId}`
                          ? "border-[#76B900] bg-gray-800/60"
                          : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                      }`}
                      onClick={() => setSelectedObject(`ru-${ruId}`)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{`RU ${ruId}`}</p>
                        </div>
                        <ZoomButton
                          onClick={(e) => {
                            e.stopPropagation();
                            zoomTo(`ru-${ruId}`);
                          }}
                          title="Zoom to radio unit"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Distributed Units Section */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("distributedUnits")}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#76B900]">
                Distributed Units
              </span>
              <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">
                {distributedUnits.size}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.distributedUnits ? "rotate-180" : ""}`}
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
          {expandedSections.distributedUnits && (
            <div className="p-4 bg-gray-850/30">
              {distributedUnits.size === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <DistributedUnitIcon className="w-10 h-auto mx-auto mb-2 opacity-50" />
                  <p>No distributed units added yet</p>
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto pr-1">
                  {Array.from(distributedUnits.keys()).map((duId) => (
                    <div
                      key={duId}
                      className={`px-2 py-1.5 rounded border cursor-pointer transition-all ${
                        isCesiumEntity(selectedObject) &&
                        selectedObject.id === `du-${duId}`
                          ? "border-[#76B900] bg-gray-800/60"
                          : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                      }`}
                      onClick={() => setSelectedObject(`du-${duId}`)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{`DU ${duId}`}</p>
                        </div>
                        <ZoomButton
                          onClick={(e) => {
                            e.stopPropagation();
                            zoomTo(`du-${duId}`);
                          }}
                          title="Zoom to distributed unit"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Equipment Section */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("userEquipments")}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#76B900]">
                User Equipments
              </span>
              <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">
                {userEquipments.size}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.userEquipments ? "rotate-180" : ""}`}
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
          {expandedSections.userEquipments && (
            <div className="p-4 bg-gray-850/30">
              {userEquipments.size === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <UserEquipmentIcon className="w-10 h-auto mx-auto mb-2 opacity-50" />
                  <p>No user equipments added yet</p>
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto pr-1">
                  {Array.from(userEquipments.keys()).map((ueId) => (
                    <div
                      key={ueId}
                      className={`px-2 py-1.5 rounded border cursor-pointer transition-all ${
                        isCesiumEntity(selectedObject) &&
                        selectedObject.id === `ue-${ueId}`
                          ? "border-[#76B900] bg-gray-800/60"
                          : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                      }`}
                      onClick={() => setSelectedObject(`ue-${ueId}`)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{`UE ${ueId}`}</p>
                        </div>
                        <ZoomButton
                          onClick={(e) => {
                            e.stopPropagation();
                            zoomTo(`ue-${ueId}`);
                          }}
                          title={`Zoom to UE ${ueId}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scatterers Section */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("scatterers")}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#76B900]">
                Dynamic Scatterers
              </span>
              <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">
                {scatterers.size}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.scatterers ? "rotate-180" : ""}`}
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
          {expandedSections.scatterers && (
            <div className="p-4 bg-gray-850/30">
              {scatterers.size === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <ScattererIcon className="w-10 h-auto mx-auto mb-2 opacity-50" />
                  <p>No dynamic scatterers added yet</p>
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto pr-1">
                  {Array.from(scatterers.keys()).map((scattererId) => (
                    <div
                      key={scattererId}
                      className={`px-2 py-1.5 rounded border cursor-pointer transition-all ${
                        isCesiumEntity(selectedObject) &&
                        selectedObject.id === `scatterer-${scattererId}`
                          ? "border-[#76B900] bg-gray-800/60"
                          : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                      }`}
                      onClick={() =>
                        setSelectedObject(`scatterer-${scattererId}`)
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{`Scatterer ${scattererId}`}</p>
                        </div>
                        <ZoomButton
                          onClick={(e) => {
                            e.stopPropagation();
                            zoomTo(`scatterer-${scattererId}`);
                          }}
                          title="Zoom to scatterer"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panels Section */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("panels")}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#76B900]">
                Panels
              </span>
              <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">
                {panels.size}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.panels ? "rotate-180" : ""}`}
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
          {expandedSections.panels && (
            <div className="p-4 bg-gray-850/30">
              {panels.size === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <PanelIcon className="w-10 h-auto mx-auto mb-2 opacity-50" />
                  <p>No panels added yet</p>
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto pr-1">
                  {Array.from(panels.values()).map((panel) => {
                    const panelId = `panel-${panel.id}`;
                    const isSelected =
                      selectedObject && (selectedObject as any).id === panelId;

                    return (
                      <div
                        key={panel.id}
                        className={`px-2 py-1.5 rounded border cursor-pointer transition-all ${
                          isSelected
                            ? "border-[#76B900] bg-gray-800/60"
                            : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                        }`}
                        onClick={() =>
                          setSelectedObject({ id: panelId } as any)
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white truncate">
                              Panel {panel.id}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Spawn Zone Section */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("spawnZone")}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#76B900]">
                Spawn Zone
              </span>
              {spawnZonePoints.length > 0 && (
                <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">
                  {spawnZonePoints.length} pts
                </span>
              )}
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.spawnZone ? "rotate-180" : ""}`}
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
          {expandedSections.spawnZone && (
            <div className="p-4 bg-gray-850/30">
              {spawnZonePoints.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <PanelIcon className="w-10 h-auto mx-auto mb-2 opacity-50" />
                  <p>No spawn zone added yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {spawnZonePoints.length} points
                    </span>
                    <div className="flex items-center gap-1">
                      <ZoomButton
                        onClick={(e) => {
                          e.stopPropagation();
                          zoomTo("__spawn_zone_polygon__", 1000.0);
                        }}
                        title="Zoom to spawn zone"
                      />
                      <button
                        onClick={() => startEditingSpawnZone()}
                        disabled={editingSpawnZone}
                        className="text-xs px-2 py-0.5 rounded bg-gray-700 text-yellow-400 hover:bg-yellow-900/40 hover:text-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => spawnZoneManager.clear()}
                        className="text-xs px-2 py-0.5 rounded bg-gray-700 text-red-400 hover:bg-red-900/40 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {/* Altitude is not supported yet */}
                  {/* <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Height</span>
                      <span className="text-xs text-gray-300 font-mono">
                        {spawnZoneAltitude} m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={500}
                      step={1}
                      value={spawnZoneAltitude}
                      onChange={(e) =>
                        spawnZoneManager.setAltitude(Number(e.target.value))
                      }
                      className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-[#76B900] bg-gray-700"
                    />
                  </div> */}
                  <div className="max-h-40 overflow-y-auto pr-1 space-y-0.5">
                    {spawnZonePoints.map((p, i) => (
                      <div
                        key={i}
                        className="text-xs text-gray-300 bg-gray-800/40 px-2 py-1 rounded font-mono"
                      >
                        {p.lat.toFixed(6)}, {p.lon.toFixed(6)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
