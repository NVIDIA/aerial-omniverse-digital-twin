/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Cesium from "cesium";
import { useViewerStore } from "~/store/viewerStore";
import { spawnZoneManager } from "~/managers/spawnZoneManager";
import type { SpawnZonePoint } from "~/managers/spawnZoneManager";

const SPAWN_ZONE_ENTITY_ID = "__spawn_zone_polygon__";
const FILL_COLOR = Cesium.Color.fromCssColorString("#2bff00").withAlpha(0.35);
const OUTLINE_COLOR = Cesium.Color.LIME;

/**
 * Layer class to visualize the committed spawn zone as a terrain-clamped polygon.
 */
class SpawnZoneLayer {
  private viewer: Cesium.Viewer | null = null;

  constructor() {
    this.setupSubscriptions();
  }

  private setupSubscriptions() {
    this.viewer = useViewerStore.getState().cesiumViewer ?? null;

    let prevViewer = this.viewer;

    useViewerStore.subscribe((state) => {
      if (state.cesiumViewer !== prevViewer) {
        this.viewer = state.cesiumViewer ?? null;
        prevViewer = this.viewer;

        const points = spawnZoneManager.getPoints();
        if (this.viewer && points && points.length >= 3) {
          this.visualize(points, spawnZoneManager.getAltitude());
        }
      }
    });

    spawnZoneManager.subscribe((points, altitude) => {
      if (points && points.length >= 3) {
        this.visualize(points, altitude);
      } else {
        this.clear();
      }
    });
  }

  clear() {
    if (!this.viewer) return;

    const entity = this.viewer.entities.getById(SPAWN_ZONE_ENTITY_ID);
    if (entity) {
      this.viewer.entities.remove(entity);
      this.viewer.scene.requestRender();
    }
  }

  private visualize(points: SpawnZonePoint[], _altitude: number) {
    if (!this.viewer || (points && points.length < 3)) {
      this.clear();
      return;
    }

    const existing = this.viewer.entities.getById(SPAWN_ZONE_ENTITY_ID);
    if (existing) {
      this.viewer.entities.remove(existing);
    }

    const positions = points.map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
    );
    const center = Cesium.Cartesian3.fromDegrees(
      points.reduce((sum, p) => sum + p.lon, 0) / points.length,
      points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    );

    this.viewer.entities.add({
      id: SPAWN_ZONE_ENTITY_ID,
      position: center,
      polygon: new Cesium.PolygonGraphics({
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: FILL_COLOR,
        outline: false,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        classificationType: Cesium.ClassificationType.TERRAIN,
      }),
    });

    this.viewer.scene.requestRender();
  }
}

export const spawnZoneLayer = new SpawnZoneLayer();
