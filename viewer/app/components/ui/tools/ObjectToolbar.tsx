/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { useViewerStore } from "../../../store/viewerStore";
import { UI_ELEMENT_OFFSET } from "../../../constants/ui";
import { SelectTool } from "./SelectTool";
import { MoveTool } from "./MoveTool";
import { RotateTool } from "./RotateTool";
import { CreateTool } from "./CreateTool";
import { MeasureOffsetTool, useGcpToolsEnabled } from "./MeasureOffsetTool";

/**
 * Toolbar for object manipulation and creation tools
 *
 * Select Tool: Enable to highlight and select buildings in the viewport.
 * When enabled, hover over buildings to see blue highlights and click to select (green).
 *
 * Move Tool: When enabled with an entity selected, shows axis arrows (gizmo) and
 * allows dragging to move the object (Blender-style translate). Drag an arrow to move along that axis.
 *
 * Create Tool: Opens a dropdown to create new objects (Radio Units, UE, etc.)
 * Uses ghost preview with smart snapping to surfaces for precise placement.
 *
 * Selected objects (like radio units) can be dragged and repositioned in the viewport.
 */
export const ObjectToolbar: React.FC = () => {
  const gcpEnabled = useGcpToolsEnabled();
  try {
    const store = useViewerStore();
    const selectToolEnabled = store?.selectToolEnabled ?? true;
    const setSelectToolEnabled = store?.setSelectToolEnabled ?? (() => {});
    const moveToolEnabled = store?.moveToolEnabled ?? false;
    const rotateToolEnabled = store?.rotateToolEnabled ?? false;
    const setTransformTool = store?.setTransformTool ?? (() => {});
    const creatingEntityType = store?.creatingEntityType ?? null;
    const startCreatingEntity = store?.startCreatingEntity ?? (() => {});
    const cancelCreatingEntity = store?.cancelCreatingEntity ?? (() => {});

    return (
      <div
        className="absolute top-1/2 -translate-y-1/2 z-10 transition-all"
        style={{
          pointerEvents: "auto",
          left: `${UI_ELEMENT_OFFSET}px`,
        }}
      >
        <div className="bg-gray-900/95 rounded-lg shadow-2xl border border-gray-700 px-2 py-3">
          <div className="flex flex-col items-center gap-2">
            <SelectTool
              enabled={selectToolEnabled}
              onToggle={() => setSelectToolEnabled(!selectToolEnabled)}
            />

            <MoveTool
              enabled={moveToolEnabled}
              onToggle={() => setTransformTool(moveToolEnabled ? null : "move")}
            />

            <RotateTool
              enabled={rotateToolEnabled}
              onToggle={() =>
                setTransformTool(rotateToolEnabled ? null : "rotate")
              }
            />

            {/* Divider */}
            <div className="h-px w-6 bg-gray-600" />

            <CreateTool
              creatingEntityType={creatingEntityType}
              onStartCreating={startCreatingEntity}
              onCancelCreating={cancelCreatingEntity}
            />

            {gcpEnabled && (
              <>
                <div className="h-px w-6 bg-gray-600" />
                <MeasureOffsetTool />
              </>
            )}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error("[ObjectToolbar] Error rendering:", error);
    return null;
  }
};
