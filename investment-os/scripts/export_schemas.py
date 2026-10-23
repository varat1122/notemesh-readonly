"""Generate versioned JSON Schema from the canonical Python types. --check for CI."""

import argparse
import inspect
import json
from pathlib import Path

from pydantic import BaseModel

from investment_os.domain import entities
from investment_os.ports import contracts, extraction

ROOT = Path(__file__).resolve().parents[1]


def documents():
    for module in [entities, contracts, extraction]:
        for name, cls in inspect.getmembers(module, inspect.isclass):
            if issubclass(cls, BaseModel) and cls.__module__ == module.__name__:
                schema = cls.model_json_schema()
                schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
                schema["$id"] = f"urn:investment-os:schema:1.0:{name}"
                yield name, json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for name, text in documents():
        path = ROOT / "docs/schemas" / f"{name}.json"
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise SystemExit(f"schema drift: {name}; regenerate schemas")
        else:
            path.write_text(text)


if __name__ == "__main__":
    main()
