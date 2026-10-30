# Original-source byte integrity and Obsidian device Sync — P0 acceptance gates

## Purpose

Investment OS uses one canonical Company/Industry/Timeline knowledge graph. Source archival and device Sync are **two separate verification layers**, not synonyms for a successful Safe Edit write or Railway deployment.

### Original file → immutable hash-checked source archive

1. Retrieve the *actual* authorized public issuer/SEC source from a pre-approved HTTPS hostname. The registered `archive_original_source` MCP tool requires **vault:read + vault:edit OAuth**, a configured `SOURCE_ARCHIVE_USER_AGENT` identifying a real organization/contact, exact allowlisted hostname and a document no larger than 8 MiB. Never use an invented email or override a block/redirect.
2. The server fetches **bytes** with manual redirect refusal, content-type and byte-count limits. It hashes the complete HTTP response bytes with SHA-256, stores an immutable snapshot outside the Obsidian Vault under `/data/source-archive`, reopens and validates the blob and returns a content-addressed receipt.
3. Use **`inspect_original_source_archive`** on the same original URL to read version history and rehash the stored blobs independently. `intact_stored_bytes` means byte-integrity on this server; it does **not** prove the issuer signed the document or that a claim was transcribed correctly.
4. Link the receipt (original URL, capturedAt, SHA-256, size, response headers/source date, evidence review) to an existing canonical Primary Evidence Note and Company Timeline **after** source-vintage deduplication and authorized Safe Edit. Do not promote archived AI to independently sourced fact. Keep separate event/publish/capture/verify dates.
5. The content-addressed archive is **outside the Obsidian Vault**. Its bytes **do not** reach desktop/mobile through Obsidian Sync. They require an independently tested off-server archive backup/restore workflow. A Markdown locator alone is not archival.

### Safely report missing historical source packages

- The Source Recovery Register tracks 54 indexed unresolved references to **34 distinct source paths** (14 JSON, 10 ZIP, 30 TXT references). All 34 distinct paths were individually checked by NoteMesh `read_attachment` on 2026-10-19 and were missing on the **server Vault only**. This does not establish that the original bytes are missing from the user's desktop, phone, alternate cloud account or legacy export.
- Do **not** generate reconstructed JSON/ZIP/TXT from ChatGPT analysis and label it original. A Drive folder appearing empty does not prove no local device copy exists.
- Keep the original referencing Markdown unchanged until exact source bytes can be inspected and verified. Once recovered, store actual bytes with hash/version and update the relevant source provenance record before altering any link.

### Server Sync → remote → desktop → mobile: independent gates

| Gate | Evidence required | Meaning |
|---|---|---|
| 1. Server write | Safe Edit `written`, verified readback/hash, reindex | Server Vault file exists and is indexed |
| 2. Supervisor running | `get_sync_delivery_evidence` or `get_vault_info.sync.state` = running | Sync daemon active; does not prove a particular file uploaded |
| 3. Server upload observed | Sync activity count/log upload for a dated session | Some files uploaded in that daemon session; not per-note delivery |
| 4. Remote specific revision | Provider-side revision/hash listing or remote file readback for exact path and version | The exact note reached the remote (not implemented yet) |
| 5. Desktop delivery | Independent target-device Obsidian readback of exact note/version and documented evidence | Desktop copy confirmed |
| 6. Mobile delivery | Independent target-device Obsidian readback of exact note/version and documented evidence | Mobile copy confirmed |

Only Gate 1 has a durable Safe Edit receipt today. The new `get_sync_delivery_evidence` tool reports aggregate supervisor state/upload and explicitly reports other gates as **not_verified**. It does not issue a sync or change credentials. Never convert a successful server upload to `mobileSyncVerified:true` or `remoteSyncVerified:true`.

**Device proof procedure (user-assisted, not fabricated):** Choose a recent already-written non-sensitive company Timeline, record its exact SHA-256/unique event ID, independently open the note in Obsidian Desktop and Obsidian Mobile while online, confirm exact event ID is visible and note the checked date/device, and report back. Device screen evidence or deliberate device-authored acknowledgement may support user attestation, but it is not cryptographic remote-version proof. Do not create extra canaries unless needed or claim to view the user's device without access.

### Rollout safety

- Keep protected Current Thesis, Portfolio and original 07_Sources locked except through their separate authorized workflows.
- Ship code under reviewed PR and green CI, check API OAuth read/write scope, then verify a fresh source archive receipt through the connected MCP action; test repeat capture idempotency and byte rehash.
- If the ChatGPT plugin only advertises seven Safe Edit actions but the server registers more, **plugin connection/tool-schema refresh is required** before the assistant can call missing actions. Server implementation alone is NOT proof of client availability.
- Never claim archive completed until the receipt includes the actual hash and `intact_stored_bytes`. Never claim mobile/desktop synced until device-specific evidence is obtained.


### No-refresh operational inspection (2026-10-19)

The existing read-only `get_vault_info` tool now includes `sourceArchive` with snapshot/source counts, declared stored byte count, and a **bounded SHA-256 byte re-read** of at most 16 recent stored snapshot blobs and 64 MiB. `checked_intact` means those particular stored bytes matched their hashes; `partial_scan` marks records left unchecked and `empty_no_originals` is NOT a healthy full archive. Even fully intact local blobs do **not** prove original publisher authenticity, source revisions captured, or off-server backup. Fields `offServerBackupVerified:false` and `remoteObsidianSyncVerified:false` are deliberately conservative until independently confirmed. This status tool is read-only and should not be used as an excuse to skip the user-authorized `archive_original_source` action and its full per-document inspection receipt.
