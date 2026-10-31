# PR #135: Read Only OAuth scope fix and security release gate

The research MCP resource and its authentication challenge request only
`vault:read`. Save Analysis retains `vault:read inbox:submit`; Safe Edit retains
`vault:read vault:edit`. No writer flags or tool authorization checks are changed.

## Preserve the deployed application

Production was inspected read-only on 2026-10-30 at 11:23:14 UTC. Its running
deployment is `b8a2b39a-b737-4ae8-b5f2-a4cee6048e2d`, commit
`71cc4178607d717b403ffd143d3a01bff7c94758`. The original PR head
`00822a3ddd6c03c7f3527126f6487ed451d5ea2c` is behind that commit by 76 commits.
Do not deploy that original head. This branch incorporates the deployed commit
before applying the OAuth fix and the security changes below.

The Railway desired source pin was older than the actual running commit. Resolve
that difference explicitly in the eventual reviewed deployment diff; do not use
an unqualified redeploy or assume the desired pin identifies the running code.

## Security Audit

The original PR changes no dependency or workflow files; its failing audit is
inherited from the deployed baseline. The blocking audit command remains
`pnpm audit --prod --audit-level=high`, with the existing reviewed build-only
exceptions unchanged. No new exception, lower threshold, or CI bypass is added.

- Pin Better Auth and both auth plugins to 1.7.7 for the authentication advisories.
- Update follow-redirects, body-parser, and Vite within their existing major lines.
- Move Zod to the patched 4.6 line, adapting the two Yahoo record schemas to its
  explicit key-schema API. No market-price behavior is intentionally changed.
- Revalidate the existing refresh-token scope preservation patch against 1.7.7.
- Initialize the auth schema before the first RPC session lookup, retaining the
  existing anonymous-protected-RPC 401 regression test.

## HOLD: Production database compatibility

The live Production `account.issuer` column is `NOT NULL` with no default, and
`account_issuer_accountId_uidx` exists. Better Auth 1.7.7 no longer writes that
column. A dependency-only deploy can therefore break authentication.

This code **refuses authentication initialization on a legacy issuer schema**;
it does not drop the column, drop the index, or migrate live account data. A
healthy HTTP endpoint alone must not be treated as compatibility approval.
Synthetic tests cover both no-issuer admin sign-in and refusal without changing
the legacy column/index. They are not evidence of a restored Production backup.

Do not deploy this branch to the current Production database until all of the
following are evidenced in a release receipt:

1. A reviewed Production-only schema cleanup and rollback procedure, exercised
   against an isolated restored copy. Preserve account identities, password
   hashes, OAuth clients/consents/tokens, and all unrelated tables and indexes.
2. A fresh encrypted off-volume backup of SQLite including committed WAL data,
   the vault, and recoverable configuration. Quiesce/drain the existing app and
   Obsidian sync safely for a coherent set. A live copy of `app.sqlite` alone is
   insufficient. Record ciphertext SHA-256 and durable storage receipt without
   putting secrets or vault contents in GitHub, chat, or logs.
3. Isolated decrypt/restore/readback and SQLite integrity/schema checks, with a
   usable recovery key available through the owner's secure recovery channel.
   M4 evidence and synthetic fixtures do not satisfy this Production gate.
4. Successful CI, security audit, and compatibility/authentication checks for the
   exact candidate SHA. Recheck the live baseline before the maintenance window.
5. A full Railway staged diff containing only the approved source/configuration
   changes. Keep the existing volume, service, OAuth secrets, Safe Edit rights,
   and writer values unchanged; do not modify M4 or merge into main as a side effect.

## Controlled deployment and rollback (only after the HOLD is cleared)

- Record the exact approved candidate, current deployment and source settings,
  volume ID/mount, backup hash/storage receipt, restore result, and configuration
  comparison. Production writer values observed during inspection were `1/1`;
  this PR does not authorize enabling additional writers or changing rights.
- Drain sync/writes, take the fresh coherent backup, execute only the separately
  reviewed schema procedure, and deploy the exact approved SHA to the same volume.
- Verify actual runtime SHA, health, authentication, sync/locks, volume and flags.
  Check the three resource metadata documents and challenges independently.
- Perform a real ChatGPT Read Only reconnect and a read-only tool call. Metadata
  and synthetic OAuth tests alone do not establish reconnect success. Verify
  that Save Analysis and Safe Edit remain distinct grants and endpoints.
- If a gate or post-deploy check fails, hold further changes. Drain writers,
  restore the verified coherent database/vault/configuration backup together
  with the old application commit `71cc4178607d717b403ffd143d3a01bff7c94758`,
  validate integrity and authentication, then resume the prior sync state.
  An app-only rollback after a schema change is not sufficient evidence of recovery.

No Production backup, restore, schema cleanup, deployment, or real ChatGPT
reconnect is claimed by this document. Those require separate execution evidence.
