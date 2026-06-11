/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, type SetStateAction } from "react";
import { distributedUnitManager } from "~/managers/distributedUnitManager";
import type { DistributedUnit } from "@/types";

/**
 * React hook to subscribe to distributed unit manager state
 * Returns the current distributed units map and re-renders on changes
 */
export function useDistributedUnits(): Map<number, DistributedUnit> {
  const [distributedUnits, setDistributedUnits] = useState<
    Map<number, DistributedUnit>
  >(() => distributedUnitManager.getAll());

  useEffect(() => {
    // Subscribe to changes
    const unsubscribe = distributedUnitManager.subscribe(
      (newDistributedUnits: SetStateAction<Map<number, DistributedUnit>>) => {
        setDistributedUnits(newDistributedUnits);
      },
    );

    // Set initial state
    setDistributedUnits(distributedUnitManager.getAll());

    return unsubscribe;
  }, []);

  return distributedUnits;
}
