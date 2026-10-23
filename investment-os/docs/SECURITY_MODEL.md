# Security, authorization and threat model

## Scope and trust

P0 is a single-operator synthetic development system, not a multi-tenant or internet-facing product. Assets: original bytes, identity/provenance, interpretation history, protected thesis/evidence, portfolio privacy, secrets, audit/receipts and compute budget. Trusted operators administer the host and migrations; retrieved sources, AI output, clients and provider responses are untrusted. A local authenticated user can still be wrong: verification status is not proof of claim truth.

Two layers must agree before a future write: authenticated actor/resource/action authority, then concrete content/versions/approval. The LLM has neither a direct DB connection nor a generic shell/filesystem writer. P0 exposes no mutating business route and no provider implementation. Dummy auth is explicitly enabled, rejects unknown tokens and rejects a production environment setting. All dummy tokens/passwords are public fixtures, not security suitable for real data.

## Permission matrix

`Read` below means entitled, scoped content only. `Propose` never means approve or execute. Future grants require real authentication, resource scope, expiry and revocation. P0 protected actions are disabled for every role, including dummy owner.

| Role | Read | Draft research | Evidence classification | Current Thesis | Portfolio | Risk | Trade execution |
|---|---|---|---|---|---|---|---|
| reader | entitled | deny | deny | read only | separately entitled read | read | deny |
| researcher / AI | entitled context | propose, scoped user action | propose only | propose delta only | no transactions | submit for review | deny |
| curator | entitled | propose | review within grant; human | no direct approval | deny | evidence input | deny |
| portfolio_analyst | separately entitled | recommendations | deny | read | proposal/reconciliation draft | submit | deny |
| risk_reviewer | entitled + portfolio grant | critique | evidence input | no mutation | recommend limits | approve/reject independently | deny |
| owner_admin | scoped | authorize concrete draft | approve scoped evidence | approve exact revision | approve scoped import/repair | configure signed limits | outside P0–P8 scope |
| service_worker | job-specific | approved action only | no self approval | deny by default | deny by default | no self approval | deny |

P0 policy evaluator implements only READ of Notes/Drafts Markdown and DRAFT capability for researcher/owner under Drafts. It does not execute or grant approval. Actual DB API credentials are SELECT-only. P1 must implement principal authentication before persisting real permissions; the `permission_grants` table is a foundation, not a working authorization issuer.

## Threat register

| Threat / entry point | Control now | Later requirement / residual risk |
|---|---|---|
| Forged role/approval in client or source | Server-owned dummy principal map; no roles in request DTO; protected actions denied | Real OIDC/OAuth issuer/audience/expiry/revocation, actor-bound approvals |
| Prompt injection in PDF/Markdown | Content marked untrusted; text cannot call writer; no model runtime | Separate system/tool inputs, citation review, egress allowlist, adversarial evaluation; markers alone are not a security boundary |
| Traversal/symlink race | Scope prefix, no absolute/dot/backslash path; dir_fd/O_NOFOLLOW each read component | Secure configured root ownership, write-side same protections, lock/journal |
| Secret/portfolio leak in logs | Never request body/query/token; sanitized validation/readiness error | Structured redaction at all adapters; classified-download entitlements and retention |
| Database write escalation | API SELECT role, migration role separated | Runtime DML roles scoped per module/tenant; RLS if multi-user |
| False committed receipt | SQL + schema require physical/index/links checks | Actual P2 readback verifier must supply independently observed evidence |
| Duplicate/retried/stale mutation | Actor/key unique constraint, digest, version-CAS tests | Durable repository/outbox, same-key-different-hash rejection, replay receipts, bounded retries |
| Tampered audit/history | Append-only DB triggers for versions/audit/receipts | External append-only backups; schema owner can bypass triggers; do not claim tamper-proof against admin |
| Poisoned/oversized upload or spreadsheet formulas | No ingestion endpoint; local text size/NUL checks | Quarantine, allowlist magic bytes, parser limits, archive bombs/malware, no macros or external links |
| SSRF/source URL | P0 performs no source URL fetch | P1 deny private/metadata addresses, redirects revalidate, DNS pin/recheck, HTTPS/domain allowlist |
| License breach/model export | License/permitted uses travel with provenance; no provider calls | Inherited most-restrictive entitlements across derivatives, no redistribution default |
| Look-ahead/fake quant | as-of constraints, not_computed default, deterministic Parquet test | Point-in-time snapshots, corporate actions, costs/slippage, leakage & reproducibility tests |
| API resource exhaustion | Loopback-only, no paid execution; DTO bounded text | Body/time/rate limits before remote exposure; quotas/worker cancellation |
| Partial filesystem/DB write | No writer yet | Journal, before-images, partial receipt, reconcile without blind retry |
| Backup inconsistency/loss | Local DB dump/restore drill | Coordinated PG/Vault/object/Parquet checkpoint, encrypted backup and restore exercise |
| Container/egress compromise | Non-root API, read-only filesystem, cap_drop, project-specific bridge network | Harden host, real TLS, vulnerability response, key management and approved deployment |

## Classification and licenses

Classes: public, licensed_vendor, internal_research, confidential_portfolio, personal_sensitive, secret. Public does not imply model-input/redistribution permission. License metadata follows Source, dataset and derived review. Bloomberg exports require entitlement review; no licensed market data is in this repository. Unknown rights → quarantine or local restricted review, never automatic upload to a model. Production encryption-at-rest/in-transit is a release gate, not claimed by a local dummy PostgreSQL password.

Portfolio data must remain confidential, and account scope is distinct from investment mandate. Future derivatives take the most restrictive applicable classification/rights. Secrets must be supplied through scoped runtime secret mechanisms, never notes, prompts, logs, payload fixtures or Git. P0 does not read existing OpenAI, GitHub or production app credentials from application code.

## Approval and audit design

Approval records bind actor, resource IDs, action, exact source/target revisions, payload hash, expiry, revocation and independent reviewer where required. A generic “approved=true” from a client cannot satisfy it. Protected thesis, Evidence Register status, portfolio transactions, ACLs and release flags require owner-controlled authority; models may draft only. Identity approver must differ from AI origin and risk approval must be independently attributable.

P0 structured HTTP logs are operational request traces, not durable business audit. Business changes in P1+ must journal audit in the same transaction (or fail closed); filesystem steps use durable receipts and repair states. Never claim business mutation success if audit/readback fails. No live key rotation, ACL change or production deployment occurs here.

## Before real-data or internet use

Separate owner approval is required for auth provider, hosting spend, model provider/data export, Drive scope, real Vault enrollment, data licensing, retention/RPO/RTO, risk limits and portfolio account access. See ADR 009. P0 evidence can support design review; it cannot waive these gates.

## P1 synthetic capture implementation overlay

The synthetic registry and local capture library now write unverified fixture data through explicit dummy principals; the HTTP API remains SELECT-only. ADRs 011–012 define the implemented boundaries. Capture uses a separately marked owner-only root, no-follow directory descriptors, immutable files/checksummed checkpoints, byte readback and fail-closed partial recovery. Bounded static PDF/CSV/XLSX inspection runs in a child with no inherited credentials. These controls do not implement real identity/grants, antivirus, tenant isolation, retention quotas or a network sandbox. No captured fixture is promoted to verified Evidence Register status. The local root and dummy database owner remain trusted.

The P1 extractor now emits bounded untrusted excerpts and immutable derived checkpoints with producer/time metadata. Citation readback reparses original bytes under the pinned parser profile; it cannot grant factual verification or write protected records. Readers can verify without writes; only dummy researcher/owner principals can create derivatives. Parser/input/output limits, corruption detection and semantic limitations are documented in ADR 013.
