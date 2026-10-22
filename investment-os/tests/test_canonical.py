from datetime import datetime
from decimal import Decimal, localcontext
from uuid import UUID

import pytest

from investment_os.domain.canonical import canonical_sha256, canonical_text
from investment_os.domain.entities import EntityEnvelope
from investment_os.domain.references import REFERENCE_RULES, extract_references


def test_stable_json_normalizes_time_decimal_order_without_rounding():
    exact = Decimal("123456789012345678901234567890.123456789012345678900")
    a = {
        "time": datetime.fromisoformat("2026-10-22T07:00:00+07:00"),
        "value": exact,
        "id": UUID(int=1),
        "zero": Decimal("-0.000"),
    }
    b = {
        "zero": Decimal("0"),
        "id": UUID(int=1),
        "value": exact,
        "time": datetime.fromisoformat("2026-10-22T00:00:00+00:00"),
    }
    with localcontext() as context:
        context.prec = 5
        result = canonical_text(a)
    assert "123456789012345678901234567890.1234567890123456789" in result
    assert canonical_sha256(a) == canonical_sha256(b)
    assert '"zero":"0"' in result
    assert "00:00:00.000000Z" in result


@pytest.mark.parametrize(
    "bad", [float("nan"), float("inf"), Decimal("NaN"), datetime(2026, 10, 22), {1: "wrong key"}]
)
def test_unsafe_canonical_values_are_rejected(bad):
    with pytest.raises((ValueError, TypeError)):
        canonical_text(bad)


def test_array_order_and_original_text_are_not_silently_changed():
    assert canonical_sha256([1, 2]) != canonical_sha256([2, 1])
    assert canonical_sha256("raw\r\ntext") != canonical_sha256("raw\ntext")


def test_all_uuid_data_references_of_enabled_kinds_are_explicit(records):
    # Future UUID fields cannot silently bypass reference extraction.
    for data in records:
        if data["kind"] not in REFERENCE_RULES:
            continue
        record = EntityEnvelope.model_validate(data).root
        refs = extract_references(record)
        represented = {(r.field, r.target_id) for r in refs}
        for name, value in record.model_dump(mode="python").items():
            if name in {"id", "verified_by", "provenance"}:
                continue
            values = value if isinstance(value, tuple) else (value,)
            for target in values:
                if isinstance(target, UUID):
                    assert (name, target) in represented
