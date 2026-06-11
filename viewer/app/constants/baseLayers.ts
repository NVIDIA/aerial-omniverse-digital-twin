/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base layer configuration for Cesium imagery providers
 *
 * LICENSE SUMMARY:
 * - Sentinel-2 (EOX): CC BY-NC-SA 4.0 - Free for non-commercial use
 * - CARTO basemaps: Free with attribution (OSM + CARTO)
 * - OpenStreetMap: ODbL - Free with attribution
 */

export interface BaseLayerConfig {
  id: string;
  name: string;
  type: "wmts" | "url" | "osm" | "ion";
  url: string;
  subdomains?: string[];
  credit: string;
  maximumLevel: number;
  ionAssetId?: number;
  // For WMTS providers
  layer?: string;
  style?: string;
  format?: string;
  tileMatrixSetID?: string;
}

export const BASE_LAYERS: BaseLayerConfig[] = [
  // Sentinel-2 cloudless 2024 layer from EOX (Web Mercator 3857)
  // Source: https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml
  // License: CC BY-NC-SA 4.0 (Non-commercial use only)
  // For commercial use, see: https://cloudless.eox.at
  {
    id: "sentinel2",
    name: "Sentinel-2 Satellite",
    type: "wmts",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{TileMatrix}/{TileRow}/{TileCol}.jpg",
    layer: "s2cloudless-2024_3857",
    style: "default",
    format: "image/jpeg",
    tileMatrixSetID: "GoogleMapsCompatible",
    credit:
      "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) | CC BY-NC-SA 4.0",
    maximumLevel: 14,
  },
  // CARTO Basemaps - Free with attribution
  // License: Free to use, data from OpenStreetMap (ODbL)
  // Source: https://carto.com/basemaps/
  {
    id: "carto-dark",
    name: "CARTO Dark",
    type: "url",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    subdomains: ["a", "b", "c", "d"],
    credit: "© OpenStreetMap contributors | © CARTO",
    maximumLevel: 20,
  },
  {
    id: "carto-light",
    name: "CARTO Light",
    type: "url",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
    subdomains: ["a", "b", "c", "d"],
    credit: "© OpenStreetMap contributors | © CARTO",
    maximumLevel: 20,
  },
  {
    id: "carto-voyager",
    name: "CARTO Voyager",
    type: "url",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    subdomains: ["a", "b", "c", "d"],
    credit: "© OpenStreetMap contributors | © CARTO",
    maximumLevel: 20,
  },
  // OpenStreetMap - Free with attribution
  // License: ODbL (Open Database License)
  // Source: https://www.openstreetmap.org/copyright
  {
    id: "osm",
    name: "OpenStreetMap",
    type: "osm",
    url: "https://tile.openstreetmap.org/",
    credit: "© OpenStreetMap contributors | ODbL",
    maximumLevel: 19,
  },
];

export const DEFAULT_BASE_LAYER_ID = "osm";

const ION_TOKEN_STORAGE_KEY = "cesium_ion_token";

export const ION_SATELLITE_LAYER: BaseLayerConfig = {
  id: "ion-satellite",
  name: "Cesium Ion Satellite",
  type: "ion",
  url: "",
  ionAssetId: 2,
  credit: "Cesium Ion | Bing Maps",
  maximumLevel: 19,
};

export function getCesiumIonToken(): string {
  try {
    return localStorage.getItem(ION_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setCesiumIonToken(token: string): void {
  try {
    if (token.trim()) {
      localStorage.setItem(ION_TOKEN_STORAGE_KEY, token.trim());
    } else {
      localStorage.removeItem(ION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}

export function getAvailableBaseLayers(): BaseLayerConfig[] {
  const token = getCesiumIonToken();
  if (token) {
    return [...BASE_LAYERS, ION_SATELLITE_LAYER];
  }
  return BASE_LAYERS;
}

/**
 * Get a base layer config by ID
 */
export const getBaseLayerById = (id: string): BaseLayerConfig | undefined => {
  return getAvailableBaseLayers().find((layer) => layer.id === id);
};
