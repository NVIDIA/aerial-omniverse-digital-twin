/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Vite (the build tool under React Router) can sometimes struggle with how Cesium handles its
  // dependencies in SSR (Server-Side Rendering) mode. You can tell Vite to treat these packages
  // differently with the `noExternal` option.
  ssr: {
    noExternal: ["cesium", "@cesium/engine", "@zip.js/zip.js"],
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    host: true,
    allowedHosts: "all",
    fs: {
      allow: [".."],
    },
  },
});
