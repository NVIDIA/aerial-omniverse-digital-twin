/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useViewerStore } from "@/store/viewerStore";

const GCP_TOOLS_KEY = "gcp_tools_enabled";
const GCP_TOOLS_EVENT = "gcp-tools-changed";

export function getGcpToolsEnabled(): boolean {
  try {
    return localStorage.getItem(GCP_TOOLS_KEY) === "true";
  } catch {
    return false;
  }
}

export function setGcpToolsEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(GCP_TOOLS_KEY, "true");
    } else {
      localStorage.removeItem(GCP_TOOLS_KEY);
    }
    window.dispatchEvent(new CustomEvent(GCP_TOOLS_EVENT));
  } catch {
    // ignore
  }
}

export function useGcpToolsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(getGcpToolsEnabled());
    const handler = () => setEnabled(getGcpToolsEnabled());
    window.addEventListener(GCP_TOOLS_EVENT, handler);
    return () => window.removeEventListener(GCP_TOOLS_EVENT, handler);
  }, []);

  return enabled;
}

interface PointPair {
  tileset: { lat: number; lon: number };
  basemap: { lat: number; lon: number };
}

type ClickStep = "tileset" | "basemap";

const NUM_PAIRS = 3;

function metersPerDegree(latDeg: number) {
  const latRad = (latDeg * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * latRad),
    lon: 111412.84 * Math.cos(latRad),
  };
}

interface PairOffset {
  dLatDeg: number;
  dLonDeg: number;
  dLatM: number;
  dLonM: number;
}

function computePairOffset(pair: PointPair): PairOffset {
  const dLatDeg = pair.basemap.lat - pair.tileset.lat;
  const dLonDeg = pair.basemap.lon - pair.tileset.lon;
  const m = metersPerDegree(pair.tileset.lat);
  return { dLatDeg, dLonDeg, dLatM: dLatDeg * m.lat, dLonM: dLonDeg * m.lon };
}

function computeResults(pairs: PointPair[]) {
  const perPair = pairs.map(computePairOffset);
  const n = perPair.length;
  const avg: PairOffset = {
    dLatDeg: perPair.reduce((s, p) => s + p.dLatDeg, 0) / n,
    dLonDeg: perPair.reduce((s, p) => s + p.dLonDeg, 0) / n,
    dLatM: perPair.reduce((s, p) => s + p.dLatM, 0) / n,
    dLonM: perPair.reduce((s, p) => s + p.dLonM, 0) / n,
  };
  return { perPair, avg };
}

export const MeasureOffsetTool: React.FC = () => {
  const [active, setActive] = useState(false);
  const [pairs, setPairs] = useState<PointPair[]>([]);
  const [currentStep, setCurrentStep] = useState<ClickStep>("tileset");
  const [pendingTileset, setPendingTileset] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const handlerRef = useRef<any>(null);

  const viewer = useViewerStore((s) => s.cesiumViewer);

  const reset = useCallback(() => {
    setPairs([]);
    setCurrentStep("tileset");
    setPendingTileset(null);
    setCopied(false);
  }, []);

  const deactivate = useCallback(() => {
    setActive(false);
    reset();
  }, [reset]);

  // Set up / tear down click handler
  useEffect(() => {
    if (!active || !viewer || !window.Cesium) {
      if (handlerRef.current) {
        handlerRef.current.destroy();
        handlerRef.current = null;
      }
      return;
    }

    const Cesium = window.Cesium;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    handler.setInputAction((event: any) => {
      const position = event.position;
      if (!position) return;

      // Use pickPosition for tileset clicks (picks on 3D tile surfaces)
      // Use globe.pick for basemap clicks (picks on the globe ignoring tiles)
      const isTilesetStep = currentStep === "tileset";

      let cartesian: any = null;
      if (isTilesetStep) {
        cartesian = viewer.scene.pickPosition(position);
      } else {
        const ray = viewer.camera.getPickRay(position);
        if (ray) {
          cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        }
      }

      if (!cartesian) return;

      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);

      if (isTilesetStep) {
        setPendingTileset({ lat, lon });
        setCurrentStep("basemap");
      } else {
        const tilesetPt = pendingTileset;
        if (!tilesetPt) return;

        setPairs((prev) => [
          ...prev,
          { tileset: tilesetPt, basemap: { lat, lon } },
        ]);
        setPendingTileset(null);
        setCurrentStep("tileset");
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
      handlerRef.current = null;
    };
  }, [active, viewer, currentStep, pendingTileset]);

  // Esc to deactivate
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") deactivate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, deactivate]);

  const done = pairs.length >= NUM_PAIRS;
  const result = done ? computeResults(pairs) : null;

  const fmtOffset = (o: PairOffset) =>
    `Lat: ${o.dLatDeg >= 0 ? "+" : ""}${o.dLatDeg.toFixed(8)}°  (${o.dLatM >= 0 ? "+" : ""}${o.dLatM.toFixed(2)} m)  |  Lon: ${o.dLonDeg >= 0 ? "+" : ""}${o.dLonDeg.toFixed(8)}°  (${o.dLonM >= 0 ? "+" : ""}${o.dLonM.toFixed(2)} m)`;

  const handleCopy = useCallback(() => {
    if (!result) return;
    const lines = [
      `Average offset (${NUM_PAIRS} pairs):`,
      `  ${fmtOffset(result.avg)}`,
      "",
      ...result.perPair.flatMap((p, i) => [
        `Pair ${i + 1}:`,
        `  Model:     ${pairs[i].tileset.lat.toFixed(8)}, ${pairs[i].tileset.lon.toFixed(8)}`,
        `  Reference: ${pairs[i].basemap.lat.toFixed(8)}, ${pairs[i].basemap.lon.toFixed(8)}`,
        `  Offset:    ${fmtOffset(p)}`,
        "",
      ]),
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  return (
    <>
      {/* Toolbar button */}
      <button
        onClick={() => (active ? deactivate() : setActive(true))}
        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
          active
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/50"
            : "text-gray-400 hover:text-white hover:bg-gray-700"
        }`}
        title="Measure Tileset Offset"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-6 h-6"
        >
          {/* First crosshair (top-left, representing tileset) */}
          <line x1="3" y1="7" x2="11" y2="7" />
          <line x1="7" y1="3" x2="7" y2="11" />
          {/* Second crosshair (bottom-right, representing basemap) */}
          <line x1="9" y1="13" x2="17" y2="13" />
          <line x1="13" y1="9" x2="13" y2="17" />
          {/* Offset arrow connecting them */}
          <line x1="9.5" y1="9.5" x2="11" y2="11" strokeDasharray="1.5 1" />
        </svg>
      </button>

      {/* Overlay - portaled to body to escape toolbar's transform context */}
      {active &&
        createPortal(
          <div className="fixed bottom-8 right-8 z-[60] bg-gray-900/95 border border-gray-700 rounded-lg shadow-2xl px-5 py-4 min-w-[340px] max-w-[420px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                Measure Tileset Offset
              </h3>
              <button
                onClick={deactivate}
                className="text-gray-500 hover:text-white p-0.5"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z" />
                </svg>
              </button>
            </div>

            {!done ? (
              <div className="space-y-3">
                <div className="text-xs text-gray-400">
                  Pair {pairs.length + 1} of {NUM_PAIRS}
                </div>

                {currentStep === "tileset" ? (
                  <p className="text-sm text-blue-300">
                    Click a recognizable point on the{" "}
                    <span className="font-semibold text-blue-200">
                      3D tileset
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-green-300">
                    Now click the same point on the{" "}
                    <span className="font-semibold text-green-200">
                      basemap
                    </span>
                  </p>
                )}

                {/* Progress dots */}
                <div className="flex gap-2">
                  {Array.from({ length: NUM_PAIRS }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full ${
                        i < pairs.length
                          ? "bg-[#76B900]"
                          : i === pairs.length
                            ? currentStep === "basemap"
                              ? "bg-amber-400"
                              : "bg-gray-600"
                            : "bg-gray-700"
                      }`}
                    />
                  ))}
                </div>

                {pairs.length > 0 && (
                  <button
                    onClick={reset}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    Reset measurements
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Per-pair results */}
                <div className="space-y-1.5">
                  {result!.perPair.map((p, i) => {
                    const pair = pairs[i];
                    const distM = Math.sqrt(
                      p.dLatM * p.dLatM + p.dLonM * p.dLonM,
                    );
                    return (
                      <div
                        key={i}
                        className="bg-gray-950 rounded-md px-3 py-2 font-mono text-xs"
                      >
                        <div className="text-gray-500 mb-1">Pair {i + 1}</div>
                        <div className="flex justify-between">
                          <span className="text-blue-400">Model:</span>
                          <span className="text-gray-300">
                            {pair.tileset.lat.toFixed(8)},{" "}
                            {pair.tileset.lon.toFixed(8)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-green-400">Reference:</span>
                          <span className="text-gray-300">
                            {pair.basemap.lat.toFixed(8)},{" "}
                            {pair.basemap.lon.toFixed(8)}
                          </span>
                        </div>
                        <div className="flex justify-between mt-1 border-t border-gray-800 pt-1">
                          <span className="text-gray-500">Offset:</span>
                          <span className="text-white">
                            {p.dLatM >= 0 ? "+" : ""}
                            {p.dLatM.toFixed(2)} m N, {p.dLonM >= 0 ? "+" : ""}
                            {p.dLonM.toFixed(2)} m E
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Distance:</span>
                          <span className="text-gray-300">
                            {distM.toFixed(2)} m
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Average */}
                <div className="bg-gray-950 rounded-md px-3 py-2 font-mono text-xs border border-[#76B900]/30">
                  <div className="text-[#76B900] font-medium mb-1">Average</div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Lat:</span>
                    <span className="text-white">
                      {result!.avg.dLatDeg >= 0 ? "+" : ""}
                      {result!.avg.dLatDeg.toFixed(8)}°{" "}
                      <span className="text-gray-400">
                        ({result!.avg.dLatM >= 0 ? "+" : ""}
                        {result!.avg.dLatM.toFixed(2)} m)
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Lon:</span>
                    <span className="text-white">
                      {result!.avg.dLonDeg >= 0 ? "+" : ""}
                      {result!.avg.dLonDeg.toFixed(8)}°{" "}
                      <span className="text-gray-400">
                        ({result!.avg.dLonM >= 0 ? "+" : ""}
                        {result!.avg.dLonM.toFixed(2)} m)
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-gray-500">Distance:</span>
                    <span className="text-gray-300">
                      {Math.sqrt(
                        result!.avg.dLatM * result!.avg.dLatM +
                          result!.avg.dLonM * result!.avg.dLonM,
                      ).toFixed(2)}{" "}
                      m
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className={`flex-1 text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      copied
                        ? "bg-[#76B900]/20 border-[#76B900]/50 text-[#76B900]"
                        : "bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700"
                    }`}
                  >
                    {copied ? "Copied!" : "Copy to clipboard"}
                  </button>
                  <button
                    onClick={reset}
                    className="text-xs px-3 py-1.5 rounded-md border border-gray-600 text-gray-400 hover:text-white hover:bg-gray-700"
                  >
                    Remeasure
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};
