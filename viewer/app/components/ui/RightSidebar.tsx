/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { useViewerStore } from "@/store/viewerStore";
import {
  getViridisGradientCSS,
  SIGNAL_MIN,
  SIGNAL_MAX,
} from "@/services/visualization";
import { RIGHT_SIDEBAR_WIDTH_PX } from "@/constants";
import { RaypathFilterPanel } from "./RaypathFilters";
import { RadioUnitProperties } from "./properties/RadioUnitProperties";
import { DistributedUnitProperties } from "./properties/DistributedUnitProperties";
import { BuildingProperties } from "./properties/BuildingProperties";
import {
  ScattererProperties,
  SCATTERERS_LIST_VIEW,
} from "./properties/ScattererProperties";
import { UserEquipmentProperties } from "./properties/UserEquipmentProperties";
import { PanelProperties } from "./properties/PanelProperties";
import { Settings } from "./Settings";
import { EntitiesPanel } from "./EntitiesPanel";
import { is3DTileFeature, isEntity } from "@/services/cesium";

export const RightSidebar: React.FC = () => {
  const {
    scenarioParams,
    rightSidebarCollapsed,
    activeRightTab,
    updateScenarioParams,
    toggleRightSidebar,
    setActiveRightTab,
    selectedObject,
    rayPathsVisible,
    toggleRayPathsVisible,
  } = useViewerStore();

  // Determine what type of object is selected
  const isFeatureSelected =
    selectedObject != null && is3DTileFeature(selectedObject);
  const isRadioUnitSelected =
    selectedObject != null &&
    isEntity(selectedObject) &&
    typeof selectedObject.id === "string" &&
    selectedObject.id.startsWith("ru-");
  const isDistributedUnitSelected =
    selectedObject != null &&
    isEntity(selectedObject) &&
    typeof selectedObject.id === "string" &&
    selectedObject.id.startsWith("du-");
  const isScattererSelected =
    selectedObject != null &&
    isEntity(selectedObject) &&
    typeof selectedObject.id === "string" &&
    selectedObject.id.startsWith("scatterer-");
  const isScatterersListView =
    selectedObject &&
    typeof (selectedObject as { id?: unknown }).id === "string" &&
    (selectedObject as { id: string }).id === SCATTERERS_LIST_VIEW.id;
  const isUserEquipmentSelected =
    selectedObject != null &&
    isEntity(selectedObject) &&
    typeof selectedObject.id === "string" &&
    selectedObject.id.startsWith("ue-");
  const isPanelSelected =
    selectedObject &&
    typeof (selectedObject as { id?: unknown }).id === "string" &&
    (selectedObject as { id: string }).id.startsWith("panel-");

  const tabs = ["Entities", "Rays", "Settings"] as const;

  if (rightSidebarCollapsed) {
    return (
      <div className="absolute right-0 top-16 z-30 bg-gray-900 bg-opacity-95 rounded-l-lg shadow-lg border border-gray-800">
        <button
          onClick={toggleRightSidebar}
          className="p-3 text-gray-400 hover:text-white transition-colors"
          title="Expand sidebar"
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
      </div>
    );
  }

  return (
    <div
      className="absolute right-0 top-16 bottom-0 bg-gray-900 bg-opacity-95 shadow-lg z-30 flex flex-col border-l border-gray-800"
      style={{ width: RIGHT_SIDEBAR_WIDTH_PX }}
    >
      {/* Header with collapse button */}
      <div className="flex items-center justify-between py-2 px-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white">Settings</h2>
        <button
          onClick={toggleRightSidebar}
          className="p-1 text-gray-400 hover:text-white transition-colors"
          title="Collapse sidebar"
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
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveRightTab(tab)}
            className={`px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors ${
              activeRightTab === tab
                ? "text-white border-b-2 border-[#76B900]"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeRightTab === "Rays" && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white">
                Signal Strength
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={rayPathsVisible}
                  onClick={() => toggleRayPathsVisible()}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#76B900] focus:ring-offset-2 focus:ring-offset-gray-900 ${
                    rayPathsVisible ? "bg-[#76B900]" : "bg-gray-600"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${
                      rayPathsVisible ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Weak</span>
                <span className="text-xs text-gray-400">Strong</span>
              </div>
              <div
                style={{
                  background: getViridisGradientCSS(),
                  width: "100%",
                  height: "20px",
                  borderRadius: "4px",
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{SIGNAL_MIN} dBm</span>
                <span className="text-xs text-gray-400">{SIGNAL_MAX} dBm</span>
              </div>
            </div>

            {/* Ray Visualization */}
            <div className="pt-4 pb-2 border-t border-gray-700 space-y-3">
              <div>
                <label className="block text-xs text-gray-300 mb-1">
                  Max Dynamic Range (dB): {scenarioParams.maxDynamicRangeDB}
                </label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={scenarioParams.maxDynamicRangeDB}
                  onChange={(e) =>
                    updateScenarioParams({
                      maxDynamicRangeDB: parseInt(e.target.value),
                    })
                  }
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  style={{ accentColor: "#76B900" }}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                  <span>0</span>
                  <span>200</span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-300 mb-1">
                  Max Visible Paths (per RU-UE):{" "}
                  {scenarioParams.maxVisibleRayPaths}
                </label>
                <p className="text-[10px] text-gray-500 mb-1">
                  Applied on database load or refresh, not when changed.
                </p>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={scenarioParams.maxVisibleRayPaths}
                  onChange={(e) =>
                    updateScenarioParams({
                      maxVisibleRayPaths: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-2 py-1.5 bg-gray-700 text-gray-200 text-xs rounded border border-gray-600 focus:border-[#76B900] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-300 mb-1">
                  Ray Sparsity (time steps): {scenarioParams.raysSparsity}
                </label>
                <p className="text-[10px] text-gray-500 mb-1">
                  Applied on database load or refresh, not when changed.
                </p>
                <input
                  type="number"
                  min="1"
                  max={999999999}
                  value={scenarioParams.raysSparsity}
                  onChange={(e) =>
                    updateScenarioParams({
                      raysSparsity: parseInt(e.target.value) || 1,
                    })
                  }
                  className="w-full px-2 py-1.5 bg-gray-700 text-gray-200 text-xs rounded border border-gray-600 focus:border-[#76B900] focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-700">
              <RaypathFilterPanel />
            </div>
          </div>
        )}

        {activeRightTab === "Entities" &&
          (isFeatureSelected ? (
            <BuildingProperties />
          ) : isRadioUnitSelected ? (
            <RadioUnitProperties />
          ) : isDistributedUnitSelected ? (
            <DistributedUnitProperties />
          ) : isScattererSelected || isScatterersListView ? (
            <ScattererProperties />
          ) : isUserEquipmentSelected ? (
            <UserEquipmentProperties />
          ) : isPanelSelected ? (
            <PanelProperties />
          ) : (
            <EntitiesPanel />
          ))}

        {activeRightTab === "Settings" && <Settings />}
      </div>
    </div>
  );
};
