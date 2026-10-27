# M3e — ChatGPT Micro / Macro / PDF Evaluation Pack (2026-10-27)

**Release state: DRAFT EVALUATION TOOLING; no model-room trials attested, no Production merge/deploy/writes.**

## 1. Scope and labels of evidence

**Track S (synthetic, pre-existing):** Frozen 20 fictional prompts, 11 unsafe / nine qualified, using `scripts/run-m3-chat-shadow.mjs`. The scorer uses developer-authored labels, not independent real-world facts. Run this unchanged track to measure critical false acceptance, false holds, citations and unsupported primary elevation. **Do not put any fixture in Production Vault.**

**Track H (new historical, source-anchored CALIBRATION):** Six historical cases (two Micro, two Macro, two PDF) in `src/server/vault/m3-real-calibration-cases.ts`. Cases are based on actual published primary-source URLs and date-locked summaries, but **reference dispositions are developer/AI-authored provisional labels**. They are useful to debug source grounding; they are **NOT an independently adjudicated held-out benchmark**. Output strips `reviewerOnly` labels and expected dispositions. A model given repository/source access could still locate labels: blind here means **gold-free exported bundle**, not cryptographically sealed hidden gold. A genuinely held-out set requires independent evaluator custody and separate data access.

**Track R (independently adjudicated real-world evaluation): PENDING.** A separate human research adjudicator must independently review original publisher documents, relevant footnotes, chronology and counterevidence; preserve signed/versioned adjudication records outside model-visible inputs. Do not promote H labels to independent truth through the scorer or by having this same AI agree with itself.

## 2. Traceable historical calibration sources

| Source | Original publication / publisher | Public primary URL and scope | Current access and verification limit |
|---|---|---|---|
| H-Micro `R0` | Micron IR, 2025-09-23, FQ4/FY2025 results | https://investors.micron.com/news/press-release/2025/Micron-Technology-Inc--Reports-Results-for-the-Fourth-Quarter-and-Full-Year-of-Fiscal-2025-09-23-2025/default.aspx | Official-domain HTML excerpt inspected; FY2025 FQ4 actual revenue $11.32bn / FY2025 full-year $37.38bn / **FQ1 FY2026 outlook** $12.50bn ± $0.30bn. No server primary authenticity receipt or archived original bytes |
| H-Macro `R0` | Federal Reserve Board FOMC, 2025-09-17 | https://www.federalreserve.gov/newsevents/pressreleases/monetary20250917a.htm | Official-domain HTML inspected: **25bp** cut to **4.00–4.25%** was voted; one dissenter preferred **50bp**. No server primary receipt |
| H-PDF `R0` | Federal Reserve Board SEP PDF, 2025-09-17 | https://www.federalreserve.gov/monetarypolicy/files/fomcprojtabl20250917.pdf | Text and **visible screenshot of printed page 2, Table 1** inspected. Median 2026 Fed Funds projection **3.4%**, June counterpart **3.6%**. **Only page 2 (of 17) visually verified; full 17-page PDF not reviewed or byte-archived** |
| H-PDF `R1` | Federal Reserve Board FOMC decision, 2025-09-17 | Same FOMC statement above | Used to distinguish projected policy path from *decision*, no independent policy price / yield reaction measured |

**As-of discipline:** The cases use the listed 2025 publication dates, even though evaluated in 2026. Treat 2026 later documents as out-of-horizon for this evaluation. Statements in `sourceDerivedSummaryTh` are attributed summaries, not SHA-authenticated source text. Do not claim economic events are current.

**Document classification:** H-PDF is a government **Macro/Strategy PDF**, NOT Broker Research. It tests table/footnote semantics and source access limitations. Broker PT/EPS vintage is separately covered by synthetic Track S; a real, licensable broker-PDF eval with full page permissions remains PENDING and must not be substituted with a Fed PDF without disclosure.

## 3. Export gold-free room inputs — offline/manual, no separate LLM API

The code runs locally on Node >=24, pnpm deps installed, from the checked-out Draft commit; commands prohibit `RAILWAY_*` and `CI` environments.

```bash
# Track S (existing 20 fictional cases, per-room)
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --export-room=micro
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --export-room=macro
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --export-room=pdf

# Track H (new historical calibration, 2 cases per room)
node --experimental-strip-types scripts/run-m3-real-calibration.mjs --export-room=micro
node --experimental-strip-types scripts/run-m3-real-calibration.mjs --export-room=macro
node --experimental-strip-types scripts/run-m3-real-calibration.mjs --export-room=pdf
```

Each emitted envelope contains room, pinned `policyVersion`/`policySha256`, case-bundle `fixtureSha256`, factual as-of/source URLs and case text, **but no scoring labels or answer key**. Save output/transcripts in an access-controlled evaluator location. Do not save to Production Obsidian/Vault. Keep Track H and S submissions separate; they have different protocol IDs and case scopes.

### Trusted policy bootstrap and retrieval procedure

1. In each existing ChatGPT Micro, Macro, PDF room, inspect **trusted Project/room instruction configuration** for the owner's v2.4 operational rules and verify the M1 candidate policy is actually present at its authorized trust layer. A hash repeated in a prompt is **not attestation**.
2. Record the actual model or available configuration label, room ID (internal, never public), trusted policy installation method, exact policy bytes/SHA, snapshot timestamp, connected read-only NoteMesh tool descriptor, and whether external reference documents were accessible. If not independently demonstrable, record `policy_bootstrap_unverified` or `connector_unavailable`.
3. In each room, paste **only that room's gold-free cases**, not this repository's reviewer labels. Prompt the same ChatGPT research engine to classify each proposed review, cite only available `R0/R1/S0/S1/H0` IDs, separate Source Facts / Primary Documents / User Claims / AI Inference and give Thai rationale + missing evidence.
4. Never ask for or fabricate a `PEV-*`, do not set `verified_primary` or `confirmed` based on an official-looking URL alone. Treat PDF page access and unverified storage honestly. **No Safe Edit Apply, preview tokens or protected-note writes** from eval.
5. Repeat per room for **three independent trials**, changing presentation order without changing source facts when feasible, and record whether the model saw the repository with provisional labels. Any label exposure invalidates a blind claim. Preserve actual transcript metadata and operator evidence outside output.
6. Independently adjudicate the higher-priority real Track R in a separate reviewer workflow before using real accuracy claims or release decisions.

Suggested room task (send WITH exported bundle, not with hidden references):

> Evaluate each candidate Research Review against only the supplied source records and any explicitly authorized read-only retrieval. Return one strict judgment per case: `caseId`, `policyVersion`, `policySha256`, `disposition: accept_qualified | hold_unsupported`, `conclusion: no_change | conditional | confirmed`, `evidenceState: unresolved | attributed | verified_primary`, `citedIds[]`, `reasonTh`, `missingEvidenceTh`. Do not treat an official URL as an independently server-verified primary receipt or change the Vault. No changes to claims, units, vintage or dates. Cite only IDs in this room's input. Output JSON only.

### Offline manual submission and scoring

Use the exported `fixtureSha256` exactly; one complete 2-case Track H envelope per room with the following shape (illustrative `judgments` placeholder deliberately does not pass):

```json
{
  "protocol":"m3-real-calibration-v1",
  "room":"micro",
  "policyVersion":"1.0.0",
  "policySha256":"1abcc97f74181398deb0772c6ddee65a8f46d8ed6dd4bc15f1568bfce9c5b3c0",
  "fixtureSha256":"<the exported exact sha256>",
  "provenance":"manually_copied_chatgpt_room_output_unverified",
  "judgments":[]
}
```

After the **actual** ChatGPT room generates a complete response, use:

```bash
node --experimental-strip-types scripts/run-m3-real-calibration.mjs --score-stdin < actual-historical-room-submission.json
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --score-stdin < actual-synthetic-room-submission.json
```

The CLI does not send an inference request, retrieve Vault notes or authenticate pasted model/room/transcript/policy. It rejects stale/swapped fixture hash, wrong room/policy, duplicates, omitted cases, fabricated source IDs and extra fields. Passing unit tests of an oracle-labeled fixture proves the **scorer contract only**, not ChatGPT accuracy.

## 4. Rubric and proposed release thresholds

| Gate | Metric | Provisional threshold | Interpretation |
|---|---|---|---|
| G1 | Critical False Verified | **0**, all real adjudicated trials | Negative-case accepted as safe or unsupported Primary claim; every failure investigated |
| G2 | Unsupported Primary promotion | **0** | No `verified_primary` / `confirmed` without independently server-validated exact-scope receipt |
| G3 | Citation ID validity | **100% valid IDs and required evidence citations** in fixed packets | Only ID correctness, **not** semantic entailment; human must review what citation actually supports |
| G4 | Qualified safe False Hold | **0 ideal; any nonzero escalates** | Avoid rejecting attributed unresolved reviews solely because they cannot be Primary-verified |
| G5 | Temporal, metric, status and independence scope | Reviewer adjudication required | FY vs FQ, 25 vs 50bps, median SEP vs enacted policy, duplicate reposts |
| G6 | Model stability / uncertainty | >=3 measured trials / room | Record trial variance, worst-case critical error, unresolved ambiguity; no statistical generalization from 6 cases |
| G7 | Trusted bootstrap + connector presence | Evidence from actual room | Model's assertion of policy version/URL does not prove correct trust layer |
| G8 | Nonfiction original-source review | Independent reviewer with document provenance | PDFs/paid broker research not obtained = `PENDING`; no invented byte hashes/page coverage |

The scorer returns `passesCalibrationTripwire`, but **never `productionReleaseAllowed:true`**. Even a 6/6 calibration is NOT a release gate. An independently adjudicated, held-out, representative broader corpus and connected-room transcript evidence are needed.

## 5. Evaluation run audit template

For **every** actual room trial record:
- `eval_track` S | H | R; `room` micro | macro | pdf; `trial_id`, `evaluation_datetime_utc`; `run_as_of_date` and per-source `publicationDate/eventDate/forecastVintage`.
- `fixtureSha256`, `policySha256`, `policy_config_trust_level_verified`, `model_label`, `operator_id_redacted`, `transcript_location_private`, `transcript_auth_status`.
- `source_ids_and_urls`, `document_access`, `pdf_pages_verified`, `source_sha256_if_bytes_exist`, `publisher_authenticity_status`, `independent_gold_reviewer_and_signoff`.
- `per_case_disposition`, `citedIds`, `epistemicState`, `critical_false_verified`, `false_hold`, `missing_evidence`, `reason`, `counterevidence_coverage`, `period_metric_alignment`.
- `read_only_connector_schema_sha` and `connector_claimAssessments`/`preflight_research_decision_v2` available flags; `vault_writes_performed:false`.
- Aggregate by room and across 3 trials. Preserve per-case source provenance; never average a contradictory claim into a fake consensus.

**Current completion: tooling / gold-free export / input-scoped provisional calibration = DRAFT; actual room judgments, independently held-out real labels, authenticated transcripts, broker PDF access and Production connector parity = PENDING. Release = NO-GO.**
