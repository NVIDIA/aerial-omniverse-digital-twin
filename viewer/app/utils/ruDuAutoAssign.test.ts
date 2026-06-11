/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import type { DistributedUnit, Panel, RadioUnit } from "@/types";
import {
  carrierMatchesDuAndPanel,
  duReferenceCarrierHz,
  findClosestMatchingDuId,
  findPanelForRuPanelType,
  normalizeRuPanelTypeKey,
  panelAntennaElementCount,
  pickPanelTypeForNewRu,
} from "./ruDuAutoAssign";

function lonLatRu(
  lonDeg: number,
  latDeg: number,
  overrides?: Partial<RadioUnit>,
): RadioUnit {
  return {
    id: 1,
    position: {
      cartographic: Cesium.Cartographic.fromDegrees(lonDeg, latDeg, 0),
      terrainHeight: 0,
    },
    orientation: new Cesium.HeadingPitchRoll(0, 0, 0),
    cellId: 1,
    duId: -1,
    duManualAssign: false,
    enableRays: true,
    height: 10,
    mechAzimuth: 0,
    mechTilt: 0,
    panelType: "panel_02",
    radiatedPower: 43,
    ...overrides,
  };
}

function lonLatDu(
  id: number,
  lonDeg: number,
  latDeg: number,
  overrides?: Partial<DistributedUnit>,
): DistributedUnit {
  return {
    id,
    position: {
      cartographic: Cesium.Cartographic.fromDegrees(lonDeg, latDeg, 0),
      terrainHeight: 0,
    },
    referenceFreq: 3600,
    subcarrierSpacing: 30_000,
    fftSize: 4096,
    numAntennas: 4,
    maxChannelBandwidth: 100,
    ...overrides,
  };
}

describe("ruDuAutoAssign", () => {
  it("normalizeRuPanelTypeKey maps numeric id to panel_XX", () => {
    expect(normalizeRuPanelTypeKey(2)).toBe("panel_02");
    expect(normalizeRuPanelTypeKey("2")).toBe("panel_02");
    expect(normalizeRuPanelTypeKey("panel_02")).toBe("panel_02");
  });

  it("panelAntennaElementCount matches grid product", () => {
    const panel: Panel = {
      id: 2,
      name: "panel_02",
      antennaNames: ["infinitesimal_dipole"],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 2,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    expect(panelAntennaElementCount(panel)).toBe(4);
  });

  it("panelAntennaElementCount honors enumerated antenna_names from YAML", () => {
    const panel: Panel = {
      id: 1,
      name: "panel_01",
      antennaNames: Array(4).fill("threeGPP_38901"),
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 1,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    expect(panelAntennaElementCount(panel)).toBe(4);
  });

  it("duReferenceCarrierHz treats values below 1e8 as MHz", () => {
    const du = lonLatDu(0, 0, 0, { referenceFreq: 3600 });
    expect(duReferenceCarrierHz(du)).toBe(3600e6);
  });

  it("carrierMatchesDuAndPanel compares MHz DU to Hz panel", () => {
    const panel: Panel = {
      id: 2,
      name: "panel_02",
      antennaNames: [],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 1,
      numLocAntennaVert: 1,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const du = lonLatDu(0, 0, 0, { referenceFreq: 3600 });
    expect(carrierMatchesDuAndPanel(du, panel)).toBe(true);
  });

  it("findPanelForRuPanelType resolves by name and panel_XX id", () => {
    const panel: Panel = {
      id: 2,
      name: "panel_02",
      antennaNames: [],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 2,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const panels = new Map<number, Panel>([[2, panel]]);
    expect(findPanelForRuPanelType("panel_02", panels)).toBe(panel);
    expect(findPanelForRuPanelType("Panel_02", panels)).toBe(panel);
    expect(findPanelForRuPanelType(2, panels)).toBe(panel);
  });

  it("pickPanelTypeForNewRu reuses a valid panel from the loaded scenario", () => {
    const panel0: Panel = {
      id: 0,
      name: "panel_00",
      antennaNames: ["infinitesimal_dipole"],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 1,
      numLocAntennaVert: 1,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const panel1: Panel = {
      ...panel0,
      id: 1,
      name: "panel_01",
    };
    const panels = new Map<number, Panel>([
      [0, panel0],
      [1, panel1],
    ]);

    expect(
      pickPanelTypeForNewRu("panel_02", panels, [
        lonLatRu(-122.0, 37.0, { panelType: "1" }),
      ]),
    ).toBe("panel_01");
  });

  it("findClosestMatchingDuId still runs when automatic even if duId was previously set", () => {
    const panel: Panel = {
      id: 2,
      name: "panel_02",
      antennaNames: [],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 2,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const panels = new Map<number, Panel>([[2, panel]]);
    const dus = new Map<number, DistributedUnit>([
      [1, lonLatDu(1, -122.2, 37.0)],
      [2, lonLatDu(2, -122.006, 37.0)],
    ]);

    const ru = lonLatRu(-122.005, 37.0, {
      panelType: "panel_02",
      duId: 999,
      duManualAssign: false,
    });
    expect(findClosestMatchingDuId(ru, dus, panels)).toBe(2);
  });

  it("findClosestMatchingDuId picks nearest DU matching panel", () => {
    const panel: Panel = {
      id: 2,
      name: "panel_02",
      antennaNames: [],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 2,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const panels = new Map<number, Panel>([[2, panel]]);
    const dus = new Map<number, DistributedUnit>([
      [1, lonLatDu(1, -122.2, 37.0)], // farther along lon
      [2, lonLatDu(2, -122.006, 37.0)], // closer to RU lon
    ]);

    const ru = lonLatRu(-122.005, 37.0, { panelType: "panel_02" });
    expect(findClosestMatchingDuId(ru, dus, panels)).toBe(2);
  });

  it("findClosestMatchingDuId matches YAML panels with explicit antenna entries", () => {
    const panel: Panel = {
      id: 1,
      name: "panel_01",
      antennaNames: Array(4).fill("threeGPP_38901"),
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 1,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const panels = new Map<number, Panel>([[1, panel]]);
    const dus = new Map<number, DistributedUnit>([
      [1, lonLatDu(1, -122.006, 37.0, { numAntennas: 4 })],
    ]);

    const ru = lonLatRu(-122.005, 37.0, { panelType: "1" });
    expect(findClosestMatchingDuId(ru, dus, panels)).toBe(1);
  });

  it("findClosestMatchingDuId returns null when manual assignment", () => {
    const panel: Panel = {
      id: 2,
      name: "panel_02",
      antennaNames: [],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 2,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const panels = new Map<number, Panel>([[2, panel]]);
    const dus = new Map<number, DistributedUnit>([
      [1, lonLatDu(1, -122.0, 37.0)],
    ]);
    const ru = lonLatRu(-122.005, 37.0, {
      panelType: "panel_02",
      duManualAssign: true,
    });
    expect(findClosestMatchingDuId(ru, dus, panels)).toBeNull();
  });

  it("findClosestMatchingDuId skips DU with wrong antenna count", () => {
    const panel: Panel = {
      id: 2,
      name: "panel_02",
      antennaNames: [],
      frequencies: [],
      referenceFreq: 3600e6,
      dualPolarized: 0,
      numLocAntennaHorz: 2,
      numLocAntennaVert: 2,
      antennaSpacingHorzCm: 0,
      antennaSpacingVertCm: 0,
      antennaRollAngleFirstPolz: 0,
      antennaRollAngleSecondPolz: 0,
    };
    const panels = new Map<number, Panel>([[2, panel]]);
    const dus = new Map<number, DistributedUnit>([
      [1, lonLatDu(1, -122.0, 37.0, { numAntennas: 16 })],
    ]);
    const ru = lonLatRu(-122.005, 37.0);
    expect(findClosestMatchingDuId(ru, dus, panels)).toBeNull();
  });
});
