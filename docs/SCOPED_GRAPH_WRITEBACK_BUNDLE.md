# PR #104 — One explicit host-authorized Investment Graph bundle write

## North Star and actual change

**New Intelligence → Historical Retrieval → AI Analysis → Canonical Markdown → Safe Vault Writeback → Physical Readback / Links / Backlinks → Reusable Next Retrieval.**

Previously, Safe Edit required TWO separate `apply_edit` calls (one for the Analysis Note and one for Company Evolution). This PR implements one **host-authorized, clearly labeled mutating MCP tool** that invokes the EXISTING Safe Edit two single-note operations in order. It does **not** create new unguarded file writers, change Current Thesis/Evidence Register/Portfolio, or grant standing unattended auto-write authority.

MCP tool: `write_investment_graph_bundle`

The administrator must explicitly enable `INVESTMENT_GRAPH_BUNDLE_ENABLED=1` **after** a security/deployment review; otherwise the tool fails before any write. The existing Safe Edit `vault:read vault:edit` OAuth scopes, single-writer deployment requirements, verified paused bidirectional Obsidian Sync, host mutating-tool authorization, CAS, backup and durable per-note journal all remain required.

## One event / two-note workflow

1. Authenticated OAuth client submits **one action** with stable `operationRoot`, `issuer`, `eventKey`, `period`, known source path, exact existing Company Evolution path and complete Analysis Markdown.
2. On the server (not caller-provided permission flags), confirm the admin kill switch, OAuth actor, exact canonical `Investment Review - {issuer} - {eventKey}.md` and `Company Evolution - {issuer}.md` paths. Reject traversal, missing source, incorrect source event, alternate company, absent Company Hub/Timeline, invalid dates, bad headings or record collisions.
3. Require frontmatter `type=investment_review; source_type=archived_ai; independent_evidence=false; verification=not_reverified|unverified; status=draft`. The original Source must remain a distinct `primary|attributed|user_supplied` note; this is **NOT** proof the original publication is authenticated.
4. Parse all new Wikilinks; require existing exact full-path Source, Company Hub and living Timeline, plus any relevant Industry/Thesis links. No new hidden/invalid/orphan reference is accepted.
5. Under existing guarded paused Sync, call Safe Edit PREVIEW then APPLY for **new Analysis Note**. Only after a real per-note receipt verifies write, readback and SQLite reindex does the bundle PREVIEW/APPLY an `append_section` link to the **existing Company Evolution** section.
6. Invoke PR #103's real authenticated read-only graph verifier after both writes. Return a constrained real-server status: verified two-note writeback, previously verified replay, or partial-write manual repair. The entire action is explicitly marked **WRITE**, so the host must authorize that one event's changes. Never treat a preview as a save.
7. No silent retry or rollback if the second note fails: the first Analysis Note stays as evidence, operation IDs and journal provide manual reconciliation. Multi-note atomicity and remote/mobile device sync are **NOT** claimed.

## Explicit partial Timeline recovery (PR #107; opt-in, NO PROD)

A successful Analysis Safe Edit receipt followed by a **never-started Timeline write** no longer has to remain an indefinite manual dead-end. The same mutating MCP tool accepts optional `recoverTimelineOnly: true` on a **new, separately host-authorized invocation**. Normal replay without that parameter **never** writes again.

The server requires the same authenticated OAuth actor, admin kill switch and paused-Sync guards. It checks the original Analysis operation's durable `written / readback verified / reindex verified` receipt, its canonical path and SHA-256 against the physically reopened, indexed Analysis Note, and requires its bytes to match the caller's identical original draft. The source's issuer/event/period, Analysis provenance/markers, all exact existing canonical references, living Timeline heading and absence of this event's marker are revalidated. It then uses the existing Safe Edit PREVIEW/APPLY on the **Timeline only** and reuses the independent two-note graph verifier. No second Analysis Note is created.

Recovery refuses when the first operation is absent, not fully written, belongs to a different OAuth actor, or when any Timeline operation already exists (including preview, writing, failed or incomplete): those cases might reflect partially committed bytes and require manual reconciliation. A repeated fully written two-note bundle is readback-verified only and never appends again. No automatic retries, rollback, standing consent or mobile Sync claims.

Integration regression exercises a real Safe Edit first-note write with a deliberately absent Timeline operation, rejects a normal replay, tampered Analysis bytes and duplicate event markers, then explicitly repairs the Timeline and proves replays remain idempotent — entirely against a temporary SYNTH Vault.

## Safety boundaries and release status

- **No user-specified `approved=true`, preview token, actor or bypass policy is accepted.** Authenticated actor is bound to the OAuth host request.
- **No protected note can be a write target**; Existing Thesis/Evidence Register can only be Wikilink references, and even these links must exist.
- No generic filesystem write API: reuses existing `safe-edit/engine.ts` CAS + protected approval logic.
- No claims of truth or thesis endorsement; model-authored content remains an unverified, reviewable Historical AI Draft with source provenance, alternatives and uncertainty.
- The action is not a persistent background auto-save policy; every invocation is an explicitly approved mutation. If the desired final product is unattended recurring save, a separate opt-in capability and platform-compliant authorization design is still required, not simply suppressing the host confirmation.
- Unit/MCP tests use **temporary synthetic Vault data** with in-memory MCP transport, not a live chat account or device.
- **DRAFT ONLY: NO MERGE, DEPLOY, REAL VAULT WRITE, PROTECTED NOTE EDITS, OR PAID API MODEL CALLS.** The known dependency Security Audit failure remains a release blocker. `INVESTMENT_GRAPH_BUNDLE_ENABLED` is **NOT** set in Railway by this PR.

## Acceptance

A single mutating MCP call on a prepared synthetic Source/Company/Timeline writes exactly one unverified Analysis Note, appends exactly one Timeline backlink, resolves full-path Wikilinks and confirms physical after-hash, FTS, and receipt state. Repeat call must not mutate the Timeline again. Incorrect provenance, missing paths and protected targets must fail before any mutation. Temporary Source and original history must stay intact.

## Next real-world milestone

Following security remediation, owner authorization and release review, prove in an authorized non-protected pilot with a genuinely sourced event that the system can retrieve real historical context, render model-reviewed investment reasoning, perform this one action, read it back and find it as **historical analysis** on the NEXT event, without claiming cross-device delivery or touching Current Thesis automatically.
