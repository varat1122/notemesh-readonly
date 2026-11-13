# IOS-PRICES-004 — offline Drive pilot contract

สถานะ: LOCAL MOCK ONLY; live OAuth/Drive/market, account consent, scheduler และ runtime activation ยัง HOLD

## เหตุผลและขอบเขต

ใช้ `GoogleDriveArchives`/`ArchiveRepository`, `DrivePriceCache`, SQLite และ MCP เดิม ไม่สร้างบริการใหม่
ช่องว่าง P0 คือ repository เดิมค้นหา/สร้าง dataset folder อัตโนมัติและไม่ได้ผูก parent/เจ้าของ/ACL กับคำอนุมัติ Pilot
เพิ่ม optional `DrivePilotSession` ให้ adapter เดิม เฉพาะ CLI offline ที่ฉีด HTTP mock; default runtime path ยังเหมือนเดิม
ไม่มี live CLI, OAuth callback ใหม่, dependency หรือการเปิดสิทธิ์แหล่งราคา

Pilot เลือก **AAPL synthetic 2 bars เท่านั้น** เป็นหนึ่ง partition + หนึ่ง catalogue ไม่รวมทั้ง 5 ตัวลง snapshot เดียว
เหตุผล: `DrivePriceCache.openPartition()` เดิมบังคับหนึ่ง instrument ต่อ archive; ถ้าใช้ 5 ตัวจะต้องมี 5 archives + catalogue
Task003 ยังเก็บ demo 5 ตัวไว้ครบ งานนี้ลดขนาดการทดลองเพื่อคงสัญญาเดิม ไม่ลดความสามารถของ MVP

## Source audit / เส้นทางจริง

| ส่วน | Source และพฤติกรรมที่ตรวจพบ |
|---|---|
| Producer | `fixtures.ts` → `parseYahooChart()` → `PriceStore.save()/serialize()`; ใส่ `dataOrigin=synthetic_fixture`; ไม่มี Yahoo fetch |
| SQLite | `store.ts`: DB closed/serialized; reader read-only; ตรวจ `quick_check`, instrument/count/currency/timezone/provider symbol |
| Archive | `drive-archive.ts`: `.iop` magic InvestmentOSPriceArchiveV1, JSON header version/createdAt/raw bytes/SHA-256/MAC + gzip; HMAC-SHA256 ก่อน decompress; global DB <=4MiB, signed <=4MiB+64KiB |
| Catalogue | `drive-catalogue.ts`: `.ioc` signed JSON payload v2, unique partitions, archiveId/databaseBytes/barCount/coverage/refresh status; global <=512KiB |
| Upload | `GoogleDriveArchives.publish()`: POST `/upload/drive/v3/files?uploadType=multipart&fields=id`, MIME `application/octet-stream`, explicit `parents:[approvedFolderId]`; names role+UTC+UUID; immutable create only |
| Integrity | Pilot appProperties role=v1/v2, investmentOsPilot, pilotSha256 of exact signed object; GET metadata then `alt=media`; byte-for-byte + HMAC; catalogue must match confirmed archive and coverage |
| Reader | `GoogleDriveArchives.latest()/get()` → new `DrivePriceCache` → signature/SQLite/partition checks → existing `registerPriceTools()` and in-memory MCP SDK `read_price_bars`, `list_price_instruments` |
| Cache | Existing max8 partitions/16MiB, <=2 requested per query; delayed/stale catalogue protection and retry backoff remain. Pilot refuses missing/duplicate generations rather than choosing an arbitrary latest one |
| OAuth | `drive-auth.ts`: exact `drive.file`, PKCE/admin-bound short-lived state, sealed refresh credential bound to clientId, expiry/scope checks; no persisted Google principal binding. Read-only audit; no edits |
| Existing UI | `/api/market-prices-drive` POST connect → backend consent/callback; GET itself runs authenticated app setup/status which may read Drive. Old activation guidance changes Railway/env/refresh. **Do not use this page as a harmless status check or follow activation steps for this Pilot** |
| HTTP/runtime | `drive-http.ts`: fixed HTTPS Google origins/no redirects/bounded body; pilot adds allowed Drive paths, budget and <=15s/request. `scripts/build-price-job.mjs` already bundles CLI into existing server image; no runtime/CI config edits |

Signing uses existing `driveKey()` derivations from `ENCRYPTION_KEY`; the demo creates a disposable **synthetic signing key**, removes its temp directory and restores process state. It never reads/creates a real OAuth credential. Signatures authenticate integrity; `.iop` gzip and `.ioc` JSON are **not confidentiality encryption**. Sharing raw objects could expose prices or metadata and would also require an authorized reader/signing-key arrangement; no sharing is enabled here.

## Safe offline commands

From the isolated Prices worktree with its existing installed dependencies and Node24:

```sh
node scripts/market-prices.ts drive-pilot-plan
node scripts/market-prices.ts drive-pilot-dry-run
```

Both accept **no extra arguments**. `--live`, token/folder arguments are refused. Do not substitute `status`, `daily`, `refresh` or invoke the app's live routes.
`drive-pilot-plan` prints UNSET/HOLD proposal only. `drive-pilot-dry-run` intercepts **all fetch calls** using `MockPilotHttp` with no forwarding transport, and uses temporary DATA_DIR + in-memory SQLite/Drive/MCP.
The CLI prints one JSON receipt to stdout; diagnostics go to stderr. The built `.output/server/price-job.mjs` supports these same offline commands; running it does not deploy anything.

## Guard and approval boundary

Guard refuses missing/UNSET/root folder, absent approval reference, wrong app/client/principal/scope, unexpected endpoint/method and unscoped list query.
Trusted authorization callback is required; there is **no default live token source** for the Pilot guard. A supplied approvalRef or callback claim is not proof of Owner approval or an OAuth grant.
Live executor must independently attest the client/grant, resolve `about.user.permissionId`, bind exact parent/pilot/manifest/candidate/window/caps, and consume one durable approval once before writes. That executor and durable single-use/crash journal are **UNSET / not implemented here**.
Folder preflight expects personal My Drive: dedicated app-created folder named `InvestmentOS-Prices-Pilot-ONLY`, matching appProperties marker, non-trashed, ownedByMe, sole expected owner/permission, not shared, canAddChildren, empty.
File metadata must have one exact approved parent, matching role/marker/hash, private owner ACL and octet-stream MIME. Missing ACL fields or inaccessible metadata means HOLD, never infer private access.
Process-cold restart onto a nonempty folder means HOLD. Offline cold MCP proof creates a **new reader/cache with the same in-memory session**, not a durable process-restart proof.

## Finite upload/readback budget (one proposed future session)

| Limit | Value |
|---|---|
| New data objects / POST attempts | <=2 total: one archive + one catalogue |
| Signed object bytes | archive <=256KiB, catalogue <=64KiB |
| Multipart upload wire bytes | <=1MiB cumulative |
| Download budget | <=2MiB cumulative **reserved maximum response sizes**, including failed requests; conservative reservations never refunded |
| Drive requests | <=24 issued total, including preflight, reads and explicit reconciliation; no automatic retry |
| Time | <=120 seconds total; <=15 seconds per HTTP request |
| Folder/OAuth work | **zero** in upload phase; separate future bootstrap proposal max1 folder, <=8 Drive calls, <=2 OAuth token calls, separate approval |
| Cost | Actual offline API cost0. Proposed future expected0 conditional on actual free quota/storage/billing evidence; paid/overage use not authorized |

Preflight: GET about, GET exact folder metadata, GET bounded exact-parent child list.
Normal upload/cold read uses14 mocked Drive requests and2 POSTs. Receipt has actual signed bytes/hash/generation names/parent/version/MIME and counters, no Authorization headers or credential values.
Budget may stop earlier than24 requests because response reservations are conservative. Underlying bounded stream cancels an oversized response; budget is an application response cap, not a billable network-byte meter.

## Failure / recovery

| Event | Deterministic behavior |
|---|---|
| 401 / expired or revoked authorization | STOP; no refresh/consent retry by Pilot guard; reauthorization requires new review |
| 403 permissions/scope or 429 quota | STOP; no scope expansion, retries, quota bypass or alternate identity |
| 404 / inaccessible ID | STOP; no alternate folder or lookup outside approved parent |
| Network response lost after POST | Mark uncertain **before** request. Same payload POST is blocked. Explicit read-only reconcile exact parent+pilot+role+SHA; exactly1 match → metadata/media/signature/bytes verify → reuse ID;0/multiple/tamper → HOLD |
| Partial/invalid upload response | Same uncertainty policy; no automatic second POST or catalogue |
| Archive readback tamper / wrong parent | STOP; catalogue cannot be admitted |
| Catalogue upload fails | Retain verified archive as reported orphan; no corrupt/current catalogue publication and no deletion |
| Duplicate generation / inconsistent manifest | Reject, no arbitrary latest selection |
| Changed bytes after preparation | Reject manifest change; same confirmed bytes read back only, no new POST |
| Fresh process / stale or orphan objects | Nonempty-folder preflight HOLD. Operator reviews existing IDs/bytes using separately approved reconciliation; no reset, blind replay, trash/delete or overwriting |

This is fail-safe session recovery, **not distributed exactly-once semantics**. Ambiguous catalogue upload can be reconciled with the same role API in-memory, but durable cross-process recovery is not implemented. Multi-writer access is unsupported; single writer and approval ledger must be established before a real Pilot.

## Supported future consent/folder design — document only

1. Separate approved isolated backend OAuth client/redirect and dedicated personal My Drive account. Confirm publisher, consent/testing status, test-user eligibility, refresh expiry, quota/storage and signing-key custody without exposing secrets.
2. Backend's existing `drive.file` consent flow is the basis; ChatGPT's Drive connector grant is unrelated. Do not grant full `drive`, reuse Production OAuth storage or copy connector credentials.
3. In a separately approved bootstrap, **the same backend app** creates the dedicated private folder with pilot marker. Merely typing an arbitrary existing folder ID does not grant `drive.file` access. Google Picker would be another supported approach but is not implemented; do not imply it exists.
4. Collect non-secret exact folder ID, observed principal reference, clientId/redirect reference, scope and owner-only ACL evidence. Owner/Coordinator approve that exact folder + current candidate/manifest/window/budgets before upload phase; signing/refresh material remain in isolated secret storage, never chat or artifact.
5. Only after live binding + durable one-time approval/crash journal are implemented/reviewed may a separate task execute one AAPL synthetic archive + catalogue, read it back through MCP, and stop. No market fetching, scheduler, runtime activation, sharing or deletion authorized by this document.

## Current official references

Public documentation reviewed2026-10-29; no Drive/OAuth API requests made.

- [Scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth): narrow `drive.file`; per-file app access requires supported create/open/Picker flow, not arbitrary ID.
- [Uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads): metadata+small payload via multipart; current bounded payload is well under5MB. No resumable retry engine added.
- [Folders](https://developers.google.com/workspace/drive/api/guides/folder), [search](https://developers.google.com/workspace/drive/api/guides/search-files): explicit parent and trashed filter.
- [about.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get), [Files metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files): principal/owner/permission/capability evidence; actual availability for chosen account remains UNSET.
- [Errors](https://developers.google.com/workspace/drive/api/guides/handle-errors): distinguish permission/quota/missing resource, fail closed.
- [Limits](https://developers.google.com/workspace/drive/api/guides/limits): standard use currently no extra charge; documentation mentions possible quota-overage charges later2026. Verify account/project conditions before claiming the real test costs0.

No account, quota, publisher, refresh-token lifetime, redirect URI or ACL was inspected live; none is reported PASS.
