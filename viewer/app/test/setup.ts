/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vitest setup file
 * Configures testing environment and mocks
 */
import { beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock Cesium globally with proper class constructors
class MockCartographic {
  longitude: number;
  latitude: number;
  height: number;

  constructor(longitude: number, latitude: number, height: number) {
    this.longitude = longitude;
    this.latitude = latitude;
    this.height = height;
  }

  static fromCartesian(cartesian: any) {
    return new MockCartographic(0, 0, 0);
  }

  static fromDegrees(longitude: number, latitude: number, height?: number) {
    return new MockCartographic(
      longitude * (Math.PI / 180),
      latitude * (Math.PI / 180),
      height || 0,
    );
  }
}

class MockCartesian3 {
  x: number;
  y: number;
  z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static fromDegrees(longitude: number, latitude: number, height?: number) {
    return new MockCartesian3(longitude, latitude, height || 0);
  }

  static fromRadians(longitude: number, latitude: number, height?: number) {
    return new MockCartesian3(longitude, latitude, height || 0);
  }

  static distance(left: any, right: any) {
    return 100;
  }

  static normalize(cartesian: any, result?: any) {
    return result || new MockCartesian3(1, 0, 0);
  }

  static subtract(left: any, right: any, result?: any) {
    return result || new MockCartesian3(0, 0, 0);
  }

  static UNIT_Z = new MockCartesian3(0, 0, 1);
}

class MockHeadingPitchRoll {
  heading: number;
  pitch: number;
  roll: number;

  constructor(heading: number = 0, pitch: number = 0, roll: number = 0) {
    this.heading = heading;
    this.pitch = pitch;
    this.roll = roll;
  }

  static fromDegrees(heading: number, pitch: number, roll: number) {
    return new MockHeadingPitchRoll(
      heading * (Math.PI / 180),
      pitch * (Math.PI / 180),
      roll * (Math.PI / 180),
    );
  }
}

class MockJulianDate {
  dayNumber: number;
  secondsOfDay: number;

  constructor(dayNumber: number = 0, secondsOfDay: number = 0) {
    this.dayNumber = dayNumber;
    this.secondsOfDay = secondsOfDay;
  }

  static now() {
    return new MockJulianDate(2460000, 0);
  }

  static addSeconds(date: any, seconds: number, result?: any) {
    const r = result || new MockJulianDate();
    r.dayNumber = date.dayNumber;
    r.secondsOfDay = date.secondsOfDay + seconds;
    return r;
  }

  static secondsDifference(left: any, right: any) {
    return (
      (left.dayNumber - right.dayNumber) * 86400 +
      (left.secondsOfDay - right.secondsOfDay)
    );
  }

  static clone(date: any, result?: any) {
    const r = result || new MockJulianDate();
    r.dayNumber = date.dayNumber;
    r.secondsOfDay = date.secondsOfDay;
    return r;
  }
}

class MockConstantProperty {
  constructor(public value: any) {}
}

class MockCallbackProperty {
  constructor(
    public callback: (...args: any[]) => any,
    public isConstant: boolean,
  ) {}

  getValue(...args: any[]) {
    return this.callback(...args);
  }
}

class MockPolylineGraphics {
  constructor(options: Record<string, unknown>) {
    Object.assign(this, options);
  }
}

class MockTimeInterval {
  constructor(options: Record<string, unknown>) {
    Object.assign(this, options);
  }
}

class MockTimeIntervalCollection {
  intervals: unknown[];

  constructor(intervals: unknown[]) {
    this.intervals = intervals;
  }
}

class MockColor {
  r: number;
  g: number;
  b: number;
  a: number;

  constructor(r: number = 0, g: number = 0, b: number = 0, a: number = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  withAlpha(a: number) {
    return new MockColor(this.r, this.g, this.b, a);
  }

  static fromBytes = vi.fn((r: number, g: number, b: number, a = 255) => {
    return new MockColor(r / 255, g / 255, b / 255, a / 255);
  });

  static fromCssColorString = vi.fn(() => new MockColor());

  static BLUE = new MockColor(0, 0, 1, 1);

  static LIME = new MockColor(0, 1, 0, 1);
}

const MockColorMaterialProperty = vi.fn(function (this: any, value: any) {
  this.value = value;
  this.getType = vi.fn(() => "Color");
});

const mockCesium = {
  Viewer: vi.fn(),
  Entity: vi.fn(),
  Cartesian3: MockCartesian3,
  Cartographic: MockCartographic,
  HeadingPitchRoll: MockHeadingPitchRoll,
  JulianDate: MockJulianDate,
  ConstantProperty: MockConstantProperty,
  CallbackProperty: MockCallbackProperty,
  PolylineGraphics: MockPolylineGraphics,
  TimeInterval: MockTimeInterval,
  TimeIntervalCollection: MockTimeIntervalCollection,
  ColorMaterialProperty: MockColorMaterialProperty,
  sampleTerrainMostDetailed: vi.fn(async (_terrainProvider, positions) => {
    return positions;
  }),
  Math: {
    toDegrees: (rad: number) => rad * (180 / Math.PI),
    toRadians: (deg: number) => deg * (Math.PI / 180),
    PI: Math.PI,
  },
  Color: MockColor,
  ArcType: {
    NONE: 0,
  },
  ScreenSpaceEventHandler: vi.fn(),
  ScreenSpaceEventType: {
    LEFT_CLICK: 1,
    MOUSE_MOVE: 2,
    RIGHT_CLICK: 3,
  },
  HeightReference: {
    RELATIVE_TO_GROUND: 0,
    CLAMP_TO_GROUND: 1,
  },
  Cesium3DTileFeature: vi.fn(),
  PostProcessStageLibrary: {
    isSilhouetteSupported: vi.fn(() => false),
    createEdgeDetectionStage: vi.fn(() => ({
      uniforms: { color: undefined, length: 0 },
      selected: [],
    })),
    createSilhouetteStage: vi.fn((stages) => ({ stages })),
  },
};

vi.mock("cesium", () => mockCesium);

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock window.Cesium
global.window = global.window || {};
(global.window as any).Cesium = mockCesium;

// Clear mocks before each test
beforeEach(() => {
  localStorage.clear();
});

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});
