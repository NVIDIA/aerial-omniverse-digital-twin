/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import * as Cesium from "cesium";
import { useViewerStore } from "../../../store/viewerStore";
import { is3DTileFeature } from "@/services/cesium";

function formatPropertyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return value.toFixed(6);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Raw string for hashing / assignment (preserves large integers better than number formatting). */
function rawPropertyString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

function findGlobalSurfaceHashPropertyKey(
  props: Record<string, unknown>,
): string | null {
  for (const k of Object.keys(props)) {
    if (k.toLowerCase() === "globalsurfacehash") return k;
  }
  return null;
}

function parseGlobalSurfaceHashes(value: unknown): string[] {
  const s = rawPropertyString(value).trim();
  if (!s) return [];
  return s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

const CopyIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
    />
  </svg>
);

export const BuildingProperties: React.FC = () => {
  const selectedObject = useViewerStore((s) => s.selectedObject);
  const setSelectedObject = useViewerStore((s) => s.setSelectedObject);
  const assignMaterialToSurfaceHashes = useViewerStore(
    (s) => s.assignMaterialToSurfaceHashes,
  );
  const surfaceMaterialAssignments = useViewerStore(
    (s) => s.surfaceMaterialAssignments,
  );

  // selectedObject should be a 3D tile feature (not a string)
  const selectedFeature =
    selectedObject && is3DTileFeature(selectedObject) ? selectedObject : null;

  // Extract properties from 3D tile feature with safety checks
  const { properties, featureValid, featureId } = useMemo(() => {
    if (!selectedFeature) {
      return { properties: {}, featureValid: false, featureId: undefined };
    }

    const props: Record<string, any> = {};
    const tileFeature = selectedFeature as Cesium.Cesium3DTileFeature;
    let valid = true;
    let fId: number | undefined;

    try {
      // Check if the feature's tileset is still valid
      if (!tileFeature.tileset || tileFeature.tileset.isDestroyed?.()) {
        valid = false;
      } else {
        fId = tileFeature.featureId;
        const propertyIds = tileFeature.getPropertyIds();
        if (propertyIds) {
          for (let i = 0; i < propertyIds.length; i++) {
            const propertyId = propertyIds[i];
            props[propertyId] = tileFeature.getProperty(propertyId);
          }
        }
      }
    } catch (error) {
      // Feature content is no longer available (tile was unloaded)
      console.warn("[BuildingProperties] Feature no longer available:", error);
      valid = false;
    }

    return { properties: props, featureValid: valid, featureId: fId };
  }, [selectedFeature]);

  const globalSurfaceHashKey = useMemo(
    () => findGlobalSurfaceHashPropertyKey(properties),
    [properties],
  );
  const globalSurfaceHashRaw =
    globalSurfaceHashKey !== null
      ? properties[globalSurfaceHashKey]
      : undefined;
  const surfaceHashes = useMemo(
    () => parseGlobalSurfaceHashes(globalSurfaceHashRaw),
    [globalSurfaceHashRaw],
  );

  const availableMaterials = useViewerStore((s) => s.availableMaterials);
  const [materialLabel, setMaterialLabel] = useState("");
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null);

  useEffect(() => {
    setMaterialLabel("");
    setAssignFeedback(null);
  }, [selectedFeature]);

  // Clear selection if feature becomes invalid
  useEffect(() => {
    if (selectedFeature && !featureValid) {
      setSelectedObject(null);
    }
  }, [selectedFeature, featureValid, setSelectedObject]);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyText = async (text: string, feedbackKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(feedbackKey);
    } catch {
      // Clipboard may be unavailable (e.g. non-secure context)
    }
  };

  // Show empty state if no feature selected
  if (!selectedFeature) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center py-8">
          <div className="text-gray-400 text-sm">
            <svg
              className="w-12 h-12 mx-auto mb-3 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <p>Click on a building to view its properties</p>
          </div>
        </div>
      </div>
    );
  }

  // Show message if feature is no longer valid (will be cleared by useEffect)
  if (!featureValid) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center py-8">
          <div className="text-gray-400 text-sm">
            <p>Building feature is no longer available.</p>
            <p className="text-xs mt-2">The tile may have been unloaded.</p>
          </div>
        </div>
      </div>
    );
  }

  // Helper to render property rows
  const renderProperty = (label: string, value: any) => {
    if (value === undefined || value === null) return null;

    const valueStr = formatPropertyValue(value);

    return (
      <tr key={label} className="border-b border-gray-700">
        <th
          className="text-left align-top py-2 pl-3 pr-2 text-xs font-medium text-gray-400 bg-gray-800/50 whitespace-normal break-anywhere"
          title={label}
        >
          {label}
        </th>
        <td className="py-2 pl-2 pr-2 text-xs text-gray-200 min-w-0 align-top">
          <div className="flex items-start gap-1.5 min-w-0">
            <span className="min-w-0 flex-1 truncate" title={valueStr}>
              {valueStr}
            </span>
            <button
              type="button"
              onClick={() => copyText(valueStr, label)}
              className="flex-shrink-0 rounded p-0.5 text-gray-500 hover:text-gray-200 hover:bg-gray-700/80 focus:outline-none focus:ring-1 focus:ring-gray-500"
              title="Copy value"
              aria-label={`Copy ${label}`}
            >
              {copiedKey === label ? (
                <span className="text-[10px] font-medium text-emerald-400 px-0.5">
                  Copied
                </span>
              ) : (
                <CopyIcon />
              )}
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const copyAllProperties = () => {
    const lines: string[] = [];
    lines.push(
      `Feature ID: ${featureId !== undefined ? String(featureId) : "N/A"}`,
    );
    lines.push("");
    for (const key of Object.keys(properties)) {
      const v = properties[key];
      if (v === undefined || v === null) continue;
      lines.push(`${key}: ${formatPropertyValue(v)}`);
    }
    return copyText(lines.join("\n"), "__all__");
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header with Back Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedObject(null)}
            className="text-gray-400 hover:text-white transition-colors"
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
          <div>
            <h3 className="text-md font-medium text-white">Building Feature</h3>
          </div>
        </div>
      </div>

      {/* Feature Info */}
      <div className="text-xs text-gray-400 bg-gray-800/30 rounded p-3">
        <p className="mb-1">
          <span className="font-medium text-gray-300">Feature ID:</span>{" "}
          {featureId !== undefined ? featureId : "N/A"}
        </p>
      </div>

      {globalSurfaceHashKey !== null && (
        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3 space-y-2">
          <div className="text-xs font-medium text-gray-300">
            Material assignment
          </div>
          <p className="text-[11px] text-gray-500 leading-snug">
            Assign a material name to every surface hash in{" "}
            <span className="text-gray-400">{globalSurfaceHashKey}</span>
            {surfaceHashes.length > 0 ? (
              <>
                {" "}
                ({surfaceHashes.length} surface
                {surfaceHashes.length === 1 ? "" : "s"})
              </>
            ) : (
              <span className="text-amber-500/90"> — no hashes parsed</span>
            )}
            . Used when exporting{" "}
            <span className="text-gray-400">assignment.json</span> from the
            header.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              value={materialLabel}
              onChange={(e) => setMaterialLabel(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-gray-600 bg-gray-900/80 px-2.5 py-1.5 text-xs text-gray-100 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              aria-label="Material name for all surface hashes"
            >
              <option value="">— Select material —</option>
              {availableMaterials.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={
                surfaceHashes.length === 0 || materialLabel.trim() === ""
              }
              onClick={() => {
                assignMaterialToSurfaceHashes(surfaceHashes, materialLabel);
                setAssignFeedback(
                  `Assigned ${surfaceHashes.length} surface hash${
                    surfaceHashes.length === 1 ? "" : "es"
                  } to "${materialLabel.trim()}".`,
                );
                window.setTimeout(() => setAssignFeedback(null), 3500);
              }}
              className="shrink-0 rounded-md bg-emerald-900/50 px-3 py-1.5 text-xs font-medium text-emerald-100 border border-emerald-800/80 hover:bg-emerald-900/80 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-1 focus:ring-emerald-600"
            >
              Assign to all surfaces
            </button>
          </div>
          {assignFeedback && (
            <p className="text-[11px] text-emerald-400/90">{assignFeedback}</p>
          )}
          {surfaceHashes.length > 0 && (
            <p className="text-[10px] text-gray-600">
              {surfaceHashes.filter((h) => surfaceMaterialAssignments[h])
                .length > 0
                ? `${surfaceHashes.filter((h) => surfaceMaterialAssignments[h]).length} of ${surfaceHashes.length} hashes in this building are in the export map.`
                : "None of this building's hashes are in the export map yet."}
            </p>
          )}
        </div>
      )}

      {/* Properties Table */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void copyAllProperties()}
          disabled={Object.keys(properties).length === 0}
          className="px-2.5 py-1 text-xs font-medium rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-1 focus:ring-gray-500"
        >
          {copiedKey === "__all__" ? "Copied!" : "Copy all"}
        </button>
      </div>
      <div className="border border-gray-700 rounded-lg overflow-x-auto max-w-full">
        <table className="w-full min-w-0 table-fixed text-sm">
          <colgroup>
            <col className="min-w-[11rem] w-[46%]" />
            <col className="min-w-0 w-[54%]" />
          </colgroup>
          <tbody>
            {Object.keys(properties).length > 0 ? (
              Object.keys(properties).map((key) =>
                renderProperty(key, properties[key]),
              )
            ) : (
              <tr>
                <td colSpan={2} className="py-4 px-3 text-center text-gray-400">
                  No properties available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
