/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { scattererManager } from "~/managers/scattererManager";
import type { Scatterer } from "@/types";

/**
 * React hook to subscribe to scatterer manager state
 * Returns the current scatterers map and re-renders on changes
 */
export function useScatterers(): Map<number, Scatterer> {
  const [scatterers, setScatterers] = useState<Map<number, Scatterer>>(() =>
    scattererManager.getAll(),
  );

  useEffect(() => {
    // Subscribe to changes
    const unsubscribe = scattererManager.subscribe((newScatterers) => {
      setScatterers(newScatterers);
    });

    // Set initial state
    setScatterers(scattererManager.getAll());

    return unsubscribe;
  }, []);

  return scatterers;
}
