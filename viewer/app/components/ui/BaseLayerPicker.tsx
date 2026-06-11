/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { useViewerStore } from "@/store/viewerStore";
import { BASE_LAYERS, getAvailableBaseLayers } from "@/constants/baseLayers";
import { changeBaseLayer } from "@/hooks/cesium";

/**
 * Icon for each base layer type
 */
const LayerIcon: React.FC<{ type: string }> = ({ type }) => {
  switch (type) {
    case "ion":
    case "wmts":
      // Satellite icon
      return (
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
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "osm":
    case "url":
    default:
      // Map icon
      return (
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
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
          />
        </svg>
      );
  }
};

export const BaseLayerPicker: React.FC = () => {
  const { baseLayerId, setBaseLayer, cesiumViewer } = useViewerStore();
  const [layers, setLayers] = useState(BASE_LAYERS);

  useEffect(() => {
    setLayers(getAvailableBaseLayers());
  }, []);

  const handleLayerChange = (layerId: string) => {
    setBaseLayer(layerId);
    if (cesiumViewer) {
      changeBaseLayer(cesiumViewer, layerId);
    }
  };

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="mb-3">
        <span className="text-sm font-medium text-white">Base Maps</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {layers.map((layer) => {
          const isSelected = baseLayerId === layer.id;
          return (
            <button
              key={layer.id}
              onClick={() => handleLayerChange(layer.id)}
              className={`flex items-center gap-2 p-2 rounded-lg text-left transition-all ${
                isSelected
                  ? "bg-blue-600 text-white ring-2 ring-blue-400"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
              title={layer.name}
            >
              <div
                className={`flex-shrink-0 ${
                  isSelected ? "text-white" : "text-gray-400"
                }`}
              >
                <LayerIcon type={layer.type} />
              </div>
              <span className="text-xs truncate">{layer.name}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-gray-500 italic">
        All base maps are free with attribution
      </div>
    </div>
  );
};
