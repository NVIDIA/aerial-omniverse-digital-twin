/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for typeGuards
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  is3DTileFeature,
  isEntity,
  isRadioUnit,
  isScatterer,
  isUserEquipment,
  extractEntityId,
  getEntityType,
  getEntityIdByType,
} from "./typeGuards";

describe("typeGuards", () => {
  describe("is3DTileFeature", () => {
    it("should return false for null", () => {
      expect(is3DTileFeature(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(is3DTileFeature(undefined as any)).toBe(false);
    });

    it("should return false for plain object", () => {
      expect(is3DTileFeature({})).toBe(false);
    });

    it("should return falsy when window.Cesium is undefined", () => {
      const originalCesium = (window as any).Cesium;
      delete (window as any).Cesium;

      const result = is3DTileFeature({ test: "feature" });

      (window as any).Cesium = originalCesium;

      expect(result).toBeFalsy();
    });
  });

  describe("isEntity", () => {
    it("should return false for null", () => {
      expect(isEntity(null)).toBe(false);
    });

    it("should return falsy for plain object when Cesium undefined", () => {
      const originalCesium = (window as any).Cesium;
      delete (window as any).Cesium;

      const result = isEntity({ id: "test" });

      (window as any).Cesium = originalCesium;

      expect(result).toBeFalsy();
    });
  });

  describe("isRadioUnit", () => {
    it("should return true for entity with ru- prefix", () => {
      const entity = { id: "ru-123" } as any;
      expect(isRadioUnit(entity)).toBe(true);
    });

    it("should return false for entity without ru- prefix", () => {
      const entity = { id: "ue-123" } as any;
      expect(isRadioUnit(entity)).toBe(false);
    });

    it("should return false for entity with partial match", () => {
      const entity = { id: "tru-123" } as any;
      expect(isRadioUnit(entity)).toBe(false);
    });
  });

  describe("isScatterer", () => {
    it("should return true for entity with scatterer- prefix", () => {
      const entity = { id: "scatterer-42" } as any;
      expect(isScatterer(entity)).toBe(true);
    });

    it("should return false for entity without scatterer- prefix", () => {
      const entity = { id: "ru-123" } as any;
      expect(isScatterer(entity)).toBe(false);
    });
  });

  describe("isUserEquipment", () => {
    it("should return true for entity with ue- prefix", () => {
      const entity = { id: "ue-99" } as any;
      expect(isUserEquipment(entity)).toBe(true);
    });

    it("should return false for entity without ue- prefix", () => {
      const entity = { id: "scatterer-123" } as any;
      expect(isUserEquipment(entity)).toBe(false);
    });
  });

  describe("extractEntityId", () => {
    it("should extract numeric ID from valid entity ID", () => {
      expect(extractEntityId("ru-123", "ru")).toBe(123);
      expect(extractEntityId("scatterer-456", "scatterer")).toBe(456);
      expect(extractEntityId("ue-789", "ue")).toBe(789);
    });

    it("should return null for entity ID with wrong prefix", () => {
      expect(extractEntityId("ru-123", "ue")).toBeNull();
      expect(extractEntityId("scatterer-456", "ru")).toBeNull();
    });

    it("should return null for invalid ID format", () => {
      expect(extractEntityId("ru-abc", "ru")).toBeNull();
      expect(extractEntityId("ru-", "ru")).toBeNull();
    });

    it("should handle multi-part IDs", () => {
      expect(extractEntityId("prefix-sub-123", "prefix")).toBe(123);
    });
  });

  describe("getEntityType", () => {
    it("should return radio-unit for ru- prefixed entity", () => {
      const entity = { id: "ru-123" } as any;
      expect(getEntityType(entity)).toBe("radio-unit");
    });

    it("should return scatterer for scatterer- prefixed entity", () => {
      const entity = { id: "scatterer-456" } as any;
      expect(getEntityType(entity)).toBe("scatterer");
    });

    it("should return user-equipment for ue- prefixed entity", () => {
      const entity = { id: "ue-789" } as any;
      expect(getEntityType(entity)).toBe("user-equipment");
    });

    it("should return unknown for unrecognized prefix", () => {
      const entity = { id: "something-else-123" } as any;
      expect(getEntityType(entity)).toBe("unknown");
    });
  });

  describe("getEntityIdByType", () => {
    it("should extract ID for matching entity type", () => {
      const obj = { id: "ru-123" };
      expect(getEntityIdByType(obj, "ru")).toBe(123);
    });

    it("should return null for non-matching entity type", () => {
      const obj = { id: "ru-123" };
      expect(getEntityIdByType(obj, "ue")).toBeNull();
    });

    it("should return null for null object", () => {
      expect(getEntityIdByType(null, "ru")).toBeNull();
    });

    it("should return null for object without id", () => {
      expect(getEntityIdByType({}, "ru")).toBeNull();
    });

    it("should return null for object with non-string id", () => {
      expect(getEntityIdByType({ id: 123 }, "ru")).toBeNull();
    });
  });
});
