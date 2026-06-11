# Configuration Builder

This module is a **configuration builder** for AODT simulations. It provides a
high-level, type-safe Python API (implemented in C++ with pybind11 bindings) for
constructing simulation YAML configs programmatically.

## File Map

Root: `client/config/`

```
.
├── README.md                        # This file
│
│   ── C++ sources (header-only library + bindings) ──
├── aodt_config.hpp                  # Umbrella header
├── core_types.hpp                   # Enums, constants, AttributeValue/AttributeMap, Position, Waypoint
├── prims.hpp                        # Domain objects: Panel, DU, RU, UE, SpawnZone, Material, Nodes factory
├── prim_collections.hpp             # AssetPaths, VegetationAssetPaths, PrimContainer<T>
├── sim_config.hpp                   # SimConfig facade — the main class users interact with
├── aodt_config_bindings.cpp         # pybind11 bindings exposing all C++ classes to Python
│
│   ── Build ──
├── CMakeLists.txt                   # Build config (standalone or as part of parent project)
│
│   ── Test ──
├── test_aodt_config.py              # pytest suite
│
│   ── Sphinx documentation ──
└── docs/                            # API reference, quickstart, advanced features
```

## File Relationships

```
                  aodt_config.hpp  (umbrella include)
                  /       |       \
       core_types.hpp  prims.hpp  prim_collections.hpp
                  \       |       /
                   sim_config.hpp     ← main facade
                         |
              aodt_config_bindings.cpp  ← pybind11 layer
                         |
                   _config.so          ← compiled shared object
```

## Documentation

The RST sources in `docs/` are synced into the unified documentation site at
`docs/config/` by `docs/scripts/sync_config_docs.py`. Build the full site from
the repository root:

```bash
sphinx-build docs docs/_build/html
```

Then open `docs/_build/html/config/index.html`.

See `docs/quickstart.rst` for the quickstart and `docs/advanced.rst` for
advanced features.
