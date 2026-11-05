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
collisions, missing/changed readback, and a Company Hub index over the 3,000-row
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
The canonical routing/writeback resolver's behavior is unchanged.

`issuerCoverage` reports selected and missing roles separately per request. A
complete NVDA result cannot conceal missing MRVL Thesis/Evidence/Timeline/Source
roles. Missing material stays missing; this code creates no Hub or protected note.
Decision packets carry this resolution/coverage without rewriting the incoming
claim entity or inferring verification, independence, owner approval or valuation.

For macro queries, explicit country/topic scope is kept separate from subject
terms. Matching macro-folder searches supplement the existing global FTS window.
When subject matches exist, unrelated country-only results do not fill the pack;
otherwise country-only fallback is explicitly marked incomplete. Filename and
FTS cutoffs are reported, not treated as exhaustive absence. Multiword explicit
scope is matched as a whole; no geographic alias table is inferred.

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
