/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import type { Panel } from "~/types/entities";
import { panelManager } from "~/managers/panelManager";
import { ANTENNA_TYPES } from "~/constants/antennaTypes";

interface PanelLayoutVisualizerProps {
  panel: Panel;
}

interface VisualizerModalProps {
  panel: Panel;
  isOpen: boolean;
  onClose: () => void;
}

const VisualizerModal: React.FC<VisualizerModalProps> = ({
  panel,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  // Polarization colors
  const FIRST_POL_COLOR = "#3b82f6"; // Blue
  const SECOND_POL_COLOR = "#f97316"; // Orange

  const {
    numLocAntennaHorz,
    numLocAntennaVert,
    antennaSpacingHorzCm,
    antennaSpacingVertCm,
    dualPolarized,
    antennaRollAngleFirstPolz,
    antennaRollAngleSecondPolz,
  } = panel;

  const rollFirstDeg = antennaRollAngleFirstPolz * (180 / Math.PI);
  const rollSecondDeg = antennaRollAngleSecondPolz * (180 / Math.PI);

  // Calculate panel dimensions
  const totalWidth = (numLocAntennaHorz - 1) * antennaSpacingHorzCm;
  const totalHeight = (numLocAntennaVert - 1) * antennaSpacingVertCm;

  // SVG viewport settings
  const padding = 25;
  const maxDimension = Math.max(totalWidth, totalHeight) || 10;
  const scale = 200 / maxDimension; // Scale to fit in 200px space
  const viewBoxWidth = totalWidth * scale + padding * 2;
  const viewBoxHeight = totalHeight * scale + padding * 2;

  // Element size
  const elementSize = 12;

  // Render antenna element with polarization indicator
  const renderElement = (row: number, col: number, index: number) => {
    const x = padding + col * antennaSpacingHorzCm * scale;
    const y = padding + row * antennaSpacingVertCm * scale;

    return (
      <g key={`element-${index}`}>
        {/* Element base circle */}
        <circle
          cx={x}
          cy={y}
          r={elementSize}
          fill="#1f2937"
          stroke="#4b5563"
          strokeWidth="1"
        />

        {/* First polarization indicator */}
        <line
          x1={x - elementSize * 0.9}
          y1={y}
          x2={x + elementSize * 0.9}
          y2={y}
          stroke={FIRST_POL_COLOR}
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${rollFirstDeg} ${x} ${y})`}
        />
        {/* Second polarization indicator */}
        {dualPolarized === 2 && (
          <line
            x1={x - elementSize * 0.9}
            y1={y}
            x2={x + elementSize * 0.9}
            y2={y}
            stroke={SECOND_POL_COLOR}
            strokeWidth="1.5"
            strokeLinecap="round"
            transform={`rotate(${rollSecondDeg} ${x} ${y})`}
          />
        )}

        {/* Element label */}
        <g>
          {/* Label background with border for better visibility */}
          <rect
            x={x - 5}
            y={y - 4}
            width="10"
            height="8"
            fill="#1f2937"
            fillOpacity="0.75"
            stroke="#374151"
            strokeWidth="0.5"
            rx="1.5"
          />
          <text
            x={x}
            y={y}
            fontSize="6"
            fill="#f3f4f6"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="monospace"
            fontWeight="600"
          >
            {index + 1}
          </text>
        </g>
      </g>
    );
  };

  // Render dimension lines
  const renderDimensions = () => {
    if (numLocAntennaHorz < 2 && numLocAntennaVert < 2) return null;

    return (
      <g>
        {/* Horizontal dimension (if more than 1 column) */}
        {numLocAntennaHorz > 1 && (
          <g>
            {/* Dimension line */}
            <line
              x1={padding}
              y1={padding + totalHeight * scale + 20}
              x2={padding + antennaSpacingHorzCm * scale}
              y2={padding + totalHeight * scale + 20}
              stroke="#6b7280"
              strokeWidth="1"
              markerStart="url(#arrowLeft)"
              markerEnd="url(#arrowRight)"
            />
            {/* Dimension text */}
            <text
              x={padding + (antennaSpacingHorzCm * scale) / 2}
              y={padding + totalHeight * scale + 35}
              fontSize="7"
              fill="#d1d5db"
              textAnchor="middle"
              fontFamily="monospace"
            >
              {antennaSpacingHorzCm.toFixed(1)} cm
            </text>
          </g>
        )}

        {/* Vertical dimension (if more than 1 row) */}
        {numLocAntennaVert > 1 && (
          <g>
            {/* Dimension line */}
            <line
              x1={padding + totalWidth * scale + 20}
              y1={padding + 8}
              x2={padding + totalWidth * scale + 20}
              y2={padding + antennaSpacingVertCm * scale - 8}
              stroke="#6b7280"
              strokeWidth="1"
              markerStart="url(#arrowUp)"
              markerEnd="url(#arrowDown)"
            />
            {/* Dimension text */}
            <text
              x={padding + totalWidth * scale + 18}
              y={padding + (antennaSpacingVertCm * scale) / 2 - 8}
              fontSize="7"
              fill="#d1d5db"
              textAnchor="middle"
              fontFamily="monospace"
              transform={`rotate(90 ${padding + totalWidth * scale + 18} ${
                padding + (antennaSpacingVertCm * scale) / 2
              })`}
            >
              {antennaSpacingVertCm.toFixed(1)} cm
            </text>
          </g>
        )}

        {/* Arrow markers */}
        <defs>
          <marker
            id="arrowRight"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 7 3, 0 6" fill="#6b7280" />
          </marker>
          <marker
            id="arrowLeft"
            markerWidth="8"
            markerHeight="8"
            refX="0"
            refY="3"
            orient="auto"
          >
            <polygon points="7 0, 0 3, 7 6" fill="#6b7280" />
          </marker>
          <marker
            id="arrowDown"
            markerWidth="8"
            markerHeight="8"
            refX="0"
            refY="4"
            orient="90"
          >
            <polygon points="0 0, 8 4, 0 8" fill="#6b7280" />
          </marker>
          <marker
            id="arrowUp"
            markerWidth="8"
            markerHeight="8"
            refX="0"
            refY="4"
            orient="270"
          >
            <polygon points="0 0, 8 4, 0 8" fill="#6b7280" />
          </marker>
        </defs>
      </g>
    );
  };

  // Generate all elements
  const elements: React.ReactElement[] = [];
  let elementIndex = 0;
  for (let row = 0; row < numLocAntennaVert; row++) {
    for (let col = 0; col < numLocAntennaHorz; col++) {
      elements.push(renderElement(row, col, elementIndex));
      elementIndex++;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 rounded-lg border border-gray-700 shadow-2xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
          <h3 className="text-lg font-medium text-white">
            Panel Layout - Panel {panel.id}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 grid grid-cols-2 gap-6">
          {/* Left Column - Visualization */}
          <div className="space-y-8">
            <div className="flex flex-col items-center">
              <svg
                width="100%"
                viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
                className="max-h-[32rem]"
                style={{ overflow: "visible" }}
              >
                {/* Background grid */}
                <rect
                  x={padding - 15}
                  y={padding - 15}
                  width={totalWidth * scale + 30}
                  height={totalHeight * scale + 30}
                  fill="#0f172a"
                  stroke="#1e293b"
                  strokeWidth="1"
                  rx="4"
                />

                {/* Antenna elements */}
                {elements}

                {/* Dimensions */}
                {renderDimensions()}
              </svg>
            </div>

            {/* Legend */}
            <div className="flex flex-col items-center pt-8">
              <div className="flex flex-row gap-4">
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-0.5 rounded"
                    style={{ backgroundColor: FIRST_POL_COLOR }}
                  ></div>
                  <span className="text-xs text-gray-300">
                    1st Polarization ({rollFirstDeg.toFixed(0)}°)
                  </span>
                </div>
                {dualPolarized === 2 && (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-0.5 rounded"
                      style={{ backgroundColor: SECOND_POL_COLOR }}
                    ></div>
                    <span className="text-xs text-gray-300">
                      2nd Polarization ({rollSecondDeg.toFixed(0)}°)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Properties */}
          <div className="space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
            <h4 className="text-sm font-medium text-gray-300">
              Panel Properties
            </h4>

            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Panel ID
                </label>
                <input
                  type="number"
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
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
                  className="w-full h-8 rounded border border-gray-700 hover:border-gray-600 flex items-center justify-center font-medium text-xs transition-all cursor-pointer mt-auto text-white"
                >
                  {panel.dualPolarized === 2 ? "Dual" : "Single"}
                </button>
              </div>
            </div>

            {/* Antenna Configuration */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Horizontal Antennas
                </label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
                  value={panel.numLocAntennaHorz}
                  onChange={(e) => {
                    const value = Math.max(
                      1,
                      Math.min(8, parseInt(e.target.value) || 1),
                    );
                    panelManager.update(panel.id, {
                      numLocAntennaHorz: value,
                    });
                  }}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Vertical Antennas
                </label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
                  value={panel.numLocAntennaVert}
                  onChange={(e) => {
                    const value = Math.max(
                      1,
                      Math.min(8, parseInt(e.target.value) || 1),
                    );
                    panelManager.update(panel.id, {
                      numLocAntennaVert: value,
                    });
                  }}
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
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white font-mono"
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
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white font-mono"
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
                  Roll of 1st Polarization [°]
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white font-mono"
                  value={rollFirstDeg.toFixed(1)}
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
                  Roll of 2nd Polarization [°]
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white font-mono"
                  value={rollSecondDeg.toFixed(1)}
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
                className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white font-mono"
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
                className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
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
                  const antennaNames = Array(numElements).fill(selectedType);

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
        </div>
      </div>
    </div>
  );
};

export const PanelLayoutVisualizer: React.FC<PanelLayoutVisualizerProps> = ({
  panel,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-800/60 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded transition-colors text-sm text-gray-300 hover:text-white"
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
            d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z"
          />
        </svg>
        View Panel Layout
      </button>

      <VisualizerModal
        panel={panel}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};
