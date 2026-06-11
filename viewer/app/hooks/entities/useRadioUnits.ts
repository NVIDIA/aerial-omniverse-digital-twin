/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, type SetStateAction } from "react";
import { radioUnitManager } from "~/managers/radioUnitManager";
import type { RadioUnit } from "@/types";

/**
 * React hook to subscribe to radio unit manager state
 * Returns the current radio units map and re-renders on changes
 */
export function useRadioUnits(): Map<number, RadioUnit> {
  const [radioUnits, setRadioUnits] = useState<Map<number, RadioUnit>>(() =>
    radioUnitManager.getAll(),
  );

  useEffect(() => {
    // Subscribe to changes
    const unsubscribe = radioUnitManager.subscribe(
      (newRadioUnits: SetStateAction<Map<number, RadioUnit>>) => {
        setRadioUnits(newRadioUnits);
      },
    );

    // Set initial state
    setRadioUnits(radioUnitManager.getAll());

    return unsubscribe;
  }, []);

  return radioUnits;
}
