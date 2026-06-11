/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized Cesium Highlight Manager
 *
 * Manages all highlighting and silhouette effects for both:
 * - 3D Tiles features (buildings) - uses silhouette post-processing
 * - Cesium entities (boxes, cylinders, models/GLB, ellipsoids, points) - uses material/outline/silhouette modifications
 *
 * For GLB models, uses color property with HIGHLIGHT blend mode (BLUE for hover, LIME for selection).
 * For other entity types, uses material color modifications or point size changes.
 *
 * This manager is attached directly to the Cesium viewer instance,
 * avoiding the need to pass highlighting functions through multiple layers.
 */

import type { ObjectType } from "@/types";
import * as Cesium from "cesium";

interface HighlightData {
  object: any;
  originalMaterial?: any;
  originalSilhouetteColor?: any;
  originalSilhouetteSize?: any;
  originalModelColor?: any; // For model entities
  originalColor?: any; // For point entities
  originalPixelSize?: any; // For point entities
}

interface FeatureHighlight {
  feature: any;
  originalColor: any;
}

export class CesiumHighlightManager {
  private viewer: any;

  // Silhouette effects for 3D Tiles
  private silhouetteBlue: any | null = null;
  private silhouetteGreen: any | null = null;

  // Fallback color highlights for 3D Tiles (when silhouette not supported)
  private highlightedFeature: FeatureHighlight | null = null;
  private selectedFeature: FeatureHighlight | null = null;

  // Object highlights for entities
  private highlightedObject: HighlightData | null = null;
  private selectedObject: HighlightData | null = null;

  constructor(viewer: any) {
    this.viewer = viewer;
    this.initializeSilhouettes();
  }

  /**
   * Initialize silhouette post-processing effects for 3D Tiles
   */
  private initializeSilhouettes() {
    if (
      !window.Cesium.PostProcessStageLibrary.isSilhouetteSupported(
        this.viewer.scene,
      )
    ) {
      return; // Will use fallback color highlighting
    }

    // Create blue silhouette for hover
    this.silhouetteBlue =
      window.Cesium.PostProcessStageLibrary.createEdgeDetectionStage();
    this.silhouetteBlue.uniforms.color = window.Cesium.Color.BLUE;
    this.silhouetteBlue.uniforms.length = 0.01;
    this.silhouetteBlue.selected = [];

    // Create green silhouette for selection
    this.silhouetteGreen =
      window.Cesium.PostProcessStageLibrary.createEdgeDetectionStage();
    this.silhouetteGreen.uniforms.color = window.Cesium.Color.LIME;
    this.silhouetteGreen.uniforms.length = 0.01;
    this.silhouetteGreen.selected = [];

    // Add to scene
    this.viewer.scene.postProcessStages.add(
      window.Cesium.PostProcessStageLibrary.createSilhouetteStage([
        this.silhouetteBlue,
        this.silhouetteGreen,
      ]),
    );
  }

  /**
   * Highlight an object (either 3D tile feature or entity)
   * @param object - The object to highlight (3D tile feature or entity ID string)
   * @param isHover - true for hover (blue), false for selection (green)
   */
  highlightObject(object: ObjectType, isHover: boolean) {
    if (!object) return;

    if (object instanceof window.Cesium.Cesium3DTileFeature) {
      this.highlight3DTileFeature(object, isHover);
    } else {
      // At this point, object must be a Cesium.Entity (since it's not null or 3DTileFeature)
      this.highlightEntity(object as Cesium.Entity, isHover);
    }
    // Request render after modifying silhouette
    this.viewer.scene.requestRender();
  }

  /** Unhighlight the hovered object (blue) */
  unhighlightHoveredObject() {
    if (this.silhouetteBlue) {
      this.silhouetteBlue.selected = [];
    } else if (this.highlightedFeature) {
      this.highlightedFeature.feature.color =
        this.highlightedFeature.originalColor;
      this.highlightedFeature = null;
    }
    // Clear entity highlight
    this.unhighlightEntityInternal(true);
    this.viewer.scene.requestRender();
  }

  /** Unhighlight the selected object (green) */
  unhighlightSelectedObject() {
    if (this.silhouetteGreen) {
      this.silhouetteGreen.selected = [];
    } else if (this.selectedFeature) {
      this.selectedFeature.feature.color = this.selectedFeature.originalColor;
      this.selectedFeature = null;
    }
    // Clear entity highlight
    this.unhighlightEntityInternal(false);
    this.viewer.scene.requestRender();
  }

  /**
   * Get the silhouette effects (for backward compatibility)
   */
  getSilhouetteGreen() {
    return this.silhouetteGreen;
  }

  /**
   * Highlight a 3D Tile feature (building)
   */
  private highlight3DTileFeature(feature: any, isHover: boolean) {
    // Use silhouette post-processing
    if (isHover) {
      // Only highlight if not already selected
      if (this.silhouetteGreen.selected[0] !== feature) {
        this.silhouetteBlue.selected = [feature];
      }
    } else {
      // Selection
      this.silhouetteGreen.selected = [feature];
      // Clear hover if it's the same feature
      if (this.silhouetteBlue.selected[0] === feature) {
        this.silhouetteBlue.selected = [];
      }
    }
  }

  /**
   * Highlight an entity (box, cylinder, model, etc.)
   * @param entity - The entity to highlight
   * @param isHover - true for hover (blue), false for selection (green)
   */
  private highlightEntity(entity: Cesium.Entity, isHover: boolean) {
    // Don't apply hover highlight if entity is already selected
    if (isHover && this.selectedObject?.object === entity) {
      return;
    }

    const targetRef = isHover ? "highlightedObject" : "selectedObject";
    const color = isHover ? window.Cesium.Color.BLUE : window.Cesium.Color.LIME;

    // Restore previous object if different
    if (this[targetRef] && this[targetRef]!.object !== entity) {
      this.unhighlightEntityInternal(isHover);
    }

    // Re-apply selection material when same entity (e.g. during drag so highlight sticks)
    if (!isHover && this.selectedObject?.object === entity) {
      if (entity.ellipsoid) {
        entity.ellipsoid.material = new Cesium.ColorMaterialProperty(
          window.Cesium.Color.LIME.withAlpha(0.8),
        );
      }
      this.viewer.scene.requestRender();
      return;
    }
    if (this[targetRef]?.object === entity) return;

    // Store original properties
    const originalData: HighlightData = { object: entity };

    // Apply highlight based on entity type
    if (entity.box) {
      originalData.originalMaterial = entity.box.material;
      entity.box.material = color.withAlpha(0.8);
    }
    if (entity.cylinder) {
      originalData.originalMaterial = entity.cylinder.material;
      entity.cylinder.material = color.withAlpha(0.8);
    }
    if (entity.ellipsoid) {
      originalData.originalMaterial = entity.ellipsoid.material;
      entity.ellipsoid.material = new Cesium.ColorMaterialProperty(
        color.withAlpha(0.8),
      );
    }
    if (entity.point) {
      originalData.originalColor = entity.point.color;
      entity.point.color = color;
      originalData.originalPixelSize = entity.point.pixelSize;
      entity.point.pixelSize = new Cesium.ConstantProperty(15.0);
    }
    if (entity.model) {
      originalData.originalModelColor = entity.model.color;
      entity.model.color = color;
    }

    this[targetRef] = originalData;

    this.viewer.scene.requestRender();
  }

  /**
   * Remove entity highlight and restore original properties
   */
  private unhighlightEntityInternal(isHover: boolean) {
    const targetRef = isHover ? "highlightedObject" : "selectedObject";
    const data = this[targetRef];

    if (!data) return;

    const entity = data.object;

    // Don't clear selection when clearing hover
    if (isHover && this.selectedObject?.object === entity) {
      this[targetRef] = null;
      return;
    }

    // Validate the entity is valid and still exists
    if (!entity || !entity.id) {
      this[targetRef] = null;
      return;
    }

    // Check if entity still exists in the viewer by ID
    const existingEntity = this.viewer.entities.getById(entity.id);
    if (!existingEntity) {
      this[targetRef] = null;
      return;
    }

    // Restore original properties based on entity type
    if (entity.box && data.originalMaterial !== undefined) {
      entity.box.material = data.originalMaterial;
    }
    if (entity.cylinder && data.originalMaterial !== undefined) {
      entity.cylinder.material = data.originalMaterial;
    }
    if (entity.model && data.originalModelColor !== undefined) {
      // Restore original model color
      entity.model.color = data.originalModelColor;
    }
    if (entity.ellipsoid && data.originalMaterial !== undefined) {
      const orig = data.originalMaterial;
      entity.ellipsoid.material =
        typeof orig?.getType === "function"
          ? orig
          : new Cesium.ColorMaterialProperty(orig);
    }
    if (entity.point) {
      if (data.originalColor !== undefined)
        entity.point.color = data.originalColor;
      if (data.originalPixelSize !== undefined)
        entity.point.pixelSize = data.originalPixelSize;
    }

    this[targetRef] = null;
    this.viewer.scene.requestRender();
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.silhouetteBlue = null;
    this.silhouetteGreen = null;
    this.highlightedFeature = null;
    this.selectedFeature = null;
    this.highlightedObject = null;
    this.selectedObject = null;
  }
}

/**
 * Get or create the highlight manager for a viewer
 */
export function getHighlightManager(
  viewer: any,
): CesiumHighlightManager | null {
  if (!viewer || !window.Cesium) return null;

  // Store manager on viewer instance
  if (!viewer._highlightManager) {
    viewer._highlightManager = new CesiumHighlightManager(viewer);
  }

  return viewer._highlightManager;
}
