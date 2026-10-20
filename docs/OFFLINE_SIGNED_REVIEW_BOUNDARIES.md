# PR #79 — Detached Signed Review Receipts (NO PROD)

This development branch adds ONLY read-only offline cryptographic consistency.
It does not grant an owner approval or allow Safe Edit execution.

## Context and trust boundaries

PR #76 reads one historical note in a segregated snapshot, #77 prepares an
unsaved candidate from supplied assertions, and #78 reconstructs internal
note/source-byte integrity from the actual isolated snapshot.

PR #79 adds Ed25519 receipt signature checks and an UNSAVED hash-chained
audit preview. This is NOT independently authenticated owner approval.

A malicious caller can make a new keypair and submit a self-selected policy
with two valid signatures. The verifier CANNOT tell if those keys belong to
the owner. Consequently, even when both signatures match the supplied policy,
all outputs enforce:

- trustedPolicyProvisionedIndependently=false
- reviewerIdentityAuthenticated=false
- ownerIdentityAuthenticated=false
- ownerApprovalGranted=false
- canAutoWrite=false and canAutoUpdateThesis=false
- auditLogPersisted=false and auditLogImmutable=false
- replayProtectionEnforced=false and keyRevocationChecked=false
- trustedClockAttested=false, claimIndependentlyVerified=false
- safeEditPreview=null and vaultModified=false

## Exact signed data

A subject digest is domain-separated and binds exact:
- note path, note SHA-256
- offline SQL notes+links fingerprint and physical Markdown manifest
- registered source URL key SHA-256, source blob SHA-256 and exact revision number
- selected review action / relationship
- SHA-256 of exact old/new candidate lines and rationale

The subject is recomputed from a FRESH PR #78 physical-byte verification.
The request does not provide arbitrary source SHA-256, indexed fingerprint,
original-source receipt, claim proof or owner identity.

Receipts use domain-separated Ed25519 signatures over exact ordered fields:
schema, role, keyId, subject hash, linked review receipt hash, issued/expiry
times, bounded unique nonce and decision. Reviewer/owner keys must differ.
An owner receipt must reference the exact signed reviewer receipt and follow
its issue time. Each receipt must be within its declared <=24h TTL,
unexpired relative to the local system clock and not future-dated beyond
five minutes. Time checking is NOT a trusted time authority.

## Audit preview

Two valid signatures produce an in-memory two-step audit hash chain with
a deterministic initial digest, predecessor pointers and receipt digests.
No journal is stored, anchored, append-only, or synchronized. Chain integrity
cannot establish completeness, nonrepudiation, independent key provisioning,
revocation status, prior nonce consumption or a durable audit record.

## Security before any real authorization

A separate owner-approved design is required for:
1. Independent enrollment of owner/reviewer Ed25519 public keys into a pinned
   trust registry OUTSIDE any caller-supplied payload or writable Vault.
2. Secure private-key custody (prefer separate device/HSM), identity proofing,
   key rotation/revocation, credential recovery, two-person controls and
   policy version anchoring.
3. Time-attested issuance and one-time nonce/replay journal with durable,
   append-only receipt storage, protected against rollback and forks.
4. Separately authenticated source and claim verification and owner approval
   explicitly bound to current note hash, source version, proposal intent,
   changes and the exact Safe Edit preview.
5. A separately reviewed Safe Edit permission service that checks all gates
   AGAIN at execution time. Never infer consent from a valid signature alone.

There is no signer/private key in Production code. Synthetic tests generate
ephemeral keys in the CI process only. There is no CLI/MCP/HTTP endpoint
and no changes to auth, deployment, Railway, Obsidian Sync, or Vault paths.

## Tests

Run:

pnpm test -- src/server/vault/offline-review-signature-gate.test.ts
pnpm test -- src/server/vault/offline-review-signature-bridge.test.ts

The tests cover correct configured-key cryptography without approval,
forged signatures, altered note/source/version/edit digest, protected paths,
expired/future signatures, key-role swaps, missing owner, stale source-byte
readback, live/Railway refusal, nonce collision and unpersisted audit chain.
They do not prove a real owner has approved any action.

**Never Merge, Deploy, touch Production Vault or run Safe Edit Apply from
this PR without a separate explicit user authorization.**
