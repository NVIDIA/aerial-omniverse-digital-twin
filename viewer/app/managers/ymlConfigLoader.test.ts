/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for YML Configuration Loader
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyYmlConfig,
  clearAllEntities,
  serializeToYml,
  initEntitySync,
  YML_STORAGE_UPDATED_EVENT,
  extractMinioFieldsFromYml,
} from "./ymlConfigLoader";
import { normalizeRuPanelTypeKey } from "@/utils/ruDuAutoAssign";
import { radioUnitManager } from "./radioUnitManager";
import { distributedUnitManager } from "./distributedUnitManager";
import { userEquipmentManager } from "./userEquipmentManager";
import { panelManager } from "./panelManager";
import { scattererManager } from "./scattererManager";
import { raypathManager } from "./raypathManager";
import { spawnZoneManager } from "./spawnZoneManager";
import { useViewerStore } from "@/store/viewerStore";
import jsYaml from "js-yaml";

// Mock Cesium (already mocked in setup.ts, but we need localToCartographic)
vi.mock("@/services/cesium", () => ({
  localToCartographic: (position: number[]) => {
    // Return a mock Cartographic based on the input
    const Cesium = require("cesium");
    return new Cesium.Cartographic(
      position[0] / 100,
      position[1] / 100,
      position[2] / 100,
    );
  },
}));

// ============================================================================
// Test YML content fixtures
// ============================================================================

const FULL_YML_CONFIG = `
db:
  db_name: test_new_arch
  db_host: 192.0.2.171
  db_port: 9000

sim:
  DUs:
    add:
    - id: 1
      pos:
        x: 0
        y: 0.0
        z: 100.0
    update:
    - attributes:
        aerial_du_num_antennas: 2
        aerial_du_reference_freq: 3660
      ids:
      - '*'
  Panels:
    add:
    - id: 1
    - id: 2
    update:
    - attributes:
        antenna_names:
        - infinitesimal_dipole
        - infinitesimal_dipole
        dual_polarized: true
        num_loc_antenna_horz: 1
        num_loc_antenna_vert: 1
        reference_freq_mhz: 3600
      ids:
      - 1
    - attributes:
        antenna_names:
        - infinitesimal_dipole
        dual_polarized: true
        num_loc_antenna_horz: 1
        num_loc_antenna_vert: 1
        reference_freq_mhz: 3600
      ids:
      - 2
  RUs:
    add:
    - id: 1
      pos:
        lat: 35.661756043062454
        lon: 139.74246300761416
    - id: 2
      pos:
        lat: 35.66271083731652
        lon: 139.74359349161577
    update:
    - attributes:
        aerial_gnb_mech_azimuth: 1
      ids:
      - '*'
  Scenario:
    update:
    - attributes:
        sim_duration: 0.3
        sim_interval: 0.1
        sim_num_procedural_ues: 2
        sim_is_seeded: true
        sim_seed: 100
        sim_ue_min_speed: 5.0
        sim_ue_max_speed: 5.0
        um_enable_urban_mobility: false
        sim_enable_dynamic_scattering: false
        um_num_vehicles: 0
        sim_slots_per_batch: 1
        sim_batches: 1
  UEs:
    add:
    - id: 1
      waypoints:
      - lat: 35.66166467525665
        lon: 139.7433705512851
      - lat: 35.661647111752124
        lon: 139.74291975902824
    - id: 2
      waypoints:
      - lat: 35.66269301551529
        lon: 139.7425588491366

gis:
  scene:
    scene_url: /opt/nvidia/map.usd
`;

const MINIMAL_YML_CONFIG = `
sim:
  RUs:
    add:
    - id: 10
      pos:
        lat: 35.0
        lon: 139.0
`;

const NO_SIM_YML = `
db:
  db_name: test
gis:
  scene:
    scene_url: /some/path
`;

const SPAWN_ZONE_YML = `
gis:
  spawn_zone:
    altitude: 25
    points_ccw:
    - lat: 35.0
      lon: 139.0
    - lat: 35.1
      lon: 139.1
    - lat: 35.2
      lon: 139.0
sim:
  RUs:
    add:
    - id: 1
      position:
        lat: 35.0
        lon: 139.0
`;

const EMPTY_YML = ``;

const MINIO_MERGE_YML = `
db:
  parquet_export:
    iceberg:
      catalog_uri: http://catalog.example.local:19120/iceberg/
  s3_config:
    access_key: minioadmin
    bucket: parquet-export-test
    endpoint_url: http://s3.example.local:9020
    provider: minio
    region: us-east-1
    secret_key: minioadmin
sim:
  DUs:
    add:
    - id: 1
      pos:
        x: 0
        y: 0
        z: 0
`;

// ============================================================================
// Tests
// ============================================================================

describe("extractMinioFieldsFromYml", () => {
  it("reads db.parquet_export.iceberg.catalog_uri and db.s3_config", () => {
    const parsed = jsYaml.load(MINIO_MERGE_YML) as Record<string, unknown>;
    const fields = extractMinioFieldsFromYml(parsed);
    expect(fields.catalogUri).toBe(
      "http://catalog.example.local:19120/iceberg/",
    );
    expect(fields.s3Endpoint).toBe("http://s3.example.local:9020");
    expect(fields.s3BucketName).toBe("parquet-export-test");
    expect(fields.s3Provider).toBe("minio");
    expect(fields.accessKey).toBe("minioadmin");
    expect(fields.secretKey).toBe("minioadmin");
  });

  it("returns empty when db is missing", () => {
    expect(extractMinioFieldsFromYml({ sim: {} })).toEqual({});
  });
});

describe("applyYmlConfig", () => {
  beforeEach(() => {
    // Clear all managers
    radioUnitManager.clear();
    distributedUnitManager.clear();
    userEquipmentManager.clear();
    panelManager.clear();
    scattererManager.clear();
    raypathManager.clear();
    spawnZoneManager.clear();
  });

  describe("MinIO settings merge from YML db", () => {
    beforeEach(() => {
      localStorage.removeItem("minio_settings");
    });

    it("merges catalog and s3 fields into minio_settings localStorage", () => {
      applyYmlConfig(MINIO_MERGE_YML);
      const saved = JSON.parse(
        localStorage.getItem("minio_settings") as string,
      );
      expect(saved.catalogUri).toBe(
        "http://catalog.example.local:19120/iceberg/",
      );
      expect(saved.s3Endpoint).toBe("http://s3.example.local:9020");
      expect(saved.s3BucketName).toBe("parquet-export-test");
      expect(saved.s3Provider).toBe("minio");
    });

    it("preferExistingMinioSettings keeps saved minio_settings over YML db fields", () => {
      localStorage.setItem(
        "minio_settings",
        JSON.stringify({
          catalogUri: "http://user-catalog/",
          s3Endpoint: "http://user-s3:9000",
          warehouse: "user-warehouse",
          s3Provider: "aws",
        }),
      );
      applyYmlConfig(MINIO_MERGE_YML, { preferExistingMinioSettings: true });
      const saved = JSON.parse(
        localStorage.getItem("minio_settings") as string,
      );
      expect(saved.catalogUri).toBe("http://user-catalog/");
      expect(saved.s3Endpoint).toBe("http://user-s3:9000");
      expect(saved.s3BucketName).toBe("user-warehouse");
      expect(saved.s3Provider).toBe("aws");
    });

    it("only overwrites fields present in YAML", () => {
      localStorage.setItem(
        "minio_settings",
        JSON.stringify({
          catalogUri: "http://keep-catalog/",
          s3Endpoint: "http://keep-endpoint:9000",
          warehouse: "keep-warehouse",
          s3Provider: "aws",
        }),
      );
      const yml = `
db:
  s3_config:
    bucket: new-bucket-only
sim:
  DUs:
    add:
    - id: 1
      pos: { x: 0, y: 0, z: 0 }
`;
      applyYmlConfig(yml);
      const saved = JSON.parse(
        localStorage.getItem("minio_settings") as string,
      );
      expect(saved.catalogUri).toBe("http://keep-catalog/");
      expect(saved.s3Endpoint).toBe("http://keep-endpoint:9000");
      expect(saved.s3BucketName).toBe("new-bucket-only");
      expect(saved.s3Provider).toBe("aws");
    });

    it("uses first parquet_export.s3_configs entry when db.s3_config is absent", () => {
      const yml = `
db:
  parquet_export:
    s3_configs:
    - endpoint_url: http://from-list:9020
      bucket: list-bucket
      provider: minio
sim:
  DUs:
    add:
    - id: 1
      pos: { x: 0, y: 0, z: 0 }
`;
      applyYmlConfig(yml);
      const saved = JSON.parse(
        localStorage.getItem("minio_settings") as string,
      );
      expect(saved.s3Endpoint).toBe("http://from-list:9020");
      expect(saved.s3BucketName).toBe("list-bucket");
      expect(saved.s3Provider).toBe("minio");
    });
  });

  describe("GIS scene_url for 3D Tiles", () => {
    beforeEach(() => {
      localStorage.removeItem("gis_scene_url");
      localStorage.setItem(
        "minio_settings",
        JSON.stringify({
          s3Endpoint: "http://test:9000",
          catalogUri: "",
          s3BucketName: "",
          s3Provider: "minio",
        }),
      );
    });

    it("stores gis.scene.scene_url from YAML", () => {
      const yml = `
gis:
  scene:
    scene_url: gis_samples_v6/tokyo_flat/viz/tiles
sim:
  DUs:
    add:
    - id: 1
      pos: { x: 0, y: 0, z: 0 }
`;
      applyYmlConfig(yml);
      expect(localStorage.getItem("gis_scene_url")).toBe(
        "gis_samples_v6/tokyo_flat/viz/tiles",
      );
    });
  });

  describe("Nested pos in YAML (AODT export)", () => {
    it("parses RU local x/y/z under position.pos into cartographic position", () => {
      const yml = `
sim:
  RUs:
    add:
    - id: 7
      position:
        pos:
          x: 1.0
          y: 2.0
          z: 3.0
`;
      applyYmlConfig(yml);
      const ru = radioUnitManager.getAll().get(7);
      expect(ru).toBeDefined();
      expect(ru!.position.cartographic).toBeDefined();
      expect(Number.isFinite(ru!.position.cartographic.longitude)).toBe(true);
      expect(Number.isFinite(ru!.position.cartographic.latitude)).toBe(true);
    });

    it("parses DU/RU/UE positions under pos without throwing", () => {
      const yml = `
sim:
  DUs:
    add:
    - id: 1
      pos:
        pos:
          x: 0.0
          y: 0.0
          z: 100.0
  RUs:
    add:
    - id: 1
      pos:
        pos:
          lat: 35.66350010610868
          lon: 139.74530874157455
  UEs:
    add:
    - id: 1
      waypoints:
      - pos:
          lat: 35.66273900802609
          lon: 139.74484583110285
        speed: 0.0
`;
      expect(() => applyYmlConfig(yml)).not.toThrow();
      expect(distributedUnitManager.getAll().get(1)).toBeDefined();
      expect(radioUnitManager.getAll().get(1)).toBeDefined();
      expect(userEquipmentManager.getAll().get(1)).toBeDefined();
    });

    it("parses nested position.pos (AODT-style) for DU xyz and RU lat/lon", () => {
      const yml = `
sim:
  DUs:
    add:
    - id: 2
      position:
        pos:
          x: 0.0
          'y': 0.0
          z: 100.0
  RUs:
    add:
    - id: 2
      position:
        pos:
          lat: 35.66350010610868
          lon: 139.74530874157455
`;
      applyYmlConfig(yml);
      expect(distributedUnitManager.getAll().get(2)).toBeDefined();
      expect(radioUnitManager.getAll().get(2)).toBeDefined();
    });

    it("parses DU geographic alt and legacy height alias", () => {
      const yml = `
sim:
  DUs:
    add:
    - id: 9
      pos:
        lat: 35.0
        lon: 139.0
        alt: 12.5
`;
      applyYmlConfig(yml);
      const du = distributedUnitManager.getAll().get(9)!;
      expect(du.position.cartographic.height).toBeCloseTo(12.5);

      distributedUnitManager.clear();
      const ymlLegacy = `
sim:
  DUs:
    add:
    - id: 9
      pos:
        lat: 35.0
        lon: 139.0
        height: 44.0
`;
      applyYmlConfig(ymlLegacy);
      const du2 = distributedUnitManager.getAll().get(9)!;
      expect(du2.position.cartographic.height).toBeCloseTo(44.0);
    });

    it("maps aerial_du_reference_freq from DU update", () => {
      const yml = `
sim:
  DUs:
    add:
    - id: 4
      pos: { x: 0, y: 0, z: 0 }
    update:
    - attributes:
        aerial_du_reference_freq: 3660
      ids:
      - 4
`;
      applyYmlConfig(yml);
      expect(distributedUnitManager.getAll().get(4)!.referenceFreq).toBe(3660);
    });
  });

  describe("Full config parsing", () => {
    it("should create all entity types from a full YML config", () => {
      const result = applyYmlConfig(FULL_YML_CONFIG);

      expect(result.distributedUnits).toBe(1);
      expect(result.panels).toBe(2);
      expect(result.radioUnits).toBe(2);
      expect(result.userEquipments).toBe(2);
      expect(result.scenarioUpdated).toBe(true);
    });

    it("should populate the distributed unit manager", () => {
      applyYmlConfig(FULL_YML_CONFIG);

      const dus = distributedUnitManager.getAll();
      expect(dus.size).toBe(1);

      const du = dus.get(1)!;
      expect(du.id).toBe(1);
      // Update applied: aerial_du_num_antennas: 2
      expect(du.numAntennas).toBe(2);
      expect(du.referenceFreq).toBe(3660);
    });

    it("should populate the panel manager with updates applied", () => {
      applyYmlConfig(FULL_YML_CONFIG);

      const panels = panelManager.getAll();
      expect(panels.size).toBe(2);

      const panel1 = panels.get(1)!;
      expect(panel1.id).toBe(1);
      expect(panel1.antennaNames).toEqual([
        "infinitesimal_dipole",
        "infinitesimal_dipole",
      ]);
      expect(panel1.dualPolarized).toBe(2);
      expect(panel1.referenceFreq).toBe(3600e6);

      const panel2 = panels.get(2)!;
      expect(panel2.antennaNames).toEqual(["infinitesimal_dipole"]);
    });

    it("should populate the radio unit manager with updates applied", () => {
      applyYmlConfig(FULL_YML_CONFIG);

      const rus = radioUnitManager.getAll();
      expect(rus.size).toBe(2);

      const ru1 = rus.get(1)!;
      expect(ru1.id).toBe(1);
      // Update applied to all: aerial_gnb_mech_azimuth: 1
      expect(ru1.mechAzimuth).toBe(1);

      const ru2 = rus.get(2)!;
      expect(ru2.mechAzimuth).toBe(1);
    });

    it("should apply default RU properties for unspecified attributes", () => {
      applyYmlConfig(FULL_YML_CONFIG);

      const ru = radioUnitManager.getAll().get(1)!;
      // These are from DEFAULT_RADIO_UNIT_PROPERTIES
      expect(ru.height).toBe(2.5);
      expect(ru.mechTilt).toBe(0.0);
      expect(ru.radiatedPower).toBe(43.0);
      expect(ru.enableRays).toBe(true);
      expect(ru.duId).toBe(-1);
    });

    it("should populate the user equipment manager", () => {
      applyYmlConfig(FULL_YML_CONFIG);

      const ues = userEquipmentManager.getAll();
      expect(ues.size).toBe(2);

      const ue1 = ues.get(1)!;
      expect(ue1.id).toBe(1);
      expect(ue1.waypoints).toHaveLength(2);

      const ue2 = ues.get(2)!;
      expect(ue2.waypoints).toHaveLength(1);
    });

    it("should map waypoint YAML alt into cartographic.height (altitude offset UI)", () => {
      const yml = `
db:
  db_name: test_alt_ue
sim:
  UEs:
    add:
    - id: 99
      waypoints:
      - pos:
          lat: 35.0
          lon: 139.0
          alt: 75
        speed: 1.5
        pause_duration: 0
        azimuth_offset: 0
        arrival_time: -1
      - lat: 35.1
        lon: 139.1
        alt: 12
gis:
  scene:
    scene_url: /opt/nvidia/map.usd
`;
      applyYmlConfig(yml);
      const ue = userEquipmentManager.get(99)!;
      expect(ue.waypoints[0].position.cartographic.height).toBe(75);
      expect(ue.waypoints[1].position.cartographic.height).toBe(12);
    });

    it("should apply default UE properties", () => {
      applyYmlConfig(FULL_YML_CONFIG);

      const ue = userEquipmentManager.getAll().get(1)!;
      expect(ue.isManual).toBe(true);
      expect(ue.radiatedPower).toBe(23.0);
      expect(ue.height).toBe(1.5);
    });

    it("should update scenario params in the store", () => {
      applyYmlConfig(FULL_YML_CONFIG);

      const { scenarioParams } = useViewerStore.getState();
      expect(scenarioParams.duration).toBe(0.3);
      expect(scenarioParams.interval).toBe(0.1);
      expect(scenarioParams.numProceduralUEs).toBe(2);
      expect(scenarioParams.enableSeededMobility).toBe(true);
      expect(scenarioParams.mobilitySeed).toBe(100);
      expect(scenarioParams.ueMinSpeed).toBe(5.0);
      expect(scenarioParams.ueMaxSpeed).toBe(5.0);
      expect(scenarioParams.enableUrbanMobility).toBe(false);
      expect(scenarioParams.enableDynamicScattering).toBe(false);
      expect(scenarioParams.maxNumVehicles).toBe(0);
      expect(scenarioParams.slotsPerBatch).toBe(1);
      expect(scenarioParams.batches).toBe(1);
    });
  });

  describe("Clearing existing entities", () => {
    it("should clear all managers before populating new entities", () => {
      // Pre-populate managers
      radioUnitManager.setAll(
        new Map([
          [
            99,
            {
              id: 99,
              position: { cartographic: {} as any, terrainHeight: 0 },
              orientation: {} as any,
              cellId: 99,
              duId: -1,
              duManualAssign: false,
              enableRays: true,
              height: 2.5,
              mechAzimuth: 0,
              mechTilt: 0,
              panelType: "panel_01",
              radiatedPower: 43,
            },
          ],
        ]),
      );

      expect(radioUnitManager.getAll().size).toBe(1);
      expect(radioUnitManager.getAll().has(99)).toBe(true);

      applyYmlConfig(MINIMAL_YML_CONFIG);

      // Old entity should be gone
      expect(radioUnitManager.getAll().has(99)).toBe(false);
      // New entity from YML should be present
      expect(radioUnitManager.getAll().has(10)).toBe(true);
    });

    it("should clear scatterers and raypaths even though YML does not create them", () => {
      const scattererClearSpy = vi.spyOn(scattererManager, "clear");
      const raypathClearSpy = vi.spyOn(raypathManager, "clear");

      applyYmlConfig(MINIMAL_YML_CONFIG);

      expect(scattererClearSpy).toHaveBeenCalled();
      expect(raypathClearSpy).toHaveBeenCalled();

      scattererClearSpy.mockRestore();
      raypathClearSpy.mockRestore();
    });

    it("should clear spawn zone manager", () => {
      const spawnZoneClearSpy = vi.spyOn(spawnZoneManager, "clear");

      applyYmlConfig(MINIMAL_YML_CONFIG);

      expect(spawnZoneClearSpy).toHaveBeenCalled();

      spawnZoneClearSpy.mockRestore();
    });
  });

  describe("Minimal config", () => {
    it("should handle a config with only RUs", () => {
      const result = applyYmlConfig(MINIMAL_YML_CONFIG);

      expect(result.radioUnits).toBe(1);
      expect(result.distributedUnits).toBe(0);
      expect(result.panels).toBe(0);
      expect(result.userEquipments).toBe(0);
      expect(result.scenarioUpdated).toBe(false);
    });

    it("should use all default values when no updates are specified", () => {
      applyYmlConfig(MINIMAL_YML_CONFIG);

      const ru = radioUnitManager.getAll().get(10)!;
      expect(ru.mechAzimuth).toBe(0.0);
      expect(ru.mechTilt).toBe(0.0);
      expect(ru.height).toBe(2.5);
      expect(ru.radiatedPower).toBe(43.0);
      expect(ru.panelType).toBe("panel_02");
    });
  });

  describe("No sim section", () => {
    it("should return zero counts when there is no sim section", () => {
      const result = applyYmlConfig(NO_SIM_YML);

      expect(result.distributedUnits).toBe(0);
      expect(result.panels).toBe(0);
      expect(result.radioUnits).toBe(0);
      expect(result.userEquipments).toBe(0);
      expect(result.scenarioUpdated).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("should throw on invalid YAML syntax", () => {
      expect(() => applyYmlConfig("{invalid: yaml: [}")).toThrow();
    });

    it("should throw on non-object YAML", () => {
      expect(() => applyYmlConfig("just a string")).toThrow(
        "Invalid YML configuration",
      );
    });

    it("should throw on empty YAML content", () => {
      expect(() => applyYmlConfig(EMPTY_YML)).toThrow(
        "Invalid YML configuration",
      );
    });
  });

  describe("Selective updates by ID", () => {
    it("should apply updates only to specified IDs", () => {
      const yml = `
sim:
  RUs:
    add:
    - id: 1
      pos:
        lat: 35.0
        lon: 139.0
    - id: 2
      pos:
        lat: 36.0
        lon: 140.0
    update:
    - attributes:
        aerial_gnb_height: 25.0
      ids:
      - 1
`;
      applyYmlConfig(yml);

      const ru1 = radioUnitManager.getAll().get(1)!;
      const ru2 = radioUnitManager.getAll().get(2)!;

      expect(ru1.height).toBe(25.0);
      expect(ru2.height).toBe(2.5); // Default, not updated
    });
  });

  describe("DU default properties", () => {
    it("should apply default DU properties", () => {
      const yml = `
sim:
  DUs:
    add:
    - id: 5
      pos:
        x: 10
        y: 20
        z: 30
`;
      applyYmlConfig(yml);

      const du = distributedUnitManager.getAll().get(5)!;
      expect(du.id).toBe(5);
      expect(du.subcarrierSpacing).toBe(30000);
      expect(du.fftSize).toBe(4096);
      expect(du.numAntennas).toBe(4);
      expect(du.maxChannelBandwidth).toBe(100);
    });

    it("normalizes aerial_du_subcarrier_spacing from kHz or Hz YAML forms", () => {
      const yml = `
sim:
  DUs:
    add:
      - id: 1
        pos: { x: 0, y: 0, z: 0 }
      - id: 2
        pos: { x: 1, y: 0, z: 0 }
    update:
      - attributes:
          aerial_du_subcarrier_spacing: 30
        ids: [1]
      - attributes:
          aerial_du_subcarrier_spacing: 30000
        ids: [2]
`;
      applyYmlConfig(yml);

      expect(distributedUnitManager.getAll().get(1)!.subcarrierSpacing).toBe(
        30000,
      );
      expect(distributedUnitManager.getAll().get(2)!.subcarrierSpacing).toBe(
        30000,
      );
    });
  });

  describe("Panel default properties", () => {
    it("should apply default panel properties and naming convention", () => {
      const yml = `
sim:
  Panels:
    add:
    - id: 3
`;
      applyYmlConfig(yml);

      const panel = panelManager.getAll().get(3)!;
      expect(panel.id).toBe(3);
      expect(panel.name).toBe("panel_03");
      expect(panel.antennaNames).toEqual(["infinitesimal_dipole"]);
      expect(panel.dualPolarized).toBe(0);
      expect(panel.numLocAntennaHorz).toBe(1);
      expect(panel.numLocAntennaVert).toBe(1);
      expect(panel.referenceFreq).toBe(3600e6);
    });

    it("maps *_mm and *_degree YAML keys (AODT-style) onto Panel state", () => {
      const yml = `
sim:
  Panels:
    add:
    - id: 1
    - id: 2
    update:
    - attributes:
        antenna_names:
        - infinitesimal_dipole
        dual_polarized: true
        num_loc_antenna_horz: 1
        num_loc_antenna_vert: 2
        reference_freq_mhz: 3600.0
        antenna_spacing_horz_mm: 41.63784138888889
        antenna_spacing_vert_mm: 41.63784138888889
        antenna_roll_angle_first_polz_degree: -45.0
        antenna_roll_angle_second_polz_degree: 45.0
      ids:
      - 1
    - attributes:
        antenna_names:
        - threeGPP_38901
        dual_polarized: true
        num_loc_antenna_horz: 2
        num_loc_antenna_vert: 1
        reference_freq_mhz: 3600.0
        antenna_spacing_horz_mm: 41.63784138888889
        antenna_spacing_vert_mm: 41.63784138888889
        antenna_roll_angle_first_polz_degree: 0.0
        antenna_roll_angle_second_polz_degree: 90.0
      ids:
      - 2
`;
      applyYmlConfig(yml);
      const p1 = panelManager.getAll().get(1)!;
      expect(p1.antennaSpacingHorzCm).toBeCloseTo(41.63784138888889 / 10);
      expect(p1.antennaSpacingVertCm).toBeCloseTo(41.63784138888889 / 10);
      expect(p1.antennaRollAngleFirstPolz).toBeCloseTo((-45 * Math.PI) / 180);
      expect(p1.antennaRollAngleSecondPolz).toBeCloseTo((45 * Math.PI) / 180);
      expect(p1.referenceFreq).toBe(3600e6);
      expect(p1.dualPolarized).toBe(2);

      const p2 = panelManager.getAll().get(2)!;
      expect(p2.antennaRollAngleFirstPolz).toBe(0);
      expect(p2.antennaRollAngleSecondPolz).toBeCloseTo((90 * Math.PI) / 180);
    });

    it("serializeToYml writes reference_freq_mhz (MHz) and dual_polarized booleans", () => {
      localStorage.clear();
      panelManager.clear();
      panelManager.setAll(
        new Map([
          [
            1,
            {
              id: 1,
              name: "panel_01",
              antennaNames: ["infinitesimal_dipole"],
              frequencies: [],
              referenceFreq: 3600e6,
              dualPolarized: 2,
              numLocAntennaHorz: 1,
              numLocAntennaVert: 2,
              antennaSpacingHorzCm: 4.163784138888889,
              antennaSpacingVertCm: 4.163784138888889,
              antennaRollAngleFirstPolz: (-45 * Math.PI) / 180,
              antennaRollAngleSecondPolz: (45 * Math.PI) / 180,
            },
          ],
        ]),
      );

      const yaml = serializeToYml();
      const parsed = jsYaml.load(yaml) as Record<string, unknown>;
      const sim = parsed.sim as Record<string, unknown>;
      const updates = (
        sim.Panels as {
          update: Array<{ ids: number[]; attributes: Record<string, unknown> }>;
        }
      ).update;
      const upd = updates.find((u) => u.ids.includes(1));
      expect(upd!.attributes.reference_freq_mhz).toBe(3600);
      expect(upd!.attributes.dual_polarized).toBe(true);
      expect(upd!.attributes.antenna_spacing_horz_mm).toBeCloseTo(
        41.63784138888889,
      );
      expect(upd!.attributes).not.toHaveProperty("antenna_spacing_horz");
      expect(upd!.attributes.antenna_roll_angle_first_polz_degree).toBe(-45);
      expect(upd!.attributes.antenna_roll_angle_second_polz_degree).toBe(45);
      expect(upd!.attributes).not.toHaveProperty(
        "antenna_roll_angle_first_polz",
      );
    });
  });

  describe("Time index generation", () => {
    it("should generate duration-based time indices (sim_is_full = false)", () => {
      const result = applyYmlConfig(FULL_YML_CONFIG);

      // FULL_YML_CONFIG has sim_duration: 0.3, sim_interval: 0.1
      // numSamples = Math.round(0.3/0.1) + 1 = 4 (inclusive end)
      expect(result.timeIndices).toBe(4);

      const { ymlTimeData } = useViewerStore.getState();
      expect(ymlTimeData).toHaveLength(4);
      expect(ymlTimeData![0]).toEqual({
        time_idx: 0,
        batch_idx: 0,
        slot_idx: 0,
        symbol_idx: 0,
      });
      expect(ymlTimeData![1]).toEqual({
        time_idx: 1,
        batch_idx: 1,
        slot_idx: 0,
        symbol_idx: 0,
      });
      expect(ymlTimeData![2]).toEqual({
        time_idx: 2,
        batch_idx: 2,
        slot_idx: 0,
        symbol_idx: 0,
      });
      expect(ymlTimeData![3]).toEqual({
        time_idx: 3,
        batch_idx: 3,
        slot_idx: 0,
        symbol_idx: 0,
      });
    });

    it("should generate slot-based time indices (sim_is_full = true)", () => {
      const yml = `
sim:
  Scenario:
    update:
    - attributes:
        sim_is_full: true
        sim_slots_per_batch: 3
        sim_batches: 2
`;
      const result = applyYmlConfig(yml);

      // 3 slots × 2 batches = 6 samples
      expect(result.timeIndices).toBe(6);

      const { ymlTimeData } = useViewerStore.getState();
      expect(ymlTimeData).toHaveLength(6);

      // batch 0: slots 0,1,2
      expect(ymlTimeData![0]).toEqual({
        time_idx: 0,
        batch_idx: 0,
        slot_idx: 0,
        symbol_idx: 0,
      });
      expect(ymlTimeData![1]).toEqual({
        time_idx: 1,
        batch_idx: 0,
        slot_idx: 1,
        symbol_idx: 0,
      });
      expect(ymlTimeData![2]).toEqual({
        time_idx: 2,
        batch_idx: 0,
        slot_idx: 2,
        symbol_idx: 0,
      });
      // batch 1: slots 0,1,2
      expect(ymlTimeData![3]).toEqual({
        time_idx: 3,
        batch_idx: 1,
        slot_idx: 0,
        symbol_idx: 0,
      });
      expect(ymlTimeData![4]).toEqual({
        time_idx: 4,
        batch_idx: 1,
        slot_idx: 1,
        symbol_idx: 0,
      });
      expect(ymlTimeData![5]).toEqual({
        time_idx: 5,
        batch_idx: 1,
        slot_idx: 2,
        symbol_idx: 0,
      });
    });

    it("should set ymlTimeData to null when no Scenario section exists", () => {
      applyYmlConfig(MINIMAL_YML_CONFIG);

      const { ymlTimeData } = useViewerStore.getState();
      expect(ymlTimeData).toBeNull();
    });

    it("should set ymlTimeData to null when no sim section exists", () => {
      applyYmlConfig(NO_SIM_YML);

      const { ymlTimeData } = useViewerStore.getState();
      expect(ymlTimeData).toBeNull();
    });

    it("should map sim_is_full to simulationMode in scenario params", () => {
      const ymlSlots = `
sim:
  Scenario:
    update:
    - attributes:
        sim_is_full: true
        sim_slots_per_batch: 2
        sim_batches: 1
`;
      applyYmlConfig(ymlSlots);
      expect(useViewerStore.getState().scenarioParams.simulationMode).toBe(
        "Slots",
      );

      const ymlDuration = `
sim:
  Scenario:
    update:
    - attributes:
        sim_is_full: false
        sim_duration: 1.0
        sim_interval: 0.5
`;
      applyYmlConfig(ymlDuration);
      expect(useViewerStore.getState().scenarioParams.simulationMode).toBe(
        "Duration",
      );
    });
  });

  describe("Spawn zone parsing", () => {
    it("should populate spawn zone from YML config", () => {
      applyYmlConfig(SPAWN_ZONE_YML);

      const points = spawnZoneManager.getPoints();
      expect(points).toHaveLength(3);
      expect(points[0].lat).toBe(35.0);
      expect(points[0].lon).toBe(139.0);
    });

    it("should set spawn zone altitude from YML config", () => {
      applyYmlConfig(SPAWN_ZONE_YML);

      expect(spawnZoneManager.getAltitude()).toBe(25);
    });

    it("should not set spawn zone when missing from config", () => {
      applyYmlConfig(MINIMAL_YML_CONFIG);

      expect(spawnZoneManager.getPoints()).toHaveLength(0);
    });

    it("should clear existing spawn zone before applying new config", () => {
      spawnZoneManager.set(
        [
          { lat: 1, lon: 2, height: 0 },
          { lat: 3, lon: 4, height: 0 },
          { lat: 5, lon: 6, height: 0 },
        ],
        99,
      );

      applyYmlConfig(MINIMAL_YML_CONFIG);

      expect(spawnZoneManager.getPoints()).toHaveLength(0);
    });
  });
});

// ============================================================================
// clearAllEntities
// ============================================================================

describe("clearAllEntities", () => {
  beforeEach(() => {
    radioUnitManager.clear();
    distributedUnitManager.clear();
    userEquipmentManager.clear();
    panelManager.clear();
    scattererManager.clear();
    raypathManager.clear();
    spawnZoneManager.clear();
  });

  it("should clear all entity managers", () => {
    // Pre-populate managers via a config
    applyYmlConfig(FULL_YML_CONFIG);

    expect(distributedUnitManager.getAll().size).toBeGreaterThan(0);
    expect(panelManager.getAll().size).toBeGreaterThan(0);
    expect(radioUnitManager.getAll().size).toBeGreaterThan(0);
    expect(userEquipmentManager.getAll().size).toBeGreaterThan(0);

    clearAllEntities();

    expect(distributedUnitManager.getAll().size).toBe(0);
    expect(panelManager.getAll().size).toBe(0);
    expect(radioUnitManager.getAll().size).toBe(0);
    expect(userEquipmentManager.getAll().size).toBe(0);
    expect(scattererManager.getAll().size).toBe(0);
    expect(raypathManager.getAll().length).toBe(0);
    expect(spawnZoneManager.getPoints()).toHaveLength(0);
  });

  it("should clear ymlTimeData from the store", () => {
    applyYmlConfig(FULL_YML_CONFIG);
    expect(useViewerStore.getState().ymlTimeData).not.toBeNull();

    clearAllEntities();
    // clearAllEntities sets ymlTimeData to [] (not null) so Zustand always detects a change
    expect(useViewerStore.getState().ymlTimeData).toEqual([]);
  });

  it("should not trigger sync (isSyncing guard)", () => {
    // Pre-populate and store a YML file so sync would normally fire
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);
    applyYmlConfig(FULL_YML_CONFIG);

    const storedBefore = localStorage.getItem("yml-editor-content");

    clearAllEntities();

    // Advance timers — if a sync was scheduled it would fire now
    vi.useFakeTimers();
    vi.advanceTimersByTime(500);
    vi.useRealTimers();

    // localStorage should NOT have been re-written with empty config
    // (The guard prevents sync during clearAllEntities)
    const storedAfter = localStorage.getItem("yml-editor-content");
    expect(storedAfter).toBe(storedBefore);
  });
});

// ============================================================================
// serializeToYml – round-trip and preservation
// ============================================================================

describe("serializeToYml", () => {
  beforeEach(() => {
    radioUnitManager.clear();
    distributedUnitManager.clear();
    userEquipmentManager.clear();
    panelManager.clear();
    scattererManager.clear();
    raypathManager.clear();
    spawnZoneManager.clear();
    localStorage.clear();
  });

  it("should round-trip entities through applyYmlConfig → serializeToYml", () => {
    // Store original YAML so serializeToYml can read it
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);

    applyYmlConfig(FULL_YML_CONFIG);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    // DUs — unchanged imported coordinates preserve their client/YAML shape.
    expect(parsed.sim.DUs.add).toHaveLength(1);
    expect(parsed.sim.DUs.add[0].id).toBe(1);
    expect(parsed.sim.DUs.add[0].pos).toEqual({ x: 0, y: 0, z: 100 });
    expect(yaml).not.toMatch(/^\s+# alt:/m);

    // Panels
    expect(parsed.sim.Panels.add).toHaveLength(2);
    expect(parsed.sim.Panels.add[0].id).toBe(1);
    expect(parsed.sim.Panels.add[1].id).toBe(2);

    // RUs
    expect(parsed.sim.RUs.add).toHaveLength(2);
    expect(parsed.sim.RUs.add[0].id).toBe(1);
    expect(parsed.sim.RUs.add[0].pos).toHaveProperty("lat");
    expect(parsed.sim.RUs.add[0].pos).toHaveProperty("lon");
    expect(parsed.sim.RUs.add[0].pos).not.toHaveProperty("alt");

    // UEs
    expect(parsed.sim.UEs.add).toHaveLength(2);
    expect(parsed.sim.UEs.add[0].waypoints).toHaveLength(2);
    expect(parsed.sim.UEs.add[1].waypoints).toHaveLength(1);

    // Scenario
    expect(parsed.sim.Scenario.update).toHaveLength(1);
    expect(parsed.sim.Scenario.update[0].attributes).toHaveProperty(
      "sim_duration",
    );
  });

  it("should preserve db and gis sections", () => {
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);
    applyYmlConfig(FULL_YML_CONFIG);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    expect(parsed.db).toBeDefined();
    expect(parsed.db.db_name).toBe("test_new_arch");
    expect(parsed.db.db_host).toBe("192.0.2.171");

    expect(parsed.gis).toBeDefined();
    expect(parsed.gis.scene.scene_url).toBe("/opt/nvidia/map.usd");
  });

  it("should preserve unknown sim section keys", () => {
    const ymlWithMaterials = `
sim:
  Materials:
    concrete: 0.5
  DUs:
    add:
    - id: 1
      pos:
        x: 0
        y: 0
        z: 50
`;
    localStorage.setItem("yml-editor-content", ymlWithMaterials);
    applyYmlConfig(ymlWithMaterials);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    // Materials (unknown key) should be preserved
    expect(parsed.sim.Materials).toBeDefined();
    expect(parsed.sim.Materials.concrete).toBe(0.5);

    // DU should also be present
    expect(parsed.sim.DUs.add).toHaveLength(1);
  });

  it("preserves panel_file in Panel add entries", () => {
    const ymlWithCustomFiles = `
sim:
  Panels:
    add:
    - id: 1
      panel_file: Custom_Antenna/panel_001_4TR.csv
`;
    localStorage.setItem("yml-editor-content", ymlWithCustomFiles);
    applyYmlConfig(ymlWithCustomFiles);

    const parsed = jsYaml.load(serializeToYml()) as any;

    expect(parsed.sim.Panels.add[0].panel_file).toBe(
      "Custom_Antenna/panel_001_4TR.csv",
    );
  });

  it("preserves the client YAML dialect while adding new DUs/RUs", () => {
    const clientYml = `
sim:
  DUs:
    add:
    - id: 1
      position:
        pos:
          x: 0.0
          y: 0.0
          z: 100.0
    default: assets/du.json
    update:
    - attributes:
        aerial_du_fft_size: 4096
        aerial_du_max_channel_bandwidth: 100.0
        aerial_du_num_antennas: 4
        aerial_du_reference_freq: 3600.0
        aerial_du_subcarrier_spacing: 30.0
      ids:
      - 1
  Panels:
    add:
    - id: 1
    default: assets/panel.json
    update:
    - attributes:
        antenna_names:
        - infinitesimal_dipole
        antenna_roll_angle_first_polz_degree: -45.0
        antenna_roll_angle_second_polz_degree: 45.0
        antenna_spacing_horz_mm: 41.63784138888889
        antenna_spacing_vert_mm: 41.63784138888889
        dual_polarized: true
        num_loc_antenna_horz: 1
        num_loc_antenna_vert: 2
        reference_freq_mhz: 3600.0
      ids:
      - 1
  RUs:
    add:
    - id: 1
      position:
        pos:
          lat: 35.65954604510278
          lon: 139.7464869752049
    default: assets/gnb.json
    update:
    - attributes:
        aerial_gnb_carrier_freq: 3600.0
        aerial_gnb_du_id: 1
        aerial_gnb_du_manual_assign: true
        aerial_gnb_height: 10.0
        aerial_gnb_mech_azimuth: 0.0
        aerial_gnb_mech_tilt: 0.0
        aerial_gnb_panel_type: 1
        aerial_gnb_radiated_power: 43.0
      ids:
      - 1
  Scatterers:
    default: assets/car_small.json
  Scenario:
    default: assets/scenario.json
    update:
    - attributes:
        sim_batches: 5
        sim_duration: 0.0
        sim_em_rays: 500
        sim_is_full: false
        sim_num_procedural_ues: 20
        sim_samples_per_slot: 1
        sim_seed: 10
        sim_slots_per_batch: 12
        sim_ue_panel_type: 1
  UEs:
    default: assets/ue.json
`;
    localStorage.setItem("yml-editor-content", clientYml);
    applyYmlConfig(clientYml);

    const Cesium = require("cesium");
    distributedUnitManager.add({
      id: 2,
      position: {
        cartographic: Cesium.Cartographic.fromDegrees(139.7467, 35.6598, 0),
        terrainHeight: 0,
      },
      referenceFreq: 3600,
      subcarrierSpacing: 30000,
      fftSize: 4096,
      numAntennas: 4,
      maxChannelBandwidth: 100,
    });
    radioUnitManager.add({
      id: 2,
      position: {
        cartographic: Cesium.Cartographic.fromDegrees(139.7462, 35.66, 0),
        terrainHeight: 0,
      },
      orientation: new Cesium.HeadingPitchRoll(0, 0, 0),
      cellId: 2,
      duId: 1,
      duManualAssign: true,
      enableRays: true,
      height: 2.5,
      mechAzimuth: 0,
      mechTilt: 0,
      panelType: "panel_01",
      radiatedPower: 43,
      carrierFreqMHz: 3600,
    });

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    expect(parsed.sim.DUs.default).toBe("assets/du.json");
    expect(parsed.sim.DUs.add[0].position.pos).toEqual({
      x: 0,
      y: 0,
      z: 100,
    });
    expect(parsed.sim.DUs.add[1].position.pos).toHaveProperty("lat");
    expect(parsed.sim.DUs.add[1].position.pos).toHaveProperty("lon");
    expect(
      parsed.sim.DUs.update[0].attributes.aerial_du_subcarrier_spacing,
    ).toBe(30);
    expect(
      parsed.sim.DUs.update[1].attributes.aerial_du_subcarrier_spacing,
    ).toBe(30);

    const panelAttrs = parsed.sim.Panels.update[0].attributes;
    expect(panelAttrs.antenna_spacing_horz_mm).toBeCloseTo(41.63784138888889);
    expect(panelAttrs.antenna_roll_angle_first_polz_degree).toBe(-45);
    expect(panelAttrs.antenna_roll_angle_second_polz_degree).toBe(45);
    expect(panelAttrs).not.toHaveProperty("antenna_spacing_horz");
    expect(panelAttrs).not.toHaveProperty("antenna_roll_angle_first_polz");

    expect(parsed.sim.RUs.add[0].position.pos.lat).toBe(35.65954604510278);
    expect(parsed.sim.RUs.add[1].position.pos).toHaveProperty("lat");
    expect(parsed.sim.RUs.update[0].attributes).not.toHaveProperty(
      "aerial_gnb_enable_rays",
    );
    expect(parsed.sim.RUs.update[0].attributes).not.toHaveProperty(
      "aerial_gnb_cell_id",
    );

    const scenarioAttrs = parsed.sim.Scenario.update[0].attributes;
    expect(scenarioAttrs.sim_em_rays).toBe(500);
    expect(scenarioAttrs.sim_samples_per_slot).toBe(1);
    expect(scenarioAttrs.sim_ue_panel_type).toBe(1);
    expect(scenarioAttrs).not.toHaveProperty("sim_ue_min_speed");
    expect(parsed.sim.Scenario.update[0]).not.toHaveProperty("ids");
    expect(parsed.sim.Scatterers.default).toBe("assets/car_small.json");
    expect(parsed.sim.UEs.default).toBe("assets/ue.json");
    expect(yaml).not.toMatch(/^\s+# alt:/m);
  });

  it("should remove entity sections when managers are empty", () => {
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);
    applyYmlConfig(FULL_YML_CONFIG);

    // Clear all entities (directly, not through clearAllEntities to avoid guard)
    distributedUnitManager.clear();
    panelManager.clear();
    radioUnitManager.clear();
    userEquipmentManager.clear();

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    expect(parsed.sim.DUs).toBeUndefined();
    expect(parsed.sim.Panels).toBeUndefined();
    expect(parsed.sim.RUs).toBeUndefined();
    expect(parsed.sim.UEs).toBeUndefined();

    // Scenario should still be present (it's always serialized)
    expect(parsed.sim.Scenario).toBeDefined();
  });

  it("should reflect newly added entities", () => {
    localStorage.setItem("yml-editor-content", MINIMAL_YML_CONFIG);
    applyYmlConfig(MINIMAL_YML_CONFIG);

    // Add a second RU programmatically
    const Cesium = require("cesium");
    radioUnitManager.add({
      id: 20,
      position: {
        cartographic: Cesium.Cartographic.fromDegrees(140.0, 36.0, 0),
        terrainHeight: 0,
      },
      orientation: {} as any,
      cellId: 20,
      duId: -1,
      duManualAssign: false,
      enableRays: true,
      height: 15,
      mechAzimuth: 45,
      mechTilt: 5,
      panelType: "panel_01",
      radiatedPower: 40,
    });

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    // Should now have 2 RUs (original id=10 + new id=20)
    expect(parsed.sim.RUs.add).toHaveLength(2);
    const ids = parsed.sim.RUs.add.map((ru: any) => ru.id);
    expect(ids).toContain(10);
    expect(ids).toContain(20);
  });

  it("should serialize spawn zone when points exist", () => {
    localStorage.setItem("yml-editor-content", SPAWN_ZONE_YML);
    applyYmlConfig(SPAWN_ZONE_YML);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    expect(parsed.gis.spawn_zone).toBeDefined();
    // temporarily disable altitude
    // expect(parsed.gis.spawn_zone.altitude).toBe(25);
    expect(parsed.gis.spawn_zone.points_ccw).toHaveLength(3);
    expect(parsed.gis.spawn_zone.points_ccw[0].lat).toBe(35.0);
  });

  it("should not serialize spawn zone when no points", () => {
    localStorage.setItem("yml-editor-content", MINIMAL_YML_CONFIG);
    applyYmlConfig(MINIMAL_YML_CONFIG);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    expect(parsed.gis.spawn_zone).toBeUndefined();
  });

  it("should produce valid YAML that can be re-parsed by applyYmlConfig", () => {
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);
    applyYmlConfig(FULL_YML_CONFIG);

    const yaml = serializeToYml();

    // Clear managers then re-apply the serialized YAML
    distributedUnitManager.clear();
    panelManager.clear();
    radioUnitManager.clear();
    userEquipmentManager.clear();

    const result = applyYmlConfig(yaml);

    // Should recreate the same entities
    expect(result.distributedUnits).toBe(1);
    expect(result.panels).toBe(2);
    expect(result.radioUnits).toBe(2);
    expect(result.userEquipments).toBe(2);
    expect(result.scenarioUpdated).toBe(true);
  });

  it("round-trips RU carrier freq, numeric panel_type, and radiated_power (dBm vs watts)", () => {
    const yml = `
sim:
  Panels:
    add:
      - id: 1
      - id: 2
    update:
      - attributes:
          reference_freq_mhz: 3600
        ids:
          - '*'
  RUs:
    add:
      - id: 1
        pos:
          lat: 35.0
          lon: 139.0
    update:
      - attributes:
          aerial_gnb_carrier_freq: 3600.0
          aerial_gnb_panel_type: 2
          aerial_gnb_radiated_power: 43.0
          aerial_gnb_du_manual_assign: true
          aerial_gnb_du_id: 1
        ids:
          - 1
`;
    localStorage.setItem("yml-editor-content", yml);
    applyYmlConfig(yml);

    const ru = radioUnitManager.getAll().get(1)!;
    expect(ru.carrierFreqMHz).toBe(3600.0);
    expect(ru.radiatedPower).toBe(43.0);
    expect(normalizeRuPanelTypeKey(ru.panelType)).toBe("panel_02");

    let parsed = jsYaml.load(serializeToYml()) as any;
    let attrs = parsed.sim.RUs.update[0].attributes;
    expect(attrs.aerial_gnb_carrier_freq).toBe(3600);
    expect(attrs.aerial_gnb_panel_type).toBe(2);
    expect(attrs.aerial_gnb_radiated_power).toBe(43);

    // Linear watts (~19.95 W from 43 dBm) stored in memory → YAML still uses dBm
    const ruWatts = {
      ...ru,
      radiatedPower: Math.pow(10, (43 - 30) / 10),
    };
    radioUnitManager.setAll(new Map([[1, ruWatts]]));
    parsed = jsYaml.load(serializeToYml()) as any;
    attrs = parsed.sim.RUs.update[0].attributes;
    expect(attrs.aerial_gnb_radiated_power).toBe(43);
  });

  it("should produce clean degree values from float32-precision radian angles", () => {
    const yml = `
sim:
  Panels:
    add:
      - id: 1
    update:
      - attributes:
          antenna_names:
            - infinitesimal_dipole
          reference_freq_mhz: 3600
          num_loc_antenna_horz: 1
          num_loc_antenna_vert: 2
          antenna_spacing_horz_mm: 41.64
          antenna_spacing_vert_mm: 41.64
          antenna_roll_angle_first_polz_degree: -45.0
          antenna_roll_angle_second_polz_degree: 45.0
        ids:
          - 1
`;
    localStorage.setItem("yml-editor-content", yml);
    applyYmlConfig(yml);

    const panel = panelManager.getAll().get(1)!;
    // Simulate float32-precision radians from DB (not exactly -pi/4)
    panelManager.update(1, {
      antennaRollAngleFirstPolz: -0.7853982,
      antennaRollAngleSecondPolz: 0.7853982,
    });

    const parsed = jsYaml.load(serializeToYml()) as any;
    const panelAttrs = parsed.sim.Panels.update[0].attributes;
    expect(panelAttrs.antenna_roll_angle_first_polz_degree).toBe(-45);
    expect(panelAttrs.antenna_roll_angle_second_polz_degree).toBe(45);
  });

  it("should handle empty localStorage gracefully", () => {
    // No localStorage content, but managers have data from a direct add
    const Cesium = require("cesium");
    distributedUnitManager.add({
      id: 1,
      position: {
        cartographic: new Cesium.Cartographic(0, 0, 0),
        terrainHeight: 0,
      },
      referenceFreq: 3600,
      subcarrierSpacing: 30000,
      fftSize: 4096,
      numAntennas: 4,
      maxChannelBandwidth: 100,
    });

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    expect(parsed.sim.DUs.add).toHaveLength(1);
  });

  it("should serialize DU update attributes from the reverse map", () => {
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);
    applyYmlConfig(FULL_YML_CONFIG);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    // DU update should contain the mapped attributes
    if (parsed.sim.DUs.update) {
      const duUpdate = parsed.sim.DUs.update[0];
      expect(duUpdate.ids).toContain(1);
      expect(duUpdate.attributes.aerial_du_reference_freq).toBe(3660);
      // Check that the reverse map produces YML-style keys
      const attrKeys = Object.keys(duUpdate.attributes);
      // e.g. numAntennas → aerial_du_num_antennas
      for (const key of attrKeys) {
        expect(key).toMatch(/^aerial_du_|^[a-z_]+$/);
      }
    }
  });

  it("should serialize UE waypoints in client format (nested pos, per-waypoint fields)", () => {
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);
    applyYmlConfig(FULL_YML_CONFIG);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    const ue1 = parsed.sim.UEs.add[0];
    expect(ue1.waypoints).toHaveLength(2);
    expect(ue1.waypoints[0]).toHaveProperty("pos");
    expect(ue1.waypoints[0].pos).toHaveProperty("lat");
    expect(ue1.waypoints[0].pos).toHaveProperty("lon");
    expect(ue1.waypoints[0].pos).not.toHaveProperty("alt");
    expect(typeof ue1.waypoints[0].pos.lat).toBe("number");
    expect(ue1.waypoints[0]).toHaveProperty("speed");
    expect(ue1.waypoints[0]).toHaveProperty("pause_duration");
    expect(ue1.waypoints[0]).toHaveProperty("azimuth_offset");
    expect(ue1.waypoints[0]).toHaveProperty("arrival_time");
    expect(ue1.waypoints[0].arrival_time).toBe(-1);
  });

  it("should include pos.alt on every waypoint when any altitude offset is non-zero (3D UE)", () => {
    localStorage.setItem("yml-editor-content", FULL_YML_CONFIG);
    applyYmlConfig(FULL_YML_CONFIG);

    const Cesium = require("cesium");
    const ue = userEquipmentManager.get(1)!;
    const w0 = ue.waypoints[0];
    userEquipmentManager.updateWaypoint(1, 0, {
      position: {
        ...w0.position,
        cartographic: Cesium.Cartographic.fromDegrees(
          Cesium.Math.toDegrees(w0.position.cartographic.longitude),
          Cesium.Math.toDegrees(w0.position.cartographic.latitude),
          1,
        ),
      },
    });

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;
    const ue1 = parsed.sim.UEs.add[0];
    expect(ue1.waypoints[0].pos.alt).toBe(1);
    expect(ue1.waypoints[1].pos.alt).toBe(0);
  });

  it("should serialize scenario params with sim_is_full boolean", () => {
    const ymlSlots = `
sim:
  Scenario:
    update:
    - attributes:
        sim_is_full: true
        sim_slots_per_batch: 2
        sim_batches: 3
`;
    localStorage.setItem("yml-editor-content", ymlSlots);
    applyYmlConfig(ymlSlots);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    const scenarioAttrs = parsed.sim.Scenario.update[0].attributes;
    expect(scenarioAttrs.sim_is_full).toBe(true);
    expect(scenarioAttrs.sim_slots_per_batch).toBe(2);
    expect(scenarioAttrs.sim_batches).toBe(3);
  });

  it("should serialize scenario params with sim_is_full = false for Duration mode", () => {
    const ymlDur = `
sim:
  Scenario:
    update:
    - attributes:
        sim_is_full: false
        sim_duration: 1.0
        sim_interval: 0.5
`;
    localStorage.setItem("yml-editor-content", ymlDur);
    applyYmlConfig(ymlDur);

    const yaml = serializeToYml();
    const parsed = jsYaml.load(yaml) as any;

    expect(parsed.sim.Scenario.update[0].attributes.sim_is_full).toBe(false);
  });
});

// ============================================================================
// initEntitySync – idempotency
// ============================================================================

describe("initEntitySync", () => {
  it("should not throw when called multiple times", () => {
    // initEntitySync is already called at module load; calling again should be safe
    expect(() => initEntitySync()).not.toThrow();
    expect(() => initEntitySync()).not.toThrow();
  });
});

// ============================================================================
// Bidirectional sync: entity changes → localStorage
// ============================================================================

describe("Bidirectional sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    radioUnitManager.clear();
    distributedUnitManager.clear();
    userEquipmentManager.clear();
    panelManager.clear();
    scattererManager.clear();
    raypathManager.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should sync entity changes to localStorage after debounce", () => {
    // 1. Load initial config and store it in localStorage
    localStorage.setItem("yml-editor-content", MINIMAL_YML_CONFIG);
    applyYmlConfig(MINIMAL_YML_CONFIG);

    // Ensure initEntitySync has been called (it's called at module load)
    initEntitySync();

    const contentBefore = localStorage.getItem("yml-editor-content")!;

    // 2. Add a new RU
    const Cesium = require("cesium");
    radioUnitManager.add({
      id: 99,
      position: {
        cartographic: Cesium.Cartographic.fromDegrees(141.0, 37.0, 0),
        terrainHeight: 0,
      },
      orientation: {} as any,
      cellId: 99,
      duId: -1,
      duManualAssign: false,
      enableRays: true,
      height: 2.5,
      mechAzimuth: 0,
      mechTilt: 0,
      panelType: "panel_02",
      radiatedPower: 43,
    });

    // 3. Advance past debounce timer (300ms)
    vi.advanceTimersByTime(400);

    // 4. Check localStorage was updated
    const contentAfter = localStorage.getItem("yml-editor-content")!;
    expect(contentAfter).not.toBe(contentBefore);

    // 5. Verify the new RU is in the YAML
    const parsed = jsYaml.load(contentAfter) as any;
    const ruIds = parsed.sim.RUs.add.map((ru: any) => ru.id);
    expect(ruIds).toContain(10); // original
    expect(ruIds).toContain(99); // new
  });

  it("should NOT sync during applyYmlConfig (isSyncing guard)", () => {
    localStorage.setItem("yml-editor-content", MINIMAL_YML_CONFIG);

    // applyYmlConfig sets _isSyncing = true, which should prevent debounced syncs
    // from scheduling during the call
    applyYmlConfig(MINIMAL_YML_CONFIG);

    // After applyYmlConfig, advance past debounce — no sync should have fired
    // because debouncedSync returned early when _isSyncing was true
    const contentRight = localStorage.getItem("yml-editor-content");
    vi.advanceTimersByTime(400);
    const contentAfter = localStorage.getItem("yml-editor-content");

    // Content should be unchanged (original MINIMAL_YML_CONFIG)
    expect(contentAfter).toBe(contentRight);
  });

  it("should dispatch YML_STORAGE_UPDATED_EVENT after sync", () => {
    localStorage.setItem("yml-editor-content", MINIMAL_YML_CONFIG);
    applyYmlConfig(MINIMAL_YML_CONFIG);
    initEntitySync();

    const eventSpy = vi.fn();
    window.addEventListener(YML_STORAGE_UPDATED_EVENT, eventSpy);

    // Add entity to trigger sync
    const Cesium = require("cesium");
    radioUnitManager.add({
      id: 77,
      position: {
        cartographic: Cesium.Cartographic.fromDegrees(140.0, 36.0, 0),
        terrainHeight: 0,
      },
      orientation: {} as any,
      cellId: 77,
      duId: -1,
      duManualAssign: false,
      enableRays: true,
      height: 2.5,
      mechAzimuth: 0,
      mechTilt: 0,
      panelType: "panel_02",
      radiatedPower: 43,
    });

    vi.advanceTimersByTime(400);

    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener(YML_STORAGE_UPDATED_EVENT, eventSpy);
  });

  it("should NOT sync when no YML file is in localStorage", () => {
    // No file in storage
    expect(localStorage.getItem("yml-editor-content")).toBeNull();

    initEntitySync();

    // Add entity — should not crash or write to storage
    const Cesium = require("cesium");
    radioUnitManager.add({
      id: 1,
      position: {
        cartographic: new Cesium.Cartographic(0, 0, 0),
        terrainHeight: 0,
      },
      orientation: {} as any,
      cellId: 1,
      duId: -1,
      duManualAssign: false,
      enableRays: true,
      height: 2.5,
      mechAzimuth: 0,
      mechTilt: 0,
      panelType: "panel_02",
      radiatedPower: 43,
    });

    vi.advanceTimersByTime(400);

    // localStorage should still be empty
    expect(localStorage.getItem("yml-editor-content")).toBeNull();
  });

  it("should debounce rapid entity changes into a single sync", () => {
    localStorage.setItem("yml-editor-content", MINIMAL_YML_CONFIG);
    applyYmlConfig(MINIMAL_YML_CONFIG);
    initEntitySync();

    const Cesium = require("cesium");
    const makeRU = (id: number) => ({
      id,
      position: {
        cartographic: Cesium.Cartographic.fromDegrees(139.0 + id, 35.0, 0),
        terrainHeight: 0,
      },
      orientation: {} as any,
      cellId: id,
      duId: -1,
      duManualAssign: false,
      enableRays: true,
      height: 2.5,
      mechAzimuth: 0,
      mechTilt: 0,
      panelType: "panel_02",
      radiatedPower: 43,
    });

    // Rapid adds within the debounce window
    radioUnitManager.add(makeRU(20));
    vi.advanceTimersByTime(100); // 100ms — not yet
    radioUnitManager.add(makeRU(30));
    vi.advanceTimersByTime(100); // 200ms — timer resets
    radioUnitManager.add(makeRU(40));

    // Advance past final debounce
    vi.advanceTimersByTime(400);

    // All three adds should be in one sync
    const parsed = jsYaml.load(
      localStorage.getItem("yml-editor-content")!,
    ) as any;
    const ruIds = parsed.sim.RUs.add.map((ru: any) => ru.id);
    expect(ruIds).toContain(10); // original
    expect(ruIds).toContain(20);
    expect(ruIds).toContain(30);
    expect(ruIds).toContain(40);
  });
});
