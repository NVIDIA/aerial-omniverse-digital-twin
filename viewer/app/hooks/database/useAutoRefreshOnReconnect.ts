/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";

/**
 * Hook that monitors for Cesium network errors and auto-refreshes the page
 * when the browser/tab becomes active again (e.g., after computer wakes from sleep
 * or internet connection is restored)
 */
export const useAutoRefreshOnReconnect = () => {
  const hasNetworkErrorRef = useRef(false);
  const hasRefreshedRef = useRef(false);

  useEffect(() => {
    // Don't run on server
    if (typeof window === "undefined") return;

    const markNetworkError = () => {
      if (!hasNetworkErrorRef.current) {
        hasNetworkErrorRef.current = true;
      }
    };

    // Check if error message indicates network issue
    const isNetworkError = (message: string): boolean => {
      return (
        message.includes("ERR_INTERNET_DISCONNECTED") ||
        message.includes("ERR_NETWORK_CHANGED") ||
        message.includes("net::ERR_") ||
        message.includes("RequestErrorEvent") ||
        message.includes("api.cesium.com") ||
        (message.includes("Cesium") &&
          (message.includes("RequestError") ||
            message.includes("Failed to fetch") ||
            message.includes("Network request failed")))
      );
    };

    // Intercept console.error to detect Cesium network errors
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      // Call original first
      originalConsoleError.apply(console, args);

      // Check if this is a network-related error
      const errorString = args.join(" ");
      if (isNetworkError(errorString)) {
        markNetworkError();
      }
    };

    // Also intercept unhandled promise rejections (Cesium often throws these)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      let message = "";

      if (reason && typeof reason === "object") {
        message = JSON.stringify(reason);
      } else {
        message = String(reason);
      }

      if (isNetworkError(message)) {
        markNetworkError();
      }
    };

    // Listen for when the page becomes visible again
    const handleVisibilityChange = () => {
      if (
        !document.hidden &&
        hasNetworkErrorRef.current &&
        !hasRefreshedRef.current
      ) {
        hasRefreshedRef.current = true;
        // Small delay to ensure the page is fully active
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    };

    // Listen for when browser comes back online
    const handleOnline = () => {
      if (hasNetworkErrorRef.current && !hasRefreshedRef.current) {
        hasRefreshedRef.current = true;
        // Small delay to ensure connection is stable
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    };

    // Add event listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    // Cleanup
    return () => {
      console.error = originalConsoleError;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  }, []);
};
