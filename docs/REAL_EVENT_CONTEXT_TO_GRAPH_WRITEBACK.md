# PR #108 — Real Source → Historical Context → AI reasoning → Safe Graph Writeback (DRAFT / NO PROD)

## Why this moves the Investment OS North Star forward

The existing production `buildInvestmentContextPack` and authenticated `write_investment_graph_bundle` operated as separate interfaces. Previously, a model or analyst had to manually reconcile exact original source identity, current file revision, relevant history and canonical destination paths before requesting a write. That made the very first real-event handoff fragile even though offline rehearsal and isolated writeback were already implemented.

The new **read-only, OAuth-scoped** `prepare_investment_graph_review` tool directly reuses the real indexed Vault and the real `buildInvestmentContextPack`, returning:

- **Exactly one caller-identified Source Note** opened from real indexed Markdown (not an invented URL, not verified issuer authorship), plus SHA-256 and a bounded, explicitly untrusted source excerpt.
- **Current historical issuer context** retrieved by the existing prioritized search: Current Thesis, Evidence Register, prior event sources, Company Evolution, Industry and prior Archived AI Investment Reviews when available. Missing/omitted evidence and provenance remain visible.
- **Exact canonical existing Company, living Timeline and Source paths**, proposed new Analysis destination, available Timeline headings and safe-write input fields for the existing mutating tool. Industry/Thesis are candidates only; AI decides their investment relevance and must cite only relevant, existing Wikilinks.
- Explicit status when the same event marker or Analysis filename already exists. That status is a **hold for duplicate/correction review**, not permission to overwrite or silently create a parallel timeline.

After the **AI** has performed source-grounded reasoning (Demand → Conversion → Margins → Earnings → FCF → ROIC → Thesis, with counter-evidence and unknowns), the model can supply its unverified draft to `write_investment_graph_bundle`. The writer now optionally accepts `expectedSourceSha256`: if the real source bytes have changed since preparation, it fails **before** creating a note.

This preserves clear responsibilities:
- **AI:** semantic relevance, cited factual attribution, hypothesis versus evidence, counter-evidence, Thesis implication and selective link decisions.
- **Code:** actual indexed source/context retrieval, canonical paths, exact original revision binding, Safe Edit authorization, receipts, hash/index/link/backlink readback and idempotency.
- **No fake AI:** this change does not call a paid model, verify original issuer signatures, decide Thesis, determine market price-in, or grant autonomous write permission.

## Integration acceptance in one temporary Vault

The existing authenticated in-memory MCP test exercises a **single, actual indexed temporary SYNTH Vault**:
1. Prepare actual Source + issuer historical context while bundle write flag remains off.
2. Confirm the source is declared user-supplied/unverified, the tool does not write, and ready-to-author exact paths/headings are real.
3. Once the synthetic test explicitly enables the admin flag, reject a mismatched SHA-256 before saving.
4. Supply an externally authored unverified Analysis Markdown to the existing host-authorized single two-note bundle. Verify physical write/readback, FTS and exact reciprocal Wikilinks.
5. Submit a DIFFERENT subsequent event with a question sharing no causal keywords; the same preparation interface must retrieve the previous Review with role `analysis`, `source_type=archived_ai`, `independent_evidence=false`. The previous event is held as existing/duplicate on preparation.
6. CI must pass Lint, Typecheck, Build, Unit/MCP Integration, Playwright E2E, Docker and Security Audit.

## Limits and release gate

- **DRAFT ONLY:** No Merge, Railway deploy, real Vault writes, protected Thesis/Portfolio mutation, external original issuer download, live model/API call or mobile Sync assertion.
- The handoff is a *read-only assisted workflow*, not an AI engine that independently verifies primary claims or manufactures an evidence-backed investment opinion.
- The admin gate `INVESTMENT_GRAPH_BUNDLE_ENABLED` remains off in Production by default. Host/user approval of each actual write remains required, as does existing Safe Edit OAuth `vault:read vault:edit`, guarded single-writer and paused Sync.
- Full stacked-chain code review, permission/sync scope and a separately approved limited real-event pilot are needed before any release. This test is an integration milestone, not proof that the live full closed loop is complete.
