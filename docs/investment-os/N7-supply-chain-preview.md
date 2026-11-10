# N7: read-only supply chain relationship preview

Task: **IOS-ORCH-RI-001**. Product Master v2.0.0 §§08.5, 12.2–12.4 and B6.

`preview_supply_chain_relationships` is a read-scoped MCP tool for discovering
attributed Source text and checking the provenance of caller-proposed economic
relationships. It returns transient research candidates. It does not publish a
graph, authenticate a publisher, adjudicate a relationship, or authorize a write.

## Two-step research flow

1. Request evidence using `question`, one to six explicit issuer labels, and
   optionally `industry` and `asOf`. Omit `candidates` to obtain a bounded Source
   catalog and current Hub navigation. No edges are inferred from co-mentions.
2. Read the relevant original submitted text and provide up to eight typed
   candidates. Copy the exact Source path, intake ID and whole-note SHA from the
   catalog. Supply an exact quote from the preserved original-language text.
   MCP display boundary markers are not part of that quote.

A discovery request against a disposable fixture might be:

```json
{
  "question": "What evidence describes MODULECO and SYSTEMCO's relationship?",
  "issuers": ["MODULECO", "SYSTEMCO"]
}
```

The labels must resolve to existing, unambiguous, freshly read Company Hubs.
Resolution provides navigation only; it does not establish legal issuer,
security, listing or DR-underlying equivalence. Missing or ambiguous endpoints
remain held. The tool never creates an issuer to make a proposed edge pass.

## Candidate contract

Each candidate supplies `localKey`, `subject`, `object`, `direction`,
`assertionOrigin`, `lifecycle`, evidence references, declared validity,
value-chain stages, mechanism, confidence basis, ambiguity, invalidation and
stage-specific transmission proposals. `estimateVintage` is separate from
Source publication and event dates.

| Field | Meaning |
|---|---|
| `predicate` | `supplier_to`, `customer_of`, `partner_of`, `competes_with`, `technology_enables`, `sector_co_exposure`, or `potential_beneficiary_of` |
| `assertionOrigin` | Caller-declared source statement, analyst interpretation, archived AI interpretation, or co-mention |
| `sourceRefs` | Supporting original-text quotes; their combined relevance scope must cover both endpoints |
| `counterEvidenceRefs` | Explicit contrary evidence; it is checked rather than silently discarded |
| `relatedEvidenceRefs` | Linked correction, contradiction or retraction evidence |
| `claimRef` / `reviewRef` | Optional, separately checked references belonging to the same Source |
| `transmission` | Separate proposals for revenue conversion, gross profit, operating profit, earnings, and OCF/FCF/ROIC |

Each evidence role accepts at most four references. A quote reference contains
`intakeId`, `sourcePath`, `sourceNoteSha256`, `quote` and an optional
`documentLocator`. Optional Claim/Review references contain `path` and
`noteSha256`. A caller-supplied receipt ID cannot replace server validation.

The batch accepts at most 32 declared references in total. The N7 projection
reads at most 16 selected Sources and returns at most eight catalog entries;
the existing context reader has its own bounded discovery limits. Explicit
references are prioritized within the Source budget. Direct Claim and Review
reference caches each have a limit of 16 entries; reused adapters perform their
own bounded dependency reads. Limit flags describe omissions; they do not
certify exhaustive retrieval.

The backend checks structural and provenance requirements. Exact quotation does
not establish whether the proposed predicate, direction or economic mechanism
is entailed. An incorrect caller declaration of a direct supplier relationship
can never receive semantic verification from this tool.

## Result interpretation

| Result | Interpretation |
|---|---|
| `pending_semantic_review` | The bounded structural checks support presenting the attributed proposal to a reasoner; meaning remains unadjudicated |
| `hypothesis_pending_review` | An analytical, archived-AI or potential-beneficiary proposal; not a confirmed business relationship |
| `hold` | An identity, reference, availability or declared contradiction/retraction condition requires resolution |

Partnerships, qualifications and future design wins do not establish shipments,
recognized revenue, margins, earnings or cash flow. Supplied transmission
magnitudes remain caller proposals; `effectiveExposureMagnitude` stays
`unknown`. No revenue estimate is calculated from graph connectivity.

Every result keeps source authenticity and economic verification false,
semantic entailment unassessed, independent evidence increment zero,
comparator eligibility false and automatic/protected-note write authority false.
Several Reviews of one Source do not become independent observations.

Integrity or availability failures redact the affected proposal and bindings.
When all cited evidence is eligible, a declared contradiction or retraction can
retain its support/counter/correction links while held. No record is overwritten.

## Evidence binding and dates

Source checks include current whole-note hash, original submitted-text digest,
index/readback agreement, FTS body and a journal/audit-validated receipt.
Claim and Review references are independently checked for current bytes,
matching Source/intake and applicable issuer scope. Existing Draft research
trust is preserved; a persistence receipt does not promote it.

Quote locations are UTF-16 offsets within preserved submitted text. A unique
span is reported only for a unique occurrence. Repeated text is explicitly
nonunique. `documentLocatorVerified` is always false: a supplied page/table
label is not proof that an original PDF or attachment was read or archived.

`asOf` is an evidence-availability cutoff with an explicit timezone. The result
is an **availability-bounded view of the current index**, not an exhaustive
reconstruction of the historical Vault or historical issuer mappings.

- Source, Claim and Review recording times are derived from their validated
  server receipts, not caller `receivedAt`, import time or file modification time.
- Publication date, event date, relationship validity and estimate vintage are
  separate. An old event date cannot make a later publication available early.
- Date-only publication values retain their timezone uncertainty. Missing dates
  stay unknown; public availability is not invented.
- A Review's creation receipt cannot date text added later. Current appended
  bytes require their own validated recording bound or remain held at a cutoff.
- Future or ineligible supporting, contrary or linked evidence cannot leak its
  path, quote or derived candidate narrative into the filtered result.
- A declared future relationship is prospective, not a verified active edge.

`generatedAt` describes this preview run; `queryCutoffAsOf` is the requested
cutoff. Neither implies that this newly generated analysis existed historically.
The method is versioned as `IOS-RI001-N7-PREVIEW-1`.

## Operational boundaries

The module uses existing bounded read adapters and SELECT-only receipt checks.
It does not initialize a new receipt store, migrate a schema, call an external
model, fetch the web, or start a service. Operational read failures are distinct
from ordinary bounded omissions. Counter-evidence discovery is not exhaustive.
`evidenceReadHoldCount` and its reason codes report failed selected-source or
scope-bearing Review checks without exposing rejected paths. Expected
availability exclusions are counted separately in `cutoffExclusionCount`.
Candidate-specific reference errors remain explicit in each candidate's issues.

The tool is exposed only with read scope, including when a legacy client asks
for write capability. Narrative fields are fenced as untrusted data while paths,
hashes and status fields remain usable by subsequent tools. These markers aid
interpretation; they do not constitute a security or semantic adjudication gate.

This slice does not implement a persistent relationship registry, relationship
approval workflow, original-document authentication, protected Timeline update,
portfolio recommendation, trade execution or live-client acceptance.
