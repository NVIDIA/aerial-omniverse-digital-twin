AODT Config Builder Documentation
==================================

The **AODT Config Builder** provides a high-level, domain-oriented Python API
for creating AODT (Aerial Omniverse Digital Twin) simulation YAML configurations.

Instead of manually writing YAML attributes, you work with domain objects
(``SimConfig``, ``Panel``, ``DU``, ``RU``, ``UE``) that handle validation and
relationship management automatically.

Key features:

- Domain-oriented API (work with Panels, DUs, RUs, UEs)
- Automatic validation and error checking
- Type-safe enums for simulation modes and antenna types
- Decoupled from YAML library (uses neutral AttributeValue layer)
- Factory pattern via ``Nodes`` for creating network elements
- S3 storage and Parquet export support
- GPX-driven UE mobility
- Material calibration and building RF attributes

.. toctree::
   :maxdepth: 2
   :caption: Contents:

   quickstart
   advanced
   api

Indices and tables
==================

* :ref:`genindex`
* :ref:`search`
