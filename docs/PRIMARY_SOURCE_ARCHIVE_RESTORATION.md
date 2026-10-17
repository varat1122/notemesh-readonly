# Original-source archive importer — gated implementation

## Scope and storage

**All originals remain under the existing Obsidian Vault. No Google Drive.**
The CLI programs are operator-invoked and **not** HTTP endpoints, browser routes, or MCP write tools.

- `scripts/primary-source-importer.cjs`: creates a new content-addressed immutable original under `07_Sources/{Company Filings|Earnings|News|Research}/{ISSUER}/{YEAR}/{SHA256}.{ext}` and a separate receipt Markdown in the *same Vault folder*.
- `scripts/restore-original-archive.cjs`: restores a **genuine source file** to its **existing exact** historical link destination under `07_Sources/ChatGPT/Archive/`. This program is deliberately not allowed to create links by substituting unrelated derived notes.

Default mode is **dry-run**. Only `--commit` writes.
Files are never overwritten if their bytes differ. Existing identical files are safe/idempotent. Source SHA-256 is computed from the actual original bytes and read back. Generated Markdown is marked `not_reverified`: a checksum proves byte identity, **not factual accuracy or issuer authenticity**.

## 1. New primary-source archive

Prepare a separate UTF-8 JSON manifest **outside the Vault**, matching the actual file you obtained from the official issuer/filing source:

```json
{
  "issuer": "NVDA",
  "category": "Earnings",
  "period": "FY27Q2",
  "eventDate": "2026-08-26",
  "publishedAt": "2026-08-26",
  "retrievedAt": "2026-10-17T08:30:00+07:00",
  "originalUrl": "https://investor.example.com/earnings/report.pdf",
  "expectedSha256": null
}
```

**Note:** the URL above is a *placeholder*, never a verified source. Replace it with the exact publisher's original URL, and remove the `expectedSha256` property if you don't have an independent digest; `null` is not accepted as a claimed checksum.

```sh
node scripts/primary-source-importer.cjs \
  --vault /data/vault \
  --file /path/to/actual-original.pdf \
  --manifest /path/to/source-manifest.json
# Review the path, URL, checksum, issuer, and source period before committing.
node scripts/primary-source-importer.cjs \
  --vault /data/vault \
  --file /path/to/actual-original.pdf \
  --manifest /path/to/source-manifest.json \
  --commit
```

The sample commands must run only in a **controlled environment with the actual source bytes mounted** (and sufficient Obsidian headroom), not in an unauthenticated public terminal. Coordinate with Obsidian Sync: verify bidirectional health/idle state before writing and confirm uploaded files are present on a second device after indexing.

The current Safe Edit protected-folder restrictions are **not relaxed** by this code. Files cannot be ingested from this chat until the real bytes can be handed to an authorized operator/runner.

## 2. Recovery of the 56 Unresolved Wikilinks

As of the **2026-10-17** live source-reconciliation check:

| Missing target type | Unresolved references | Distinct original targets |
|---|---:|---:|
| Original JSON under `07_Sources/ChatGPT/Archive/` | 14 | 14 |
| Original ZIP | 10 | 1 |
| Original TXT | 30 | 19 |
| Historical derived Markdown Notes | 2 | 2 |
| **Total** | **56** | **36** |

Thus **54 references** are restoreable *only if* the 34 distinct genuine archive files are recovered. The ZIP is referenced ten times; restoring it once will resolve ten target references if all paths match. Two derived Markdown references require checking the original source conversation and either restoring a truthful original historical note or changing the very large index with reviewed source-preserving replacement. They are **not** targets of the ZIP/JSON/TXT importer.

Example (not a statement that the original file is locally available):

```sh
node scripts/restore-original-archive.cjs \
  --vault /data/vault \
  --file /path/to/verified/Feed-160726.json \
  --target '07_Sources/ChatGPT/Archive/Feed 160726.json'

# Only after confirming the original content, exact historical destination and SHA:
node scripts/restore-original-archive.cjs \
  --vault /data/vault \
  --file /path/to/verified/Feed-160726.json \
  --target '07_Sources/ChatGPT/Archive/Feed 160726.json' \
  --sha256 <independently-recorded-source-sha256> \
  --commit
```

The SHA option is optional if no independently recorded historical digest exists, but if omitted the result explicitly says **`file_bytes_only_no_historical_identity_proof`**. Do not promote that restore to archival authenticity until provenance is corroborated. **No source bytes are fabricated from a README, copied AI note, URL string or filename.**

## Verification after a controlled import

1. Check SHA-256 of raw files after write, and keep receipt/manifest outside the source archive when possible.
2. Let NoteMesh reindex the new attachment and Markdown receipt; check that only matching historical targets disappear from the unresolved list.
3. Verify Obsidian Sync's upload/readback, then independently verify on another Obsidian device.
4. Match issuer, fiscal reporting period and exact source locator to the Evidence/Claim Register.
5. Apply supported facts to an approved versioned Thesis only after event dedup and counter-evidence review.

## Security properties and limits

- The source importer and recovery script do not fetch arbitrary URLs or open incoming HTTP access.
- Source extensions/sizes, JSON/ZIP/PDF headers, SHA-256 when provided, path traversal and symlink guards apply.
- Missing original bytes cannot be restored merely from an unresolved Obsidian link. Deleting those links may reduce a metric artificially while destroying historical provenance; retain them until recovery or evidence-backed correction.
- `source_sha256` only attests to **stored bytes**; a fetched official issuer document still needs identity and factual verification.
- Test files: `src/server/primary-source-importer.test.ts` and `src/server/restore-original-archive.test.ts`.
- **Do not deploy or invoke `--commit` until CI and reviewed operational permissions pass**. The initial code is a reviewable GitHub branch, not a deployed authenticated source-upload service.
