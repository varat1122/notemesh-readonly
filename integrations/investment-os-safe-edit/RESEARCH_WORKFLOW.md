# Existing NoteMesh orchestration contract

Candidate on the existing PR #108 branch; no new backend, schema, database or
model service. Tool contracts come from `src/server/mcp/server.ts`,
`safe-edit-server.ts`, `safe-edit/schema.ts`, `investment-review-preparation.ts`
and `investment-graph-bundle.ts`. These files, not a published App snapshot, are
what this package describes. Discover the actual connected tools first.

## Read and reason before writing

| Stage | Existing tool / arguments | Result and condition |
| --- | --- | --- |
| Identity/history | Read Only `investment_context_pack`: `question`, optional `issuers`, `industry`, `focus`, `maxNotes` (5–16), `maxChars` (4500–18000) | `retrieval_only_not_verified`; read `items`, `incomplete`, `warnings`, actual excerpts. Follow important/contrary paths with `read_note`. Lexical bounds are not exhaustive coverage. |
| Intake/duplicates | Read Only `plan_investment_writeback`: `domain`, `entities`, `topic`, `inputFormat`, `sourceKind`, `extractedText`; optional provenance/claim | `read_only_plan_not_written`; examine historical/source-event candidate paths and missing gates. Read those notes before adjudicating duplicate/correction. `planId` is not a write receipt. |
| Exact claim if available | Read Only `review_investment_claim`: `domain`, `entity`, `metric`, `period`, `originalSource`, `statement`; optional literal `value`, `unit`, `eventDate`, `publishedAt`, `focus`, `maxCandidates` | `review_only_not_verified`. Candidate classifications: `duplicate_candidate`, `possible_correction_or_contradiction`, `confirmation_candidate_not_independent`, `added_detail_candidate`, `unresolved`. Do not equate these with proven facts or final analyst classification. |
| Capture absent Source | Safe Edit `create_note`: `operationId`, `path`, `reason`, `content` | PREVIEW ONLY. Existing parent under `10_Knowledge/Company Research/`, source-only text, no overwrites. Display exact preview before authorization. |
| Authorized Source apply | Safe Edit `apply_edit`: `operationId`, `previewToken`, `expectedHash` = preview `beforeHash` | Inspect `get_edit_status({operationId})`; require `written` and receipt `write:written`, `readback:verified`, `reindex:verified`. Independently `read_note` the Source. |
| Source-bound preparation | Safe Edit `prepare_investment_graph_review`: `issuer`, `eventKey`, `period`, `sourcePath`, `question`, optional `focus`, `industry` | Ready: `real_vault_review_context_prepared_no_write`. Duplicate: `existing_event_or_analysis_requires_duplicate_review_no_write` → HOLD. Preparation never grants write authority. |
| ChatGPT reasoning | No model API tool | Use original source + historical/contrary evidence + one or more research frameworks in Project Instructions. AI supplies an untrusted analysis draft. |
| Concrete approved graph write | Safe Edit `write_investment_graph_bundle` (below) | Only new Analysis + append to existing Company Evolution. Host/user approval, OAuth scope, writer gates, validated idle Sync and engine checks all apply. |
| Independent verification | Safe Edit `verify_investment_graph_writeback`: `analysisOperationId`, `timelineOperationId`, `analysisPath`, `timelinePath`, `sourcePath` | Same authenticated actor. Physical bytes/hash, reviewed Source binding, SQLite/FTS and reciprocal links. Inspect actual returned booleans. Server evidence is not device Sync. |
| Next event | Repeat read/preparation with Source B and its own genuine event identity | Source A's Analysis must return as `role:analysis`, `declaredSourceType:archived_ai`, `declaredIndependentEvidence:false`. Compare its interpretation without counting it as another source. |

`domain`: company/industry/macro/asset. `inputFormat`: text/screenshot/pdf/mixed.
`sourceKind`: broker_research/issuer_release/regulatory_filing/news_media/
user_commentary/archived_chat/unknown. Optional `claim` contains
`metric`, `period`, `statement`, optionally `value`, `unit`.
Optional intake provenance: `sourceLanguage`, `sourceUrl`, `publisher`,
`eventDate`, `publicationDate` (ISO day or null), `rawAttachmentPath`,
`rawAttachmentSha256`, `rawAttachmentContentType`, `focus`.
Do not manufacture missing exact fields just to invoke a tool.

## Source capture

Use the existing [pilot runbook Source format](../../docs/REAL_EVENT_CLOSED_LOOP_PILOT_RUNBOOK.md#source-format-fill-only-from-an-actual-supplied-item).
`entity`, `event_key` and a known actual `period` must match the preparation call;
preserve unknown dates as null. Preparation accepts an absent Source period, but
its call still requires a meaningful period; if none can be established, HOLD
graph persistence and provide a read-only research draft instead of inventing one.
Store user input as `user_supplied`/`unverified` unless independently justified.
Actual body and metadata must agree with physical/indexed Source bytes.

There are three distinct preservation claims:

- Source Markdown: actual provided text, URL, identity, chronology and attribution.
- User binary: only `store_user_attachment({base64,contentType})` with accessible
  exact bytes and approval; max 4 MiB JPEG/PNG/WebP/PDF. Verify with
  `inspect_user_attachment({sha256,contentType})` using the receipt. A ChatGPT
  screenshot reference or extracted text is not base64 file access.
- Official bytes: `archive_original_source({url})` is an approved allowlisted
  HTTPS fetch to an archive **outside** the Vault, not a Markdown Source. Inspect
  revisions with `inspect_original_source_archive({url})`. Hashes do not prove
  issuer authenticity. Redirect/missing primary source failures do not justify
  switching to an unguarded download/writer or labeling input verified.

General Safe Edit intentionally cannot create Source Markdown in `07_Sources/`.
`submit_investment_notes` is a separate combined Inbox save path; it cannot
substitute for a canonical original Source or the graph acceptance below.

## Review template → actual write contract

[INVESTMENT_REVIEW_TEMPLATE.md](INVESTMENT_REVIEW_TEMPLATE.md) is raw Markdown to
compose, not a new machine schema. Fill all placeholders; omit unsupported
optional body sections rather than inventing answers. Keep the required
frontmatter, operation/event markers and Source/Company/Timeline links.
For a ChatGPT-authored draft `ANALYSIS_ORIGIN` is `chatgpt_project`; controlled
tests must use `controlled_offline_fixture` instead. Dates are quoted ISO values
or YAML `null`, never an import date disguised as an event. `verified_at: null`
describes this unverified AI note; list any separately checked claim's actual
verification date/method in its evidence row.

Human classification maps to existing Safe Edit vocabulary, without new enums:
New→`new_event`, Duplicate→`duplicate`, Incremental→`added_detail`,
Confirmation→`confirmation`, Correction→`correction`,
Contradiction→`contradiction`, Thesis-Changing→`thesis_changing`,
Insufficient evidence→`unresolved`. The graph writer conservatively journals
`unresolved` AI evidence; an analyst's narrative classification does not upgrade it.

Copy `canonical.requiredAnalysisSourceMetadata.source_path/source_sha256`
verbatim from preparation. `SOURCE_LINK`, `COMPANY_LINK`, `TIMELINE_LINK` are
the returned full paths **without `.md`**. Include each wikilink only once in the
whole note; cite `[E1]` and plain paths elsewhere. The writer requires 3–18
distinct, resolved full-path links. Optional Industry/Thesis links must refer to
existing indexed notes and have a stated research reason. Proposed typed edges
remain a Markdown proposal with evidence/status; no economic relationship is
promoted by making a link. No protected Thesis/Evidence Register/Portfolio edits.

Show the complete final Analysis Markdown plus the intended Timeline append
before invoking the mutating action. This is the user review preview; the graph
action internally uses the existing Safe Edit preview/apply engine. Do not
invent a graph-preview endpoint or call it as if it were a read-only preview.

```json
{
  "operationRoot": "<new stable lowercase root, regex ^[a-z][a-z0-9-]{8,60}$>",
  "issuer": "<prepared issuer>",
  "eventKey": "<prepared eventKey>",
  "period": "<prepared period>",
  "timelineDate": "<reviewed ISO day of timeline entry>",
  "timelineHeading": "<one exact existingTimelineHeadings text, no #>",
  "analysisPath": "<canonical.analysisPath>",
  "timelinePath": "<canonical.timelinePath>",
  "sourcePath": "<canonical.sourcePath>",
  "analysisMarkdown": "<complete composed review>",
  "expectedSourceSha256": "<originalSource.sha256>"
}
```

Current preparation is **company-scoped**: indexed `01_Companies/ISSUER.md` and
`08_Daily_Weekly/Research Indexes/Company Evolution - ISSUER.md` must exist.
It is not a general macro/industry graph saver. Use read-only analysis for
unresolved identity, absent anchors or unsupported persistence scope; do not
bootstrap new hubs/timelines or assign an arbitrary ticker to macro news.

## Failure and reconciliation table

| Observation | Required behavior |
| --- | --- |
| No graph tools / connection expired | Analyze with actual available reads; label unsaved. Reconnect intended App through secure OAuth; never ask for tokens or switch writers. Metadata edits do not publish missing tools. |
| Duplicate/corrected source | Read matching source/version/history, retain old record and adjudicate lineage. Default graph path holds same-event updates; correction save is separately reviewed work, not another eventKey. |
| Missing primary source / contradictory evidence | Mark original verification pending, conflicting claims and missing coverage. Abstain on unsupported conclusions. May draft unverified analysis; never certify facts from labels. |
| Source changed since preparation / stale index | HOLD. Reread/reprepare and revise reasoning; do not replace a receipt-bound source hash with a new one to force replay. |
| `authorized_two_note_graph_written_and_readback_verified` | Record returned two operation IDs; independently call graph verifier. |
| `previously_written_both_receipts_graph_reverified` | Existing complete operation reverified; no new note. Do not submit a differently worded duplicate. |
| `analysis_written_timeline_or_graph_needs_manual_reconciliation` | Report partial: first note verified, entire graph false. Inspect both IDs with `get_edit_status`; retain exact payload. |
| Timeout / unknown result | Read existing operation status and actual paths first. Missing client result does not prove nothing was written. No silent resend/new IDs. |
| Analysis fully verified; Timeline operation entirely absent | Only after review and **new concrete authorization**, same payload/root with `recoverTimelineOnly:true` may complete the missing append. |
| Timeline preview/writing/failed, uncertain, or `existing_partial_or_preview_operations_manual_review` | Manual reconciliation; never automatic recovery, rollback or replacement IDs. |
| Event A verified after later Event B append | Require `historicalWriteReceiptsVerified` and `currentGraphIntegrityVerified`. Exact old afterHash can differ only through a verified authorized append receipt chain. |

## Release/authorization boundary

Read MCP tools and Safe Edit use separate connections/resources. Safe Edit
requires fresh `vault:read` + `vault:edit` OAuth for its exact audience, actor-bound
receipts and per-action host approval. `offline_access` is a refresh grant, not
investment approval. Server gates include `SAFE_EDIT_ENABLED`,
`SAFE_EDIT_SINGLE_WRITER`, `INVESTMENT_GRAPH_BUNDLE_ENABLED` and the real Sync/DR
controls. This package does not enable flags, repoint the production endpoint,
publish an App registry or authorize a real Vault. Use the existing Web-capable
App identity; do not replace it with a second desktop-only package.

The candidate Safe Edit server exposes **15** tools. Historical connected App
snapshots had seven/twelve; the three graph tools must be observed in an actual
ChatGPT chat after an owner-approved release/action refresh. Backend registry
tests and a wrapper version bump cannot establish frontend availability.
