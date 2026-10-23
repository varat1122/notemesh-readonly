# Phase P1 — Data & Evidence MVP technical plan

P0 supplies contracts, a running local API/DB foundation and tests. P1 implements source/evidence behavior; it does not start multi-agent runtime, trading or dashboard work. Blueprint §18 phase numbering governs sequencing; the earlier capability-map MVP/P1/P2 labels are broad capability groupings, not authorization to skip gates.

## Current implementation

Step 1 engineering is implemented for ten unverified synthetic draft kinds; schema owner sign-off is still pending. See [P1_REGISTRY_STATUS.md](P1_REGISTRY_STATUS.md) and ADR 011. Actor-bound replay, atomic audit, concurrency tests and database restore also cover part of step 9. A bounded synthetic slice of step 3 is also implemented: original PDF/CSV/XLSX bytes, structural inspection/quarantine, content-addressed readback and resumable Document/Source registration. See P1_INTAKE_STATUS.md and ADR 012. Step 4 now has synthetic deterministic excerpts and original-source citation readback for three formats (P1_EXTRACTION_STATUS.md, ADR 013); unit/currency/date normalization, OCR and visual table semantics are not implemented. Step 2 real auth/grants remains incomplete. No public write/upload endpoint is opened.

## Ordered work packages

An additional synthetic slice now bridges steps 3/4/7: UTF-8 `.txt` capture and immutable paragraph review drafts with original-source anchors (P1_TEXT_REVIEW_STATUS.md, ADR 014). The queue is not a Claim/Evidence Register and performs no verified promotion. Next engineering work is explicit human duplicate/correction and atomic-claim proposal review; real-source grants and durable review authority remain prerequisites for production inputs.

| Step | Implementation | Acceptance / stop condition |
|---|---|---|
| 1. Contract sign-off and repository | Owner review schemas/ADRs; UUID registry, canonical serializer, typed reference extraction, transactional repository | Same payload stable hash; kind/ID/revision constraints; missing/wrong reference blocked; no JSON-only FK loophole |
| 2. Principal and source scope | Real local auth and explicit intake grants; classification/rights inheritance | Unauthorized capture and model export denied; revocation and audit tested; dummy auth never promoted |
| 3. Immutable manual intake | Bounded PDF/CSV/XLSX upload, magic bytes, quarantine, source byte capture + hash readback | 3 synthetic document types; size/archive/macro/external-link cases; originals preserved across restart |
| 4. Parse and normalize | Text/table/cell locators, unit/currency/time precision, parser version and output digest | Excerpt reopens exact source; unknown dates remain null; no import-date substitution |
| 5. Security Master | Company/instrument/venue/class/currency/dated aliases | Same ticker different venue/time stays distinct; ambiguous issuer blocks |
| 6. Source/event reconciliation | Content dedup + semantic event review; duplicate/repost/correction/added detail | One event can reference repost lineage; correction preserves original source and audit |
| 7. Claim/Evidence registry | Atomic statements, source digest+locator, supports/contradicts, review queue | AI hypothesis never independent fact; verified promotion requires source evidence and authorized reviewer |
| 8. Controlled adapters | Drive interface with manual upload first; optional authorized SEC/FX sample | Separate backend OAuth, license/policy/host checks; no API entitlement inferred from ChatGPT connector |
| 9. Reliability and recovery | Jobs/outbox, actor-bound idempotency, retries, artifact manifests, backup drill | Same-key/different-hash conflict; crash injection gives partial not committed; restored hashes match |
| 10. P1 evidence report | Synthetic end-to-end plus explicitly authorized small real-source case | Byte/source/date/identity/rights trace complete; no paid inference or real Vault requirement |

## Dependencies and ownership decisions

Owner: review naming/schema baseline, choose permitted source formats/retention, authorize any actual Drive identity and scope, confirm Bloomberg export rights if used. Engineering: implement SQL repository checks and payload migrations, parser threat controls, semantic dedup review UX, typed reference enforcement, source storage journal, durable denial audit, local auth. Security: threat-model review and restore evidence. No paid model is needed for P1 parsing/schema/evidence foundation.

MVP source storage uses a controlled local content-addressed object directory first, accessed through a storage adapter; Drive remains an optional intake locator until actual credentials/permissions are approved. No alternative source of truth is introduced. P1 fixture scope is synthetic by default; it can be implemented without waiting for cloud hosting or a real account. Any real data test must be separately scoped.

## P1 completion evidence

Capture PDF/CSV/XLSX originals → registry → parsed excerpt locators → duplicate/repost/correction classification → claim/evidence graph → restart/readback → restore. Demonstrate wrong issuer, timezone/precision error, dangerous upload, revoked permission, changed bytes and retry conflict failures. No silent business-date guessing. Report every missing piece as BLOCKED/FAIL.

P2 then adds authorized Vault enrollment, historical retrieval, actual AI-authored draft workflow only under permitted provider/host context, typed links, two-note journaled writeback and next-event recall. P4 owns actual quant computation; P5 tactical; P6 portfolio/committee. Neither P0 nor P1 authorizes production deployment, broker integration or protected auto-writes.
