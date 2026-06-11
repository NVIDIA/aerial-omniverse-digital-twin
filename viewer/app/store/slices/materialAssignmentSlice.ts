/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maps 3D Tiles surface hash strings to user-defined material labels for export (assignment.json).
 */
export type SurfaceMaterialAssignments = Record<string, string>;

export interface MaterialAssignmentSlice {
  surfaceMaterialAssignments: SurfaceMaterialAssignments;
  setSurfaceMaterialAssignments: (
    assignments:
      | SurfaceMaterialAssignments
      | ((prev: SurfaceMaterialAssignments) => SurfaceMaterialAssignments),
  ) => void;
  assignMaterialToSurfaceHashes: (
    hashes: string[],
    materialLabel: string,
  ) => void;
  clearSurfaceMaterialAssignments: () => void;
  availableMaterials: string[];
  setAvailableMaterials: (materials: string[]) => void;
  materialsJsonUrl: string | null;
  setMaterialsJsonUrl: (url: string | null) => void;
}

export const createMaterialAssignmentSlice = (
  set: any,
  get: any,
): MaterialAssignmentSlice => ({
  surfaceMaterialAssignments: {},

  setSurfaceMaterialAssignments: (assignments) => {
    const prev = get().surfaceMaterialAssignments as SurfaceMaterialAssignments;
    set({
      surfaceMaterialAssignments:
        typeof assignments === "function"
          ? (
              assignments as (
                p: SurfaceMaterialAssignments,
              ) => SurfaceMaterialAssignments
            )(prev)
          : assignments,
    });
  },

  assignMaterialToSurfaceHashes: (hashes, materialLabel) => {
    const trimmed = materialLabel.trim();
    if (!trimmed || hashes.length === 0) return;
    const prev = get().surfaceMaterialAssignments as SurfaceMaterialAssignments;
    const next = { ...prev };
    for (const h of hashes) {
      const key = h.trim();
      if (key) next[key] = trimmed;
    }
    set({ surfaceMaterialAssignments: next });
  },

  clearSurfaceMaterialAssignments: () =>
    set({ surfaceMaterialAssignments: {} }),

  availableMaterials: [],
  setAvailableMaterials: (materials) => set({ availableMaterials: materials }),

  materialsJsonUrl: null,
  setMaterialsJsonUrl: (url) => set({ materialsJsonUrl: url }),
});
