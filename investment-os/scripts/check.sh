#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --frozen
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen python scripts/export_schemas.py --check
uv run --frozen python scripts/check_repository.py
scripts/compose.sh up --build -d --wait
IOS_TEST_DATABASE_URL="postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:${IOS_PG_PORT:-55432}/ios_synthetic" \
  uv run --frozen pytest
uv run --frozen python scripts/verify_compose.py
uv run --frozen python scripts/intake_demo.py
uv run --frozen python scripts/intake_demo.py
uv run --frozen python scripts/extraction_demo.py
uv run --frozen python scripts/extraction_demo.py
uv run --frozen python scripts/text_review_demo.py
uv run --frozen python scripts/text_review_demo.py
