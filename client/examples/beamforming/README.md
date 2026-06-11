# Beamforming

This folder contains the beamforming post-processing workflow. Use it after an
upstream simulation and calibration run to apply calibration outputs and check
whether beamformed simulation curves align with measurement traces.

This guide does not run the upstream baseline simulation or calibration. The
actual workflow here starts after calibration output exists: fetch/review the
calibrated artifacts, run a new simulation from `sim_config_calibrated.yml`, then
compare post-calibration simulated power curves against measured power curves.

## Glossary

- `RU`: radio unit, the transmitter side of the simulated link.
- `UE`: user equipment, the receiver moving through the measurement scenario.
- `AODT`: NVIDIA Aerial Omniverse Digital Twin, the repository and runtime used
by the simulation client.
- `RSRP`: Reference Signal Received Power, the power curve compared against
measurements.
- `CFR`: Channel Frequency Response, the channel data used for beamforming.
- `Iceberg/Parquet`: exported simulation data tables, usually stored through
the configured S3/MinIO backend.
- `codebook`: calibrated RU beam weights exported as `RU_*_codebook.csv` when
beam training is enabled.

## Folder Organization: Beamforming

### Main

- `pipeline.py`: command-line runner for applying calibrated beams after
simulation and calibration artifacts are available locally.

### Helpers

`helpers/` contains utilities for artifacts that were already produced by
upstream simulation and calibration.

- `helpers/s3_io/fetch_calibrated_beamforming_artifacts.py`: fetches calibrated
beamforming artifacts from S3. Use it when calibration outputs are not already
local.
- `helpers/plot/plot_beam_power_timeseries.py`: plots selected beam RSRP
against measurement CSV traces for matching RU/UE pairs. Use it to inspect curve
overlap after beamforming.

### For Developers

Most users can skip `src/`. It contains implementation details for changing
beamforming behavior, not steps required to run this workflow.

## Setup And Runtime Dependencies

This example assumes you already have the AODT repository and client environment
set up. Start with the repository overview in
[`README.md`](../../../README.md); use
[`container/README.md`](../../../container/README.md) for the prebuilt container
path or [`client/README.md`](../../README.md) for manual client setup.

Runtime Python imports used by this example:

- `numpy`: tensor shaping, CFR handling, and beamforming math.
- `duckdb`: local SQL over exported Iceberg/Parquet data.
- `pyiceberg`: Iceberg catalog/table access for CFR and raypath data.
- `PyYAML`: simulation and calibration YAML parsing.
- `matplotlib` (optional): beam power plotting and optional debug CFR plots.

If you use the container setup, these should come from that environment. If you
are running outside the container, install them in your Python environment:

```bash
pip install numpy duckdb pyiceberg PyYAML matplotlib
```

Commands below start from the repository root and then `cd client`, because the
example imports are rooted under the client package.

## Prerequisite

This README is useful after the upstream simulation and calibration work is done
or reachable. Use your project simulation and calibration documentation for
those upstream steps.

Before running the beamforming commands, make sure you have:

- the repository checked out and the client runtime available;
- a running Digital Twin server address for simulations, used as
`--server_address <dt_server_address>`;
- S3/MinIO access to the bucket that holds simulation and calibration artifacts;
- Iceberg/Parquet channel data from the upstream simulation;
- the upstream calibration YAML, used by the fetch helper as
`--cal-yaml path/to/calibration.yml`;
- either local calibrated artifacts or S3 access so workflow step 1 can fetch
them:
  - `sim_config_calibrated.yml`, the calibrated simulation YAML;
  - optional `RU_*_codebook.csv`, one campaign codebook when beam training ran;
  - optional `ru<N>_ue<M>_with_beams_filled.csv` measurement-beam CSVs for
  plotting.

### 1. Upstream Simulation

Simulate the scenario where the measurements were taken outside this
beamforming folder. Follow your upstream simulation documentation for setup and
recommendations.

### 2. Upstream Calibration From Simulation Results

Treat calibration as a function of step 1: use the simulation outputs,
configuration, and data locations from the scenario just simulated. Match the
calibration run to those simulation outputs. Run calibration with the upstream
calibration workflow; this section only highlights the fields that must stay
aligned for later beamforming.

- **Align:**
  - S3 config: use the same bucket, credentials, and access settings needed for
  the simulation outputs;
  - object keys: point calibration inputs to the artifacts produced by step 1;
  - database locations: keep catalog, schema, table, and folder references tied
  to the simulated channel data.

- **Match:**
  - `gis`: keep the geometry and scene references consistent with the simulated
  measurement scenario;
  - `db` section: keep Iceberg/Parquet reads pointed at the simulation outputs.

- **Produce output:**
  - `S3 folder`: write calibration artifacts to the calibration output folder;
  - `sim_config_calibrated.yml`: calibrated simulation YAML emitted into the
  output folder;
  - `Materials`: calibrated material updates, using the
  `sim_config_calibrated.yml` output;
  - `Veg_materials`: calibrated vegetation updates, using the
  `sim_config_calibrated.yml` output;
  - `codebook`: campaign beam codebook, using the `RU_*_codebook.csv` output
  when beam training is enabled.

### 3. Calibration Output Artifacts

After calibration, the artifacts needed by this folder are:

- `RU_*_codebook.csv`: the campaign codebook, when beam training produced one
- `sim_config_calibrated.yml`: the YAML emitted by calibration output.

---

The prerequisite section ends here. The steps below are the actual beamforming
post-processing workflow in this folder.

## Typical Workflow

The core post-processing workflow starts here. Its numbering is independent
from the prerequisite checklist above.

### 1. Fetch And Review Calibration Outputs

If your calibration output is in S3, use the artifact fetch helper with the
upstream calibration input YAML:

```bash
cd client

python3 examples/beamforming/helpers/s3_io/fetch_calibrated_beamforming_artifacts.py \
  --cal-yaml path/to/calibration.yml \
  --output-dir path/to/beamforming_outputs
```

This helper can download:

- `sim_config_calibrated.yml`, the calibrated simulation YAML
- optional `RU_*_codebook.csv` files, one codebook per campaign when exported
- measurement CSVs referenced by `cal.measurements[*].measurement_file`

Skip this step if those files already exist locally.

Here `path/to/calibration.yml` is the YAML used to run upstream calibration.
`sim_config_calibrated.yml` is one of the fetched outputs.

Double-check the YAML fetched by
`helpers/s3_io/fetch_calibrated_beamforming_artifacts.py` before running the
calibrated simulation:

- do not accidentally overwrite the baseline simulation database output;
- adjust database paths or folders so the new run writes to fresh outputs.

### 2. Simulation From Calibrated YAML

Run a new simulation with `sim_config_calibrated.yml`. This is an independent
step between fetching calibration outputs and applying beams: it produces fresh
Iceberg/Parquet channel data with calibrated scene content:

- updated materials;
- updated vegetation materials;
- updated UEs;
- updated RUs;
- matching panel sizing when beams were trained during upstream calibration.

Run it with the same Digital Twin server used for the baseline simulation:

```bash
cd client

python3 examples/example_full_sim.py \
  --server_address <dt_server_address> \
  --import_option file \
  --yaml_file path/to/sim_config_calibrated.yml
```

### 3. Apply Beams With Helpers

Use the beamforming and plotting steps to check overlap between measured and
beamformed curves:

- `RUsBeams: true`: codebook provided, apply the trained RU beams;
- `RUsBeams: false`: no codebook, fall back to a single element as a baseline
sanity check.

`RUsBeams` is a calibration target from the upstream calibration YAML. Do not set
it here; use it to understand whether a `RU_*_codebook.csv` should exist.

After the prepared YAML and optional codebook are available locally, run:

```bash
cd client

python3 examples/beamforming/pipeline.py \
  --sim-yaml path/to/sim_config_calibrated.yml \
  --output-folder path/to/beamforming_outputs
```

Expected outputs:

- `beamformed_rsrp.json`

### 4. Plotting [Optional]

If you have measurement-beam CSVs, generate one beam power plot per RU/UE pair.
Use the directory that contains files named like
`ru<N>_ue<M>_with_beams_filled.csv`; if step 1 fetched them, this is usually the
same output folder. `MPLBACKEND=Agg` makes matplotlib write files without
opening a display:

```bash
cd client

MPLBACKEND=Agg python3 examples/beamforming/helpers/plot/plot_beam_power_timeseries.py \
  --input-json path/to/beamforming_outputs/beamformed_rsrp.json \
  --output-dir path/to/beamforming_outputs/beam_power_plots \
  --measurements-beams-dir path/to/beamforming_outputs
```

Expected plots:

- `ru_<N>_ue_<M>_beam_power_timeseries.png`
- `ru_<N>_ue_<M>_selected_beam_power_timeseries.png`

