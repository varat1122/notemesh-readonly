# M5.5.1 — Primary claim evidence receipt gate (26 Oct 2026)

## Threat model and invariant

The ChatGPT caller can invent `sourceKind`, `originalDocumentAccess`, claims,
primary URLs, and receipt strings. The indexed Obsidian Vault contains legacy,
user-writable frontmatter and excerpt-hash receipts. **None of these is a
trusted primary evidence authority.** Source preservation and Review approval
are independent: a quality hold must not block an otherwise safe Source preview.

## What this branch validates

For each `resolution: verified_primary`, the server requires a claim-scoped
`primaryEvidenceReceipt`, `entity`, `metric`, `period`, `unit`, `verifiedValue`,
`primarySourceUrl` and competing values. The entity must belong to the current
intake scope. A server-side registry record must match the exact scope and have:

1. A separate **operator adjudication** with an OAuth-labeled reviewer, UTC
   approval timestamp, exact locator, primary-origin approval and (when values
   conflict) explicit conflict adjudication. An indexed Vault note cannot issue
   this approval, and no MCP route in this branch can create an approved record.
2. A referenced, complete `source_snapshots` document fetched through the
   authorized HTTPS archive channel, with matching URL, snapshot SHA-256 and
   byte-by-byte rehash/readback. Manual uploads do not count as issuer fetches.
3. A literal 12–2,000 character source anchor present in the verified original
   stored bytes. This first stage supports HTML/text/XML/JSON only; PDFs and
   opaque formats remain held until independently audited extraction exists.

The only successful status is `server_adjudicated_primary_claim_scope`; it is a
human-reviewed claim-and-byte linkage, **not** a cryptographic issuer signature,
full-document semantic truth engine, dated consensus, or Thesis approval.
Without a matching record the Review receives
`primary_evidence_receipt_validation_pending`. Conflicting assertions stay held
unless the server adjudication explicitly includes the conflict.

`guidance` now requires assessments regardless of caller-declared `sourceKind`.
A narrowly bounded explicit-confirmation text check also holds reported facts
that claim issuer verification without any assessment. Neither rule solves
general-language semantic entailment; incorrect content-type labels and subtle
paraphrases are still attack surfaces requiring broader evaluation.

## Remaining blocker: issuance is deliberately absent

The schema is additive and read-only validation is implemented, but **there is
no production issuance flow yet**. Before production treats any receipt as
approved, add a separately authorized, audited operator workflow with original
document review, issuer-origin checks, exact numeric semantics, vintage/period
adjudication, counter-evidence disposition, and revocation/change history.
Require independent reviewer permissions and append-only audit (plus signature
or equivalent server provenance control) before enabling live issuance.
Direct SQL INSERT used by unit tests is a synthetic fixture, not a deployment
runbook. Do not manually approve records in Production merely to make a test
pass.

## MCP schema and rollout

- The new `researchReview.claimAssessments[]` and primary-scope fields are
  optional on the **wire**, preserving ordinary legacy research payload shape.
- Typed Guidance with no assessment is *semantically* held, while its Source
  preview may continue. A caller cannot bypass this by relabeling `sourceKind`.
- On 26 Oct 2026 the deployed Safe Edit connector descriptor was inspected:
  `researchReview` did **not** include `claimAssessments`. Production was still
  commit `71cc4178`; the draft head is `ac5bf634` before this continuation.
- Local MCP `tools/list` descriptor test verifies prepare **and apply** schemas
  contain the same nested fields. It does not prove that ChatGPT clients have
  refreshed to the new deployed descriptor. Refresh/reconnect and inspect the
  **actual** connector schema before a production cutover.
- Keep `M55_REQUIRE_TYPED_REVIEW` compatibility behavior unchanged unless a
  separate authorized rollout verifies existing callers.

## Rollout gates (do not claim completion prematurely)

1. Full TypeScript, ESLint, tests and build on the PR head; security review of
   source archive readback and all gate failure states.
2. Review, refresh and exercise the Safe Edit connector's real tool schema.
3. Review production issuance trust boundary; decide whether to deploy a
   fail-closed validator without issuance or implement issuance separately.
4. Only after authorized merge, verify Railway successful commit SHA. Run the
   two synthetic cases **Production Preview Only**, no Apply of fictitious
   content; confirm zero synthetic search hits in the Production Vault.
5. Confirm no protected Thesis/Evidence/Timeline/Portfolio paths were touched.

Next milestones remain separate: INFY Company Hub onboarding and historical
prior Source/Review Wikilinks; do not conflate them with evidence validation.
