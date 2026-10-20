# PR #100 — Safe Edit Two-Note Handoff (Offline Contract)

## Why this direction

The actual NoteMesh **Safe Edit Chat** connector already exposes:
- `create_note` — new-note PREVIEW after duplicate/path checking;
- `append_section` — PREVIEW to add a dated Timeline section item;
- `apply_edit` — actual write requiring a **reviewed preview token, expectedHash and host/user authorization**;
- `get_edit_status` — operation receipt and independent write/readback/reindex/Sync stages.

Re-implementing a second unrestricted writer would bypass the existing authorization, version checks, atomic-per-note write, backups and receipts. Instead, PR #100 defines the **preview-first dependency orchestration contract** for the two existing Safe Edit operations, built on PR #98 canonical links and PR #99 physical synthetic rehearsal.

## Executable addition

`coordinateOfflineSyntheticSafeEditHandoff`:

1. Reruns #98 physical canonical link planner, source and Thesis-line historical checks and #99 independent two-note temporary-sandbox write/readback/SQLite/FTS reconciliation.
2. Requires a real section heading **present in the source snapshot** and an exact valid `YYYY-MM-DD` event/timeline date; rejects path tampering, wrong entity, missing anchor, unsupported destination or silently changed source Markdown.
3. Builds a deterministic, explicitly **unverified SYNTH-only** Analysis Note containing only approved full-path canonical references and standard cautionary text. Does NOT pass through free-form model hypotheses, prompt-injected source text, private Thesis content or unverified financial numbers.
4. Generates stable separate operation IDs `<operation>-analysis` and `<operation>-timeline`.
5. Asks an **injected preview-only Safe Edit adapter** for the existing operation receipts:
   - if the Analysis operation is absent: **preview create_note only**;
   - if preview exists: do not preview twice or skip ahead;
   - if the Analysis operation has an **applied + independently reported write/readback/index/expected-hash receipt**: **preview append_section** to the original Company Evolution, never to Current Thesis;
   - if the Timeline operation is already previewed: do not preview again;
   - if both normalized receipts report fully applied/readback/indexed: emit **test-port reported receipts only**, not confirmed real production writes;
   - on failed, incomplete, mismatched or out-of-order receipt: **hold for manual reconciliation**, never claim two-note atomicity or silently retry.
6. Returns only a **redacted diagnostic state**. No note paths, user content, raw source texts, preview tokens or host authorization are returned.
7. **Never calls `apply_edit`**, no authenticated production connector invocation, and does not modify any persistent or real Vault source. The adapter is injected for tests; it is not a trusted access-control authority.

## Trust boundary and gap to production

Passing the tests proves **state sequencing and preview intent preparation**, not real authorized editing. The actual Safe Edit connector's responses are `unknown` at this layer; a subsequent authenticated production adapter must normalize the real response shape **without trusting caller/model-provided approval booleans**, ensure each `apply_edit` is explicitly authorized by its host, and verify genuine `get_edit_status` receipts. No `get_edit_status` through the real connector was called in this PR.

Each Safe Edit apply protects **one note**; two notes are not an atomic transaction. A verified first apply followed by a failed second must produce a **partial-write review/repair state**, not erase or repeat the first. No automatic rollback of protected notes is permitted; a compensating edit would also require review/authorization.

The final production acceptance sequence must separately prove:
- authenticated owner scope and least-privilege vault:edit permission;
- original-source and exact claim provenance for selected real notes;
- staged two-step preview/apply with host-approved diffs and conflict/version checks;
- readback of the two physical notes with link/backlink resolution and durable per-operation receipt IDs;
- idempotency and restart repair on partial application;
- device-specific sync delivery (server receipt does not prove a phone has the notes);
- explicit policy on which non-protected notes can auto-write without individual review.

**NO LIVE VAULT WRITE, NO MODEL/API INVOCATION, NO AUTO APPLY, NO MERGE/DEPLOY.** All work is synthetic and offline. Current Thesis / Evidence Register protected content and Portfolio are references only.

## Synthetic tests

Tests exercise actual PR #98/99 source fixture, first preview, repeat idempotency, barrier against Timeline before complete Analysis receipt, second preview, reported two-receipt completion, partial/incomplete/failed/out-of-order states, spoofed receipt identities and flags, invalid dates and headings, changed source checksum, redaction and strict absence of any actual `apply_edit` call.
