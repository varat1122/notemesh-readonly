# Google Drive price storage

Optional backend, inactive until configured. Default remains `disk`; deployment does not connect Google, widen grants, create Drive files, enable Safe Edit or migrate the vault. The existing disk reserve is unchanged; disk-mode leases cover the bounded maximum universe run. Base vault/index storage needs separate management.

## Data path

Drive stores immutable **closed, compressed SQLite snapshots**, never a mounted/live SQL file. Each listing has its own archive, with a versioned header, SHA-256 and server-key-derived HMAC. A separately signed catalogue commits the verified partition IDs/coverage for the active universe. The server verifies authentication before decompression/SQLite and opens query-only RAM readers. MCP can read the private catalogue and requested archived partitions on a cold cache; it never downloads source quotes, publishes Drive files or refreshes prices. Warm queries reuse RAM. Existing query/event calculations are reused, with no new production dependency.

Capacity: 200 research listings plus up to four explicit comparator ETFs (204 total). Uncompressed Drive DB cap: 4 MiB per listing, independent of the local-disk cap. Read cache holds at most eight partitions and 16 MiB of serialized SQLite payloads; native SQLite/query/buffer overhead adds process memory beyond that payload budget. Each analysis loads at most stock plus comparator; listing/status queries read catalogue metadata, not all 200 databases. Downloads, decompression and metadata responses are bounded; redirects are refused and origins fixed to Google. Archives contain price tables, quarantine and bounded receipts/corrections, never vault notes, auth/index data, holdings or credentials. They are signed, **not encrypted**; keep Drive permissions private.

## Consistency and limitations

- Requires `MARKET_PRICES_DRIVE_SINGLE_WRITER=1` after confirming one Railway replica/deployment and no CLI/other writer. This is an operational assertion, **not a distributed lock**. Do not scale to multiple writers. Exclude external collectors even when the attached volume prevents overlapping service instances.
- Serializes collection in-process. Completes all price transactions and releases the lease before serializing. Creates a new private file under an app-created `Investment OS - Market Prices` folder. Never overwrites, shares, patches or deletes old generations. Multiple matching dataset folders refuse operation.
- Downloads every new listing archive and catalogue and requires byte-for-byte equality plus signature validation. Publishes the new catalogue only after all completed batch partitions are verified, so a failed/incomplete batch cannot expose new uncommitted prices. Orphaned new files from a failed catalogue commit are retained privately, not selected for reads. Upload receipts alone do not count. Failures retain the previous verified cache with explicit lastError. On restart, loads only the latest signed catalogue by Drive creation time, then downloads listing partitions on demand. A corrupt newest catalogue refuses loading without silently reverting; bad partition identity/size/signature refuses that read.
- Existing source cooldown/receipts survive successful archive publication/restart. Google 401/403/429 waits an hour in-process; other failures ten minutes. Google-side backoff does not persist across restart: do not restart to evade it. Source cooldown is also retained in-process when Drive cannot publish the new failure receipt; it survives restart only after a verified catalogue commit. Failed archive uploads cannot persist new source-error receipts; operator logs expose the error.
- No automatic cleanup. Per-listing daily snapshots and batch catalogues accumulate; review size/count over time. This supports a personal 200-listing universe, not a whole-market lake or portfolio transaction database. The default remains eight connectivity pilot instruments until an explicit watchlist is supplied; synthetic 200-listing tests do not mean 200 real symbols were chosen or ingested.
- HMAC namespace and credentials depend on the existing ENCRYPTION_KEY. Do not rotate it during setup; existing vault secrets depend on it too.

## Connection

Detailed steps: [Computer Use handoff](GOOGLE_DRIVE_COMPUTER_USE_PROMPT.md).

Setup: `https://notemesh-production-a893.up.railway.app/api/market-prices-drive`

Exact Web application redirect URI: `https://notemesh-production-a893.up.railway.app/api/market-prices-drive/callback`

Dedicated Google OAuth client; scope only `https://www.googleapis.com/auth/drive.file`. No service-account key, broad Drive scope, public sharing or billing upgrade. External OAuth Testing mode issues a seven-day refresh token for Drive; long-running use needs an appropriate production publishing configuration under Google's requirements. A testing grant is not permanent.

Variables: MARKET_PRICES_DRIVE_CLIENT_ID, MARKET_PRICES_DRIVE_CLIENT_SECRET, MARKET_PRICES_DRIVE_CREDENTIAL. Existing authenticated administrator starts same-origin POST consent. Random five-minute single-use state and PKCE bind to that admin. Callback strips the OAuth code from the URL before displaying a ten-minute, single-view encrypted credential. Copy it directly into Railway's credential variable; never into chat/source/logs/screenshots. No OAuth state/credential is written to the volume. Restart before copying requires fresh consent.

After persistence and one-writer verification, set MARKET_PRICES_STORAGE=google-drive and MARKET_PRICES_DRIVE_SINGLE_WRITER=1; retain MARKET_PRICES_ENABLED=1. Redeploy, wait for terminal SUCCESS and verify collector upload/read-back. CLI `prices:status` reads catalogue metadata into RAM in Drive mode. CLI `prices:refresh` writes and must not run concurrently with production. MCP may hydrate only existing verified archived partitions; it never performs source refresh or writes. ChatGPT's Drive connection cannot supply this server's OAuth token.

## Acceptance and rollback

Verify administrator auth/CSRF, exact scope, encrypted credential persistence, live backend, first collector updated counts, catalogueId/verifiedAt, partition read-back and restart catalogue load, and authorized MCP list/read/status/event after catalogue refresh. Verify health, existing Read Only, existing Save Linked Notes receipt and server-side Obsidian Sync; device arrival is separate. No synthetic vault write belongs to this feature. Mocked tests do not establish real Google acceptance.

On failure set MARKET_PRICES_ENABLED=0 to stop optional price collection/tools while keeping notes. Preserve credentials/archives. Returning to disk mode does not resolve the known disk-reserve blocker. No deletion is needed.

References: [uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [token expiry](https://developers.google.com/identity/protocols/oauth2#expiration). Drive storage and API quotas/billing thresholds are separate; 2 TB storage is not unlimited API usage.

## Backfill and incremental collection

First successful pull for a listing targets five years. Later daily updates request a 30-calendar-day overlap before the last stored session, upserting new dates and comparing old overlapping prices. Full history beginning at the earliest stored session is rechecked weekly, or immediately when an overlap price/adjusted basis, new/changed dividend/split, quarantine or absent overlap suggests a rebase. A required full re-fetch must succeed before storing that new basis; throttling retains old data with a visible error. Very small adjustedClose-only jitter uses the existing 1e-6 relative policy. Missing provider rows are retained with older fetchedAt, never fabricated. Parser/snapshot limit is 10,000 daily bars, response cap remains 2 MiB and each listing database remains capped at 4 MiB. This is bounded storage, not an unlimited historical archive.

The Drive worker processes at most five due listings per tick by default (MARKET_PRICES_BATCH_SIZE accepts 1–10). It spaces provider requests, publishes a verified batch catalogue and reports universeSize/remainingDue. Initial coverage of 200 listings requires multiple cycles; complete means the selected due queue is drained, while batch_complete is partial progress. A provider 401/403/429 persists a global one-hour cooldown in the catalogue. There is no promise a free provider accepts the whole universe every day. Disk mode keeps its existing full-window fetch behavior.
