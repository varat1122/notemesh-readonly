# M4 — Source-first to Reference Preflight to Review: isolated staging integrity

**Date:** 2026-10-27 Asia/Bangkok. **Status:** development test specification, not a Production or Staging authorization.

## Scope and boundary

Add a real MCP Integration Test using a **disposable `mkdtemp` Vault** (not `/data/vault`) and existing isolated SQLite/FTS. The mocked Sync wrapper affects only the temporary test daemon; the real MCP transport, OAuth scope, Safe Edit preview/apply, CAS, filesystem readback, FTS, SHA-256 and Source identity are exercised. Do not run test fixtures against Production Vault or claim they represent actual market events.

Flow under test:

1. `prepare_canonical_writeback(captureOnly:true)` creates **preview only**; Source is absent. A `researchDecisionV2` pointing to preview's expected Source hash MUST return `hold_references_or_authority` with `source_missing_or_not_searchable`.
2. An explicitly authorized `apply_canonical_writeback` **inside the temporary test Vault only** writes Source once. Require durable receipt with write/readback/reindex verified and physical SHA matching the preview hash; state is `source_saved_analysis_pending`.
3. `preflight_research_decision_v2` checks real indexed Source ID/path, current full-note SHA and literal preserved user quote. The supported result is only `structurally_grounded_shadow_only`, with `writesPerformed:false`, `investmentTruthVerified:false`, `sourceAuthenticityVerified:false` and zero issuer-verified claims.
4. Deliberately **forged Primary Receipt** and a stale Source SHA MUST HOLD; an unresolved competing claim without source ref is explicitly warned. The preflight does not decide economic entailment.
5. Use `existingIntakeId` to prepare one linked unresolved Review. Source remains `verified_existing`; only Review `needs_create`, no duplicate Source. Apply in temporary Vault must return **real** readback + indexed/searchable results, and note must contain exact Source and existing Company Hub Wikilinks.
6. Subsequent Prepare is idempotent with no new operations. Exact Source bytes and protected Thesis/Evidence/Portfolio fixture notes remain unchanged.

**No fixture is allowed in Production or user Vault.** This is a test of the mechanical integrity boundary, not a blind LLM semantic-evaluation result or proof of publisher authenticity.

## Release gates still open

- Production Connector descriptor still lacks M3d `preflight_research_decision_v2` and Draft `claimAssessments` until authorized deployment and refresh.
- The preflight is not enforced within Apply and is not a substitute for source-independent semantic attribution, event chronology or original-document verification.
- Actual Micro/Macro/PDF hidden-gold LLM runs and independent evidence adjudication remain pending. An immutable simulation corpus cannot certify live-model reliability.
- Real authorized staging with non-synthetic documents, controlled identities, source byte receipts, CAS/replay, Wikilink integrity, rollback and security exception review is separate. **No production Apply, Merge or Deploy**.
