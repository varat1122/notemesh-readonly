# C1 Git-disabled Research Pilot — real-user E2E runbook (CHAT + WORK)

Task IOS-ORCH-RI-001. Candidate: branch `ccr-eca3beae-c1-usability`, built on PR #184
source `2a8845dd` (tree `6ec053c8`). This is a **bounded pilot**. It is not Full L1, not a
release, and not Production. ADR-D1-GIT-01 and the Full L1 security HOLD are unchanged.

Nothing in this document grants anything. Every WORK step below needs its own
Owner-approved permission: instance, endpoint, OAuth, connector and write grant. MA01 is
Source-only and is not reusable for Review.

## 0. What C1 does and does not allow (code-enforced)

| Area | C1 behaviour |
|---|---|
| Git sync | Never started. `runGit`/`runGitBuffer` refuse before any child launch. Remote setup is refused (409). |
| Obsidian sync | Supervisor is never started. `runOb` is refused. |
| Cloud/desktop intake, legacy importer, raw note/folder/disk writes | Refused (`c1_pilot_*`). |
| Prices | `refreshPrices` refused (`c1_pilot_price_writer_denied`). Collector timer never starts, even with `MARKET_PRICES_ENABLED=1`. *(New in this candidate.)* |
| Google Drive/OAuth egress | Every request refused before `fetch()` (`c1_pilot_external_drive_denied`). *(New.)* |
| Price store / tools | An on-disk writable `PriceStore` refuses to open, and no price tools are offered on `/api/mcp`, even with `MARKET_PRICES_ENABLED=1`. |
| Writes | Only the canonical Source/Draft path through `/api/safe-edit` (`prepare_*`/`apply_canonical_writeback`), plus the dashboard reviewer decision. |
| Identity | `DATA_DIR` must be a real directory under the OS tmpdir whose name starts `ios-c1-pilot-`, with a real `vault/` (no symlink). Any `RAILWAY_*` id is refused, so this cannot run on Railway. A process without `C1_RESEARCH_PILOT=disposable` on that directory HOLDs. |

**Not OS isolation.** WORK must provide a dedicated UID, private mounts (no Production,
Prices, MA01 or Hermes volumes) and the agreed network posture.

Server-side Source URL download (`archive_original_source`) stays refused unless
`SOURCE_ARCHIVE_USER_AGENT` and the admin allowlist are configured. Use **pasted text**
Sources for the pilot.

## 1. Policy facts CHAT must design around (RISK-1.1, unchanged)

The exact gate table and the two-case feasibility are in
`docs/ios-ri001-risk-2-quant-primary-proposal.md` §1–2. To check a candidate excerpt for digits
before any run, use the one-liner in §2 of that document.

A Draft/Review is admitted (Judge `PASS`) **only** when every one of these holds:

1. **No digit anywhere.** Any `\p{N}` character fails, Thai digits included. This covers the
   Source text, the proposed Thai Review fields, broker metadata, and claim or relationship
   candidates. Dates, years, Q-numbers, prices and numeric tickers (e.g. `2330`, `9988`) all
   cause `HOLD` (`draft_risk_quantitative_scope_not_supported`). Expect most real news to end
   as **Source-only**. That is correct behaviour, not a failure.
2. The event is `added_detail` and not material:
   - no broker research or rating;
   - no earnings, guidance, estimates or portfolio content types;
   - no supplier/customer relationships;
   - no unresolved claim.
3. Each risk finding cites **both** the received Source (exact UTF-16 span plus SHA-256)
   **and** a receipt-bound *history* span from an earlier saved Source for the same subject.
   Therefore **capture one earlier related Source first**
   (`prepare/apply_canonical_writeback` with `captureOnly:true`). Without history, the result
   is `draft_risk_source_history_basis_hold`.
4. A dashboard reviewer approves the exact bound Draft at `/api/safe-edit-approval?id=<operationId>`:
   - The approval is recorded as `admin:<id>` with `humanPresence:not_verified` and
     `criticIndependence:not_verified`.
   - It is **not** a human or independent-critic certification. Never describe it as one.

Saved Reviews always carry `historical_analysis_only`, `comparator_eligible: false` and
`independent_evidence_increment: 0`.

## 2. WORK preflight (needs Owner approval for each item)

1. **Host:** a non-Railway isolated host or VM.
   - Dedicated UID; `DATA_DIR=$(realpath "$TMPDIR")/ios-c1-pilot-<id>` containing `vault/`.
   - No shared mounts. Record `uname`, UID, mounts and `id`.
2. **Build the exact candidate:**
   `git checkout <commit>`, then `pnpm install --frozen-lockfile`, then `pnpm build`.
   Record commit, tree and the `.output` digest.
3. **Environment, only:**
   - `C1_RESEARCH_PILOT=disposable`
   - `SAFE_EDIT_ENABLED=1`
   - `SAFE_EDIT_SINGLE_WRITER=1`
   - `ENCRYPTION_KEY=<new pilot-only key>`
   - `DATA_DIR`
   - `BASE_URL=https://<approved pilot origin>`
   - `PORT`
   - `TMPDIR`

   Do **not** set Git, Obsidian, Drive, Prices or `SOURCE_ARCHIVE_USER_AGENT` variables, and
   do not copy any Production secret.
4. **Start:** `node .output/server/index.mjs` behind a TLS reverse proxy on the approved
   origin. Then check:
   - `GET /api/health` returns `configured:false`.
   - Logs contain no `[supervisor] starting`, `[git]` or `[market-prices]` lines.
5. **Admin and vault setup:**
   - Within 30 minutes of start, claim the admin from a separate browser.
   - Call RPC `setupLocalPilotVault {confirmLocalOnly:true}` and `setTimezone`.
     - Setup creates seven empty folders, including the Company Hub parent `01_Companies/`.
       It creates **no** Hub or other note.
     - An instance configured by an earlier candidate (six folders) HOLDs with
       `c1_local_setup_directory_missing_hold` on re-run. It is never silently repaired; recreate
       the disposable instance instead.
   - **Company Hub (required for `domain:"company"`).** After the Edit connector is bound,
     create `01_Companies/<TICKER>.md` in-app with Safe Edit `create_note` followed by
     `apply_edit`:
     - This is an ordinary target (`pilotReviewRequired:false`). The apply receipt must read
       `write/readback/reindex: verified`.
     - Never place the file on disk out of band; an out-of-band file is a test fixture, not
       onboarding.
     - The ticker must contain no digits.
     - A Hub `aliases:` entry (for example `Azure` on `MSFT`) is a lexical issuer-context
       mapping only. Add it **only** with Owner approval, in this disposable C1 only, and after
       checking that no other Hub claims the alias (a collision is `ambiguous_hold`).
     - The actor that creates or edits a Hub influences issuer resolution and history selection.
       Record who created it and its receipt in the evidence.
6. **Two OAuth protected resources (two connectors):**
   - **Edit connector:** resource `BASE_URL/api/safe-edit`, metadata
     `/.well-known/oauth-protected-resource/api/safe-edit`, scopes `vault:read vault:edit`.
     Used only by the room that saves.
   - **Read connector:** resource `BASE_URL/api/mcp`, metadata
     `/.well-known/oauth-protected-resource`, scope `vault:read`. Used by the fresh retrieval
     room.

   An Edit token is refused on `/api/mcp` and a Read token on `/api/safe-edit`
   (audience-bound).
7. **Descriptor check after binding:**
   - The Edit connector lists `prepare_research_judge_packet`,
     `research_judge_result_contract`, `prepare_canonical_writeback`,
     `apply_canonical_writeback` and `get_edit_status`, and **no** approve or review-decision
     tool.
   - The Read connector lists `search_vault`, `read_note`, `get_links` and
     `investment_context_pack`.

   Record the descriptor digests.

## 3. CHAT journey (expected server states)

| # | Room / actor | Action | Expected |
|---|---|---|---|
| J0 | Micro (Edit) | Save one earlier related qualitative Source, `captureOnly:true` | 1 receipt `write/readback/reindex: verified` |
| J1 | Micro (Edit) + dashboard reviewer | New digit-free qualitative *added detail* Source. Then: `prepare_research_judge_packet`, analysis, `research_judge_result_contract`, `prepare_canonical_writeback` with `researchJudge`, reviewer approves the exact Draft in the dashboard, `apply_canonical_writeback` | Judge `PASS`. `status: saved_verified`. 2 receipts (Source + Review), all `verified`. The Review links its Source and the hub. |
| J2 | same | Re-submit J1 unchanged | `previews: []`, `receipts: []` (no duplicate, no extra independence) |
| J3 | same | Same subject, Source containing a date or number (or broker/rating) | Judge `HOLD`. Only `source_intake` is saved (1 receipt). No Review file. |
| J4 | Second room (Macro/Industry, Edit) | One Macro/Industry Source | Record the outcome. A reviewed C1 Macro positive is **not proven** (L1-02); Source-only is acceptable and must be labelled as such. |
| J5 | WORK | Stop the server **immediately** after J3 (no settle delay), then restart with the same `DATA_DIR` and env | `/api/health` returns `configured:true`. `get_edit_status` returns the same receipts. File SHA-256 matches the receipts. The `links` rows of the J1 Review are resolved. |
| J6 | **New** ChatGPT conversation (Read connector, new OAuth consent, no pasted history) | Call `search_vault` by ticker or IN-id, `investment_context_pack {issuers:[<TICKER>]}`, `read_note` on the Review, and `get_links` (`outgoing` / `backlinks`) | The Review and Source are found with their trust labels. The J3 Source is readable and has no Review. Answers must cite the receipts and the restrictive labels. |
| J7 | negatives | `preview_edit` on `05_Thesis/...`; raw `create_note` in a Knowledge folder; Read-token call to `/api/safe-edit`; `submit_investment_notes` | All refused. Protected bytes unchanged. |

**Search limitation.** The FTS index (`unicode61`) does not segment unspaced Thai. A Thai
substring such as `ช่องทางติดต่อ` inside a longer run will not match. Search by ticker, IN-id
or English terms, or use `investment_context_pack`.

## 4. Evidence to capture per step

- Commit/tree and image/`.output` digest.
- Host identity, UID and mounts.
- OAuth resource, audience and client id, plus a hashed token id.
- Connector descriptor digests.
- Each operation id with its receipt JSON.
- File SHA-256 and the readback (`get_edit_status`).
- Cold restart timestamps.
- The fresh-room transcript, including the tool calls and their returned paths.
- Protected-file hashes before and after.

Do not paste earlier chat content into the fresh room.

## 5. Stop / recovery

On any stale seal, actor or scope problem, missing approval, integrity failure or unknown
partial effect:

- Stop non-Source apply. Keep the journal and receipts.
- Inspect with `get_edit_status`.
- Do not reset locks, rewrite receipts or auto-clear maintenance.

Disposable cleanup happens only after the evidence is preserved and owned processes are
stopped.

## 6. Automated equivalents in this candidate (mechanism only, synthetic actor)

- `tests/http/c1-pilot-journey.test.ts` covers J0–J3 and J5–J7 on the emitted server with a
  new OAuth client after restart.
- `tests/http/c1-pilot.test.ts` covers onboarding, descriptor, dashboard approval and cold
  readback.
- `src/server/vault/links-watcher.test.ts` is the regression for the cold-link defect.
- `src/server/market-prices/c1-price-drive-guard.test.ts` covers the Prices/Drive denials.
- `src/server/mcp/c1-pilot-admission.test.ts` covers the HOLD/FAIL and bypass matrix.
