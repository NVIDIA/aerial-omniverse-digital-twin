# NVIDIA Aerial Digital Twin Viewer

Next-generation 5G and 6G network simulation platform powered by NVIDIA CUDA-accelerated RAN, CesiumJS, and AI-driven ray-tracing.

## Features

### 🌐 Advanced 3D Geospatial Visualization

- **CesiumJS Integration**: High-precision WGS84 globe with accurate terrain and building data
- **3D Tiles Streaming**: Efficient rendering of massive datasets (BIM, point clouds)
- **Base Layer Options**: Sentinel-2 Satellite, CARTO (Dark / Light / Voyager), OpenStreetMap

### 📡 Entity Management & Ray-Traced Planning

- **Radio Units (RU)**: Add, configure, and position 5G/6G radio units with panel type, power, azimuth/tilt, and ray options
- **Distributed Units (DU)**: Configure DUs with reference frequency, subcarrier spacing, FFT size, and antenna count
- **User Equipment (UE)**: Place UEs with waypoints, mobility, and panel configuration
- **Scatterers**: Dynamic scatterer entities with time-indexed positions and orientations
- **Panels**: Antenna panel configurations (layout, spacing, polarization)
- **Spawn Zone**: Define spawn zones for procedural entity placement
- **Heat Map / Ray Visualization**: Viridis color gradient for signal strength (-180 to -40 dBm) and configurable raypath display

### 🗄️ Data Sources & APIs

- **MinIO**: Use MinIO (or S3-compatible storage) for Parquet files; proxy requests via `/api/minio` to avoid CORS
- **Iceberg**: Server-side Iceberg REST catalog (e.g., Nessie) with DuckDB for querying Parquet on S3; column projection and filtering via `/api/iceberg`
- **YML Configuration**: Upload and apply AODT YML scenario files; sync entities (DUs, RUs, UEs, Scatterers, Panels, Spawn Zone) with an in-app YML editor

### 🛠️ Editing & Tools

- **Object Toolbar**: Select, Move, Rotate, and Create tools for entities (RUs, UEs, etc.) with ghost preview and surface snapping
- **Property Panels**: Edit selected Radio Units, Distributed Units, User Equipment, Scatterers, Panels, and 3D building features in the right sidebar
- **Timeline**: Time-index playback; load time steps from MinIO / Iceberg-backed data, filter raypaths and entity visibility by time

### 🔬 Simulation & Scenario Parameters

- **Scenario Params**: Panel types (UE/RU), simulation mode (Duration/Slots), RAN simulation toggle, ray tracing (emission, bounces, paths per antenna pair), ray visualization (temperature color, dynamic range, sparsity, width)
- **User Equipments**: Seeded/urban mobility, procedural UEs, indoor percentage, height, radius, reception sphere, speed range
- **Dynamic Scatterers**: Enable dynamic scattering and max vehicle count

### 🚀 Performance & Architecture

- **Slice-based Store**: Zustand store split into object, UI, layer, scenario, camera, and data-source slices
- **Managers**: Dedicated managers for radio units, distributed units, user equipment, scatterers, panels, raypaths, spawn zone, layers, database, data loading, and YML config
- **Entity Hooks**: `useRadioUnits`, `useDistributedUnits`, `useUserEquipments`, `useScatterers`, `usePanels`, `useSpawnZone`, `useRaypaths` for reactive entity data
- **Testing**: Vitest with unit and integration tests; coverage via `@vitest/coverage-v8`

### ⚙️ Configurable Parameters

- **Network Types**: 6G, 5G V2V, and 5G support
- **Frequency Bands**: mmWave (26 GHz+) and sub-6 GHz
- **Power & Antenna**: Customizable transmit power, antenna gain, and panel types
- **Signal Range**: Adjustable sensitivity thresholds

### 🎨 Professional UI/UX

- **NVIDIA Design Language**: Dark theme with signature green accents
- **Collapsible Sidebars**: Left (base layer + tilesets), Right (Entities, Rays, Settings)
- **Real-time Controls**: Instant parameter updates and visualization
- **Location Search**: Jump to locations via search in the header

## Technology Stack

- **Frontend**: React 19, React Router 7
- **3D Engine**: Cesium 1.126
- **Simulation**: NVIDIA CUDA (backend)
- **State**: Zustand 5 (slice-based store)
- **Styling**: Tailwind CSS 4
- **Build**: Vite 7, React Router dev/build
- **Language**: TypeScript 5
- **Data / Backend APIs**: DuckDB (Iceberg route), hyparquet, js-yaml

## Getting Started

### Prerequisites

- **Node.js**: The toolchain (**Vite 7** requires **Node.js 20.19+ or 22.12+**; see the [Vite 7 migration guide](https://v7.vite.dev/guide/migration.html)). **Node.js 24+** and **npm 11+** are the tested versions. Very old runtimes (for example **Node.js 12**) are unsupported: they cannot parse syntax such as optional chaining used by install-time tooling and may fail with errors like `SyntaxError: Unexpected token '.'` during `npm install`.
- Modern web browser with WebGL 2.0 support
- (Optional) NVIDIA 6G Developer Program membership for full access

### Installing Node.js & npm

**Minimum vs. tested:** Meet **Vite 7’s** requirement (**Node.js 20.19+ or 22.12+**). This repo is tested with **Node.js v24.x** and **npm v11.x**. All downloads and instructions can be found at the [official Node.js site](https://nodejs.org/en/download).

**macOS / Linux — nvm (recommended):** Use [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager) so you can install and switch Node versions without conflicting with system packages. After [installing nvm](https://github.com/nvm-sh/nvm#installing-and-updating), install and select a **Vite-compatible** version—for example **20** or **22** (use a recent patch so you are on **20.19+** or **22.12+**), or **24** to match the tested setup:

```bash
nvm install 24
nvm use 24

node -v   # should print v24.x.x (or v20.x.x / v22.x.x if you chose an LTS)
npm -v
```

**Windows:**

1. Set version to v24.x.x (LTS) using the dropdown at the top
2. Select _Windows_ and the corresponding architecture using the dropdown menus below.
3. Download the Windows Installer (.msi)
4. Run the installer
5. Verify the installation:

```bash
node -v   # should print v24.x.x
npm -v    # should print 11.x.x
```

On Windows you can use the official installer, [nvm-windows](https://github.com/coreybutler/nvm-windows), or another version manager (`fnm`, etc.).

**macOS / Linux (alternative):** Use the prebuilt installer from nodejs.org, or another version manager (`fnm`, etc.).

### Installation

```bash
# From the repository root, navigate to the viewer directory
cd viewer

# Install dependencies
npm install

# Start development server
npm run dev
```

The application is available at `http://localhost:5173`. If running on a remote server, access it via the server's IP address: `http://<ip>:5173`. The default route is the viewer (no separate home page).

#### If `npm install` fails (wrong Node version)

A failed install is often a **version mismatch**: the project expects a current Node.js, not an old system default (for example Node 12). Transitive dependencies may use syntax that only newer Node parses; upgrading Node fixes that.

1. Check your version: `node -v`. If it is below **Vite 7’s minimum** (**20.19+** or **22.12+**), upgrade (see **Installing Node.js & npm** above). With nvm, for example: `nvm install 24 && nvm use 24`, or install **20** / **22** and ensure the patch version satisfies Vite’s requirement.
2. After upgrading, do a **clean install** so leftover artifacts from the failed run are not reused:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Building for Production

```bash
npm run build
npm run start
```

### Code Quality

```bash
# Type checking
npm run typecheck

# Format with Prettier
npm run format
npm run format:check

# Tests
npm run test
npm run test:ui
npm run test:run
npm run test:coverage
```

Prettier config is in `.prettierrc` at the project root.

## Project Structure

```
viewer/
├── app/
│   ├── components/
│   │   ├── layers/           # Cesium layers, tiles, raypaths, entities, and gizmos
│   │   ├── ui/               # Sidebars, settings, timeline, search, and controls
│   │   │   ├── properties/   # Entity property panels
│   │   │   └── tools/        # Create, move, rotate, select, and measurement tools
│   │   └── viewer/           # CesiumViewer
│   ├── constants/            # Base layers, locations, entity defaults, timeline, UI
│   ├── hooks/                # Cesium, database, and entity hooks
│   ├── managers/             # Entity, layer, raypath, scenario, and data managers
│   ├── routes/               # Viewer page and API route modules
│   ├── services/             # Cesium, database, and visualization services
│   ├── store/                # viewerStore, slices, persisted state, and types
│   ├── test/                 # Vitest setup and integration tests
│   ├── types/                # Cesium, entity, and simulation types
│   ├── utils/                # S3, MinIO, GIS tileset, gizmo, and placement helpers
│   ├── app.css
│   ├── entry.client.tsx
│   ├── entry.server.tsx
│   ├── root.tsx
│   └── routes.ts             # React Router route config
├── public/                   # Static assets
├── tests/                    # MR test scripts
├── Dockerfile
├── package.json
├── react-router.config.ts
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── README.md
```

## Usage Guide

### Navigating the Viewer

1. **Base layer**: Choose Sentinel-2, CARTO, or OSM in the left sidebar.
2. **Tilesets**: Toggle 3D tiles (e.g., Tokyo); use “Zoom to” to fly to a tileset.
3. **Heat map**: Signal strength uses a Viridis gradient from weak (-180 dBm) to strong (-40 dBm).
4. **Right sidebar**: Switch between **Entities**, **Rays**, and **Settings**; configure the Iceberg catalog, S3/MinIO endpoint, and scenario in **Settings**.

The viewer is centered on **Tokyo, Japan** (near Tokyo Tower) by default.

### Data source (MinIO / Iceberg)

- In **Settings**, connect using the **Iceberg Catalog** section: REST catalog URI, S3 provider (MinIO or AWS), optional credentials, and bucket/warehouse.
- After connecting, pick a database (namespace), then **Load** / **Refresh** to pull Parquet-backed data. The **Iceberg** API (`/api/iceberg`) is used for catalog queries and DuckDB-backed table access.

### YML Scenario Files

- Use the header action to open the **YML Editor**.
- Paste or edit an AODT YML config, then **Apply** to load DUs, Panels, RUs, UEs, Scatterers, and Spawn Zone into the viewer.
- Entity state can be synced from the database and reflected back in the editor.

### Timeline

- With a data source connected and time-index data loaded, the **Timeline** at the bottom shows steps.
- Select a time index to filter raypaths and time-based entity visibility.
- Playback controls and “Go to” are available for stepping through simulation time.

### Entity Tools

- **Select**: Click 3D buildings or entities to select; properties show in the right sidebar.
- **Move**: With an entity selected, enable Move to show the axis gizmo and drag to translate.
- **Rotate**: Use the rotate tool to change orientation.
- **Create**: Choose entity type (e.g., RU, UE), then click in the scene to place with ghost preview and snapping.

## API Reference

### Server Routes

| Route          | Method | Purpose                                                                                             |
| -------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `/api/minio`   | POST   | Proxy requests to MinIO/S3 (e.g., Parquet URLs)                                                     |
| `/api/iceberg` | POST   | Iceberg catalog (listNamespaces, listTables, queryTable, describeTable, testConnection) with DuckDB |

### ViewerStore (Zustand)

The viewer state is composed of **slices**:

- **Object slice**: Selection, transform tool, create flow, zoom, edit state
- **UI slice**: Sidebar collapse, active tabs, tool toggles (select, move, rotate), layer visibility
- **Layer slice**: Tilesets, base layer, Cesium viewer ref
- **Scenario slice**: `scenarioParams` (simulation, ray tracing, UE, scatterer options)
- **Camera slice**: Camera state save/restore
- **Data source slice**: `dataSourceType` (`"minio"`)

Key types: `RadioUnit`, `DistributedUnit`, `UserEquipment`, `Scatterer`, `Panel`, `Raypath`, `TilesetConfig`, `ScenarioParams` (see `app/types` and `app/store/types.ts`).

## Performance

- **GPU**: CUDA-accelerated ray-tracing and propagation on the backend
- **3D Tiles**: Loaded from your tile warehouse MinIO endpoint (e.g. `http://your-minio-host:9002`; streaming and LOD for large scenes)
- **WebGL**: Hardware-accelerated rendering with Cesium (WebGL 2.0)
- **State**: Zustand with slices to limit re-renders; entity data via managers and hooks

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

WebGL 2.0 is required. An NVIDIA GPU is recommended for best performance with CUDA backends.

## NVIDIA 6G Developer Program

For full capabilities of NVIDIA Aerial Digital Twin:

- Advanced propagation models
- Machine learning algorithm testing
- Extended scenario libraries
- Priority support

Visit: https://developer.nvidia.com/6g-program

## Acknowledgments

- **NVIDIA Aerial**: CUDA-accelerated RAN platform
- **Cesium**: 3D geospatial visualization
- **React Router**: Routing
- **Tailwind CSS**: Styling
- **Vitest**: Testing

---

**NVIDIA Aerial Digital Twin** — _Next-Generation Network Simulation_
