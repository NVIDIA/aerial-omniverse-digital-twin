/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { panelManager } from "~/managers/panelManager";
import type { Panel } from "@/types";

/**
 * React hook to subscribe to panel manager state
 * Returns the current panels map and re-renders on changes
 */
export function usePanels(): Map<number, Panel> {
  const [panels, setPanels] = useState<Map<number, Panel>>(() =>
    panelManager.getAll(),
  );

  useEffect(() => {
    // Subscribe to changes
    const unsubscribe = panelManager.subscribe((newPanels) => {
      setPanels(newPanels);
    });

    // Set initial state
    setPanels(panelManager.getAll());

    return unsubscribe;
  }, []);

  return panels;
}
