# Investment OS — Safe Edit

This change extends the existing NoteMesh/Railway deployment. It does not replace
its vault, database, Sync configuration, research resource or add-only intake.
Safe Edit starts **disabled**. New OAuth consent and a production rollout review
are required before enabling it. Code/build tests do not prove ChatGPT Chat or
mobile end-to-end availability.

## Permission matrix

| Resource | Required bearer scopes | API keys | Existing-note edits | Delete/move |
|---|---|---|---|---|
| `/api/mcp` | Existing research access, normally `vault:read` | Existing read-only access retained | No | No |
| `/api/save-analysis` | `vault:read inbox:submit` | Refused | No; add-only intake | No |
| `/api/safe-edit` | **`vault:read vault:edit`**, fresh consent | Refused | Guarded Markdown operations | No |
| `/api/safe-edit-approval` | Signed-in administrator session + same-origin POST | Refused | Approves one hash; does not apply | No |

The old research metadata still advertises its pre-existing read/intake scopes;
this patch adds no edit scope to old protected-resource metadata. Tool handlers
still enforce actual verified access-token scopes. Registration eligibility is
not a grant. No consent/token rows are migrated or widened. Read/inbox refresh
grants cannot acquire edit permission. New Safe Edit JWTs must have the exact
Safe Edit resource audience; the legacy origin audience is not accepted there.
The existing provider refresh-scope patch is now also installed by postinstall,
so local development and CI use the same authorization behavior as Docker.

## Tools

| Tool | Inputs and behavior | Vault mutation |
|---|---|---|
| `preview_edit` | operationId, path, reason, one structured change, optional evidence review | None; records expiring preview in the journal |
| `append_section` | Exact unique heading, date, content; prepares dated evidence/review/log append | Preview only |
| `update_frontmatter` | Allowlisted properties; preserves other YAML keys and comments | Preview only |
| `create_note` | New path in an existing folder; title/content/claim duplicate checks | Preview only |
| `rollback_edit` | Original operation ID, same actor/path and unchanged after-hash | Preview only; never deletes created files |
| `apply_edit` | operationId, original previewToken, expectedHash | Applies exactly the stored after-content |
| `get_edit_status` | operationId belonging to the OAuth client | None |

Every prepared change is applied only through `apply_edit`. The tool's destructive
annotation enables the host's write confirmation. Every thesis edit, and every
edit to a note marked `user_endorsed: true` or `status: user_endorsed`, additionally
requires human approval of the exact diff on the signed-in approval page. A model
cannot supply an approval boolean or use its OAuth token to approve a thesis.
Read-only and Save Linked Notes remain usable beside the separate Safe Edit
connection for research and source retrieval.

A preview contains before/after SHA-256, the full changed line range, final-newline
flags, warnings, expiry, an opaque random token and an approval URL. Tokens are
bound to an operation and OAuth client and expire in 30 minutes. Only token
hashes are stored. A retry of a successfully written operation returns its old
receipt; it cannot append twice. Reusing an ID with a different payload/actor
fails. A lost preview token requires a new preview/operation ID.

## Integrity and threat boundaries

The pipeline is validate → preview → authorization → stop and await idle Sync →
version check → checksum backup/manifest → anchored atomic publish → readback →
reindex verification → durable receipt → restart Sync.

- Linux only, one Railway replica and one server vault writer. The administrator
  must verify those deployment properties before setting the acknowledgement
  flag. The flag is **not** an automatic Railway topology detector.
- The cloud Sync daemon must be running, idle and verified as bidirectional.
  Safe Edit waits for its child process to exit, blocks restart/manual Sync during
  the critical section, then restarts it. A timeout writes nothing. Cloud intake
  does not process work while Sync is stopped. Remote changes arriving after
  restart are still governed by Obsidian Sync; this is not a distributed lock
  across all devices. Edit the same thesis from one device at a time.
- A cross-process lock guards mutation. A crash-held lock is never automatically
  stolen. An interrupted operation blocks new previews of its target until
  administrator recovery.
- Paths are vault-relative Markdown, with traversal, control characters, symlinks,
  hardlinks, binaries, invalid UTF-8 and unsupported extensions refused. Existing
  parent folders are required. Files are capped at 100 KB. Publication anchors
  the parent directory descriptor through Linux `/proc/self/fd`, preventing an
  ancestor path swap from redirecting the write. `create_note` publishes with
  no-clobber link semantics; replacing an existing file uses atomic rename.
- Every backup and manifest is fsynced under `/data/safe-edit-backups`, outside
  the synced vault. The existing disk reserve guard applies to backup, temporary
  file and journal growth. The journal allows up to 1,000 operations / about
  20 MB of before/after text. Archival must preserve evidence and receipts before
  removing old records; no automatic history deletion is included.
- `07_Sources` and `06_Portfolio` cannot be mutated. Corrections must be saved as
  separate review/evidence. No generic delete, move, whole-vault or bulk tool is
  exposed. The API performs one note operation at a time.
- YAML is parsed as a bounded mapping with duplicate-key detection. Body edits
  cannot alter YAML. Frontmatter edits use a strict allowlist. Link additions and
  removals are reported. Table syntax has structural checks; warnings require
  review. Markdown content is never executed as instructions or HTML.
- Approval HTML escapes note data, forbids scripts and framing, requires an
  authenticated admin session and a same-origin POST, and caps its body at 2 KB.
  Vault-content fencing helps the host identify untrusted data; it is not a
  claim that all model prompt injections can be detected by keyword scanning.
- Audit events retain actor, required scope, reason, path, hashes, time and
  result. Access tokens, preview tokens and credential arguments are not logged.

## Evidence and thesis rules

Review metadata separates source type, verification, claim identity,
classification, true delta, independence, dates and related paths. Unknown dates
are null. Claim identity is entity + event/metric + reporting period + original
source, normalized independently of note title/import date.

Duplicate claims cannot mutate living knowledge. Repeated deltas for the same
claim in the same target note are refused. The same event can deliberately be
linked into Evidence Register, Change Log and Current Thesis without being
counted as three independent pieces of evidence. A known event cannot be
resubmitted to the same target as `new_event`. Confirmation requires asserted
independence and cannot use Archived AI as independent evidence. Primary
verification requires a primary URL, actual verification date and a primary
source review; the server validates these fields but cannot itself establish
that a model has read a source. The workflow must read sources before claiming
verification. Blind verification upgrades are refused.

For an existing Current Thesis, record the review first in the sibling Evidence
Register and Change Log. `append_section` includes the structured review and
`evidence-event-key` automatically in the selected section. Then preview Current
Thesis with both exact sibling paths in `evidence.relatedPaths`. Its event key
must already be present in both. Corrections/contradictions are appended so prior
claims remain visible. Previous Current Thesis bytes remain in checksum backups
and the durable operation journal; never rewrite the historical source archive.

Three-note updates are **ordered operations, not a multi-file transaction**.
If the last step fails, the register/log remain as the review trail and the
Current Thesis remains unchanged. Inspect receipts and resume with a fresh
preview. Do not pretend a partially completed update changed the thesis.

## Reconnect in ChatGPT

After deployment and feature enablement, add a **new** custom MCP connection:

- Name: `Investment OS — Safe Edit`
- URL: `https://notemesh-production-a893.up.railway.app/api/safe-edit`
- Authentication: OAuth, required scopes `vault:read vault:edit`
- Keep NoteMesh Read Only and Save Linked Notes installed unchanged.

Use a fresh registration/connection and approve its new consent screen. An old
read/inbox refresh token must fail to escalate; never repair that by editing
consent/token rows in SQLite. Discover exactly the seven tools above, then test
from the intended ChatGPT **Chat** surface, not merely Work, Inspector or an API.
If a surface or account does not expose the plugin, report that separately; server
code cannot unlock product-side availability or workspace restrictions.

Official references checked 2026-10-16:

- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools

See SAFE_EDIT_RUNBOOK.md for rollout/recovery and SAFE_EDIT_PROMPTS.md for daily use.
