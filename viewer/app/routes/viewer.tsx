/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { CesiumViewerComponent } from "@/components/viewer/CesiumViewer";
import { TopHeader } from "@/components/ui/TopHeader";
import { LeftSidebar } from "@/components/ui/LeftSidebar";
import { RightSidebar } from "@/components/ui/RightSidebar";
import { Timeline } from "@/components/ui/Timeline";
import { useViewerStore } from "@/store/viewerStore";
import { SIDEBAR_WIDTH_PX, RIGHT_SIDEBAR_WIDTH_PX } from "@/constants";
import { minioClient } from "@/services/database";
import { useEffect, useState } from "react";

export default function ViewerPage() {
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    selectedDatabase,
    timelineRefreshTrigger,
  } = useViewerStore();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const checkConnection = () => {
      setIsConnected(minioClient.isConnected());
    };

    checkConnection();
    const interval = setInterval(checkConnection, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      {/* Top Header */}
      <TopHeader />

      {/* Main 3D Viewer */}
      <div
        className="absolute top-16 bottom-0 transition-all duration-300"
        style={{
          left: leftSidebarCollapsed ? 0 : SIDEBAR_WIDTH_PX,
          right: rightSidebarCollapsed ? 0 : RIGHT_SIDEBAR_WIDTH_PX,
        }}
      >
        <CesiumViewerComponent className="w-full h-full" />
      </div>

      {/* Left Sidebar */}
      <LeftSidebar />

      {/* Right Sidebar */}
      <RightSidebar />

      {/* Timeline Widget (Horizontal at bottom) */}
      <Timeline
        database={selectedDatabase}
        refreshTrigger={timelineRefreshTrigger}
        isConnected={isConnected}
      />
    </div>
  );
}
