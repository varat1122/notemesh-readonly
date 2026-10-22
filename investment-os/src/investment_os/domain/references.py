"""Explicit reference rules for the first synthetic registry slice; unknown kinds deny."""

from dataclasses import dataclass
from uuid import UUID

from investment_os.domain.common import Record

# Only P1 data/evidence drafts. Protected/P2–P9 records have no writer here.
REFERENCE_RULES = {
    "industry": {"parent_id": {"industry"}},
    "technology": {},
    "company": {"industry_ids": {"industry"}},
    "instrument": {"issuer_id": {"company"}},
    "document": {},
    "source": {"original_document_id": {"document"}, "original_source_id": {"source"}},
    "event": {"company_id": {"company"}, "source_ids": {"source"}, "related_event_id": {"event"}},
    "claim": {"subject_id": {"company", "instrument"}, "event_id": {"event"}},
    "evidence": {"claim_id": {"claim"}, "source_id": {"source"}, "document_id": {"document"}},
    "relationship": {"evidence_ids": {"evidence"}},
}
EDGE_KINDS = {
    "issuer_of": ({"company"}, {"instrument"}),
    "source_supports_claim": ({"source"}, {"claim"}),
    "source_contradicts_claim": ({"source"}, {"claim"}),
    "company_operates_in_industry": ({"company"}, {"industry"}),
    "supplier_to": ({"company"}, {"company"}),
    "customer_of": ({"company"}, {"company"}),
    "partner_of": ({"company"}, {"company"}),
    "potential_beneficiary_of": ({"company"}, {"technology", "industry"}),
    "potential_risk_from": ({"company"}, {"technology", "industry"}),
    "technology_enables": ({"technology"}, {"technology"}),
    "technology_substitutes": ({"technology"}, {"technology"}),
}


@dataclass(frozen=True)
class Reference:
    field: str
    target_id: UUID
    kinds: frozenset[str]


def extract_references(record: Record) -> tuple[Reference, ...]:
    if record.kind not in REFERENCE_RULES:
        raise ValueError("entity kind not enabled for registry persistence")
    fields = dict(REFERENCE_RULES[record.kind])
    fields["supersedes_id"] = {record.kind}
    result = []
    if record.kind == "relationship":
        if record.predicate not in EDGE_KINDS:
            raise ValueError("relationship predicate not enabled in this slice")
        subject, obj = EDGE_KINDS[record.predicate]
        fields.update(subject_id=subject, object_id=obj)
    values = {name: getattr(record, name) for name in fields}
    fields.update(
        {"provenance.source_ids": {"source"}, "provenance.original_origin_id": {"source"}}
    )
    values.update(
        {
            "provenance.source_ids": record.provenance.source_ids,
            "provenance.original_origin_id": record.provenance.original_origin_id,
        }
    )
    for field, kinds in fields.items():
        value = values[field]
        targets = value if isinstance(value, tuple) else (() if value is None else (value,))
        if len(targets) != len(set(targets)):
            raise ValueError("duplicate reference in field")
        for target in targets:
            if target == record.id:
                raise ValueError("self reference is not supported")
            result.append(Reference(field, target, frozenset(kinds)))
    return tuple(sorted(result, key=lambda r: (r.field, str(r.target_id))))
