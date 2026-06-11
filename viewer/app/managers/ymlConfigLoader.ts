/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * YML Configuration Loader
 *
 * Parses an uploaded AODT YML configuration file and populates
 * the entity managers (DUs, Panels, RUs, Scenario, UEs, Scatterers) with the
 * declared entities, using code defaults for any unspecified attributes.
 */
import jsYaml from "js-yaml";
import * as Cesium from "cesium";

import { radioUnitManager } from "./radioUnitManager";
import { distributedUnitManager } from "./distributedUnitManager";
import { userEquipmentManager } from "./userEquipmentManager";
import { panelManager } from "./panelManager";
import { scattererManager } from "./scattererManager";
import { raypathManager } from "./raypathManager";
import { spawnZoneManager } from "./spawnZoneManager";
import { spawnZoneLayer } from "@/components/layers/SpawnZoneLayer";
import {
  refreshGisTilesetsFromStorage,
  useViewerStore,
} from "@/store/viewerStore";
import {
  DEFAULT_S3_WAREHOUSE_SEGMENT,
  GIS_SCENE_URL_STORAGE_KEY,
  joinS3PathSegments,
  normalizeWarehouseGisDatasetPath,
} from "@/utils/gisTilesets";
import { localToCartographic, setCoordinateConfig } from "@/services/cesium";
import {
  DEFAULT_RADIO_UNIT_PROPERTIES,
  DEFAULT_DISTRIBUTED_UNIT_PROPERTIES,
  DEFAULT_USER_EQUIPMENT_PROPERTIES,
} from "@/constants/entityDefaults";
import { normalizeRuPanelTypeKey } from "@/utils/ruDuAutoAssign";
import { minioClient } from "@/services/database";

import type {
  RadioUnit,
  DistributedUnit,
  UserEquipment,
  Scatterer,
  Panel,
  Position,
  TimeIndexedPosition,
  TimeIndexedOrientation,
  Waypoint,
} from "@/types";
import type { ScenarioParams, TimeInfo } from "@/types/simulation";

// ============================================================================
// YML Type Definitions
// ============================================================================

type YmlPositionValue =
  | { x: number; y: number; z: number }
  | { lat: number; lon: number; alt?: number }
  | { pos: { x: number; y: number; z: number } }
  | { pos: { lat: number; lon: number; alt?: number } };

interface YmlDUAdd {
  id: number;
  /** Flat `{ x, y, z }` / `{ lat, lon, alt? }` or nested `{ pos: { x, y, z } }` (AODT exports). Legacy `position` still accepted when loading. */
  pos?: YmlPositionValue;
  position?: YmlPositionValue;
}

interface YmlPanelAdd {
  id: number;
  panel_file?: string;
}

interface YmlRUAdd {
  id: number;
  /** Geographic `{ lat, lon, alt? }`, local `{ x, y, z }` (m → lat/lon/alt via ENU), or nested under `pos`. Legacy `position` still accepted when loading. */
  pos?: YmlPositionValue;
  position?: YmlPositionValue;
}

interface YmlUEAdd {
  id: number;
  /** Waypoints may use `pos: { lat, lon }` or flat lat/lon and optional alt. */
  waypoints?: Array<Record<string, unknown>>;
}

interface YmlScattererAdd {
  id: number;
  isIndoor?: boolean;
  waypoints?: Array<{ lat: number; lon: number; alt?: number }>;
  orientations?: Array<{ heading: number; pitch: number; roll: number }>;
}

interface YmlUpdateEntry {
  attributes: Record<string, any>;
  ids?: (string | number)[];
}

interface YmlSimConfig {
  DUs?: {
    add?: YmlDUAdd[];
    update?: YmlUpdateEntry[];
    default?: string;
  };
  Panels?: {
    add?: YmlPanelAdd[];
    update?: YmlUpdateEntry[];
    default?: string;
  };
  RUs?: {
    add?: YmlRUAdd[];
    update?: YmlUpdateEntry[];
    default?: string;
  };
  Scenario?: {
    update?: YmlUpdateEntry[];
    default?: string;
  };
  UEs?: {
    add?: YmlUEAdd[];
    update?: YmlUpdateEntry[];
    default?: string;
  };
  Scatterers?: {
    add?: YmlScattererAdd[];
    update?: YmlUpdateEntry[];
    default?: string;
  };
}

interface YmlConfig {
  db?: Record<string, any>;
  sim?: YmlSimConfig;
  gis?: Record<string, any>;
}

/** Dispatched after MinIO connection fields are merged from an applied YML file. */
export const MINIO_SETTINGS_MERGED_EVENT = "minio-settings-merged-from-yml";

const MINIO_SETTINGS_STORAGE_KEY = "minio_settings";

type MinioS3Provider = "aws" | "minio";

interface MinioStoredConnection {
  catalogType?: "rest" | "glue";
  glueRegion?: string;
  catalogUri: string;
  s3Endpoint: string;
  s3BucketName: string;
  s3Provider: MinioS3Provider;
  accessKey?: string;
  secretKey?: string;
}

function normalizeS3Provider(value: unknown): MinioS3Provider | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  if (lower === "minio" || lower === "aws") return lower;
  return undefined;
}

/**
 * Reads db.parquet_export.iceberg.catalog_uri and db.s3_config (or first
 * db.parquet_export.s3_configs[] entry) for MinIO / catalog form fields.
 */
export function extractMinioFieldsFromYml(
  config: Record<string, unknown>,
): Partial<MinioStoredConnection> {
  const out: Partial<MinioStoredConnection> = {};
  const db = config.db;
  if (!db || typeof db !== "object") {
    return out;
  }

  const dbRecord = db as Record<string, unknown>;

  const parquetExport = dbRecord.parquet_export;
  if (parquetExport && typeof parquetExport === "object") {
    const pe = parquetExport as Record<string, unknown>;
    const iceberg = pe.iceberg;
    if (iceberg && typeof iceberg === "object") {
      const ice = iceberg as Record<string, unknown>;
      const cat = ice.catalog_uri;
      if (typeof cat === "string" && cat.trim()) {
        out.catalogUri = cat.trim();
      }
      const ctype = ice.catalog_type;
      if (ctype === "glue" || ctype === "rest") {
        out.catalogType = ctype;
      }
      const gr = ice.glue_region;
      if (typeof gr === "string" && gr.trim()) {
        out.glueRegion = gr.trim();
      }
    }
  }

  let s3: Record<string, unknown> | undefined;
  const direct = dbRecord.s3_config;
  if (direct && typeof direct === "object") {
    s3 = direct as Record<string, unknown>;
  } else if (parquetExport && typeof parquetExport === "object") {
    const pe = parquetExport as Record<string, unknown>;
    const list = pe.s3_configs;
    if (Array.isArray(list) && list[0] && typeof list[0] === "object") {
      s3 = list[0] as Record<string, unknown>;
    }
  }

  if (!s3) {
    return out;
  }

  const endpoint = s3.endpoint_url;
  if (typeof endpoint === "string" && endpoint.trim()) {
    out.s3Endpoint = endpoint.trim();
  }
  const bucket = s3.bucket;
  if (typeof bucket === "string" && bucket.trim()) {
    out.s3BucketName = bucket.trim();
  }
  const prov = normalizeS3Provider(s3.provider);
  if (prov) {
    out.s3Provider = prov;
  }

  const accessKey = s3.access_key;
  if (typeof accessKey === "string" && accessKey.trim()) {
    out.accessKey = accessKey.trim();
  }
  const secretKey = s3.secret_key;
  if (typeof secretKey === "string" && secretKey.trim()) {
    out.secretKey = secretKey.trim();
  }

  return out;
}

function mergeMinioSettingsFromYmlConfig(
  config: Record<string, unknown>,
  options?: { preferExistingLocalStorage?: boolean },
): void {
  if (typeof window === "undefined") return;

  const extracted = extractMinioFieldsFromYml(config);
  const keys = Object.keys(extracted) as (keyof MinioStoredConnection)[];
  if (keys.length === 0) return;

  const defaults: MinioStoredConnection = {
    catalogType: "rest",
    glueRegion: "us-east-1",
    catalogUri: "",
    s3Endpoint: "",
    s3BucketName: "",
    s3Provider: "minio",
    accessKey: "",
    secretKey: "",
  };

  let savedParsed: Partial<MinioStoredConnection> & { warehouse?: string } = {};
  try {
    const saved = localStorage.getItem(MINIO_SETTINGS_STORAGE_KEY);
    if (saved) {
      savedParsed = JSON.parse(saved) as Partial<MinioStoredConnection> & {
        warehouse?: string;
      };
      if (!savedParsed.s3BucketName?.trim() && savedParsed.warehouse?.trim()) {
        savedParsed = {
          ...savedParsed,
          s3BucketName: savedParsed.warehouse.trim(),
        };
      }
    }
  } catch {
    // ignore corrupt storage
  }

  // yml-wins: explicit apply — YML db.* overwrites saved MinIO settings.
  // preferExisting: cached re-apply on load — saved settings win so in-app edits are not reset.
  let merged: MinioStoredConnection = options?.preferExistingLocalStorage
    ? { ...defaults, ...extracted, ...savedParsed }
    : { ...defaults, ...savedParsed, ...extracted };

  if (!merged.s3BucketName?.trim() && savedParsed.warehouse?.trim()) {
    merged = { ...merged, s3BucketName: savedParsed.warehouse.trim() };
  }

  try {
    localStorage.setItem(MINIO_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent(MINIO_SETTINGS_MERGED_EVENT));
  } catch {
    // localStorage unavailable or full
  }
}

function mergeGisSceneUrlFromYmlConfig(config: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const gis = config.gis;
  if (!gis || typeof gis !== "object") return;
  const scene = (gis as Record<string, unknown>).scene;
  if (!scene || typeof scene !== "object") return;
  const sceneUrl = (scene as Record<string, unknown>).scene_url;
  if (typeof sceneUrl !== "string" || !sceneUrl.trim()) return;
  try {
    localStorage.setItem(GIS_SCENE_URL_STORAGE_KEY, sceneUrl.trim());
  } catch {
    // ignore
  }
}

async function fetchSceneMetadata(
  endpoint: string,
  bucketSeg: string,
  scene: string,
): Promise<void> {
  if (typeof window === "undefined") return;

  const url = joinS3PathSegments(
    endpoint,
    bucketSeg,
    scene,
    "sim",
    "master_metadata.json",
  );
  const meta = await minioClient.fetchJson(url);
  if (!meta) return;

  const lat = typeof meta.center_lat === "number" ? meta.center_lat : undefined;
  const lon = typeof meta.center_lon === "number" ? meta.center_lon : undefined;
  if (lat == null || lon == null) return;

  // Pass the full projected CRS so the viewer can convert local (X, Y) using
  // the same projection the producer (aodt_py) and simulator use. Anything
  // other than a string is ignored; coordinateService will then keep its
  // default CRS. `setCoordinateConfig` is async because a non-UTM CRS may
  // trigger a one-shot dynamic import of the epsg-index database.
  const crs =
    typeof meta.crs === "string" && meta.crs.trim().length > 0
      ? meta.crs.trim()
      : undefined;
  await setCoordinateConfig({
    centerLat: lat,
    centerLng: lon,
    ...(crs ? { crs } : {}),
    metersPerUnit: meta.meters_per_unit ?? 0.01,
  });
}

export async function fetchAvailableMaterials(): Promise<void> {
  if (typeof window === "undefined") return;

  const url = useViewerStore.getState().materialsJsonUrl;
  if (!url) return;

  try {
    const data = await minioClient.fetchJson(url);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.warn("[fetchAvailableMaterials] Invalid materials.json format");
      return;
    }

    useViewerStore.getState().setAvailableMaterials(Object.keys(data));
  } catch (error) {
    console.error(
      "[fetchAvailableMaterials] Failed to fetch materials:",
      error,
    );
    useViewerStore.getState().setAvailableMaterials([]);
  }
}

// ============================================================================
// Default values for Panels (no existing defaults in entityDefaults.ts)
// ============================================================================

const DEFAULT_PANEL_PROPERTIES: Omit<Panel, "id"> = {
  name: "panel",
  antennaNames: ["infinitesimal_dipole"],
  frequencies: [],
  /** Hz (matches Panel UI: GHz field uses referenceFreq / 1e9) */
  referenceFreq: 3600e6,
  dualPolarized: 0,
  numLocAntennaHorz: 1,
  numLocAntennaVert: 1,
  antennaSpacingHorzCm: 0,
  antennaSpacingVertCm: 0,
  antennaRollAngleFirstPolz: 0,
  antennaRollAngleSecondPolz: 0,
};

// ============================================================================
// Attribute Mapping: YML key → entity property
// ============================================================================

const DU_ATTRIBUTE_MAP: Record<string, keyof DistributedUnit> = {
  aerial_du_num_antennas: "numAntennas",
  aerial_du_subcarrier_spacing: "subcarrierSpacing",
  aerial_du_fft_size: "fftSize",
  aerial_du_max_channel_bandwidth: "maxChannelBandwidth",
  aerial_du_reference_freq: "referenceFreq",
};

/**
 * YAML may use subcarrier spacing in kHz (15, 30, 60, …) or Hz (15000, 30000).
 * {@link DistributedUnit.subcarrierSpacing} is always Hz (UI shows kHz).
 */
function normalizeDuSubcarrierSpacingHz(stored: number): number {
  if (!Number.isFinite(stored) || stored <= 0) return stored;
  // Shorthand kHz values; larger literals are already Hz (e.g. 30000).
  if (stored <= 1000) {
    return stored * 1000;
  }
  return stored;
}

const RU_ATTRIBUTE_MAP: Record<string, keyof RadioUnit> = {
  aerial_gnb_mech_azimuth: "mechAzimuth",
  aerial_gnb_mech_tilt: "mechTilt",
  aerial_gnb_height: "height",
  aerial_gnb_radiated_power: "radiatedPower",
  aerial_gnb_panel_type: "panelType",
  aerial_gnb_enable_rays: "enableRays",
  aerial_gnb_du_id: "duId",
  aerial_gnb_du_manual_assign: "duManualAssign",
  aerial_gnb_cell_id: "cellId",
  aerial_gnb_carrier_freq: "carrierFreqMHz",
};

const PANEL_ATTRIBUTE_MAP: Record<string, keyof Panel> = {
  antenna_names: "antennaNames",
  dual_polarized: "dualPolarized",
  num_loc_antenna_horz: "numLocAntennaHorz",
  num_loc_antenna_vert: "numLocAntennaVert",
  reference_freq_mhz: "referenceFreq",
  antenna_spacing_horz: "antennaSpacingHorzCm",
  antenna_spacing_vert: "antennaSpacingVertCm",
  antenna_roll_angle_first_polz: "antennaRollAngleFirstPolz",
  antenna_roll_angle_second_polz: "antennaRollAngleSecondPolz",
};

const SCENARIO_ATTRIBUTE_MAP: Record<string, keyof ScenarioParams> = {
  sim_duration: "duration",
  sim_interval: "interval",
  sim_num_procedural_ues: "numProceduralUEs",
  sim_is_seeded: "enableSeededMobility",
  sim_seed: "mobilitySeed",
  sim_ue_min_speed: "ueMinSpeed",
  sim_ue_max_speed: "ueMaxSpeed",
  um_enable_urban_mobility: "enableUrbanMobility",
  sim_enable_dynamic_scattering: "enableDynamicScattering",
  um_num_vehicles: "maxNumVehicles",
  sim_slots_per_batch: "slotsPerBatch",
  sim_batches: "batches",
};

const SCATTERER_ATTRIBUTE_MAP: Record<string, keyof Scatterer> = {
  is_indoor_mobility: "isIndoor",
};

const UE_ATTRIBUTE_MAP: Record<string, keyof UserEquipment> = {
  // Legacy colon format (loading only — underscore equivalents win in reverse map)
  "aerial:ue:radiated_power": "radiatedPower",
  "aerial:ue:mech_tilt": "mechTilt",
  "aerial:ue:is_manual": "isManual",
  // Current underscore format (matches client UE::toAttributeMap)
  aerial_ue_radiated_power: "radiatedPower",
  aerial_ue_mech_tilt: "mechTilt",
  aerial_ue_manual: "isManual",
};

// ============================================================================
// Reverse Attribute Mapping: entity property → YML key
// ============================================================================

function reverseMap<V extends string>(
  map: Record<string, V>,
): Record<V, string> {
  const reversed: Record<string, string> = {};
  for (const [ymlKey, entityKey] of Object.entries(map)) {
    reversed[entityKey] = ymlKey;
  }
  return reversed as Record<V, string>;
}

const REVERSE_DU_MAP = reverseMap(DU_ATTRIBUTE_MAP);
const REVERSE_RU_MAP = reverseMap(RU_ATTRIBUTE_MAP);
const REVERSE_PANEL_MAP = reverseMap(PANEL_ATTRIBUTE_MAP);
const REVERSE_SCATTERER_MAP = reverseMap(SCATTERER_ATTRIBUTE_MAP);
const REVERSE_UE_MAP = reverseMap(UE_ATTRIBUTE_MAP);
const REVERSE_SCENARIO_MAP = reverseMap(SCENARIO_ATTRIBUTE_MAP);

// ============================================================================
// Helper functions
// ============================================================================

function cloneYamlValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneYamlValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = cloneYamlValue(child);
    }
    return out as T;
  }
  return value;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function updateEntryIds(entry: YmlUpdateEntry): (string | number)[] {
  return Array.isArray(entry.ids) && entry.ids.length > 0 ? entry.ids : ["*"];
}

function updateEntryTargetsId(entry: YmlUpdateEntry, id: number): boolean {
  return updateEntryIds(entry).some((rawId) => {
    if (rawId === "*") return true;
    return Number(rawId) === id;
  });
}

function existingAddForId(
  section: { add?: Array<Record<string, unknown>> } | undefined,
  id: number,
): Record<string, unknown> | undefined {
  return section?.add?.find((entry) => Number(entry.id) === id);
}

function existingUpdateForId(
  section: { update?: YmlUpdateEntry[] } | undefined,
  id: number,
): YmlUpdateEntry | undefined {
  return section?.update?.find((entry) => updateEntryTargetsId(entry, id));
}

function idsForSerializedEntity(
  existingUpdate: YmlUpdateEntry | undefined,
  id: number,
): (string | number)[] {
  const ids = existingUpdate?.ids;
  if (
    Array.isArray(ids) &&
    ids.length === 1 &&
    ids[0] !== "*" &&
    Number(ids[0]) === id
  ) {
    return cloneYamlValue(ids);
  }
  return [id];
}

function sectionMetadataOnly(
  existingSection: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existingSection) return undefined;
  const preserved = cloneYamlValue(existingSection);
  delete preserved.add;
  delete preserved.update;
  return Object.keys(preserved).length > 0 ? preserved : undefined;
}

function roundForYml(value: number, decimals = 12): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function ymlPositionSource(
  entry: Record<string, unknown> | undefined,
): unknown {
  return entry?.position ?? entry?.pos;
}

function positionFromYmlPosition(raw: unknown): Position | null {
  if (!raw || typeof raw !== "object") return null;
  const pos = unwrapNestedPos(raw as Record<string, unknown>);
  if ("lat" in pos && "lon" in pos) {
    const p = pos as {
      lat: number;
      lon: number;
      alt?: number;
      height?: number;
    };
    return positionFromLatLon(
      Number(p.lat ?? 0),
      Number(p.lon ?? 0),
      Number(p.alt ?? p.height ?? 0),
    );
  }
  const p = pos as { x?: number; y?: number; z?: number };
  return positionFromLocal(
    Number(p.x ?? 0),
    Number(p.y ?? 0),
    Number(p.z ?? 0),
  );
}

function positionsAlmostEqual(a: Position, b: Position): boolean {
  const heightA = a.cartographic.height + (a.terrainHeight ?? 0);
  const heightB = b.cartographic.height + (b.terrainHeight ?? 0);
  return (
    Math.abs(a.cartographic.latitude - b.cartographic.latitude) <= 1e-9 &&
    Math.abs(a.cartographic.longitude - b.cartographic.longitude) <= 1e-9 &&
    Math.abs(heightA - heightB) <= 1e-3
  );
}

function serializePositionAdd<T extends { id: number }>(
  id: number,
  position: Position,
  existingAdd: Record<string, unknown> | undefined,
): T {
  const existingPosition = positionFromYmlPosition(
    ymlPositionSource(existingAdd),
  );
  if (
    existingAdd &&
    existingPosition &&
    positionsAlmostEqual(position, existingPosition)
  ) {
    return cloneYamlValue(existingAdd) as T;
  }

  const lat = Cesium.Math.toDegrees(position.cartographic.latitude);
  const lon = Cesium.Math.toDegrees(position.cartographic.longitude);
  const add = existingAdd
    ? cloneYamlValue(existingAdd)
    : ({ id } as Record<string, unknown>);
  delete add.pos;
  add.id = id;
  add.position = { pos: { lat, lon } };
  return add as T;
}

function setAttr(
  attrs: Record<string, any>,
  ymlKey: string,
  value: unknown,
): void {
  if (value !== undefined) attrs[ymlKey] = value;
}

function setCanonicalAttr(
  attrs: Record<string, any>,
  canonicalKey: string,
  aliases: string[],
  value: unknown,
): void {
  setAttr(attrs, canonicalKey, value);
  for (const alias of aliases) {
    if (alias !== canonicalKey) delete attrs[alias];
  }
}

/**
 * Some AODT YAML files nest coordinates under `pos`, e.g.
 * `pos: { pos: { x, y, z } }` or `waypoints: [{ pos: { lat, lon } }]`.
 */
/**
 * Simulator / parquet sometimes stores gNB Tx power as linear watts (from dBm)
 * while YAML and this UI use dBm. Detect the standard watt values for integer
 * dBm EIRPs and convert back to dBm so upload → download round-trips cleanly.
 */
function coerceRuRadiatedPowerDbm(rp: number): number {
  if (!Number.isFinite(rp)) return rp;
  for (let dbm = 10; dbm <= 53; dbm++) {
    const watts = Math.pow(10, (dbm - 30) / 10);
    if (Math.abs(rp - watts) <= 1e-5 * Math.max(1, watts)) return dbm;
  }
  return rp;
}

/** Integer panel index for YAML (matches aerial_gnb_panel_type in AODT exports). */
function ruPanelTypeForYmlExport(
  panelType: RadioUnit["panelType"],
): number | string {
  const key = normalizeRuPanelTypeKey(panelType);
  const m = /^panel_(\d+)$/i.exec(key);
  if (m) return parseInt(m[1], 10);
  if (typeof panelType === "number" && Number.isFinite(panelType))
    return Math.trunc(panelType);
  return key;
}

function unwrapNestedPos<T extends Record<string, unknown>>(
  raw: T | undefined | null,
): T {
  if (!raw || typeof raw !== "object") {
    return {} as T;
  }
  const inner = (raw as { pos?: unknown }).pos;
  if (inner && typeof inner === "object") {
    return inner as T;
  }
  return raw;
}

/** Lat/lon/alt for UE or scatterer waypoints (flat or under `pos`). */
function waypointGeo(wp: Record<string, unknown>): {
  lat: number;
  lon: number;
  alt: number;
} {
  const geo = unwrapNestedPos(wp);
  let alt = 0;
  if ("alt" in geo) alt = Number((geo as { alt: unknown }).alt);
  else if ("alt" in wp) alt = Number((wp as { alt: unknown }).alt);
  return {
    lat: Number((geo as { lat?: number }).lat ?? 0),
    lon: Number((geo as { lon?: number }).lon ?? 0),
    alt,
  };
}

/**
 * Create a Position object from lat/lon in degrees.
 */
function positionFromLatLon(
  lat: number,
  lon: number,
  height: number = 0,
): Position {
  return {
    cartographic: Cesium.Cartographic.fromDegrees(lon, lat, height),
    terrainHeight: 0,
  };
}

/**
 * Create a Position object from local x/y/z coordinates (in meters).
 * localToCartographic expects centimeters, so we convert meters → cm.
 */
function positionFromLocal(x: number, y: number, z: number): Position {
  const cartographic = localToCartographic([x * 100, y * 100, z * 100]);
  return {
    cartographic,
    terrainHeight: 0,
  };
}

/**
 * Apply YML update entries to a map of entities.
 * Handles wildcard ('*') and specific ID matching.
 */
function applyUpdates<T extends { id: number }>(
  entities: Map<number, T>,
  updates: YmlUpdateEntry[] | undefined,
  attributeMap: Record<string, keyof T>,
): void {
  if (!updates) return;

  for (const entry of updates) {
    const ids = updateEntryIds(entry);
    const isWildcard = ids.some((id) => id === "*");
    const targetIds = isWildcard
      ? Array.from(entities.keys())
      : ids.map(Number).filter((id) => entities.has(id));

    for (const id of targetIds) {
      const entity = entities.get(id);
      if (!entity) continue;

      for (const [ymlKey, value] of Object.entries(entry.attributes)) {
        const entityKey = attributeMap[ymlKey];
        if (entityKey && entityKey !== "id") {
          (entity as any)[entityKey] = value;
        }
      }
    }
  }
}

/** UI uses 2 = dual polarized, 0 = single; YAML often uses booleans. */
function normalizePanelDualPolarized(raw: unknown): number {
  if (raw === true || raw === 1 || raw === 2) return 2;
  return 0;
}

/**
 * Apply Panel YML updates with unit/name variants (mm vs cm, *_degree, MHz → Hz).
 * Generic applyUpdates cannot express these conversions.
 */
function applyPanelUpdates(
  entities: Map<number, Panel>,
  updates: YmlUpdateEntry[] | undefined,
): void {
  if (!updates) return;

  for (const entry of updates) {
    const ids = updateEntryIds(entry);
    const isWildcard = ids.some((id) => id === "*");
    const targetIds = isWildcard
      ? Array.from(entities.keys())
      : ids.map(Number).filter((id) => entities.has(id));

    for (const id of targetIds) {
      const panel = entities.get(id);
      if (!panel) continue;

      for (const [ymlKey, raw] of Object.entries(entry.attributes)) {
        switch (ymlKey) {
          case "antenna_names":
            panel.antennaNames = raw as string[];
            break;
          case "dual_polarized":
            panel.dualPolarized = normalizePanelDualPolarized(raw);
            break;
          case "num_loc_antenna_horz":
            panel.numLocAntennaHorz = Number(raw);
            break;
          case "num_loc_antenna_vert":
            panel.numLocAntennaVert = Number(raw);
            break;
          case "reference_freq_mhz":
            panel.referenceFreq = Number(raw) * 1e6;
            break;
          case "antenna_spacing_horz":
          case "antenna_spacing_horz_cm":
            panel.antennaSpacingHorzCm = Number(raw);
            break;
          case "antenna_spacing_vert":
          case "antenna_spacing_vert_cm":
            panel.antennaSpacingVertCm = Number(raw);
            break;
          case "antenna_spacing_horz_mm":
            panel.antennaSpacingHorzCm = Number(raw) / 10;
            break;
          case "antenna_spacing_vert_mm":
            panel.antennaSpacingVertCm = Number(raw) / 10;
            break;
          case "antenna_roll_angle_first_polz":
            panel.antennaRollAngleFirstPolz = Number(raw);
            break;
          case "antenna_roll_angle_first_polz_degree":
            panel.antennaRollAngleFirstPolz = Number(raw) * (Math.PI / 180);
            break;
          case "antenna_roll_angle_second_polz":
            panel.antennaRollAngleSecondPolz = Number(raw);
            break;
          case "antenna_roll_angle_second_polz_degree":
            panel.antennaRollAngleSecondPolz = Number(raw) * (Math.PI / 180);
            break;
          default:
            break;
        }
      }
    }
  }
}

// ============================================================================
// Entity creation functions
// ============================================================================

/**
 * Create DistributedUnit entities from YML config
 */
function createDistributedUnits(
  config: YmlSimConfig,
): Map<number, DistributedUnit> {
  const duMap = new Map<number, DistributedUnit>();
  const duConfig = config.DUs;
  if (!duConfig?.add) return duMap;

  for (const entry of duConfig.add) {
    const raw =
      entry.pos ?? (entry as YmlDUAdd & { position?: unknown }).position;
    const pos = raw
      ? unwrapNestedPos(raw as Record<string, unknown>)
      : { x: 0, y: 0, z: 0 };

    // Support both local (x/y/z) and geographic (lat/lon) position formats
    let position: Position;
    if ("lat" in pos && "lon" in pos) {
      const p = pos as {
        lat: number;
        lon: number;
        alt?: number;
        height?: number;
      };
      position = positionFromLatLon(p.lat, p.lon, p.alt ?? p.height ?? 0);
    } else {
      const p = pos as { x?: number; y?: number; z?: number };
      position = positionFromLocal(
        Number(p.x ?? 0),
        Number(p.y ?? 0),
        Number(p.z ?? 0),
      );
    }

    const du: DistributedUnit = {
      id: entry.id,
      position,
      ...DEFAULT_DISTRIBUTED_UNIT_PROPERTIES,
    };
    duMap.set(du.id, du);
  }

  applyUpdates(duMap, duConfig.update, DU_ATTRIBUTE_MAP);

  for (const du of duMap.values()) {
    du.subcarrierSpacing = normalizeDuSubcarrierSpacingHz(du.subcarrierSpacing);
  }

  return duMap;
}

/**
 * Create Panel entities from YML config
 */
function createPanels(config: YmlSimConfig): Map<number, Panel> {
  const panelMap = new Map<number, Panel>();
  const panelConfig = config.Panels;
  if (!panelConfig?.add) return panelMap;

  for (const entry of panelConfig.add) {
    const panel: Panel = {
      id: entry.id,
      ...DEFAULT_PANEL_PROPERTIES,
      name: `panel_${String(entry.id).padStart(2, "0")}`,
    };
    panelMap.set(panel.id, panel);
  }

  applyPanelUpdates(panelMap, panelConfig.update);
  return panelMap;
}

/**
 * Create RadioUnit entities from YML config
 */
function createRadioUnits(config: YmlSimConfig): Map<number, RadioUnit> {
  const ruMap = new Map<number, RadioUnit>();
  const ruConfig = config.RUs;
  if (!ruConfig?.add) return ruMap;

  for (const entry of ruConfig.add) {
    const raw =
      entry.pos ?? (entry as YmlRUAdd & { position?: unknown }).position;
    const pos = raw
      ? unwrapNestedPos(raw as Record<string, unknown>)
      : { lat: 0, lon: 0 };

    let position: Position;
    if ("lat" in pos && "lon" in pos) {
      const p = pos as {
        lat: number;
        lon: number;
        alt?: number;
        height?: number;
      };
      position = positionFromLatLon(
        Number(p.lat ?? 0),
        Number(p.lon ?? 0),
        Number(p.alt ?? p.height ?? 0),
      );
    } else {
      const p = pos as { x?: number; y?: number; z?: number };
      position = positionFromLocal(
        Number(p.x ?? 0),
        Number(p.y ?? 0),
        Number(p.z ?? 0),
      );
    }

    const ru: RadioUnit = {
      id: entry.id,
      cellId: entry.id,
      position,
      ...DEFAULT_RADIO_UNIT_PROPERTIES,
    };
    ruMap.set(ru.id, ru);
  }

  applyUpdates(ruMap, ruConfig.update, RU_ATTRIBUTE_MAP);

  for (const [, ru] of ruMap) {
    ru.radiatedPower = coerceRuRadiatedPowerDbm(ru.radiatedPower as number);
  }

  // Rebuild orientation from potentially-updated mechAzimuth / mechTilt
  for (const [, ru] of ruMap) {
    ru.orientation = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(ru.mechAzimuth),
      Cesium.Math.toRadians(ru.mechTilt),
      0,
    );
  }

  return ruMap;
}

/**
 * Build scenario params from YML config
 */
function buildScenarioParams(
  config: YmlSimConfig,
): Partial<ScenarioParams> | null {
  const scenarioConfig = config.Scenario;
  if (!scenarioConfig?.update) return null;

  const params: Partial<ScenarioParams> = {};

  for (const entry of scenarioConfig.update) {
    for (const [ymlKey, value] of Object.entries(entry.attributes)) {
      // Handle sim_is_full → simulationMode specially (boolean → enum)
      if (ymlKey === "sim_is_full") {
        params.simulationMode = value ? "Slots" : "Duration";
        continue;
      }

      const paramKey = SCENARIO_ATTRIBUTE_MAP[ymlKey];
      if (paramKey) {
        (params as any)[paramKey] = value;
      }
    }
  }

  return Object.keys(params).length > 0 ? params : null;
}

/**
 * Generate TimeInfo[] from the Scenario section of a YML config.
 *
 * If sim_is_full is true  → # of samples = sim_slots_per_batch × sim_batches
 * If sim_is_full is false → # of samples = sim_duration / sim_interval
 *
 * Returns null when the required attributes are missing.
 */
function generateTimeIndices(config: YmlSimConfig): TimeInfo[] | null {
  const scenarioConfig = config.Scenario;
  if (!scenarioConfig?.update) return null;

  // Collect all scenario attributes into a flat map
  const attrs: Record<string, any> = {};
  for (const entry of scenarioConfig.update) {
    for (const [key, value] of Object.entries(entry.attributes)) {
      attrs[key] = value;
    }
  }

  const isFull: boolean = !!attrs["sim_is_full"];

  let numSamples: number;
  let slotsPerBatch: number;

  if (isFull) {
    slotsPerBatch = Number(attrs["sim_slots_per_batch"] ?? 0);
    const batches = Number(attrs["sim_batches"] ?? 0);
    if (slotsPerBatch <= 0 || batches <= 0) return null;
    numSamples = slotsPerBatch * batches;
  } else {
    const duration = Number(attrs["sim_duration"] ?? 0);
    const interval = Number(attrs["sim_interval"] ?? 0);
    if (duration <= 0 || interval <= 0) return null;
    numSamples = Math.round(duration / interval) + 1;
    slotsPerBatch = Number(attrs["sim_slots_per_batch"] ?? numSamples);
  }

  const timeIndices: TimeInfo[] = [];
  for (let i = 0; i < numSamples; i++) {
    timeIndices.push({
      time_idx: i,
      batch_idx: slotsPerBatch > 0 ? Math.floor(i / slotsPerBatch) : 0,
      slot_idx: slotsPerBatch > 0 ? i % slotsPerBatch : i,
      symbol_idx: 0,
    });
  }

  return timeIndices.length > 0 ? timeIndices : null;
}

/**
 * Create UserEquipment entities from YML config
 */
function createUserEquipments(
  config: YmlSimConfig,
): Map<number, UserEquipment> {
  const ueMap = new Map<number, UserEquipment>();
  const ueConfig = config.UEs;
  if (!ueConfig?.add) return ueMap;

  for (const entry of ueConfig.add) {
    const waypoints: Waypoint[] = (entry.waypoints ?? []).map((wp, idx) => {
      const w = wp as Record<string, unknown>;
      const g = waypointGeo(w);
      return {
        id: idx,
        position: positionFromLatLon(g.lat, g.lon, g.alt),
        speed: Number((w as any).speed ?? 0),
        stop: Number((w as any).pause_duration ?? 0),
        azimuth_offset: Number((w as any).azimuth_offset ?? 0),
        arrival_time: Number((w as any).arrival_time ?? -1),
      };
    });

    const ue: UserEquipment = {
      id: entry.id,
      positions: [],
      waypoints,
      ...DEFAULT_USER_EQUIPMENT_PROPERTIES,
    };
    ueMap.set(ue.id, ue);
  }

  applyUpdates(ueMap, ueConfig.update, UE_ATTRIBUTE_MAP);
  applyUEWaypointArrays(ueMap, ueConfig.update);
  return ueMap;
}

/** Maps YAML per-waypoint array keys to the corresponding Waypoint field. */
const WAYPOINT_ARRAY_MAP: Record<string, keyof Waypoint> = {
  waypoint_speed: "speed",
  waypoint_pause_duration: "stop",
  waypoint_azimuth_offset: "azimuth_offset",
};

/**
 * Applies per-waypoint array attributes and aerial_ue_panel_type from UE
 * update entries — things the generic applyUpdates cannot handle.
 */
function applyUEWaypointArrays(
  ues: Map<number, UserEquipment>,
  updates: YmlUpdateEntry[] | undefined,
): void {
  if (!updates) return;

  for (const entry of updates) {
    const ids = updateEntryIds(entry);
    const isWildcard = ids.some((id) => id === "*");
    const targetIds = isWildcard
      ? Array.from(ues.keys())
      : ids.map(Number).filter((id) => ues.has(id));

    for (const id of targetIds) {
      const ue = ues.get(id);
      if (!ue) continue;

      // Per-waypoint arrays (waypoint_speed, waypoint_pause_duration, waypoint_azimuth_offset)
      for (const [ymlKey, waypointKey] of Object.entries(WAYPOINT_ARRAY_MAP)) {
        const arr = entry.attributes[ymlKey];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < Math.min(arr.length, ue.waypoints.length); i++) {
          (ue.waypoints[i] as any)[waypointKey] = arr[i];
        }
      }

      // aerial_ue_panel_type: single int → panel array
      const panelType = entry.attributes["aerial_ue_panel_type"];
      if (panelType !== undefined) {
        ue.panel = [Number(panelType)];
      }
    }
  }
}

/**
 * Create Scatterer entities from YML config
 */
function createScatterers(config: YmlSimConfig): Map<number, Scatterer> {
  const scattererMap = new Map<number, Scatterer>();
  const scattererConfig = config.Scatterers;
  if (!scattererConfig?.add) return scattererMap;

  for (const entry of scattererConfig.add) {
    const waypoints = entry.waypoints ?? [];
    const orientationEntries = entry.orientations ?? [];

    const positions: TimeIndexedPosition[] = waypoints.map((wp, idx) => {
      const w = wp as Record<string, unknown>;
      const g = waypointGeo(w);
      return {
        timeIdx: idx,
        position: positionFromLatLon(g.lat, g.lon, g.alt),
      };
    });

    const orientations: TimeIndexedOrientation[] = orientationEntries.map(
      (o, idx) => ({
        timeIdx: idx,
        orientation: new Cesium.HeadingPitchRoll(
          Cesium.Math.toRadians(o.heading),
          Cesium.Math.toRadians(o.pitch),
          Cesium.Math.toRadians(o.roll),
        ),
      }),
    );

    // If fewer orientations than positions, pad with identity orientation
    while (orientations.length < positions.length) {
      orientations.push({
        timeIdx: orientations.length,
        orientation: new Cesium.HeadingPitchRoll(0, 0, 0),
      });
    }

    const scatterer: Scatterer = {
      id: entry.id,
      positions,
      orientations,
      isIndoor: entry.isIndoor ?? false,
    };
    scattererMap.set(scatterer.id, scatterer);
  }

  applyUpdates(scattererMap, scattererConfig.update, SCATTERER_ATTRIBUTE_MAP);
  return scattererMap;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Clear all entities from every manager.
 * Call this when the YML file is removed from storage.
 */
export function clearAllEntities(): void {
  _isSyncing = true;
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }
  try {
    distributedUnitManager.clear();
    panelManager.clear();
    radioUnitManager.clear();
    userEquipmentManager.clear();
    scattererManager.clear();
    raypathManager.clear();
    spawnZoneManager.clear();
    spawnZoneLayer.clear();

    useViewerStore.getState().setYmlTimeData([]);
    useViewerStore.setState({ vizBaseUrl: null, tilesets: [] });

    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(GIS_SCENE_URL_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  } finally {
    _isSyncing = false;
  }
}

/**
 * Parse a YAML string and apply the configuration to entity managers.
 * Clears all existing entities before creating new ones.
 *
 * @param yamlContent - Raw YAML string from the uploaded file
 * @param options.preferExistingMinioSettings - If true, MinIO/Iceberg fields already in
 *   `localStorage` (minio_settings) are kept; YML only fills gaps. Use when re-applying
 *   cached YML on page load so user-edited connection fields are not overwritten.
 * @returns A summary of what was created, or throws on parse error
 */
export interface ApplyYmlConfigOptions {
  preferExistingMinioSettings?: boolean;
}

/**
 * True if the YAML defines any entity with a projected (x/y/z) position —
 * i.e. positions that will go through `positionFromLocal` and depend on
 * the scene's CRS. Used by callers to decide whether a
 * `prefetchSceneMetadataFromYmlConfig` failure is fatal: if no projected
 * positions are present, applying the YAML with the previous CRS is safe.
 */
export function ymlConfigUsesProjectedPositions(yamlContent: string): boolean {
  let config: unknown;
  try {
    config = jsYaml.load(yamlContent);
  } catch {
    return false;
  }
  const sim = (config as any)?.sim;
  if (!sim || typeof sim !== "object") return false;
  const groups = [
    "Distributed_units",
    "Radio_units",
    "User_equipments",
    "Scatterers",
  ];
  for (const group of groups) {
    const entities = sim[group];
    if (!entities || typeof entities !== "object") continue;
    for (const entity of Object.values(entities)) {
      const pos = (entity as any)?.position;
      if (pos == null) continue;
      if (Array.isArray(pos)) return true;
      if (typeof pos === "object" && !("lat" in pos && "lon" in pos)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Pre-fetch scene metadata (and resolve its CRS via setCoordinateConfig)
 * before `applyYmlConfig` is called. Must be awaited so that subsequent
 * `positionFromLocal` calls inside `applyYmlConfig` use the correct CRS.
 *
 * Safe to call when the YAML has no scene info — it simply returns.
 */
export async function prefetchSceneMetadataFromYmlConfig(
  yamlContent: string,
): Promise<void> {
  const config = jsYaml.load(yamlContent) as YmlConfig;
  if (!config || typeof config !== "object") return;

  const s3Config = config.db?.s3_config;
  const sceneUrl = config.gis?.scene?.scene_url;
  if (!s3Config?.endpoint_url || !sceneUrl) return;

  const endpoint = s3Config.endpoint_url.replace(/\/+$/, "");
  const bucketSeg =
    typeof s3Config.bucket === "string" && s3Config.bucket.trim()
      ? s3Config.bucket.trim()
      : DEFAULT_S3_WAREHOUSE_SEGMENT;
  const scene = normalizeWarehouseGisDatasetPath(
    sceneUrl.replace(/^\/+|\/+$/g, ""),
    bucketSeg,
  );
  await fetchSceneMetadata(endpoint, bucketSeg, scene);
}

export function applyYmlConfig(
  yamlContent: string,
  options?: ApplyYmlConfigOptions,
): {
  distributedUnits: number;
  panels: number;
  radioUnits: number;
  userEquipments: number;
  scatterers: number;
  scenarioUpdated: boolean;
  timeIndices: number;
} {
  // Prevent sync-back while we are applying a config
  _isSyncing = true;
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }

  try {
    // 1. Parse YAML
    const config = jsYaml.load(yamlContent) as YmlConfig;
    if (!config || typeof config !== "object") {
      throw new Error("Invalid YML configuration: expected an object");
    }

    mergeMinioSettingsFromYmlConfig(config as Record<string, unknown>, {
      preferExistingLocalStorage: options?.preferExistingMinioSettings === true,
    });
    mergeGisSceneUrlFromYmlConfig(config as Record<string, unknown>);
    refreshGisTilesetsFromStorage();

    const s3Config = config.db?.s3_config;
    const sceneUrl = config.gis?.scene?.scene_url;
    if (s3Config?.endpoint_url && sceneUrl) {
      const endpoint = s3Config.endpoint_url.replace(/\/+$/, "");
      const bucketSeg =
        typeof s3Config.bucket === "string" && s3Config.bucket.trim()
          ? s3Config.bucket.trim()
          : DEFAULT_S3_WAREHOUSE_SEGMENT;
      const scene = normalizeWarehouseGisDatasetPath(
        sceneUrl.replace(/^\/+|\/+$/g, ""),
        bucketSeg,
      );
      const vizBaseUrl = `${joinS3PathSegments(
        endpoint,
        bucketSeg,
        scene,
        "viz",
      )}/`;
      useViewerStore.getState().setVizBaseUrl(vizBaseUrl);

      // fetchSceneMetadata is intentionally NOT awaited here — it's hoisted
      // into prefetchSceneMetadataFromYmlConfig so callers can await CRS
      // setup before applyYmlConfig (and its sync positionFromLocal calls)
      // runs. Calling it here unawaited would race entity construction
      // against setCoordinateConfig and place the first batch of entities
      // with the wrong CRS.
    }

    // get materials.json path
    const materialsPath = (config.sim as any)?.Materials?.default;
    if (typeof materialsPath === "string" && materialsPath.trim()) {
      const matEndpoint = (s3Config?.endpoint_url ?? "").replace(/\/+$/, "");
      const matBucket = s3Config?.bucket ?? "";
      if (matEndpoint && matBucket) {
        const matUrl = joinS3PathSegments(
          matEndpoint,
          matBucket,
          materialsPath.trim(),
        );
        useViewerStore.getState().setMaterialsJsonUrl(matUrl);
        fetchAvailableMaterials();
      }
    } else {
      console.warn(
        "[ymlConfigLoader] Materials path not found or empty in config",
      );
    }

    const sim = config.sim;
    const gis = config.gis;

    // 2. Clear all existing entities
    distributedUnitManager.clear();
    panelManager.clear();
    radioUnitManager.clear();
    userEquipmentManager.clear();
    scattererManager.clear();
    raypathManager.clear();
    spawnZoneManager.clear();

    if (!sim) {
      // Clear YML time data when no sim config
      const { setYmlTimeData } = useViewerStore.getState();
      setYmlTimeData(null);

      return {
        distributedUnits: 0,
        panels: 0,
        radioUnits: 0,
        userEquipments: 0,
        scatterers: 0,
        scenarioUpdated: false,
        timeIndices: 0,
      };
    }

    // 3. Create entities from YML config
    const duMap = createDistributedUnits(sim);
    const panelMap = createPanels(sim);
    const ruMap = createRadioUnits(sim);
    const ueMap = createUserEquipments(sim);
    const scattererMap = createScatterers(sim);

    // 4. Apply scenario params
    const scenarioParams = buildScenarioParams(sim);
    let scenarioUpdated = false;
    if (scenarioParams) {
      const { updateScenarioParams } = useViewerStore.getState();
      updateScenarioParams(scenarioParams);
      scenarioUpdated = true;
    }

    // 5. Generate and store time indices from scenario config
    const timeData = generateTimeIndices(sim);
    const { setYmlTimeData } = useViewerStore.getState();
    setYmlTimeData(timeData);

    // 6. Populate managers (triggers layer subscriptions → visualization)
    if (duMap.size > 0) distributedUnitManager.setAll(duMap);
    if (panelMap.size > 0) panelManager.setAll(panelMap);
    if (ruMap.size > 0) radioUnitManager.setAll(ruMap);
    if (ueMap.size > 0) userEquipmentManager.setAll(ueMap);
    if (scattererMap.size > 0) scattererManager.setAll(scattererMap);

    // 7. Apply spawn zone if present
    if (
      gis?.spawn_zone?.points_ccw &&
      gis?.spawn_zone?.points_ccw.length >= 3
    ) {
      spawnZoneManager.set(
        gis.spawn_zone.points_ccw.map(
          (p: { lat: number; lon: number; alt?: number }) => ({
            lat: p.lat,
            lon: p.lon,
            height: p.alt ?? 0,
          }),
        ),
        gis.spawn_zone.altitude ?? 10,
      );
    }

    return {
      distributedUnits: duMap.size,
      panels: panelMap.size,
      radioUnits: ruMap.size,
      userEquipments: ueMap.size,
      scatterers: scattererMap.size,
      scenarioUpdated,
      timeIndices: timeData?.length ?? 0,
    };
  } finally {
    _isSyncing = false;
  }
}

// ============================================================================
// Entity → YML Serialization (reverse direction)
// ============================================================================

const LOCAL_STORAGE_KEY = "yml-editor-content";

const DU_EXPORT_ATTRS: Array<[keyof DistributedUnit, string]> = [
  ["fftSize", "aerial_du_fft_size"],
  ["maxChannelBandwidth", "aerial_du_max_channel_bandwidth"],
  ["numAntennas", "aerial_du_num_antennas"],
  ["referenceFreq", "aerial_du_reference_freq"],
  ["subcarrierSpacing", "aerial_du_subcarrier_spacing"],
];

const RU_EXPORT_ATTRS: Array<[keyof RadioUnit, string]> = [
  ["carrierFreqMHz", "aerial_gnb_carrier_freq"],
  ["duId", "aerial_gnb_du_id"],
  ["duManualAssign", "aerial_gnb_du_manual_assign"],
  ["height", "aerial_gnb_height"],
  ["mechAzimuth", "aerial_gnb_mech_azimuth"],
  ["mechTilt", "aerial_gnb_mech_tilt"],
  ["panelType", "aerial_gnb_panel_type"],
  ["radiatedPower", "aerial_gnb_radiated_power"],
  ["enableRays", "aerial_gnb_enable_rays"],
];

const SCENARIO_EXPORT_DEFAULTS: Partial<ScenarioParams> = {
  duration: 1.0,
  interval: 1.0,
  numProceduralUEs: 0,
  enableSeededMobility: false,
  mobilitySeed: 0,
  ueMinSpeed: 1.5,
  ueMaxSpeed: 2.5,
  enableUrbanMobility: false,
  enableDynamicScattering: false,
  maxNumVehicles: 0,
  slotsPerBatch: 1,
  batches: 1,
};

function duSubcarrierSpacingKhzForYml(value: number): number {
  return roundForYml(normalizeDuSubcarrierSpacingHz(value) / 1000);
}

function scenarioValueIsDefault<K extends keyof ScenarioParams>(
  key: K,
  value: ScenarioParams[K],
): boolean {
  return (
    hasOwn(SCENARIO_EXPORT_DEFAULTS as Record<string, unknown>, key) &&
    (SCENARIO_EXPORT_DEFAULTS[key] as ScenarioParams[K]) === value
  );
}

/**
 * Serialise a RadioUnit into a YML add entry + per-entity update entry.
 */
function serializeRadioUnit(
  ru: RadioUnit,
  existingSection?: {
    add?: Array<Record<string, unknown>>;
    update?: YmlUpdateEntry[];
  },
): {
  add: YmlRUAdd;
  update: YmlUpdateEntry;
} {
  const existingAdd = existingAddForId(existingSection, ru.id);
  const existingUpdate = existingUpdateForId(existingSection, ru.id);
  const attrs: Record<string, any> = cloneYamlValue(
    existingUpdate?.attributes ?? {},
  );

  for (const [entityKey, ymlKey] of RU_EXPORT_ATTRS) {
    let value = (ru as any)[entityKey];
    if (entityKey === "panelType")
      value = ruPanelTypeForYmlExport(ru.panelType);
    if (entityKey === "radiatedPower") {
      value = coerceRuRadiatedPowerDbm(ru.radiatedPower);
    }
    if (value === undefined) continue;

    // Keep client-style YAML lean: do not add UI-only default attributes to
    // existing client entries unless they were already present or changed.
    if (
      !hasOwn(attrs, ymlKey) &&
      ((entityKey === "enableRays" &&
        value === DEFAULT_RADIO_UNIT_PROPERTIES.enableRays) ||
        (entityKey === "cellId" && value === ru.id))
    ) {
      continue;
    }
    attrs[ymlKey] = value;
  }

  return {
    add: serializePositionAdd<YmlRUAdd>(ru.id, ru.position, existingAdd),
    update: {
      attributes: attrs,
      ids: idsForSerializedEntity(existingUpdate, ru.id),
    },
  };
}

/**
 * Serialise a DistributedUnit into YML add + update entries.
 * Unchanged imported positions keep their original YAML shape; new or moved
 * DUs use AODT-style `position.pos` with geographic coordinates.
 */
function serializeDistributedUnit(
  du: DistributedUnit,
  existingSection?: {
    add?: Array<Record<string, unknown>>;
    update?: YmlUpdateEntry[];
  },
): {
  add: YmlDUAdd;
  update: YmlUpdateEntry;
} {
  const existingAdd = existingAddForId(existingSection, du.id);
  const existingUpdate = existingUpdateForId(existingSection, du.id);
  const attrs: Record<string, any> = cloneYamlValue(
    existingUpdate?.attributes ?? {},
  );

  for (const [entityKey, ymlKey] of DU_EXPORT_ATTRS) {
    let value = (du as any)[entityKey];
    if (entityKey === "subcarrierSpacing") {
      value = duSubcarrierSpacingKhzForYml(Number(value));
    }
    setAttr(attrs, ymlKey, value);
  }

  return {
    add: serializePositionAdd<YmlDUAdd>(du.id, du.position, existingAdd),
    update: {
      attributes: attrs,
      ids: idsForSerializedEntity(existingUpdate, du.id),
    },
  };
}

/**
 * Serialise a Panel into YML add + update entries.
 */
function serializePanel(
  panel: Panel,
  existingSection?: {
    add?: Array<Record<string, unknown>>;
    update?: YmlUpdateEntry[];
  },
): {
  add: YmlPanelAdd;
  update: YmlUpdateEntry;
} {
  const existingAdd = existingAddForId(existingSection, panel.id);
  const existingUpdate = existingUpdateForId(existingSection, panel.id);

  if ((existingAdd as any)?.panel_file && !existingUpdate) {
    return {
      add: { ...cloneYamlValue(existingAdd), id: panel.id } as YmlPanelAdd,
      update: { attributes: {}, ids: [panel.id] },
    };
  }

  const attrs: Record<string, any> = cloneYamlValue(
    existingUpdate?.attributes ?? {},
  );

  if (!attrs.antenna_names) {
    setAttr(attrs, "antenna_names", [...new Set(panel.antennaNames)]);
  }
  setAttr(attrs, "dual_polarized", panel.dualPolarized === 2);
  setAttr(attrs, "num_loc_antenna_horz", panel.numLocAntennaHorz);
  setAttr(attrs, "num_loc_antenna_vert", panel.numLocAntennaVert);
  setAttr(attrs, "reference_freq_mhz", roundForYml(panel.referenceFreq / 1e6));
  setCanonicalAttr(
    attrs,
    "antenna_spacing_horz_mm",
    ["antenna_spacing_horz", "antenna_spacing_horz_cm"],
    roundForYml(panel.antennaSpacingHorzCm * 10, 6),
  );
  setCanonicalAttr(
    attrs,
    "antenna_spacing_vert_mm",
    ["antenna_spacing_vert", "antenna_spacing_vert_cm"],
    roundForYml(panel.antennaSpacingVertCm * 10, 6),
  );
  setCanonicalAttr(
    attrs,
    "antenna_roll_angle_first_polz_degree",
    ["antenna_roll_angle_first_polz"],
    roundForYml(Cesium.Math.toDegrees(panel.antennaRollAngleFirstPolz), 4),
  );
  setCanonicalAttr(
    attrs,
    "antenna_roll_angle_second_polz_degree",
    ["antenna_roll_angle_second_polz"],
    roundForYml(Cesium.Math.toDegrees(panel.antennaRollAngleSecondPolz), 4),
  );

  return {
    add: existingAdd
      ? ({ ...cloneYamlValue(existingAdd), id: panel.id } as YmlPanelAdd)
      : { id: panel.id },
    update: {
      attributes: attrs,
      ids: idsForSerializedEntity(existingUpdate, panel.id),
    },
  };
}

/**
 * Serialise a UserEquipment into YML add + update entries.
 */
function serializeUserEquipment(
  ue: UserEquipment,
  existingSection?: {
    add?: Array<Record<string, unknown>>;
    update?: YmlUpdateEntry[];
  },
): {
  add: YmlUEAdd;
  update: YmlUpdateEntry;
} {
  const existingAdd = existingAddForId(existingSection, ue.id);
  const existingUpdate = existingUpdateForId(existingSection, ue.id);
  const includeAlt = ue.waypoints.some(
    (w) => Math.abs(w.position.cartographic.height) > 1e-4,
  );
  const waypoints = ue.waypoints.map((wp) => {
    const lat = Cesium.Math.toDegrees(wp.position.cartographic.latitude);
    const lon = Cesium.Math.toDegrees(wp.position.cartographic.longitude);
    const pos: { lat: number; lon: number; alt?: number } = { lat, lon };
    // only include alt if it's non-zero, denoting a 3D UE
    if (includeAlt) pos.alt = wp.position.cartographic.height;
    return {
      arrival_time: wp.arrival_time,
      azimuth_offset: wp.azimuth_offset,
      pause_duration: wp.stop,
      pos,
      speed: wp.speed,
    };
  });

  const attrs: Record<string, any> = cloneYamlValue(
    existingUpdate?.attributes ?? {},
  );
  for (const [entityKey, ymlKey] of Object.entries(REVERSE_UE_MAP)) {
    let value = (ue as any)[entityKey];
    if (value === undefined) continue;
    if (entityKey === "radiatedPower") {
      value = coerceRuRadiatedPowerDbm(value);
    }
    attrs[ymlKey] = value;
  }

  // panel array → single panel type int
  if (ue.panel.length > 0) {
    attrs["aerial_ue_panel_type"] = ue.panel[0];
  }

  const hasGpx = existingAdd && "gpx" in existingAdd;
  const add: YmlUEAdd = hasGpx
    ? ({ ...cloneYamlValue(existingAdd), id: ue.id } as YmlUEAdd)
    : existingAdd
      ? ({ ...cloneYamlValue(existingAdd), id: ue.id, waypoints } as YmlUEAdd)
      : { id: ue.id, waypoints };
  return {
    add,
    update: {
      attributes: attrs,
      ids: idsForSerializedEntity(existingUpdate, ue.id),
    },
  };
}

/**
 * Serialise a Scatterer into YML add + update entries.
 */
function serializeScatterer(
  scatterer: Scatterer,
  existingSection?: {
    add?: Array<Record<string, unknown>>;
    update?: YmlUpdateEntry[];
  },
): {
  add: YmlScattererAdd;
  update: YmlUpdateEntry;
} {
  const existingAdd = existingAddForId(existingSection, scatterer.id);
  const existingUpdate = existingUpdateForId(existingSection, scatterer.id);
  const waypoints = scatterer.positions.map((p) => ({
    lat: Cesium.Math.toDegrees(p.position.cartographic.latitude),
    lon: Cesium.Math.toDegrees(p.position.cartographic.longitude),
    alt: p.position.cartographic.height + p.position.terrainHeight,
  }));

  const orientationEntries = scatterer.orientations.map((o) => ({
    heading: Cesium.Math.toDegrees(o.orientation.heading),
    pitch: Cesium.Math.toDegrees(o.orientation.pitch),
    roll: Cesium.Math.toDegrees(o.orientation.roll),
  }));

  const attrs: Record<string, any> = cloneYamlValue(
    existingUpdate?.attributes ?? {},
  );
  for (const [entityKey, ymlKey] of Object.entries(REVERSE_SCATTERER_MAP)) {
    const value = (scatterer as any)[entityKey];
    if (value !== undefined) attrs[ymlKey] = value;
  }

  return {
    add: {
      ...(existingAdd ? cloneYamlValue(existingAdd) : {}),
      id: scatterer.id,
      isIndoor: scatterer.isIndoor,
      waypoints,
      orientations: orientationEntries,
    },
    update: {
      attributes: attrs,
      ids: idsForSerializedEntity(existingUpdate, scatterer.id),
    },
  };
}

/**
 * Serialise Scenario params into a YML update entry.
 */
function serializeScenarioParams(
  params: ScenarioParams,
  existingSection?: { update?: YmlUpdateEntry[] },
): YmlUpdateEntry | null {
  const existingUpdate = existingSection?.update?.[0];
  const hasExistingUpdate = !!existingUpdate;
  const attrs: Record<string, any> = cloneYamlValue(
    existingUpdate?.attributes ?? {},
  );

  for (const [entityKey, ymlKey] of Object.entries(REVERSE_SCENARIO_MAP)) {
    const key = entityKey as keyof ScenarioParams;
    const value = params[key];
    if (value === undefined) continue;
    if (
      hasOwn(attrs, ymlKey) ||
      (!hasExistingUpdate && !scenarioValueIsDefault(key, value))
    ) {
      attrs[ymlKey] = value;
    }
  }

  // sim_is_full is handled specially (simulationMode → boolean)
  if (
    hasOwn(attrs, "sim_is_full") ||
    (!hasExistingUpdate && params.simulationMode !== "Duration")
  ) {
    attrs["sim_is_full"] = params.simulationMode === "Slots";
  }

  if (Object.keys(attrs).length === 0) return null;
  const entry: YmlUpdateEntry = { attributes: attrs };
  if (existingUpdate?.ids) entry.ids = cloneYamlValue(existingUpdate.ids);
  return entry;
}

/**
 * Build a complete YML config object from the current entity state.
 * Preserves the `db` and `gis` sections from the existing stored YAML.
 */
export function serializeToYml(): string {
  // 1. Read existing YAML to preserve db / gis sections
  let existingConfig: YmlConfig = {};
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = jsYaml.load(raw);
      if (parsed && typeof parsed === "object") {
        existingConfig = parsed as YmlConfig;
      }
    }
  } catch {
    // ignore parse failures — we'll just start fresh
  }

  // 2. Read current entity state from managers
  const dus = distributedUnitManager.getAll();
  const panels = panelManager.getAll();
  const rus = radioUnitManager.getAll();
  const ues = userEquipmentManager.getAll();
  const scatterers = scattererManager.getAll();
  const scenarioParams = useViewerStore.getState().scenarioParams;

  // 3. Build the sim section, preserving any unknown keys from the original
  //    (e.g. Materials, VegetationMaterials, asset paths, comments)
  const existingSim: Record<string, any> = (existingConfig.sim as any) ?? {};
  const sim: Record<string, any> = { ...existingSim };
  const gis: Record<string, any> = { ...(existingConfig.gis ?? {}) };

  // DUs — merge into existing (keeps `asset` etc.)
  const existingDuSection = existingSim.DUs as Record<string, any> | undefined;
  if (dus.size > 0) {
    const adds: YmlDUAdd[] = [];
    const updates: YmlUpdateEntry[] = [];
    for (const du of dus.values()) {
      const s = serializeDistributedUnit(du, existingDuSection);
      adds.push(s.add);
      if (Object.keys(s.update.attributes).length > 0) updates.push(s.update);
    }
    sim.DUs = { ...(existingDuSection ?? {}), add: adds };
    if (updates.length > 0) sim.DUs.update = updates;
    else delete sim.DUs.update;
  } else {
    const preserved = sectionMetadataOnly(existingDuSection);
    if (preserved) sim.DUs = preserved;
    else delete sim.DUs;
  }

  // Panels
  const existingPanelSection = existingSim.Panels as
    | Record<string, any>
    | undefined;
  if (panels.size > 0) {
    const adds: YmlPanelAdd[] = [];
    const updates: YmlUpdateEntry[] = [];
    for (const panel of panels.values()) {
      const s = serializePanel(panel, existingPanelSection);
      adds.push(s.add);
      if (Object.keys(s.update.attributes).length > 0) updates.push(s.update);
    }
    sim.Panels = { ...(existingPanelSection ?? {}), add: adds };
    if (updates.length > 0) sim.Panels.update = updates;
    else delete sim.Panels.update;
  } else {
    const preserved = sectionMetadataOnly(existingPanelSection);
    if (preserved) sim.Panels = preserved;
    else delete sim.Panels;
  }

  // RUs
  const existingRuSection = existingSim.RUs as Record<string, any> | undefined;
  if (rus.size > 0) {
    const adds: YmlRUAdd[] = [];
    const updates: YmlUpdateEntry[] = [];
    for (const ru of rus.values()) {
      const s = serializeRadioUnit(ru, existingRuSection);
      adds.push(s.add);
      if (Object.keys(s.update.attributes).length > 0) updates.push(s.update);
    }
    sim.RUs = { ...(existingRuSection ?? {}), add: adds };
    if (updates.length > 0) sim.RUs.update = updates;
    else delete sim.RUs.update;
  } else {
    const preserved = sectionMetadataOnly(existingRuSection);
    if (preserved) sim.RUs = preserved;
    else delete sim.RUs;
  }

  // Scenario
  const existingScenarioSection = existingSim.Scenario as
    | Record<string, any>
    | undefined;
  const scenarioEntry = serializeScenarioParams(
    scenarioParams,
    existingScenarioSection,
  );
  if (scenarioEntry) {
    sim.Scenario = {
      ...(existingScenarioSection ?? {}),
      update: [scenarioEntry],
    };
  } else {
    const preserved = sectionMetadataOnly(existingScenarioSection);
    if (preserved) sim.Scenario = preserved;
    else delete sim.Scenario;
  }

  // Scatterers — manual scatterer creation is not supported yet, so only
  // preserve the existing section metadata (e.g. `default` asset path).
  const existingScattererSection = existingSim.Scatterers as
    | Record<string, any>
    | undefined;
  {
    const preserved = sectionMetadataOnly(existingScattererSection);
    if (preserved) sim.Scatterers = preserved;
    else delete sim.Scatterers;
  }

  // UEs (only update YAML with manual UEs)
  const existingUeSection = existingSim.UEs as Record<string, any> | undefined;
  const manualUes = [...ues.values()].filter((ue) => ue.isManual);
  if (manualUes.length > 0) {
    const adds: YmlUEAdd[] = [];
    const updates: YmlUpdateEntry[] = [];
    for (const ue of manualUes) {
      const s = serializeUserEquipment(ue, existingUeSection);
      adds.push(s.add);
      if (Object.keys(s.update.attributes).length > 0) updates.push(s.update);
    }
    sim.UEs = { ...(existingUeSection ?? {}), add: adds };
    if (updates.length > 0) sim.UEs.update = updates;
    else delete sim.UEs.update;
  } else {
    const preserved = sectionMetadataOnly(existingUeSection);
    if (preserved) sim.UEs = preserved;
    else delete sim.UEs;
  }

  // Spawn zone (temporarily disable altitude)
  const szPoints = spawnZoneManager.getPoints();
  const szAltitude = spawnZoneManager.getAltitude();
  if (szPoints.length >= 3) {
    gis.spawn_zone = {
      // altitude: szAltitude,
      points_ccw: szPoints.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        // alt: p.height,
      })),
    };
  } else {
    delete gis.spawn_zone;
  }

  // 4. Assemble full config (preserve db / gis and any other top-level keys)
  const config: Record<string, any> = { ...existingConfig };
  config.sim = sim;
  config.gis = gis;

  return jsYaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    noArrayIndent: true,
  });
}

// ============================================================================
// Bidirectional Sync: entity changes → YAML in localStorage
// ============================================================================

/** Guard flag — true while applyYmlConfig is running (prevents feedback loops). */
let _isSyncing = false;

/**
 * Custom event name dispatched after the YAML in localStorage is updated
 * programmatically. The YmlEditor listens for this to refresh its content.
 */
export const YML_STORAGE_UPDATED_EVENT = "yml-storage-updated";

/**
 * Write the current entity / scenario state back to localStorage as YAML.
 * Skipped when we are inside applyYmlConfig (to avoid infinite loops).
 */
function syncYmlToStorage(): void {
  if (_isSyncing) return;

  // Sync if there is already a YML file in storage, or if we have a spawn zone to persist
  // (so a newly created spawn zone is always added to the YAML file)
  const hasStoredYml = !!localStorage.getItem(LOCAL_STORAGE_KEY);
  const hasSpawnZone = spawnZoneManager.getPoints().length >= 3;
  if (!hasStoredYml && !hasSpawnZone) return;

  try {
    const yaml = serializeToYml();
    localStorage.setItem(LOCAL_STORAGE_KEY, yaml);

    // Notify the YmlEditor (if open) so it can refresh
    window.dispatchEvent(new CustomEvent(YML_STORAGE_UPDATED_EVENT));
  } catch (err) {
    console.error("[YmlConfigLoader] Failed to sync entities to YAML:", err);
  }
}

/** Debounce timer for syncYmlToStorage */
let _syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 300;

let _syncSuppressed = false;

function debouncedSync(): void {
  // Don't schedule sync while applyYmlConfig is running — the debounce timer
  // would outlive the _isSyncing guard and fire an unwanted write.
  if (_isSyncing || _syncSuppressed) return;

  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncYmlToStorage, SYNC_DEBOUNCE_MS);
}

/**
 * Suppress YAML-to-localStorage syncs during bulk operations (e.g. DB loads)
 * so intermediate empty states don't overwrite custom add-entry fields like
 * panel_file.  Call resumeSync() when done.
 */
export function suppressSync(): void {
  _syncSuppressed = true;
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }
}

/**
 * Resume YAML syncing and immediately write current entity state to localStorage.
 */
export function resumeSync(): void {
  _syncSuppressed = false;
  syncYmlToStorage();
}

/** Flag to ensure sync subscriptions are only set up once */
let _syncSubscriptionsInitialized = false;

/**
 * Set up subscriptions so that any entity or scenario change is synced
 * back to the YAML file in localStorage.  Idempotent — safe to call
 * multiple times (only the first call has any effect).
 *
 * Exported so callers (e.g. TopHeader's useEffect) can guarantee the
 * subscriptions are active on the client even if the module-level
 * initialisation was skipped during SSR.
 */
export function initEntitySync(): void {
  if (_syncSubscriptionsInitialized) return;
  _syncSubscriptionsInitialized = true;

  distributedUnitManager.subscribe(() => debouncedSync());
  panelManager.subscribe(() => debouncedSync());
  radioUnitManager.subscribe(() => debouncedSync());
  userEquipmentManager.subscribe(() => debouncedSync());
  scattererManager.subscribe(() => debouncedSync());
  spawnZoneManager.subscribe(() => debouncedSync());

  // Scenario params live in Zustand – subscribe to changes
  let prevScenario = useViewerStore.getState().scenarioParams;
  useViewerStore.subscribe((state) => {
    if (state.scenarioParams !== prevScenario) {
      prevScenario = state.scenarioParams;
      debouncedSync();
    }
  });
}

// Initialise sync subscriptions at module load (client-side only).
// The guard inside initEntitySync prevents double-init if a component
// also calls it from useEffect.
if (typeof window !== "undefined") {
  initEntitySync();
}
