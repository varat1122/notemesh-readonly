"""Bounded accidental-secret/data guard for the greenfield subtree, not a DLP guarantee."""

import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
patterns = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b"),
    re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
]
skip = {".venv", ".git", "artifacts", "__pycache__", ".pytest_cache", ".ruff_cache"}
count = 0
for path in root.rglob("*"):
    if not path.is_file() or any(part in skip for part in path.relative_to(root).parts):
        continue
    relative = path.relative_to(root)
    if path.name.startswith(".env") and path.name != ".env.example":
        raise SystemExit(f"untracked runtime config in deliverable: {relative}")
    if path.suffix.lower() in {".pdf", ".xlsx", ".csv", ".parquet", ".duckdb", ".sqlite", ".dump"}:
        raise SystemExit(f"unexpected dataset/binary in P0 deliverable: {relative}")
    content = path.read_text()
    if any(p.search(content) for p in patterns):
        raise SystemExit(f"possible secret in {relative}; value suppressed")
    count += 1
print(f"PASS: inspected {count} text files; no matched credential pattern or dataset binary")
