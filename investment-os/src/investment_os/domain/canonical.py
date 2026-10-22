"""ios-json-v1: stable UTF-8 payload hashing, independent of PostgreSQL JSONB formatting."""

import hashlib
import json
import math
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

from pydantic import BaseModel

CANONICAL_FORMAT = "ios-json-v1"


def normalized(value):
    if isinstance(value, BaseModel):
        return normalized(value.model_dump(mode="python"))
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("canonical timestamps require timezone")
        return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("non-finite decimal")
        # Do not Decimal.normalize(): ambient decimal context can round financial values.
        text = format(value, "f")
        text = text.rstrip("0").rstrip(".") if "." in text else text
        return "0" if value == 0 else text
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Enum):
        return normalized(value.value)
    if isinstance(value, dict):
        if not all(isinstance(k, str) for k in value):
            raise TypeError("canonical object keys must be strings")
        return {k: normalized(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalized(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("non-finite float")
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError("unsupported canonical value")


def canonical_text(value) -> str:
    return json.dumps(
        normalized(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def canonical_sha256(value) -> str:
    return hashlib.sha256(canonical_text(value).encode("utf-8")).hexdigest()
