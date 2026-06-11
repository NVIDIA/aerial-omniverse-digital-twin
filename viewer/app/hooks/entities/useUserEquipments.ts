/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { userEquipmentManager } from "~/managers/userEquipmentManager";
import type { UserEquipment } from "@/types";

/**
 * React hook to subscribe to user equipment manager state
 * Returns the current user equipments map and re-renders on changes
 */
export function useUserEquipments(): Map<number, UserEquipment> {
  const [userEquipments, setUserEquipments] = useState<
    Map<number, UserEquipment>
  >(() => userEquipmentManager.getAll());

  useEffect(() => {
    // Subscribe to changes
    const unsubscribe = userEquipmentManager.subscribe((newUserEquipments) => {
      setUserEquipments(newUserEquipments);
    });

    // Set initial state
    setUserEquipments(userEquipmentManager.getAll());

    return unsubscribe;
  }, []);

  return userEquipments;
}
