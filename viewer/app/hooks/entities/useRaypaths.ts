/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, type SetStateAction } from "react";
import { raypathManager } from "~/managers/raypathManager";
import type { Raypath } from "@/types";

/**
 * React hook to subscribe to raypath manager state
 * Returns the current raypaths array and re-renders on changes
 */
export function useRaypaths(): Raypath[] {
  const [raypaths, setRaypaths] = useState<Raypath[]>(() =>
    raypathManager.getAll(),
  );

  useEffect(() => {
    // Subscribe to changes
    const unsubscribe = raypathManager.subscribe(
      (newRaypaths: SetStateAction<Raypath[]>) => {
        setRaypaths(newRaypaths);
      },
    );

    // Set initial state
    setRaypaths(raypathManager.getAll());

    return unsubscribe;
  }, []);

  return raypaths;
}
