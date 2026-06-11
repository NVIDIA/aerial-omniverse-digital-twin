/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for uiSlice
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUISlice } from "./uiSlice";
import type { UISlice } from "./uiSlice";

// Mock localStorage utils
vi.mock("../utils/localStorage", () => ({
  saveActiveTab: vi.fn(),
}));

describe("uiSlice", () => {
  let slice: UISlice;
  let mockSet: any;
  let mockGet: any;
  let mockStore: any;

  beforeEach(() => {
    mockSet = vi.fn((updates: any) => {
      if (typeof updates === "function") {
        const currentState = mockGet();
        return updates(currentState);
      }
    });
    mockGet = vi.fn(() => ({
      leftSidebarCollapsed: false,
      rightSidebarCollapsed: false,
      timelineRefreshTrigger: 0,
    }));
    mockStore = {};

    slice = createUISlice(mockSet, mockGet, mockStore);
  });

  describe("Initial State", () => {
    it("should have correct initial values", () => {
      expect(slice.leftSidebarCollapsed).toBe(false);
      expect(slice.rightSidebarCollapsed).toBe(false);
      expect(slice.activeRightTab).toBe("Rays");
      expect(slice.isSimulationRunning).toBe(false);
      expect(slice.selectedDatabase).toBe("default");
      expect(slice.timelineRefreshTrigger).toBe(0);
      expect(slice.ymlTimeData).toBeNull();
    });
  });

  describe("toggleLeftSidebar", () => {
    it("should toggle left sidebar from false to true", () => {
      mockGet.mockReturnValue({ leftSidebarCollapsed: false });
      slice.toggleLeftSidebar();

      const result = mockSet.mock.calls[0][0]({ leftSidebarCollapsed: false });
      expect(result).toEqual({ leftSidebarCollapsed: true });
    });

    it("should toggle left sidebar from true to false", () => {
      mockGet.mockReturnValue({ leftSidebarCollapsed: true });
      slice.toggleLeftSidebar();

      const result = mockSet.mock.calls[0][0]({ leftSidebarCollapsed: true });
      expect(result).toEqual({ leftSidebarCollapsed: false });
    });
  });

  describe("toggleRightSidebar", () => {
    it("should toggle right sidebar", () => {
      mockGet.mockReturnValue({ rightSidebarCollapsed: false });
      slice.toggleRightSidebar();

      const result = mockSet.mock.calls[0][0]({ rightSidebarCollapsed: false });
      expect(result).toEqual({ rightSidebarCollapsed: true });
    });
  });

  describe("setActiveRightTab", () => {
    it("should set active tab to Entities", () => {
      slice.setActiveRightTab("Entities");

      expect(mockSet).toHaveBeenCalledWith({ activeRightTab: "Entities" });
    });

    it("should set active tab to Settings", () => {
      slice.setActiveRightTab("Settings");

      expect(mockSet).toHaveBeenCalledWith({ activeRightTab: "Settings" });
    });
  });

  describe("startSimulation", () => {
    it("should set simulation running to true", () => {
      slice.startSimulation();

      expect(mockSet).toHaveBeenCalledWith({ isSimulationRunning: true });
    });
  });

  describe("stopSimulation", () => {
    it("should set simulation running to false", () => {
      slice.stopSimulation();

      expect(mockSet).toHaveBeenCalledWith({ isSimulationRunning: false });
    });
  });

  describe("setSelectedDatabase", () => {
    it("should update selected database", () => {
      slice.setSelectedDatabase("test_db");

      expect(mockSet).toHaveBeenCalledWith({ selectedDatabase: "test_db" });
    });
  });

  describe("triggerTimelineRefresh", () => {
    it("should increment timeline refresh trigger", () => {
      mockGet.mockReturnValue({ timelineRefreshTrigger: 5 });
      slice.triggerTimelineRefresh();

      const result = mockSet.mock.calls[0][0]({ timelineRefreshTrigger: 5 });
      expect(result).toEqual({ timelineRefreshTrigger: 6 });
    });

    it("should increment from 0 to 1", () => {
      mockGet.mockReturnValue({ timelineRefreshTrigger: 0 });
      slice.triggerTimelineRefresh();

      const result = mockSet.mock.calls[0][0]({ timelineRefreshTrigger: 0 });
      expect(result).toEqual({ timelineRefreshTrigger: 1 });
    });
  });

  describe("setYmlTimeData", () => {
    it("should set YML time data", () => {
      const timeData = [
        { time_idx: 0, batch_idx: 0, slot_idx: 0, symbol_idx: 0 },
        { time_idx: 1, batch_idx: 0, slot_idx: 1, symbol_idx: 0 },
      ];
      slice.setYmlTimeData(timeData);

      expect(mockSet).toHaveBeenCalledWith({ ymlTimeData: timeData });
    });

    it("should clear YML time data when set to null", () => {
      slice.setYmlTimeData(null);

      expect(mockSet).toHaveBeenCalledWith({ ymlTimeData: null });
    });
  });
});
