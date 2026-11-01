# Research context fidelity — candidate behavior

This describes the local IOS-ORCH-CORE-ENG-003 candidate, not a deployed release.
It extends the existing Context Pack, M5.3 planner and M5.4 canonical tools.
It does not introduce a new reasoning framework, database migration, writer,
background task, Prices path or permission grant.

## Entity and Review retrieval

`investment_context_pack` still requires `question`. Optional `issuers` now
accepts exact existing Company Hub names and unambiguous aliases (up to six,
120 characters each). Retrieval uses the routing module's existing title,
indexed alias and explicit curated alias mechanism. The reviewed `TSM` alias
maps to an existing `01_Companies/TSMC.md` Hub. It is an issuer context mapping,
not a security/listing or price-symbol equivalence. No fuzzy rewriting occurs.

An exact whole-query alias such as `question: "TSM"` can resolve the same Hub.
Longer questions should specify `issuers`; there is no general named-entity
extractor over question or Source prose. Ambiguity refuses a selection rather
than choosing a company. Unresolved ticker-shaped identifiers retain their
requested scope and report missing context; other unresolved names are errors.

A bounded Company Research title/metadata pass complements FTS. It inspects
at most 3,000 indexed paths, scopes by the primary subject, ranks exact subject
words in titles and admits at most 80 candidates. The combined pool is capped
at 240. It is generic across issuers; no Review filename is hard-coded.
FTS page, index and pool caps set `discoveryTruncated` and a coverage warning.
Role quotas, `maxNotes` and `maxChars` still apply. `decisions` explains selected
scores and omissions (`maxNotes`, `maxChars`, role quota or archive fallback).
Uninspected candidates beyond a discovery cap cannot be enumerated individually.

Explicit single-subject canonical or dated Review filenames, then explicit
entity/ticker fields, take priority over incidental legacy company tags.
Disagreement is reported as `entity_metadata_disagrees_with_primary_subject`.
Joint-company titles without a single-subject delimiter retain joint tags.
This prevents a legacy `company: [TSMC, NET]` financial statement from becoming
Cloudflare evidence merely because it contains `NET INCOME`. Source prose is
never automatically converted into new company links by the current planner.
Historical Vault metadata and links are not changed by this correction.

## Cutoff and what it can prove

Optional `asOf` is an ISO timestamp **with timezone**, no later than retrieval
start. Omission retains unfiltered retrieval, explicitly labelled as such.
Choose the actual analysis knowledge cutoff, not the economic event date.

For each candidate the reader uses a no-follow file descriptor, checks file
identity/timestamps across the read and hashes actual bytes. A cutoff excludes
a current version if its filesystem mtime, ctime or birthtime is later than
the cutoff. Ctime prevents a copied/backdated mtime alone from admitting a
later edit. Declared publication/receipt/review/import/update availability,
and stored Research provenance as-of/context observation time, also constrain
eligibility. Malformed declared availability fails closed. Date-only values
are conservatively the end of that UTC day; intraday precision is not invented.
An economic event date is not treated as knowledge availability (a previously
published forecast may discuss a future event).

Future or unverifiable candidates have redacted identities in exclusion
diagnostics: no future filename or excerpt is returned. Alias Hubs and
Timeline-derived industry links must also be cutoff-eligible. A link index edge
absent from the eligible Timeline bytes cannot expand cutoff context. The
legacy exact-claim comparison is not cutoff-aware and is explicitly skipped
in cutoff planning; no comparison is not proof of a new claim.

These are conservative bounds under trustworthy server clocks/filesystem
metadata, not an authenticated historical availability ledger. A sync, copy or
edit after a historical cutoff can make an old note ineligible even if its
original information is older. Earlier full-note bytes cannot be restored.
An isolated pilot should establish and retain its Event A corpus before B,
record A's cutoff and manifest, then introduce B. A contaminated current Vault
cannot establish an unseen historical state merely from old event dates.

## Observed Context manifest

`manifest` uses `format: ios-context-manifest/1`. It records:

- Original query, canonical issuer scope, retrieval start/completion, cutoff,
  method, bounded coverage and limitations.
- Alias/Hub identity bindings, observed content hashes and version bounds.
- Selected paths/identities, whole-file SHA-256, byte size, declared dates/trust
  and provenance summary, line locators and truncation, excerpt SHA-256 and
  exact excerpt bytes in UTF-8 base64. Model-facing item excerpts remain fenced;
  base64 avoids introducing a second unfenced Vault-prose channel.
- A content-derived `CTX-…` identifier and HMAC attestation, using a
  domain-separated derivative of the existing server encryption key, scoped
  to the current origin/Vault directory. No new secret is provisioned.

Verification checks the digest/attestation, counts, cutoff, actual current
file/Hub hashes and version bounds, declared metadata and exact excerpt
selection. Rehashing a changed manifest does not recreate the attestation.
This binds a server observation; it does not authenticate note assertions,
legal issuer identity, policy authority or analyst/model identity. An exported
digest alone is integrity evidence, not an independently verifiable signature.
Key/origin/Vault relocation invalidates current-key attestation checks.

The manifest preserves selected excerpts and essential metadata, not complete
notes, the full FTS index, every compatibility diagnostic or an atomic Vault
snapshot. Full-note replay after changes still needs retained original bytes
or a separately authorized snapshot/version store. No such store is fabricated.

## Structured Research provenance

Both `plan_investment_writeback` and canonical prepare/apply accept optional
`researchProvenance` with strict additive fields:

- `policy`, `protocol`, `schema`: `{reference, version?, sha256?}`.
- `producer`: `{kind, id, model?, method?, version?}`. Kind is `llm`,
  `human_analyst`, `quant_engine` or `data_adapter`; unknown identity/version
  stays unknown, never inferred from `source_type: chatgpt_analysis`.
- `asOf`: timestamp or null; `context`: the unchanged returned manifest.
- `coverage`: text; `limitations`: bounded string array.

Explicit provenance cutoff must agree with the supplied context cutoff. The
planner uses that cutoff for its additional retrieval. Its returned
`historical.manifest` describes that additional retrieval; it does not silently
replace the caller's actual-used `researchProvenance.context`.

The renderer preserves the structured object in Source/Review frontmatter as
`research_provenance`, with an explicit assertion boundary. Full `read_note`
returns it; later Context Packs return `provenanceSummary`, marked
`note_declared_not_reverified`. Policy/protocol/schema versions and producer
identity are preserved declarations, not validation against a trusted registry.
The six Thai review fields and optional translation, supplemental analysis,
legacy inputs and existing Source/Review/CAS workflow remain supported.

Current context must still match before apply. If it drifts after writes but
before final verification, `hold_post_write_verification` returns the durable
receipts and makes `readyForNextNews=false`. Inspect exact paths/receipts; do not
blindly repeat writes. Existing Source bytes remain immutable: Feed Only cannot
silently replace prior structured provenance; new analysis belongs in a Review.

## Acceptance boundaries

Local tests represent the dispatched C07/C11/C12 behaviors and C13 leakage
control, including a second issuer for Review recall, alias collisions, changed
versions, stale links, manifest tampering and actual synthetic MCP/Safe Edit
A-save/B-retrieve/save/readback. They do not replace or edit Frozen Semantic Set
v1.0. Its full artifact/hash was unavailable when these fixtures were authored;
formal binding to that exact set remains an evidence check for the Coordinator.
No real Vault write, deployment, consent, connector refresh or live pilot is
implied by the local results.
