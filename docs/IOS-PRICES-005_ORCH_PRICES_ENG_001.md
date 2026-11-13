# IOS-ORCH-PRICES-ENG-001 — bounded consolidation

Task revision1.1.0; role PRICES-ENG; System Master IOS-MASTER v3.0.0.

## Selected implementation and scope

Continue **ORIGINAL-R1**, exact tree `16c053c72fe6836308155ec160730ec9f3c4686c`, parent D972. Preserve its recorded selection for bounded correction and `ACCEPT_BOUNDED_OFFLINE_CORRECTION`; that acceptance applies to its original tree, not automatically to this incremental correction. IOS-ORCH must review the returned result. Live remains HOLD; Yahoo RIGHTS_HOLD; no new operational authority.

ORIGINAL-R1 retains its existing owned journal, PilotOperation deadline/cancellation/first-cause guard, admitted synchronous custody commit, monotonic checkpoint/recovery and original code-exchange/folder recovery plumbing. C1 and RESUME-R1 remain preserved references; neither full patch is applied over ORIGINAL-R1.

## Proven remaining gap and selective correction

On exact ORIGINAL-R1 plus a test-only overlay, seven safety assertions fail: raw outside-ID GET, unscoped list and three raw upload POSTs can reach the mock transport without a durable upload attempt; altered multipart parent/ID/payload can reach upload transport; replay of a valid multipart reaches transport a second time.

Reuse C1's request admission inside the existing ORIGINAL-R1 DrivePilotSession:

- C1 tree `6a3ea8859f2a14d7b48a72865beffe3ce83b0536`;
- source `drive-pilot.ts`, SHA-256 `f326de490bcce5cbabb161d2313bd4dad7107f6b68fa2ffcda03b3c4c98ab563`;
- C1 `bytes` GET ID/query admission, `admitPost`, `pendingPost` and post-checkpoint ticket assignment in `attempt`;
- six tests adapted from C1 `drive-pilot-c1.test.ts`, SHA-256 `1ec48f6adb39a7cc963448731301087daedd06741eb60b7e45f0e1fe784c5e8e`, using ORIGINAL-R1's lease/operation APIs; one additional meaningful ticket-replay case.

The ticket is created only after the role attempt is durably saved, consumed before dispatch, and never reconstructed on recovery. Unapproved raw requests fail before transport. Multipart must match the prepared bytes, role properties, parent and reserved ID. Existing request/wire/response reservations and first HOLD cause remain under ORIGINAL-R1's admission/operation guard. No port, approval schema or custody contract change is made.

## Verification and limits

Use the same seven tests before/after correction. Check affected pilot/archive/MCP tests and original normal/archive/catalogue/folder recovery, typecheck/lint and the existing price CLI mock command as appropriate. Preserve before-source binding, final source manifest and receipts. Historical ORIGINAL-R1 144, RESUME-R1 241 and C1 142 test results are separate source-bound evidence, never additive or substitutes for this candidate's current checks.

No format, Drive repository/cache/MCP interface, collector/rights, global Auth/routes/scopes, dependency/lockfile, runtime/scheduler, CORE, Vault or backup change. Bootstrap stays <=1folder/8Drive requests/2OAuth calls; upload <=2file-create POST attempts/24Drive calls/1MiBwire/2MiBresponse reservation/120s with the original signed/overall/per-request admission. Only fabricated AAPL2bars/archive1/catalogue1 and nonforwarding mock transport are used.

Existing ORIGINAL-R1 custody adapters must place synchronous storage effects inside the supplied admitted `commit` callback; no live adapter is enrolled or certified here. Admission is not hard real-time preemption or rollback of a server/custody effect. The local cooperating-host model is unchanged.

Remaining runner/authority/custody/account/zero-cost/folder binding facts are UNSET. Separate future Bootstrap and Upload decisions are required; provider-rights/real daily data and automation follow separately. Archived Better Auth missing-table diagnostics remain outside this correction; no full app/live readiness claim follows from mock or CLI bundle success.
