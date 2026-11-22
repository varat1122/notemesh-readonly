# Investment OS — M5.2 Classification & Canonical Routing (Draft)

Status: **read-only planning code; not a Production release and not an automatic Vault writer**.

## Problem and boundary

An inbox receipt is evidence that user-supplied source material was captured; it
is not the company/industry knowledge record. A J.P. Morgan-attributed Memory
excerpt may concern SK hynix, Samsung, Micron and Kioxia at once, but one social
repost does not establish four independent new events or four changes to their
investment theses.

`plan_investment_writeback` keeps the existing deterministic raw/review identity,
adds `routingV2`, and does **not** write a note. New input fields are optional,
so callers using the original tool contract continue to work.

## Classification is multi-axis

| Axis | Examples | Rule |
| --- | --- | --- |
| Format | `text`, `screenshot`, `pdf`, `mixed` | A PDF is a container, not a source quality level. |
| Attributed source | `broker_research`, `issuer_release`, `social_repost`, `official_macro` | Caller-supplied label is not source verification. |
| Content type(s) | `reported_fact`, `broker_price_target`, `broker_estimate`, `guidance`, `policy`, `portfolio_snapshot` | One item can have multiple types. |
| Entity roles | `primary_subject`, `covered_company`, `supplier`, `customer`, `competitor`, `mentioned` | A co-mention is not proof of a commercial relationship. |
| Theme(s) | `Memory`, `Optical`, `AI Infrastructure` | Resolve only to existing indexed Industry Hubs. |
| Novelty/materiality | unresolved/unassessed | Original source and historical review are still required. |

`routingV2.companyHubs` and `industryHubs` are existing index paths only. An
unknown alias is returned under `unresolvedEntities` or `unresolvedThemes`.
These link candidates are not authorization to append to every linked company.

## Example: multi-company broker commentary

```json
{
  "domain": "industry",
  "entities": ["SK hynix", "Samsung Electronics", "Micron", "Kioxia"],
  "themes": ["Memory"],
  "entityRoles": [
    {"entity": "SK hynix", "role": "covered_company"},
    {"entity": "Samsung Electronics", "role": "covered_company"},
    {"entity": "Micron", "role": "covered_company"},
    {"entity": "Kioxia", "role": "covered_company"}
  ],
  "contentTypes": ["analyst_opinion", "industry_data"],
  "topic": "Memory HBM4 and NAND",
  "inputFormat": "screenshot",
  "sourceKind": "broker_research",
  "extractedText": "Faithfully extracted attributed text goes here."
}
```

The planner may link four existing Company Hubs and `02_Industries_Themes/Memory.md`.
It does not manufacture company timelines, duplicate facts, or thesis changes.

## Broker PT and forecast revisions

`brokerUpdate` explicitly distinguishes *old → new* from a mere reiteration.
Comparisons require the same bank, old/current report dates, matching old/new
currencies, comparable PT horizons when stated, and valid prices. A qualifying
raise/cut is still a **candidate**, not a verified fact.
Forecast estimate rows keep each metric, fiscal period, unit and vintage separate;
they are not consensus or realized earnings. Missing, cross-bank, reversed-date
or uncomparable figures remain unresolved.

## Safe-write workflow remains separate

1. Preserve exact source text and, when available, original attachment bytes.
2. Verify publisher/source and event/publication dates; retrieve historical notes.
3. Resolve aliases, roles, same-source/event reposts, precise claims and counter-evidence.
4. Prepare one canonical Research Review with links to relevant hubs, rather than
   duplicating independent analysis in every company note.
5. Propose dated, incremental Company/Industry Evolution append **only if**
   materiality, canonical target and event identity are established.
6. Use separately authorized Safe Edit with preview, SHA/readback, reindex and
   retrieval verification for every actual write.
7. Never automatically edit Current Thesis, Evidence Register or Portfolio.

Thus M5.2 improves a **read-only router**. The source-to-canonical Safe Edit
orchestrator, production integration, full originality checks and mobile sync
are separate acceptance work. No code or test in M5.2 demonstrates a
production Vault write or device sync.

## Regression coverage

See `src/server/vault/investment-writeback-router.test.ts` fixtures F01–F12:
multi-issuer Memory, broker PT reiteration/raise/cut/vintage, issuer guidance,
social repost, macro policy, broker PDF estimate, protected portfolio capture,
missing hubs, stable receipt IDs and duplicate source/event candidate.

## RI-001 read-only research retrieval

`investment_context_pack` now uses the existing Company Hub title and explicit
`aliases`, `alias`, `company_name`, `ticker` metadata vocabulary. It adds no
hard-coded TSM/TSMC or security-master mapping. A unique indexed Hub must be
readable and its alias set must agree with current Markdown readback. Title/alias
collisions, missing/changed readback, and a top-level Company Hub index over the 3,000-row
bound HOLD alias expansion; the sentinel is never a partial uniqueness result.
This is indexed metadata plus readback, not external legal-issuer verification;
an unindexed Hub/alias cannot be discovered by this bounded contract.

`issuerResolution` preserves the requested label and exposes the Hub/path and
resolution status. Without a mapping, plain tickers retain literal historical
discovery with `unresolved` status, but are never expanded by similarity or body
co-mentions. Qualified identifiers require an explicit matching Hub declaration;
no market prefix, ADR/DR suffix, or exchange code is stripped. A Hub alias provides
company-context linkage only. It never substitutes a security, listing, price
series, claim entity, Source ID, event identity or canonical write authority.
Canonical Hub matching semantics are unchanged. Context and canonical routing
now share the top-level Markdown Hub scan: nested files and non-Markdown entries
are excluded before the 3,000-Hub limit plus sentinel. An incomplete Hub scan
cannot establish a unique routing match.

On identity HOLD, `identityHoldDiscovery` retains up to 12 read-back historical
Company Research paths from a 30-hit literal-identifier search plus sentinel.
Only the requested plain identifier is searched; ambiguous aliases are not
expanded and body co-mentions of another named issuer are excluded. Invalid or
qualified identifiers are not reduced to a guessed ticker. Search/read bounds
and stale/unavailable note metadata are explicit. These are unverified hints,
not issuer mappings, selected canonical context, primary facts or adjudicated
duplicates. Decision Packets carry them separately. The writeback router keeps
them in its existing possible-event hints (at most four), with the full bounded
discovery status in `historical`, so identity HOLD cannot silently imply no
history. No new write authority or identity rebinding follows from these hints.

`issuerCoverage` reports selected and missing roles separately per request. A
complete NVDA result cannot conceal missing MRVL Thesis/Evidence/Timeline/Source
roles. Missing material stays missing; this code creates no Hub or protected note.
Decision packets carry this resolution/coverage without rewriting the incoming
claim entity or inferring verification, independence, owner approval or valuation.

For macro queries, explicit country/topic scope is kept separate from subject
terms. Matching macro-folder searches supplement the existing global FTS window.
Subject matches receive ranking priority; they do not exclude other scoped
country/risk evidence. Explicit `/`, `;`, `|` or comma separators select at most
four distinct scopes; multiword names remain intact, and `and` is not split into
speculative geographic identities. Each selected item carries its own
`matchedMacroScopes` and source path. No country, event or source is merged.
Unsearched scopes and filename/FTS cutoffs are reported, not treated as absence.

Per scope, at most 24 candidate readbacks (100 KB per accepted note, 1,200 body
lines) look for explicit counter-evidence/risk/adverse-section headings. These
are untrusted section hints, not semantic proof that a document contradicts a
claim. Unread or unmarked country candidates remain eligible for ranking.
Selection reserves context and contrary-section slots per scope within the
existing total budget; country-only background gets at most one slot per scope
when a subject was requested. Archived AI remains historical and subject to its
existing fallback cap. If there is no subject hit, country context is explicitly
incomplete for that subject. `macroCoverage` reports subject and counter-section
coverage separately for each scope, including read/window/excerpt/selection
limits; `NOT_FOUND` is only within that bounded heading/candidate contract.

The existing read-time schema adapter identifies archived AI and derivative
summaries. Raw ChatGPT paths are historical even if metadata declares primary.
Macro recaps are de-ranked and share a one-note fallback cap unless historical
archives were explicitly requested. Company historical research and protected
drafts stay discoverable, including their existing reconciliation scores.
`evidenceUse=historical_context_only` prevents archived verification labels from
filling primary-evidence gaps or a decision packet's primary candidate list.
Other results remain `unverified_candidate`; multiple notes never establish
independence. Counter-evidence flags require the section heading to survive the
excerpt budget; full-note review remains necessary.

Fixtures in `investment-context.test.ts` and `investment-decision-packet.test.ts`
cover explicit aliases, ambiguity, stale/missing readback, bounds, qualified
identifiers, missing roles, NVDA control, macro relevance, archive non-promotion,
counter-evidence clipping and byte/index invariance. Synthetic alias declarations
are not evidence of a mapping in the live Vault; live validation is separate.

### Canonical Review discovery and intake-bound context

Issuer-scoped retrieval also checks the existing canonical Company Research
filename family directly, before the broad FTS cutoff. The path index bounds
each issuer scan to 100 rows plus a sentinel; at most eight Review readbacks
are attempted, ordered by declared publication. Invalid/stale metadata,
unreadable notes, or either cutoff report incomplete discovery. This is not a
global Vault absence proof. No Current Thesis or Evidence Register is created
or inferred from a Research Review.

`researchCoverage` separates canonical Review, counter-evidence section hints,
and dated historical comparator coverage. `FOUND` identifies selected paths;
`scanComplete=false` still warns that other candidates may be missing.
`NOT_FOUND` means no matching result in the completed, bounded candidate scope,
not that no evidence exists externally or anywhere else in the Vault.
`SCAN_INCOMPLETE` covers unresolved issuer scope, read/scan/selection bounds,
clipped excerpts and unknown comparator chronology. Counter-evidence is a
visible section-heading witness, not verified contradictory evidence.
Comparators are earlier declared publications, not independent corroboration.

`latestReviewPaths` uses only valid `published_at`, never file mtime or
`event_date`. Date-only values span possible timezones; unknown dates and
overlapping windows return `ORDER_UNKNOWN`, and incomplete scans cannot assert
a unique latest. A selected latest Review remains unverified research context.

Every excerpt also carries separate declared `eventDate`, `publicationDate`,
`analysisDate` and `importDate` values with `DECLARED`/`UNKNOWN` status. They use
only valid explicit `event_date`, `published_at`, `analysis_date`, `imported_at`
metadata respectively. Legacy `date`/`imported_on`, Review creation and filesystem
times never fill these gaps. For similarly relevant notes (cohorts within ten
points of the highest remaining score), like-role results prefer declared
publication time. Unknown/overlapping
dates and deterministic filename tie-breaks are display ordering only, not a
latest-event claim. Analysis/import dates never affect this ordering.

`contextBundles` keeps each intake separate. The exact canonical Review path,
typed metadata, `intake_id`, `original_source_path`, Source metadata, dates,
source-token FTS hits, physical wikilink and resolved link index must agree.
Both current files must match their existing canonical Safe Edit create
receipts, including hashes and successful write/readback/reindex. A missing,
pending, drifted or unverifiable binding returns `HOLD`; no other Source is
substituted and no receipt store is initialized. These receipts are historical
write evidence, not primary-claim verification. Unknown event dates stay null;
`economicEventEquivalence=not_established` even for two intakes of one issuer or
URL. Optional `intakeId` requires issuer scope and selects that intake's canonical
Source/Review pair while retaining separately labelled issuer background.

An unbound but readable Review can still be discovered as note-declared
research, with its binding HOLD visible. No historical bytes/receipts are
rewritten, no repair is attempted, and primary evidence or independence is not
inferred. Decision packets carry these coverage and bundle results unchanged.

Legacy Reviews with absent/null `review_scope` have a narrow compatibility path:
the exact `investment_research_review` type, valid filename-matching `intake_id`,
unambiguous existing Hub scope and indexed/frontmatter readback must agree.
Conflicting issuer declarations, wrong scope, malformed metadata and stale
readback remain rejected. An admitted legacy Review is selected only as
`historical_context_only`; canonical coverage is `SCAN_INCOMPLETE` and its bundle
is `HOLD / legacy_review_scope_missing`, even if historical create receipts exist.
It cannot become `BOUND_SOURCE_REVIEW` or a primary candidate, and a same-intake
Source is not automatically paired. An explicit `intakeId` still isolates the
requested Review.

Filename discovery includes the resolved Hub title/requested label and up to
twelve sorted, explicit Hub aliases, each checked through the existing identity
collision and readback resolver. All subject prefixes share the same 100-row
plus sentinel/eight-readback bounds. Unchecked or ambiguous aliases cannot
authorize discovery; `legacy_subject_alias_limit` and
`legacy_subject_alias_unresolved` report incomplete scope rather than confident
absence. This does not discover every historical filename or establish a live
instrument-to-issuer mapping. No metadata repair, receipt rewrite or migration
occurs.

`investment-research-context.test.ts` exercises real receipts in temporary
fixtures, not live mutation or live instrument-identity acceptance.
