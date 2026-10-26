# M5.5.1 — Primary claim evidence receipt gate (26 Oct 2026)

## Decision owner: autonomous AI research policy (26 Oct 2026)

The owner delegates **routine research judgments** to the Investment OS AI
framework; the owner is not a per-claim approver or a substitute data source.
The owner may subsequently challenge the analysis, at which point contradictory
evidence must be revisited with provenance and chronology. No such discussion
retroactively changes an immutable historical Source receipt.

The AI independently decides whether a source is new, duplicate, confirmation,
correction, contradictory or unresolved; the investment mechanism; and whether
the research conclusion is `no_change`, `conditional`, or eligible for
`confirmed`. It MUST produce source-attributed, uncertainty-aware analyses even
if no other human signs off. Ordinary user-supplied Sources and conservative
Reviews do not wait for dual-human keys. For a contradictory number with no
independent original, AI chooses `resolution: unresolved` and a non-confirmed
conclusion, records competing values and what would falsify them, and lets the
standard Source/Review safe-write process proceed if other quality checks pass.

**Non-delegable epistemic constraint:** AI confidence, repeated LLM votes,
plausible text, caller-selected `sourceKind`, an uploaded file, and any caller
typed `PEV-*` are not proof of publisher identity or source-claim truth. The
server will not promote `verified_primary` or `conclusion: confirmed` without
an independently verified, exact-scope Primary Evidence Receipt. The current
Ed25519 reviewer/approver route is an **optional, disabled high-assurance
channel**, not a required part of routine ingestion. It must NOT be automated
by the AI holding both signing keys or simulated with two model calls. An
entirely machine-driven high-assurance path would require a separately built,
audited authenticated primary fetch and semantic/chronological counter-evidence
validation; it does **not** exist in this draft.

The gate now also scans the **submitted** text for high-signal numeric guidance
regardless of caller content-type labels, requiring the AI to record a structured
claim decision. This is only an omission detector and can yield both false
positives and false negatives; it does not make submitted text verified.
The 26 Oct adversarial matrix first demonstrated eight previously passing
false-positive acceptance paths out of ten examples, including unqualified
percentage-based revenue/EPS assertions, wrong percentage scopes and an
unresolved Guidance headline presented as a declarative fact. The draft now
additionally requires a structured decision when financial/macro metric words
appear with percentage values in AI-authored headline or analytical sections;
checks the stated percentage against `competingValues`; checks basic metric
families (e.g. Revenue is not Gross Margin) and explicit fiscal-year vintage;
and requires uncertainty or attribution in a clause repeating an unresolved
percentage. The preserved
translation is deliberately exempt, as faithful translations can contain
unverified numbers without adopting them as AI facts.

**Residual gap:** These regex/metric-family checks cover a bounded class of
English/Thai percentage claims. They do not prove semantic entailment or catch
all absolute currency amounts, basis-point values, misattributed quotes,
unstated vintages, per-share denominators, mixed-metric sentences, or claims
expressed without explicit numbers. A motivated/mistaken caller can still
misclassify news or write unsupported non-percentage conclusions. Passing the
regression tests is therefore necessary but not sufficient for a Production
AI-autonomous `verified_primary` release. Future semantic evaluation must be
tested against independent originals and blinded counterexamples, not simply
ask the same model to confirm its own work.
Permitted automatic changes remain limited to the separately authorized,
add-only Source and Canonical Review workflow with actual Safe Edit receipts,
SHA readback, search-index and wikilink checks. Current Thesis, Evidence
Register, Evolution Timeline and Portfolio remain protected.

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

1. A separate **operator adjudication** with a signed UTC review timestamp,
   exact locator, primary-origin approval and (when values conflict) explicit
   conflict adjudication. An indexed Vault note cannot issue this approval,
   and no MCP route in this branch can create an approved record. Both an
   externally assigned reviewer and approver must sign the exact canonical
   attestation with distinct Ed25519 private keys. The server stores only
   their previously authorized public keys.
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

## Signed issuance (draft implementation; not activated in Production)

This instance deliberately permits **one Better Auth admin account only**.
Adding a second app admin would undermine its security invariant. Therefore
reviewer and approver identities are *external signing keys*, not fake second
admin sessions. The code enforces two distinct Ed25519 public-key fingerprints
with different configured roles. A single person could still hold both private
keys: organizational key custody and independent real-human review are outside
what the server can prove.

- Operator-controlled server config: `PRIMARY_EVIDENCE_SIGNERS_JSON`, an array
  of `{keyId, role: "reviewer" | "approver", publicKeyPem}`. Two different
  public keys are required. **Never upload or configure either private key on
  NoteMesh, ChatGPT, GitHub, the Vault, or the MCP connector.** No keys are
  supplied by this repository and an absent/invalid config fails closed.
- Independently enable `PRIMARY_EVIDENCE_ISSUANCE_ENABLED=1` only after signer
  custody and human operating rules are approved; default is disabled even if
  public keys happen to be configured.
- Admin-session-only `POST /api/primary-evidence-receipt`, JSON actions:
  `prepare`, `issue`, `revoke`. Requires an actual signed-in Better Auth admin
  session and exact same-origin header. OAuth `vault:edit`, API keys and signed
  MCP tool arguments do not authorize it.
- `prepare` checks exact HTTPS allowlisted original URL, full archived byte
  integrity, anchored verified value, source vintage and scope; returns a
  canonical domain-separated `messageBase64` for external signatures. This
  step is read-only and issues no approved receipt.
- Two external reviewers verify publisher provenance, relevant source section,
  metric/period/unit/value and conflicting vintages. For contradictory numbers,
  the signed payload includes a **counterClaims[] row for each competing
  value**, its attributed source/label, optional publication date, disposition
  and rationale. Reviews citing values not covered by those adjudications are
  held; a naked `conflictingValuesAdjudicated: true` cannot unlock a Review.
  Each signer signs the same
  decoded `messageBase64` using offline Ed25519. The admin submits both
  signatures through `issue`; server revalidates the document, signer roles and
  signatures, then records an immutable approved row and append-only audit
  event in one transaction. Receipt ID is content-derived.
- `revoke` adds an irreversible revocation row and event with a reason. Neither
  approved rows nor audit/revocation entries can be updated/deleted by normal
  app operations. Read-time validation checks revocations, signer configuration
  and both signatures again. Dropping keys from the allowlist causes existing
  receipts to fail closed until key migration/adjudication is completed.
- A unique Claim Scope index prevents a second Receipt for the same archived
  document, Entity, Metric, Period, Unit and Value even if signed again with a
  different review timestamp. Revoked approval cannot be resurrected by a
  duplicate receipt that inflates evidence weight.

The code does not automatically determine issuer authorship or economic claim
truth: it verifies **human-signed attestation bound to exact original bytes**.
No private-key issuance, signer custody, reviewer appointment, operational UI,
or real-world dual-human acceptance has been performed. Signing fixtures in
tests are synthetic only. PDF anchors remain unsupported. Production issuance
must stay disabled by missing signer configuration until the owner authorizes
operational roles and an audited pilot with real primary evidence.

This costly two-signature process is an optional high-assurance route for a
**confirmed primary** claim. Routine AI-owned Source Intake and conservative,
uncertainty-labeled research Reviews continue through the existing Safe Edit
workflow without human attestation. With the signer feature disabled, the AI
must not promote a claim to `verified_primary` merely to avoid an unresolved
label. Do not subject every Micro/Macro news item to manual attestation.

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
3. Keep signed-receipt issuance **disabled** for an AI-only release. If the
   optional human-signed high-assurance channel is ever chosen separately,
   independently assign key owners and conduct an approval/revocation pilot
   before enabling that feature. No AI-created pseudo-independent signatures.
4. Only after authorized merge, verify Railway successful commit SHA. Run the
   two synthetic cases **Production Preview Only**, no Apply of fictitious
   content; confirm zero synthetic search hits in the Production Vault.
5. Confirm no protected Thesis/Evidence/Timeline/Portfolio paths were touched.

Next milestones remain separate: INFY Company Hub onboarding and historical
prior Source/Review Wikilinks; do not conflate them with evidence validation.
