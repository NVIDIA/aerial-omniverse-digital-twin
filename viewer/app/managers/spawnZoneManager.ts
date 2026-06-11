/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type SpawnZonePoint = { lat: number; lon: number; height: number };

type Subscriber = (points: SpawnZonePoint[], altitude: number) => void;

/**
 * Manager class for the spawn zone polygon.
 */
export class SpawnZoneManager {
  private points: SpawnZonePoint[] = [];
  private altitude: number = 10;
  private subscribers: Set<Subscriber> = new Set();

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notify() {
    this.subscribers.forEach((cb) => cb(this.points, this.altitude));
  }

  getPoints(): SpawnZonePoint[] {
    return this.points;
  }

  getAltitude(): number {
    return this.altitude;
  }

  setPoints(points: SpawnZonePoint[]): void {
    this.points = [...points];
    this.notify();
  }

  setAltitude(altitude: number): void {
    this.altitude = altitude;
    this.notify();
  }

  set(points: SpawnZonePoint[], altitude: number): void {
    this.points = [...points];
    this.altitude = altitude;
    this.notify();
  }

  clear(): void {
    this.points = [];
    this.notify();
  }
}

// Export singleton instance
export const spawnZoneManager = new SpawnZoneManager();
