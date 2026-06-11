/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback } from "react";
import { MinIOSettings } from "./MinIOSettings";
import {
  getCesiumIonToken,
  setCesiumIonToken,
} from "../../constants/baseLayers";
import {
  useGcpToolsEnabled,
  setGcpToolsEnabled,
} from "./tools/MeasureOffsetTool";

export const Settings: React.FC = () => {
  const isInitialMount = useRef(true);

  React.useEffect(() => {
    isInitialMount.current = false;
  }, []);

  return (
    <div className="px-4">
      <div className="py-2">
        <p className="text-xs text-gray-500">
          Connect to your Iceberg catalog (REST or AWS Glue) and S3-compatible
          endpoint to load scenario and visualization data.
        </p>
      </div>

      <div className="border-t border-gray-700 my-3"></div>

      <MinIOSettings shouldAutoConnect={isInitialMount.current} />

      <div className="border-t border-gray-700 my-3"></div>

      {/* Map Settings */}
      <div className="py-3 space-y-3">
        <h3 className="text-sm font-medium text-white">Map Settings</h3>
        <CesiumIonTokenInput />
        <GcpToolsToggle />
      </div>
    </div>
  );
};

const CesiumIonTokenInput: React.FC = () => {
  const [token, setToken] = useState(() => getCesiumIonToken());
  const [saved, setSaved] = useState(true);

  const handleSave = useCallback(() => {
    setCesiumIonToken(token);
    setSaved(true);
    if (token.trim()) {
      const Cesium = (window as any).Cesium;
      if (Cesium) {
        Cesium.Ion.defaultAccessToken = token.trim();
      }
    }
  }, [token]);

  const handleClear = useCallback(() => {
    setToken("");
    setCesiumIonToken("");
    setSaved(true);
  }, []);

  return (
    <div className="py-3 space-y-2">
      <label className="block text-xs text-gray-400">Cesium Ion Token</label>
      <div className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder="Paste your Cesium Ion access token"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#76B900]"
        />
        {token.trim() && !saved && (
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-[#76B900] text-black text-sm font-medium rounded hover:bg-[#6BA000] transition-colors"
          >
            Save
          </button>
        )}
        {token.trim() && saved && (
          <button
            onClick={handleClear}
            className="px-3 py-1.5 bg-gray-700 text-gray-300 text-sm rounded hover:bg-gray-600 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Adds Cesium Ion satellite imagery to base maps.
        {saved && token.trim() ? " Reload the page to apply." : ""}
      </p>
    </div>
  );
};

const GcpToolsToggle: React.FC = () => {
  const enabled = useGcpToolsEnabled();

  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs text-gray-400">Georeferencing tool</span>
      <button
        role="switch"
        aria-checked={enabled}
        onClick={() => setGcpToolsEnabled(!enabled)}
        className={`relative w-8 h-4.5 rounded-full transition-colors ${
          enabled ? "bg-[#76B900]" : "bg-gray-600"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${
            enabled ? "translate-x-3.5" : ""
          }`}
        />
      </button>
    </label>
  );
};
