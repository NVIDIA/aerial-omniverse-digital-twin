/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import {
  spawnZoneManager,
  type SpawnZonePoint,
} from "~/managers/spawnZoneManager";

/**
 * React hook to subscribe to spawn zone manager state.
 * Returns the current points and altitude, re-renders on changes.
 */
export function useSpawnZone(): {
  points: SpawnZonePoint[];
  altitude: number;
} {
  const [data, setData] = useState(() => ({
    points: spawnZoneManager.getPoints(),
    altitude: spawnZoneManager.getAltitude(),
  }));

  useEffect(() => {
    const unsubscribe = spawnZoneManager.subscribe((points, altitude) => {
      setData({ points, altitude });
    });

    // Set initial state
    setData({
      points: spawnZoneManager.getPoints(),
      altitude: spawnZoneManager.getAltitude(),
    });

    return unsubscribe;
  }, []);

  return data;
}
