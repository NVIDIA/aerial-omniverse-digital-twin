# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Round-trip example: load a YAML config, mutate it, save the result.

Demonstrates re-editing a previously generated AODT config via the
``_config`` Python bindings.

Run from the repo root (after building ``_config``)::

    PYTHONPATH=client/build:client/build/config \
        python3 client/examples/example_import_yaml_config.py
"""

import argparse
import logging
import sys
from pathlib import Path

if not logging.getLogger().hasHandlers():
    logging.basicConfig(level=logging.INFO)

try:
    from _config import (
        SimConfig,
        DiffusionModel,
        AntennaElement,
    )
except ImportError as e:
    logging.error(f"Import error: {e}")
    logging.error(
        "Build the _config module first and add it to PYTHONPATH, e.g.:\n"
        "  PYTHONPATH=client/build:client/build/config python3 %s",
        sys.argv[0],
    )
    sys.exit(1)

try:
    from omegaconf import OmegaConf
except ImportError as e:
    logging.error(f"Import error: {e}")
    logging.error("Make sure config module is built and in PYTHONPATH")
    sys.exit(1)


def update_sim_config_from_yaml(sim_config_file: Path, new_sim_config_path: Path) -> int:
    logging.info(f"Creating SimConfig by importing {sim_config_file}...")
    config = SimConfig.from_yaml_file(str(sim_config_file))

    # Update simulation_id
    config.set_simulation_id("test_new_sim_id")

    # update timeline
    config.set_timeline(duration=5, interval=1)

    # update number of batches
    config.set_num_batches(2)

    # update ray tracing model to Lambertian
    config.set_ray_tracing_model(DiffusionModel.LAMBERTIAN, 5, 500, 500)

    # update RU panel elements to isotropic
    # 1. get ru panel id assuming it is the default panel
    ru_panel_id = config.get_default_ru_panel_id()
    # Alternatively, you can update panel for specific RU
    # ru = config.get_ru(1) # Update for RU with id 1
    # ru_panel_id = ru.panel_id()

    # 2. get ru panel
    ru_panel = config.get_panel(ru_panel_id)
    # 3. update ru panel elements to isotropic
    ru_panel.set_antenna_elements([AntennaElement.Isotropic])
    ru_panel.set_panel_size(4, 8, True)
    
    # update UE panel elements to infinitesimal dipole
    ue_panel_id = config.get_default_ue_panel_id()
    config.get_panel(ue_panel_id).set_antenna_elements(
        [AntennaElement.InfinitesimalDipole]
    )

    for ue_id in config.get_ue_ids():
        config.get_ue(ue_id).set_radiated_power(23.0)

    new_freq = 3400.0 # MHz

    for ru_id in config.get_ru_ids():
        config.get_ru(ru_id).set_radiated_power(43.0)
        config.get_ru(ru_id).set_frequency(new_freq)
    
    for du_id in config.get_du_ids():
        config.get_du(du_id).set_frequency(new_freq)

    for panel_id in config.get_panel_ids():
        config.get_panel(panel_id).set_frequency(new_freq)

    logging.info("Saving configuration...")
    try:
        OmegaConf.save(config.to_dict(), new_sim_config_path)
        logging.info("Configuration saved.")
        return 0
    except Exception as e:
        logging.exception("Failed to save configuration: %s", e)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import, mutate, and re-emit an AODT config."
    )
    here = Path(__file__).parent
    parser.add_argument(
        "--sim-config-old",
        type=Path,
        default=here / "example_generated_YAML_config.yml",
        help="Source YAML config to import.",
    )
    parser.add_argument(
        "--sim-config-new",
        type=Path,
        default=here / "example_new_YAML_config.yml",
        help="Destination YAML for the mutated config.",
    )
    args = parser.parse_args()

    print(
        f"Importing simulation configuration from {args.sim_config_old} "
        f"-> {args.sim_config_new}"
    )
    return update_sim_config_from_yaml(args.sim_config_old, args.sim_config_new)


if __name__ == "__main__":
    sys.exit(main())
