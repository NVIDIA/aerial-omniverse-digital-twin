/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cesium Type Guards and Checking Utilities
 * Moved from app/utils/cesiumTypeChecks.ts
 */
import * as Cesium from "cesium";
import type { ObjectType } from "@/types";

/**
 * Check if an object is a Cesium 3D Tile Feature
 */
export function is3DTileFeature(
  object: ObjectType,
): object is Cesium.Cesium3DTileFeature {
  return (
    object !== null &&
    typeof object === "object" &&
    window.Cesium &&
    object instanceof window.Cesium.Cesium3DTileFeature
  );
}

/**
 * Check if an object is a Cesium Entity
 */
export function isEntity(object: ObjectType): object is Cesium.Entity {
  return (
    object !== null &&
    typeof object === "object" &&
    window.Cesium &&
    object instanceof window.Cesium.Entity
  );
}

/**
 * Check if an entity is a Radio Unit by ID prefix
 */
export function isRadioUnit(entity: Cesium.Entity): boolean {
  return entity.id.startsWith("ru-");
}

/**
 * Check if an entity is a Scatterer by ID prefix
 */
export function isScatterer(entity: Cesium.Entity): boolean {
  return entity.id.startsWith("scatterer-");
}

/**
 * Check if an entity is a User Equipment by ID prefix
 */
export function isUserEquipment(entity: Cesium.Entity): boolean {
  return entity.id.startsWith("ue-");
}

/**
 * Extract numeric ID from entity ID string
 * @param entityId - Entity ID in format "prefix-123"
 * @param prefix - Expected prefix (e.g., "ru", "scatterer", "ue")
 * @returns Numeric ID or null if invalid
 */
export function extractEntityId(
  entityId: string,
  prefix: string,
): number | null {
  if (!entityId.startsWith(`${prefix}-`)) return null;
  const parts = entityId.split("-");
  const id = parseInt(parts[parts.length - 1]);
  return isNaN(id) ? null : id;
}

/**
 * Get entity type from entity ID
 * @returns "radio-unit" | "scatterer" | "user-equipment" | "unknown"
 */
export function getEntityType(
  entity: Cesium.Entity,
): "radio-unit" | "scatterer" | "user-equipment" | "unknown" {
  if (isRadioUnit(entity)) return "radio-unit";
  if (isScatterer(entity)) return "scatterer";
  if (isUserEquipment(entity)) return "user-equipment";
  return "unknown";
}

/**
 * Extract numeric ID from a selected entity object based on entity type prefix
 * Convenience wrapper around extractEntityId that works with objects
 *
 * @param selectedObject The selected object (must have an id property)
 * @param type The entity type prefix (e.g., "ru", "scatterer", "ue")
 * @returns The numeric ID if the object matches the type, null otherwise
 *
 * @example
 * getEntityIdByType(selectedObject, "ru") // Returns 42 for entity with id "ru-42"
 * getEntityIdByType(selectedObject, "scatterer") // Returns 24 for "scatterer-24"
 */
export function getEntityIdByType(
  selectedObject: any,
  type: string,
): number | null {
  if (
    selectedObject &&
    typeof selectedObject === "object" &&
    "id" in selectedObject &&
    typeof selectedObject.id === "string" &&
    selectedObject.id.startsWith(`${type}-`)
  ) {
    return extractEntityId(selectedObject.id, type);
  }
  return null;
}
