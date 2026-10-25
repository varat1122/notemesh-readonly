# Railway Pro Volume Backups — Production readiness and non-disruptive recovery

**25 October 2026; status: NO-GO for any *new* Production Writer release.**  
This is a non-invasive workplan and offline evidence contract. It is **not** a provider backup receipt, encrypted backup, operational Restore instruction, permission grant, go-live approval or Obsidian device-sync evidence.

## Actual Railway targets (verified via authenticated Railway read-only connector)

| | Production (DO NOT RESTORE OR ALTER) | Isolated Staging |
| --- | --- | --- |
| Project | `wholesome-wholeness` / `88f3c614-6222-4ad3-b80f-a0890a3ef587` | `Investment-OS-DR-Staging` / `8ac4a414-9f0b-4a90-bcce-4995e5736d9d` |
| Environment | `production` | `staging` |
| Service | `NoteMesh` | `notemesh-pilot-001` |
| Volume | `notemesh-volume`, 1000 MB at `/data` | `notemesh-pilot-001-volume`, 1024 MB |
| Provider backup evidence | 2026-10-25 owner screenshot shows a **resize-associated** `Online resize to 1000MB` item marked 8 days old / 415 MB. Not proof of a fresh routine backup | Owner screenshot shows 3 manual items dated 2026-10-24 and 2026-10-25; not Production |
| Schedule | Owner selected Daily+Weekly+Monthly, then reported **Save successful** on 2026-10-25. The authenticated Railway connector cannot read schedule settings or backup inventory. Provider readback **NOT VERIFIED** | Screenshot previously read `No backup schedule` |

**Railway reference:** https://docs.railway.com/volumes/backups. Daily backups kept 6 days, Weekly 27 days, Monthly 89 days; incremental Copy-on-Write backup storage is **billed**. Pro plan purchase does not itself prove schedule activation, fresh snapshot, integrity or ability to recover. Do not make a USD 10 cumulative-billing claim from service CPU or volume size.

## G1 — production snapshot confirmation: evidence needed

- On the **correct Production project** and `NoteMesh → Backups`, capture schedule summary showing Daily+Weekly+Monthly *after* Save. This requires owner-operated Railway UI until the connector exposes provider backup controls.
- Capture the **first new scheduled** backup created after the save time, with date, size and status. A prior online-resize or manually triggered item is not the first new scheduled backup.
- Record retention, exact provider backup ID if available, applicable incremental cost and last snapshot recency. Only nonsecret metadata belongs in the PR.
- Do not press Restore or New Backup to manufacture evidence; do not change live production writer settings.

## G2 — restore evidence: **blocked on native snapshot limitation**

Railway's native Volume Restore is constrained to the **same project AND same environment** and stages a mount switch followed by redeployment. That means clicking Restore on Production **mutates Production**; it cannot create a disposable backup-clone in the isolated Staging project. A successful Backup listing is NOT a verified recovery, and a historical source file is NOT a recoverability test.

Before a non-disruptive recovery test, separately design and authorize **a new, empty, isolated, non-Production export/restore workflow** with an external encrypted export and separate data+key custody. Such a workflow must:
1. Capture or export a coherent source cut spanning the Vault, `app.sqlite` and its WAL/sidecars, relevant market-price SQLite, source archive, audit receipts and exact byte manifest. Avoid claiming atomicity from a moving volume; the app has multiple writer classes and Obsidian daemon/child processes. The current process-local DR writer fence cannot certify this on its own.
2. Recover only into a privately controlled empty non-Production target; explicitly whitelist service, volume, path and identity, with separate owner action and spending approval.
3. Verify file SHA-256, path/mode/link safety, SQLite `quick_check` and `integrity_check`, WAL and schema/data coherence, original source linkage, note content, index reconstitution, ownership/permissions, and a read-only Git origin/commit comparison.
4. Record captured_at, recovered_at, RPO/RTO, differences and operator acceptance. **Production Volume remains untouched**. Do not enable external sync, Git push, OAuth write access or paid inference from the restored target.

Offline encrypted synthetic restore tests already exist in `scripts/backup/nm-dr-drill.mjs`. They are **not** an independent Production restore. Historical Google Drive prototype folders are optional—not a required primary backup destination.

## G3 — security and rollout: read-only results and blockers

- Verified 25 October 2026 via authenticated Railway connector: Production Online 1/1, latest deployed SHA `b563c55f`, no undeployed patch, attached `/data` volume. Current production service source **configuration pinned SHA `a34b34c5`**, a different value than the deployed SHA. Do not merge/redeploy before reconciling intended release identity.
- Production **names** include `SAFE_EDIT_ENABLED`, `SAFE_EDIT_SINGLE_WRITER` but OAuth **redacts actual values**. Production audit logs confirm historical Safe Edit writes on 19 October, so never claim current Production writer is off merely because M4 Staging writer flags were set to 0.
- The main-branch Safe Edit engine has exact approval hashes and Linux atomic writes, but operational role grants, owner revocation, external audit retention, rollback and current secret-free configuration review remain unverified. Do not copy secrets into chat, public logs or this document.
- Current Performance log error-severity labels included `[slow] mcp search_vault` and `[lag] event loop blocked` on 25 October; these are latency signals, not independently established intrusion or backup failures. No sampled HTTP 5xx were observed in the inspected log window; sampling is not a full uptime audit.
- CI #430 passed on Draft PR #114 Staging SHA `7fafe260`, not a production release authorization. Current M4.6 real-news Staging note [commit `9b5e686f`](https://github.com/varat1122/investment-os-staging-test-vault/commit/9b5e686f35b6516c5309a135e8ca890c0c7828c0) is NOT Production Vault or Desktop/Android sync acceptance.
- Unverified Railway Billing/invoices and actual incremental-spend ceiling remain STOP conditions. Invoice, backup pricing, spend alerts, and any Pro-plan subscription effect must be distinguished.

## Offline fail-closed candidate checklist

Pure evaluator `src/server/backup/railway-production-readiness.ts` reads **reviewer-supplied references**; it does not call Railway, create backups, approve transactions, inspect secrets or certify evidence authenticity. It rejects owner-reported-only schedules, resize/manual snapshots, snapshots captured before configuration, wrong project, stale reviewed receipts, unknown writer flags, unverified isolated restore, budget and release identity.

Even if every field is marked reviewed, the only positive output is `READY_FOR_SEPARATE_OWNER_REVIEW`: **no automatic GO, Writer activation, Restore or Deploy is authorized**. Test cases are synthetic; production still **NO-GO** until all independently verified receipts and a **new, specific owner signoff** exist.

**Separate milestones:** M2 Obsidian Desktop/Mobile Sync remains unverified; Production DR readiness is not device sync evidence.
