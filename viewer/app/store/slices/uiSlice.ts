/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * UI state slice
 * Manages: sidebars, tabs, simulation state, timeline
 */
import { saveActiveTab } from "../utils/localStorage";
import type { TimeInfo } from "@/types/simulation";

export interface UISlice {
  // State
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  activeRightTab: "Rays" | "Entities" | "Settings";
  isSimulationRunning: boolean;
  selectedDatabase: string;
  timelineRefreshTrigger: number;
  ymlTimeData: TimeInfo[] | null;

  // Actions
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setActiveRightTab: (tab: "Rays" | "Entities" | "Settings") => void;
  startSimulation: () => void;
  stopSimulation: () => void;
  setSelectedDatabase: (database: string) => void;
  triggerTimelineRefresh: () => void;
  setYmlTimeData: (data: TimeInfo[] | null) => void;
}

export const createUISlice = (set: any, _get: any, _store: any): UISlice => ({
  // Initial state
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  activeRightTab: "Rays",
  isSimulationRunning: false,
  selectedDatabase: "default",
  timelineRefreshTrigger: 0,
  ymlTimeData: null,

  // Actions
  toggleLeftSidebar: () =>
    set((state) => ({ leftSidebarCollapsed: !state.leftSidebarCollapsed })),
  toggleRightSidebar: () =>
    set((state) => ({ rightSidebarCollapsed: !state.rightSidebarCollapsed })),
  setActiveRightTab: (tab) => {
    set({ activeRightTab: tab });
    saveActiveTab(tab);
  },
  startSimulation: () => set({ isSimulationRunning: true }),
  stopSimulation: () => set({ isSimulationRunning: false }),
  setSelectedDatabase: (database) => set({ selectedDatabase: database }),
  triggerTimelineRefresh: () =>
    set((state) => ({
      timelineRefreshTrigger: state.timelineRefreshTrigger + 1,
    })),
  setYmlTimeData: (data) => set({ ymlTimeData: data }),
});
