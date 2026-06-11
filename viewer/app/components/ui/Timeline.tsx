/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { fetchFromDataSource } from "../../managers/dataLoader";
import { raypathLayer } from "../layers/RaypathLayer";
import { useViewerStore } from "../../store/viewerStore";
import { minioClient } from "@/services/database";
import { SIDEBAR_WIDTH, RIGHT_SIDEBAR_WIDTH } from "../../constants/ui";
import * as Cesium from "cesium";
import { TIMELINE_CONFIG } from "../../constants/timeline";
import type { TimeInfo } from "@/types/simulation";

interface TimelineProps {
  database: string;
  refreshTrigger?: number;
  isConnected: boolean;
}

export const Timeline: React.FC<TimelineProps> = ({
  database,
  refreshTrigger = 0,
  isConnected,
}) => {
  const [timeData, setTimeData] = useState<TimeInfo[]>([]);
  const [selectedTimeIdx, setSelectedTimeIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackInterval, setPlaybackInterval] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("timeline-playback-interval");
      return stored ? parseInt(stored) : 500;
    }
    return 500;
  }); // milliseconds per step
  const [showDetails, setShowDetails] = useState(false);
  const [goToValue, setGoToValue] = useState<string>("");
  const [goToError, setGoToError] = useState<string | null>(null);
  const playbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Get sidebar states for proper centering
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    rayPathsVisible,
    ymlTimeData,
  } = useViewerStore();

  // Update raypath visibility when rayPathsVisible changes
  useEffect(() => {
    raypathLayer.setVisibility(rayPathsVisible);
  }, [rayPathsVisible]);

  // Fetch time_info data when refreshTrigger changes
  useEffect(() => {
    if (!database || !isConnected || refreshTrigger === 0) {
      return;
    }

    loadTimeInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger, database, isConnected]);

  // Apply YML-derived time indices when they change
  useEffect(() => {
    if (ymlTimeData && ymlTimeData.length > 0) {
      setTimeData(ymlTimeData);
      const firstTimeIdx = ymlTimeData[0].time_idx;
      setSelectedTimeIdx(firstTimeIdx);
      setTimeFilter(firstTimeIdx);
      setError(null);
      setLoading(false);
    } else if (ymlTimeData === null || ymlTimeData.length === 0) {
      setTimeData([]);
      setSelectedTimeIdx(null);
      stopPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ymlTimeData]);

  /**
   * Set time filter to show only entities with availability for a specific time index.
   * Cesium's availability system automatically handles showing/hiding entities based on their availability intervals.
   */
  const setTimeFilter = (timeIdx: number) => {
    const viewer = useViewerStore.getState().cesiumViewer;
    if (!viewer) return;

    // Set the clock's current time to display this time_idx
    // Cesium will automatically show/hide entities based on their availability intervals
    const newTime = Cesium.JulianDate.addSeconds(
      TIMELINE_CONFIG.baseTime,
      timeIdx * TIMELINE_CONFIG.timeStep,
      new Cesium.JulianDate(),
    );

    viewer.clock.currentTime = Cesium.JulianDate.clone(newTime);
  };

  const loadTimeInfo = async () => {
    // `isConnected` from the parent can lag (polled); avoid treating post-disconnect
    // refresh as a failed fetch (see MinIOSettings handleDisconnect + triggerTimelineRefresh).
    if (!minioClient.isConnected()) {
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use dataLoader to fetch time-index data from MinIO / Iceberg
      const result = await fetchFromDataSource(
        "time_info",
        database,
        `SELECT * FROM ${database}.time_info ORDER BY time_idx ASC`,
      );

      if (result.error) {
        console.error("[Timeline] Error loading time_info:", result.error);
        setError(result.error);
        setTimeData([]);
      } else {
        // Normalize data to ensure proper types (important for Parquet data)
        const rawData = result.data as any[];
        const normalizedData: TimeInfo[] = rawData.map((row) => ({
          time_idx: Number(row.time_idx ?? 0),
          batch_idx: Number(row.batch_idx ?? 0),
          slot_idx: Number(row.slot_idx ?? 0),
          symbol_idx: Number(row.symbol_idx ?? 0),
        }));

        // Sort by time_idx (catalog queries may already be ordered; Parquet might not)
        normalizedData.sort((a, b) => a.time_idx - b.time_idx);

        const timeData = normalizedData;
        if (timeData.length == 0) {
          console.warn("[Timeline] No time data found, using default");
          timeData.push({
            time_idx: 0,
            batch_idx: 0,
            slot_idx: 0,
            symbol_idx: 0,
          });
        }

        setTimeData(timeData);
        // Always reset to the first time index when loading new data
        const firstTimeIdx = timeData[0].time_idx;
        setSelectedTimeIdx(firstTimeIdx);
        setTimeFilter(firstTimeIdx);
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to load time_info";
      console.error("[Timeline] Exception loading time_info:", err);
      setError(errorMsg);
      setTimeData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTimeSelect = (timeIdx: number) => {
    setSelectedTimeIdx(timeIdx);
    setTimeFilter(timeIdx);
  };

  // Playback controls
  const handlePlayPause = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  };

  const startPlayback = () => {
    if (timeData.length === 0) return;

    setIsPlaying(true);

    playbackIntervalRef.current = setInterval(() => {
      setSelectedTimeIdx((prev) => {
        if (prev === null) {
          const firstTimeIdx = timeData[0].time_idx;
          setTimeFilter(firstTimeIdx);
          return firstTimeIdx;
        }

        const currentIdx = timeData.findIndex((t) => t.time_idx === prev);
        if (currentIdx >= timeData.length - 1) {
          // Reached the end, loop back to start
          const firstTimeIdx = timeData[0].time_idx;
          setTimeFilter(firstTimeIdx);
          return firstTimeIdx;
        }

        const nextTimeIdx = timeData[currentIdx + 1].time_idx;
        setTimeFilter(nextTimeIdx);
        return nextTimeIdx;
      });
    }, playbackInterval);
  };

  const stopPlayback = () => {
    setIsPlaying(false);
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
  };

  const handlePrevious = () => {
    if (selectedTimeIdx === null || timeData.length === 0) return;
    const currentIdx = timeData.findIndex(
      (t) => t.time_idx === selectedTimeIdx,
    );
    if (currentIdx > 0) {
      handleTimeSelect(timeData[currentIdx - 1].time_idx);
    }
  };

  const handleNext = () => {
    if (selectedTimeIdx === null || timeData.length === 0) return;
    const currentIdx = timeData.findIndex(
      (t) => t.time_idx === selectedTimeIdx,
    );
    if (currentIdx < timeData.length - 1) {
      handleTimeSelect(timeData[currentIdx + 1].time_idx);
    }
  };

  const handleGoTo = (e: React.FormEvent) => {
    e.preventDefault();
    const targetTimeIdx = parseInt(goToValue);

    if (isNaN(targetTimeIdx)) {
      setGoToError("Invalid number");
      return;
    }

    const exists = timeData.some((t) => t.time_idx === targetTimeIdx);
    if (!exists) {
      setGoToError("Time index not found");
      return;
    }

    setGoToError(null);
    handleTimeSelect(targetTimeIdx);
    setGoToValue("");
  };

  // Cleanup playback on unmount
  useEffect(() => {
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, []);

  // Update playback interval
  useEffect(() => {
    if (isPlaying) {
      stopPlayback();
      startPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackInterval]);

  // Save playback interval to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "timeline-playback-interval",
        playbackInterval.toString(),
      );
    }
  }, [playbackInterval]);

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (goToError) {
      const timer = setTimeout(() => {
        setGoToError(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [goToError]);

  const selectedData = timeData.find((t) => t.time_idx === selectedTimeIdx);
  const currentIdx = selectedTimeIdx
    ? timeData.findIndex((t) => t.time_idx === selectedTimeIdx)
    : -1;

  // Calculate dynamic centering for banner based on sidebars
  // The banner should be centered in the visible map viewport area
  const leftSidebarWidth = leftSidebarCollapsed ? 0 : SIDEBAR_WIDTH;
  const rightSidebarWidth = rightSidebarCollapsed ? 0 : RIGHT_SIDEBAR_WIDTH;

  // Calculate the center of the visible area as a percentage of total viewport width
  // Visible area spans from leftSidebarWidth to (100% - rightSidebarWidth)
  const visibleAreaCenter =
    typeof window !== "undefined"
      ? leftSidebarWidth +
        (window.innerWidth - leftSidebarWidth - rightSidebarWidth) / 2
      : 0; // Default value for SSR

  // Has YML-sourced time data (show timeline even without a DB connection)
  const hasYmlTime = ymlTimeData !== null && ymlTimeData.length > 0;

  // Don't render if not connected (unless YML provides time data) or no data after initial load
  if (!isConnected && !hasYmlTime) return null;
  if (!loading && timeData.length === 0 && refreshTrigger > 0 && !hasYmlTime)
    return null;

  return (
    <>
      {/* Error Toast Banner - positioned at top of map viewport */}
      {goToError && (
        <div
          className="absolute top-20 z-30 animate-fade-in transition-all duration-300"
          style={{
            pointerEvents: "auto",
            left: `${visibleAreaCenter}px`,
            transform: "translate(-50%, 0)",
          }}
        >
          <div className="bg-red-500/95 text-white px-4 py-3 rounded-lg shadow-2xl border border-red-400 flex items-center gap-3">
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-medium">{goToError}</span>
            <button
              onClick={() => setGoToError(null)}
              className="ml-2 text-white/80 hover:text-white transition-colors"
              title="Dismiss"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Timeline Widget */}
      <div
        className="absolute bottom-8 z-30 transition-all"
        style={{
          pointerEvents: "auto",
          left: `${visibleAreaCenter}px`,
          transform: "translateX(-50%)",
        }}
      >
        <div className="bg-gray-900/95 rounded-lg shadow-2xl border border-gray-700 px-4 py-2">
          <div className="flex items-center gap-3">
            {/* Loading State */}
            {loading && (
              <div className="text-xs text-gray-400">Loading timeline...</div>
            )}

            {/* Error State */}
            {error && (
              <div className="text-xs text-red-400">Error: {error}</div>
            )}

            {/* Playback Controls */}
            {!loading && !error && timeData.length > 0 && (
              <>
                {/* Play/Pause Button */}
                <button
                  onClick={handlePlayPause}
                  className={`p-2 rounded transition-all ${
                    isPlaying
                      ? "bg-[#76B900] text-black shadow-lg"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                  }`}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                {/* Timeline Scrubber */}
                <div className="flex items-center gap-2 min-w-[200px]">
                  <input
                    type="range"
                    min={0}
                    max={timeData.length - 1}
                    value={currentIdx >= 0 ? currentIdx : 0}
                    onChange={(e) => {
                      // If playing, stop playback when user manually drags scrubber
                      if (isPlaying) {
                        stopPlayback();
                      }
                      const arrayIndex = parseInt(e.target.value);
                      handleTimeSelect(timeData[arrayIndex].time_idx);
                    }}
                    className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                    style={{
                      background: `linear-gradient(to right, #76B900 0%, #76B900 ${
                        currentIdx >= 0
                          ? (currentIdx / (timeData.length - 1)) * 100
                          : 0
                      }%, #374151 ${
                        currentIdx >= 0
                          ? (currentIdx / (timeData.length - 1)) * 100
                          : 0
                      }%, #374151 100%)`,
                    }}
                  />
                  <span className="text-xs font-mono text-[#76B900] font-medium min-w-[3ch]">
                    {selectedTimeIdx ?? timeData[0].time_idx}
                  </span>
                  <span className="text-xs text-gray-500">
                    / {timeData[timeData.length - 1].time_idx}
                  </span>
                </div>

                {/* Previous Button */}
                <button
                  onClick={handlePrevious}
                  disabled={currentIdx <= 0 || isPlaying}
                  className="p-2 rounded transition-all bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous"
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M15 19l-7-7 7-7z" />
                  </svg>
                </button>

                {/* Next Button */}
                <button
                  onClick={handleNext}
                  disabled={currentIdx >= timeData.length - 1 || isPlaying}
                  className="p-2 rounded transition-all bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next"
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 5l7 7-7 7z" />
                  </svg>
                </button>

                {/* Info/Settings Buttons */}
                {selectedData && (
                  <div className="flex items-center gap-2">
                    {/* Toggle Details */}
                    <button
                      onClick={() => setShowDetails(!showDetails)}
                      className="p-2 rounded transition-all bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                      title="Toggle details"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path d="M12 8v4m0 4h.01" />
                      </svg>
                    </button>
                  </div>
                )}
              </>
            )}

            {/* No Data Placeholder */}
            {!loading && !error && timeData.length === 0 && (
              <div className="text-xs text-gray-400">
                Load database to display timeline
              </div>
            )}
          </div>

          {/* Expanded Details Panel */}
          {showDetails && selectedData && !loading && timeData.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-800">
              <div className="flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-gray-400">Batch:</span>
                  <span className="text-gray-200 font-mono">
                    {selectedData.batch_idx}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400">Slot:</span>
                  <span className="text-gray-200 font-mono">
                    {selectedData.slot_idx}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400">Symbol:</span>
                  <span className="text-gray-200 font-mono">
                    {selectedData.symbol_idx}
                  </span>
                </div>
                {/* Go to Time Input */}
                <form onSubmit={handleGoTo} className="flex items-center gap-1">
                  <span className="text-gray-400">Go to:</span>
                  <input
                    type="text"
                    value={goToValue}
                    onChange={(e) => {
                      setGoToValue(e.target.value);
                      setGoToError(null);
                    }}
                    placeholder="Time"
                    className={`w-16 px-2 py-1 text-xs rounded font-mono transition-colors ${
                      goToError
                        ? "bg-red-900/30 border-2 border-red-500 text-red-200 placeholder-red-400"
                        : "bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#76B900]"
                    }`}
                    disabled={isPlaying}
                  />
                  <button
                    type="submit"
                    disabled={isPlaying || !goToValue.trim()}
                    className="p-1 rounded transition-all bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Go to time index"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </form>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">Interval:</span>
                  <input
                    type="range"
                    min="100"
                    max="2000"
                    step="100"
                    value={playbackInterval}
                    onChange={(e) =>
                      setPlaybackInterval(parseInt(e.target.value))
                    }
                    className="w-24 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <span className="text-gray-200 font-mono min-w-[3.5ch]">
                    {playbackInterval}ms
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
