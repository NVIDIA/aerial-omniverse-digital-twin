/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for SpawnZoneManager
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpawnZoneManager } from "./spawnZoneManager";
import type { SpawnZonePoint } from "./spawnZoneManager";

describe("SpawnZoneManager", () => {
  let manager: SpawnZoneManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SpawnZoneManager();
  });

  describe("Initial State", () => {
    it("should start with empty points", () => {
      expect(manager.getPoints()).toEqual([]);
    });

    it("should start with default altitude", () => {
      expect(manager.getAltitude()).toBe(10);
    });
  });

  describe("setPoints", () => {
    it("should set points", () => {
      const points: SpawnZonePoint[] = [
        { lat: 35.0, lon: 139.0, height: 0 },
        { lat: 35.1, lon: 139.1, height: 0 },
        { lat: 35.2, lon: 139.2, height: 0 },
      ];

      manager.setPoints(points);

      expect(manager.getPoints()).toEqual(points);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const points: SpawnZonePoint[] = [
        { lat: 35.0, lon: 139.0, height: 0 },
        { lat: 35.1, lon: 139.1, height: 0 },
        { lat: 35.2, lon: 139.2, height: 0 },
      ];

      manager.setPoints(points);

      expect(callback).toHaveBeenCalledWith(points, 10);
    });

    it("should copy points to avoid external mutation", () => {
      const points: SpawnZonePoint[] = [{ lat: 35.0, lon: 139.0, height: 0 }];

      manager.setPoints(points);
      points.push({ lat: 36.0, lon: 140.0, height: 0 });

      expect(manager.getPoints()).toHaveLength(1);
    });
  });

  describe("setAltitude", () => {
    it("should set altitude", () => {
      manager.setAltitude(25);

      expect(manager.getAltitude()).toBe(25);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      manager.setAltitude(25);

      expect(callback).toHaveBeenCalledWith([], 25);
    });
  });

  describe("set", () => {
    it("should set both points and altitude", () => {
      const points: SpawnZonePoint[] = [
        { lat: 35.0, lon: 139.0, height: 0 },
        { lat: 35.1, lon: 139.1, height: 0 },
        { lat: 35.2, lon: 139.2, height: 0 },
      ];

      manager.set(points, 50);

      expect(manager.getPoints()).toEqual(points);
      expect(manager.getAltitude()).toBe(50);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      const points: SpawnZonePoint[] = [{ lat: 35.0, lon: 139.0, height: 0 }];

      manager.set(points, 50);

      expect(callback).toHaveBeenCalledWith(points, 50);
    });
  });

  describe("clear", () => {
    it("should clear all points", () => {
      const points: SpawnZonePoint[] = [
        { lat: 35.0, lon: 139.0, height: 0 },
        { lat: 35.1, lon: 139.1, height: 0 },
        { lat: 35.2, lon: 139.2, height: 0 },
      ];

      manager.setPoints(points);
      manager.clear();

      expect(manager.getPoints()).toEqual([]);
    });

    it("should notify subscribers", () => {
      const callback = vi.fn();
      manager.subscribe(callback);

      manager.clear();

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("subscribe", () => {
    it("should return unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribe(callback);

      manager.setPoints([{ lat: 35.0, lon: 139.0, height: 0 }]);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      manager.setPoints([{ lat: 36.0, lon: 140.0, height: 0 }]);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should support multiple subscribers", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      manager.subscribe(callback1);
      manager.subscribe(callback2);

      manager.setPoints([{ lat: 35.0, lon: 139.0, height: 0 }]);

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });
});
