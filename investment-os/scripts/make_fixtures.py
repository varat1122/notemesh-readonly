"""Deterministic fictional records. No issuer, broker or licensed data."""

import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from investment_os.domain.entities import EntityEnvelope


def uid(name):
    return str(uuid5(NAMESPACE_URL, "https://synthetic.invalid/investment-os/" + name))


def fixtures():
    at = "2026-10-22T00:00:00Z"
    sha = "a" * 64
    extras = {
        "industry": dict(name="Fictional Widgets", taxonomy_version="synthetic-v1"),
        "technology": dict(name="Fictional Widget Process", maturity="prototype"),
        "company": dict(
            legal_name="Synthetic Company (not an issuer)",
            jurisdiction="synthetic",
            industry_ids=[uid("industry")],
        ),
        "instrument": dict(
            issuer_id=uid("company"),
            asset_type="equity",
            share_class="A",
            aliases=[dict(symbol="SYNTH", venue="TEST", currency="USD", valid_from=at)],
        ),
        "document": dict(
            content_sha256=sha,
            byte_size=32,
            media_type="text/plain",
            storage_key="sha256/" + sha,
            storage_backend="local",
        ),
        "source": dict(
            publisher="Synthetic publisher",
            channel="manual",
            source_type="user_supplied",
            original_document_id=uid("document"),
        ),
        "event": dict(
            company_id=uid("company"),
            source_ids=[uid("source")],
            event_type="synthetic_fixture",
            period="test-only",
        ),
        "claim": dict(
            subject_id=uid("company"),
            event_id=uid("event"),
            statement="Fictional widget demand may change",
            claim_type="opinion",
        ),
        "evidence": dict(
            claim_id=uid("claim"),
            source_id=uid("source"),
            document_id=uid("document"),
            document_sha256=sha,
            locator="line:1",
            excerpt="Synthetic only",
            relation="context",
        ),
        "relationship": dict(
            subject_id=uid("company"),
            object_id=uid("technology"),
            predicate="potential_beneficiary_of",
            mechanism="Fictional possibility",
        ),
        "note": dict(
            canonical_path="Drafts/example.md",
            note_type="review",
            content_sha256=sha,
            entity_ids=[uid("company")],
        ),
        "research_review": dict(
            event_id=uid("event"),
            note_id=uid("note"),
            source_ids=[uid("source")],
            analyst_lens="fundamental",
            conclusion="No real conclusion",
            uncertainties=["All data synthetic"],
            analysis_origin="ai",
        ),
        "mandate": dict(
            name="Synthetic core mandate",
            mandate_type="core",
            horizon="years",
            risk_budget="0",
            currency="USD",
            constraints=["No execution"],
        ),
        "thesis_version": dict(
            company_id=uid("company"),
            mandate_id=uid("mandate"),
            note_id=uid("note"),
            scenarios={s: "Unknown" for s in ["bull", "base", "bear"]},
            assumptions=["Synthetic only"],
            invalidation="All real inputs absent",
        ),
        "market_data_reference": dict(
            instrument_id=uid("instrument"),
            provider="synthetic",
            dataset_sha256=sha,
            artifact_key="synthetic.parquet",
            adjustment="unknown",
            currency="USD",
            session_timezone="UTC",
            coverage_start=at,
            coverage_end=at,
        ),
        "quant_run": dict(
            dataset_ids=[uid("market_data_reference")],
            code_version="synthetic-contract-v1",
            environment_sha256=sha,
            model_version="not-implemented",
            parameters={},
            limitations=["Not computed"],
            transaction_cost_assumptions="Unknown",
            bias_controls=["Not evaluated"],
        ),
        "signal": dict(
            instrument_id=uid("instrument"),
            run_id=uid("quant_run"),
            horizon="one day",
            generated_at=at,
            expires_at="2026-10-23T00:00:00Z",
        ),
        "trade_setup": dict(
            mandate_id=uid("mandate"),
            instrument_id=uid("instrument"),
            market_data_id=uid("market_data_reference"),
            entry_conditions="Not actionable",
            invalidation="Missing prices",
            stop_policy="Not configured",
            take_profit_policy="None",
            risk_unit="1",
            position_limit="1",
            transaction_cost_assumption="Unknown",
            expected_holding_period="one day",
            expires_at="2026-10-23T00:00:00Z",
        ),
        "portfolio": dict(
            account_reference="synthetic-account", base_currency="USD", mandate_ids=[uid("mandate")]
        ),
        "transaction": dict(
            portfolio_id=uid("portfolio"),
            transaction_type="deposit",
            quantity="1",
            price="1",
            fees="0",
            taxes="0",
            currency="USD",
            fx_rate="1",
        ),
        "decision": dict(
            mandate_id=uid("mandate"),
            thesis_id=uid("thesis_version"),
            thesis_version=1,
            research_ids=[uid("research_review")],
            risk_review_id=uid("research_review"),
            constraints=["Not actionable"],
            action="NO_ACTION_INSUFFICIENT_EVIDENCE",
            rationale="Synthetic contract only",
            dissent=["No independent risk review performed"],
        ),
        "job": dict(
            job_type="synthetic",
            idempotency_key="synthetic-case-0001",
            request_sha256=sha,
            actor_id=uid("actor"),
            state="blocked",
        ),
        "receipt": dict(job_id=uid("job"), resource_id=uid("note"), state="blocked"),
        "audit_event": dict(
            actor_id=uid("actor"),
            action="synthetic",
            resource_id=uid("note"),
            request_id=uid("request"),
            outcome="denied",
            payload_sha256=sha,
        ),
    }
    result = []
    for kind, fields in extras.items():
        data = dict(
            id=uid(kind),
            kind=kind,
            version=1,
            schema_version="1.0",
            provenance=dict(
                origin="synthetic", basis="P0 fictional fixture", actor_id=uid("actor")
            ),
            times=dict(received_at=at, imported_at=at),
            **fields,
        )
        if kind == "market_data_reference":
            data["times"].update(data_as_of=at, available_to_strategy_at=at)
        if kind == "transaction":
            data["times"]["event_at"] = at
        if kind in {"portfolio", "transaction"}:
            data["classification"] = "confidential_portfolio"
        result.append(EntityEnvelope.model_validate(data).model_dump(mode="json"))
    return result


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[1] / "tests/fixtures_synthetic/entities.json"
    path.write_text(json.dumps(fixtures(), indent=2) + "\n")
