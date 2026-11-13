# IOS-PRICES-005 — single-use Drive pilot gate

**OFFLINE/MOCK ONLY.** No live CLI, account/consent, Drive/OAuth/API request, deployment or runtime authorization is supplied by this document. Source price rights remain HOLD.

## Two bounded gaps closed

1. `drive-pilot-bootstrap.ts` adds an isolated pilot-only PKCE code-exchange adapter and app-created folder bootstrap. It reuses `driveKey`, `googleBytes` and exact `DRIVE_SCOPE` from reviewed code. It never calls `driveAccessToken`, reads legacy credential storage, changes Auth/login/routes/config, or uses ChatGPT connector credentials.
2. `drive-pilot-approval.ts` verifies independently signed permits; `drive-pilot-journal.ts` stores consumption, pre-dispatch budgets and crash states; `drive-pilot-gate.ts` connects them to the Task004 real adapter, existing signed archive/catalogue, cache and MCP. This is one local pilot journal, not a general approval service.

Task004 remains usable: optional persistence defaults off; existing offline commands and default nonpilot adapter behavior are preserved. No format, provider, entitlement, scheduler or package changes.

## Owner authority / trusted inputs

The proposal is inert. Approval requires an Ed25519 signature over UTF-8 `canonicalJSON(permit)` (object keys recursively sorted, array order preserved), encoded base64url. Envelope shape is exactly `{permit,signature}`; an approvalRef, a key embedded in that envelope, a default key or a signature under an operator-chosen different key is rejected.
`OwnerAuthority` is a separately provisioned public PEM, SHA-256 of its DER/SPKI, and Owner-enrollment evidence reference. The real enrollment is **UNSET**. Future operator must obtain the public-key fingerprint from Owner through a separate verified channel and pin it outside proposal/journal input. The private key stays with Owner or an explicitly appointed approval signer, never Codex/chat/runtime/journal. Each permit needs Owner review before signing; this task provides a verifier, **no live signer/enrollment shortcut**.
Trusted one-shot runner must use the reviewed candidate/binding, protected signing-key/token custody, stable clock, single host/PID namespace and durable journal directory. A supplied context label does not remotely attest the running code or prove a person's decision. Mock fixture keys/grants are never live authority.

### R1 invocation admission and deadlines

Each admitted invocation owns a fresh in-memory capability tied to the durable PID/nonce/host lease. All mutations require that capability and recheck the shared lease. Invalid permits and busy invocations cannot hold, release or close another invocation's journal, including when the same handle is reused. HOLD and DONE are absorbing; the first terminal cause is retained. Counters, object progress, validated phase progress and the original upload start cannot move backwards.

Bootstrap and upload have separate signed windows. Bootstrap keeps its originally consumed permit expiry (signed interval at most 15 minutes); PKCE/local consent additionally keeps its existing shorter five-minute bound. Upload reserves its start before waiting on a grant and uses the earlier of that original start + 120 seconds and its signed expiry. Recovery uses the same consumed permit and deadline. A legacy pre-request upload journal without a start checkpoint uses the signed `notBefore` conservatively, never a fresh start.

The pilot-only operation guard bounds consent, client-secret, custody, grant, request/body and cold-MCP/cleanup awaits. It checks ownership, terminal state and time before dispatch, after awaits and at state-commit admission. Caller cancellation is preserved. A timed-out transport can still have completed remotely, so consumed reservations and uncertain object states remain; an attempted object is reconciled, never blindly reposted. Aborting an await does not undo an already dispatched request or provide hard real-time preemption of synchronous disk/fsync work.

The trusted pilot custody adapter now receives `write(sealed, commit)`. It may prepare asynchronously, but must place its complete synchronous storage effect inside the supplied `commit(() => { ... })`, exactly once, before resolving. The callback rechecks admission at the actual effect; late calls after HOLD, expiry, ownership loss or completion are rejected. Writing outside that callback, or starting asynchronous writes inside its effect, violates this adapter contract and is not made safe by Promise cancellation. No live custody adapter is configured by this task.

Recovery remains conditional on the original remaining caps. A restart after `READBACK_VERIFIED` preserves that phase while reserving further reads, but may exhaust the original request/response-reservation budget and HOLD with both prior files retained. It must not lower progress, refund counters, extend time or repost to force a successful result.

## Exact permit contract

Common fields: version1, unique permitId, pilotId/journalId/candidateTree, approved principal/client/redirect/exact `drive.file`, signing-key proof and custody reference, notBefore/expiresAt, Owner evidence and zero-cost quota references, expected USD0 and charge ceiling USD0. Missing/UNSET fields, expiry, paid cost, wrong binding or signature fail before HTTP.
The key proof hashes an independently derived `driveKey('pilot-signing-custody-v1')`; it is a non-secret commitment, not the signing key. A changed/missing key prevents execution and unsealing custody.

| Phase | Signed authority and limits |
|---|---|
| Bootstrap | Create at most1 private empty app folder under personal My Drive root; <=8Drive requests, <=2OAuth token calls; consent nonce <=5min and permit window <=15min. Normal path6Drive+1OAuth. No archive/catalogue upload authorized |
| Upload | Bind bootstrap permit digest + exact returned folder/ACL hash + reserved archive/catalogue IDs + exact signed object SHA/bytes, AAPL2fabricated bars, <=2file-create POSTs /24Drive requests /1MiB upload wire /2MiB download reservations /120s; signed window <=120s. No folder create, OAuth exchange/refresh, re-consent, sharing/deletion or source fetch |

Bootstrap allocates **two future binary file IDs** with `files.generateIds` after folder validation; this is a bounded Drive GET, not two new files. Catalogue can then contain the exact archive ID **before** Owner signs upload permit. `GoogleDriveArchives` supplies those IDs in the existing multipart metadata and rejects a different returned ID. Thus neither catalogue hash nor archive identity is a wildcard/late substitution.
Future total creates: folder1 + archive1 + catalogue1 =3objects across separately approved phases. File-ID allocation does not authorize uploading anything. Reservations include failed/uncertain requests and never reset on restart. USD0 requires real account/quota/storage/billing evidence; code is not a provider billing meter or a guarantee of free service.

## OAuth/folder path — not executed live

1. Prepare an empty private local journal directory (0700, real path, no symlink) and typed binding at the reviewed candidate. `PilotJournal.prepare()` never replaces an existing directory/journal; recovery only uses `open()`, which refuses missing or corrupt data.
2. Enroll the independently verified Owner public key and sign bootstrap proposal. `PilotOAuthBinding.beginConsent()` first verifies it. Pending PKCE state is bound to the permit digest and expiry. Future operator passes a consent factory to `bootstrapPilotFolder`; only after durable permit consumption does that factory call `receivePilotConsentLocally()`. This explicit helper binds a short-lived HTTP listener only on approved `127.0.0.1:<port>/api/market-prices-drive/callback`, checks host/state/redirect/method, receives one code, then closes. It never opens a browser or logs codes itself; no listener ran in this task. Choose a dedicated Web OAuth client with that exact registered loopback redirect. **Do not point it at the existing app callback**, whose legacy pending-state map is separate. No global Auth route/config changes or ChatGPT connector are used.
3. `bootstrapPilotFolder()` acquires the journal lease and atomically consumes the bootstrap permit **before** code exchange/Drive. The token response must explicitly report exact `drive.file`, Bearer, bounded expiry. Missing/wrong scope stops. Client-authenticated exchange uses exact approved client/redirect/PKCE; observed Drive `about.user.permissionId` must equal expected principal before folder creation.
4. Token is access-only and transient. A separate custody port stores AES-GCM sealed, binding-AAD-protected data; tokens/secrets/codes/state/verifier are not journaled or printed. No default live custody implementation or refresh-token source exists. Mock custody is private/disposable. Future live custody must be separately configured and kept durable until the short pilot finishes.
5. Bootstrap searches only root + exact pilot marker for prior folder; fresh bootstrap rejects any hit. Before its sole folder POST, journal commits `folderAttempted` and budget. Returned folder must be private/untrashed/owner-only, app-created marker+client hash, expected name/MIME, writable and empty. Pasted preexisting IDs, other app/owner/shared/nonempty folders are refused. `drive.file` does not grant arbitrary Folder ID access; Picker is not implemented.
6. Record owner/permission/folder evidence digest and reserved IDs; READY stops for **separate** Owner upload review/signature. `uploadPermitProposal()` reconstructs exact synthetic bytes and does not consume anything. No upload happens merely because READY exists.
7. `executePilotUpload()` validates signed payloads/binding/custody and remaining token lifetime, consumes upload permit, then uses existing `GoogleDriveArchives`, `DrivePriceCache` and MCP in-memory reader. A new cache is used after reopen/recovery; signatures/hash/SQLite/coverage/identity and AAPL2bars must match. Runtime/collector remain untouched.

## Durable semantics and crash handling

`PREPARED → BOOTSTRAP_APPROVED → READY → UPLOAD_STARTED → ARCHIVE_VERIFIED → CATALOGUE_VERIFIED → READBACK_VERIFIED → DONE`, or HOLD.
SQLite DELETE journal + synchronous FULL transactions protect state and unique consumed permit IDs/digests. After each transition/reservation, explicit file and directory fsync must succeed; failures stop dispatch. JSON payload checksum/schema detect corrupt/invalid journal state; no migration/reset/rebuild path is provided.
The lease is a transactional local PID/nonce record. A live PID prevents concurrent execution. Only **explicit recovery** may continue a consumed permit after a dead process; host kernel boot/PID namespace changes HOLD rather than assuming a foreign PID is dead. An unavailable host identity, uncertain PID, bad permissions/symlinks, missing journal/custody or changed signing key also HOLD.
Before each HTTP call, counters are committed; before POST, role is persisted as uncertain. On restart the original signed permit, window, counters and bytes must still match. Folder/ACL/principal are revalidated, and only journaled reserved child IDs are allowed. An uncertain role is queried by exact parent+pilot marker+role+signed hash, then exact ID/metadata/bytes/HMAC checked. Exactly1 match reuses the ID; zero/multiple/wrong ACL/HMAC/parent HOLD. A previously verified role is downloaded and verified again. No attempted role is reposted.
Crash before dispatch may conservatively HOLD when only PREPARED role evidence exists. Unknown folder creation similarly reconciles root+marker, never issues a second folder POST; missing/duplicate matches HOLD. Quota/time/byte reservations are not refunded. 401/403/404/429 stop without refresh, expanded scope, identity switch, quota increase, paid fallback or automatic retry.
Failed catalogue leaves archive intact as an orphan. Leftovers are retained/reported; no trash/delete/share API exists. Missing/corrupt journal must **not** be replaced to retry the permit. This protects against crashes in the trusted single-host environment, not malicious administrator DB rollback/copy or unapproved external writers. Persistent volume and custody ownership must be confirmed before live use.

## Offline commands and evidence

```sh
node scripts/market-prices.ts drive-pilot-gate-plan
node scripts/market-prices.ts drive-pilot-gate-dry-run
```

Both accept no arguments, no live flag/credentials. The internal `drive-pilot-gate-mock-worker` subprocess command accepts only dedicated marker-checked invented fixture directories and fixed mock modes; its fetch handler never forwards to a network. Do not use legacy `status`/`refresh`/`daily` or the Drive admin page to test this.
The dry-run makes three disposable worlds: normal, SIGKILL after fake archive success, SIGKILL after fake catalogue success. A different Node process opens the same journal/fixture server, restores sealed fixture custody and performs reconcile/readback with **one POST per data role**. CLI stdout is a JSON receipt; diagnostics stderr; all fixture credentials/DB/world directories are removed after the demonstration. Only sanitized metadata/MCP results are delivered.
Normal upload14requests; archive-crash recovery19; catalogue-crash recovery22, all within24 and2MiB reservation. Folder-crash recovery is additionally tested: total8Drive+1OAuth/one folder. Existing Task004 tests and full regression must still pass.
Private fixture keypairs exist solely in mock setup; no actual Owner key, live token, account, folder or authorization is generated. Prototype journal/world DBs and sealed fixture custody are excluded from evidence ZIP.

## Next human decision

No further general infrastructure is proposed. Coordinator reviews this exact offline candidate, then asks Owner for a dedicated account/client/approved redirect, independent key enrollment, isolated secret custody/persistent single-host directory and zero-cost evidence. Actual values remain UNSET until supplied/verified.
Then authorize a one-shot **Bootstrap only** task, using these internal primitives in an explicitly approved isolated invocation; no production login flow/runtime changes. Review its non-secret actual folder/ACL/reserved-ID receipt and the exact unsigned upload manifest, then request a second signed Upload permit. If real Google consent/metadata/quotas differ from the mock contract, STOP and report the concrete discrepancy. No claim of L3 LIVE PASS until actual independently authorized readback.

The scope semantics and small multipart/pre-generated-ID approach continue Task004's reviewed Google documentation; this task made **no new external documentation/API reads**. Existing Auth/callback source was audited read-only. No edits or extra scope request for global Auth were needed.
