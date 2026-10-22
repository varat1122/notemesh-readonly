# Canonical schemas v1.0

Generated from `src/investment_os/domain/entities.py` and `ports/contracts.py` by `scripts/export_schemas.py`. Draft 2020-12 JSON Schema, strict unknown-field rejection. EntityEnvelope uses the `kind` discriminator for all 24 entity types. Python semantic validators additionally enforce cross-field chronology, evidence independence, protected approval requirements, signal expiry and complete receipt prerequisites; JSON Schema alone does not encode all of these checks.

Every entity inherits UUID identity, version, schema version, provenance, classification and timestamp policy. Domain relationships and storage ownership are described in DATA_ARCHITECTURE.md. Typed reference existence/kind checks are the P1 repository's responsibility; do not insert arbitrary JSON directly into the future application DB.

Synthetic examples are in `tests/fixtures_synthetic/entities.json`. They are fictional and do not assert independent factual verification, real performance or executed transactions. No source timestamps or prices are invented to fill missing data in actual research.

Regenerate: `uv run --frozen python scripts/export_schemas.py`.
Check drift: `uv run --frozen python scripts/export_schemas.py --check`.
