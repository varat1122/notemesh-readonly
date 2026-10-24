# Live Research Intelligence MVP — 23 Oct 2026

**24 Oct update:** see [Pilot #001](pilots/live-writeback-001/README_TH.md).
Owner has since confirmed real ChatGPT Read Only success. Local Zod v3 has now
been replaced compatibly with SDK-supported 4.6.6; current audit passes the
existing policy and 385 focused regression tests pass. The v3 finding and peer
description in this 23 Oct snapshot are historical, not current blockers.
CI, original-source access, deployed version, frontend Safe Edit and actual Test
Vault isolation remain unverified/blocked. No live write or deployment occurred.

The user-facing delivery is the [installable ChatGPT Project instruction package](../integrations/investment-os-safe-edit/USER_ACCEPTANCE_TH.md),
not a new service. Normal investment news starts research under those
instructions; explicit fallback: **วิเคราะห์ข่าวนี้ด้วย Investment OS**.
Actual ChatGPT tool use must still be observed. No paid inference is required.

## Implementation decision

The existing implementation already supports Source capture, bounded historical
retrieval, claim/event candidates, source-hash preparation, authorized Analysis
+ existing Company Evolution write, independent physical/index/link readback and
next-event historical AI retrieval. Reuse it; do not start another backend or
import the adjacent greenfield database branches for this MVP.

The proven gap was the installable research analyst contract: the earlier
Project prompt did not cover all five specialist frameworks, structured review
fields, attachment limits, actual tool conditions and a frontend acceptance
procedure together. The smallest change is four Project support files, links
from existing prompts, and the existing end-to-end test consuming the delivered
Markdown template. Completion is measured by that exact template surviving
Source A → authorized graph write → physical/FTS/link readback → fresh process
read → Source B recalls A. This is not a new schema or analysis engine.

| Delivery | Install/use |
| --- | --- |
| [Master Analyst Instructions](../integrations/investment-os-safe-edit/PROJECT_INSTRUCTIONS_TH.md) | Copy the whole file into ChatGPT **Project Instructions**, once. One ChatGPT model; Fundamental, Industry, Macro, Market and Thesis frameworks. |
| [Tool orchestration](../integrations/investment-os-safe-edit/RESEARCH_WORKFLOW.md) | Attach as Project file. Actual arguments, conditions, authorization and reconciliation; source preservation is separate from AI analysis. |
| [Investment Review Markdown](../integrations/investment-os-safe-edit/INVESTMENT_REVIEW_TEMPLATE.md) | Attach as Project file. Existing `investment_review` frontmatter, Source version, evidence table, historical comparison, mechanisms, risks, relationship proposals and proposed actions. No new JSON schema. |
| [User acceptance / installation](../integrations/investment-os-safe-edit/USER_ACCEPTANCE_TH.md) | Read once; actual discovery, news A, concrete approval, independent readback, duplicate and news B. No long repeated prompt. |

## Existing assets used

Read Only `investment_context_pack`, `review_investment_claim`,
`plan_investment_writeback`, `search_vault` and `read_note`; Safe Edit Source
`create_note` preview → `apply_edit`; `investment-review-preparation`;
`investment-graph-bundle`; existing Safe Edit engine, CAS, backups, journal and
Sync guard; `knowledge-graph-readback`; source archive/attachment inspection;
SQLite/FTS and canonical link resolver. ChatGPT supplies semantic reasoning.
The existing controlled transport seam supplies only offline test fixtures.
No provider endpoint, credential or evaluation-budget adapter was changed.

The graph write remains company-scoped. Macro/Industry research instructions
are usable for reasoning/retrieval, but those domains do not acquire a new graph
writer. Missing Company/Timeline anchors, unknown identity/period and same-event
corrections hold graph persistence. Drafts can still be delivered honestly.
Relationship proposals persist as attributed Markdown; a resolved Wikilink does
not prove a commercial relationship or promote an economic edge.

## Workspace and continuity

Base: `0a503698bd257c362454fe90a8278d33dd47e937` on existing branch
`feat/real-event-context-to-writeback-handoff-20261021`.
Fresh Git remote read confirmed PR #108 head and its existing branch both at
`dd89be9c00bfc248c5d103c9eea327535febc372`; main remains
`b563c55fd99c5fb2738fda0682f7b6f76a0ef42a`.
The [prior stack inventory](validation/consolidation-acceptance.json) verifies
#84–#108 in sequence and main as an ancestor of the reconciled candidate.
No new PR, workspace, reset, force push, merge or deployment was performed.
GitHub GraphQL returned `Forbidden`, so current Draft/state/base/CI are not
confirmed from Git refs alone. Changes remain local pending release review.

Blueprint v1.0 was read from the preserved P0 branch's
`investment-os/docs/MASTER_BLUEPRINT.md`, particularly Sections 07, 09 and 13;
SHA-256 `e2abf6a2c31d997b1e05f0b31b529c2707cf0ddce461f4483049f14936e53130`.
The old uploaded temporary attachment path is unavailable; this is the same
recovered document recorded in the consolidation audit. P0 owner schema
ratification is still pending, independently of local technical acceptance.

## Validation and its limits

The existing 111-test core selection was inspected, not inferred from main.
The existing MCP integration case now fills the delivered review template and
passes it through the real preparation, writer and readback. Its global fetch
spy forbids external calls; protected Thesis/Register hashes remain unchanged.
It reopens persisted files and readonly SQLite/FTS in a separate OS process,
then Source B recalls A as `analysis` / `archived_ai` / non-independent.
Sync daemon control and OAuth access are controlled test contexts, not a live
Obsidian service or real ChatGPT consent. Semantic investment quality needs
human review of actual ChatGPT output.

Relevant existing tests cover the failure gates without adding another suite:

| Scenario | Existing evidence and boundary |
| --- | --- |
| Duplicate / repeat news | MCP bundle, engine and intake routing: no second Source/Analysis/Timeline; preparation hold or receipt-bound replay. |
| Corrected source | Archive revision retention; claim conflict candidate; changed Source/hash/index refuses old write/readback. Automatic same-event correction writing is intentionally unsupported. |
| Missing primary | Context reports missing roles; archive reports empty; claim review refuses missing identity; unverified drafts cannot promote themselves to primary. No issuer authentication is claimed. |
| Conflicting evidence | Exact metric/period/unit conflicts are triaged for review, not declared economic truth; counter-evidence passage is retrieved. |
| Unverified supplier/customer | Intake rejects incidental co-mentions/inferred issuer guidance; analyst instructions require exposure evidence. Model judgment is not proven by these deterministic guards. |
| Prompt injection | Boundary fencing and engine tests keep vault text as data and preserve privileges. Actual ChatGPT resistance still requires frontend observation. |
| Unauthorized / protected write | Scope/audience/writer/DR gates, actor/token/CAS, protected approval and provenance refusal; no live consent asserted. |
| Stale source hash/index | Preparation, graph write and independent readback refuse changed or unbound Source versions. |
| Partial writeback | Real injected second-note rename failure leaves a verified Analysis + interrupted Timeline and requires manual reconciliation; only never-started Timeline recovery is separately authorized. |
| Retrieval after restart | Fresh process reads physical hashes/FTS/reciprocal links; subsequent source context retrieves saved AI distinctly from declared primary fixture. Not a real Sync restart test. |

Final acceptance: **234/234 tests in 19 files, zero failed/skipped/pending**.
This includes the delivered template through the existing MCP end-to-end case
and relevant OAuth, protected-write and Sync regressions after dependency patches.
Lint/typecheck and build passed; prerender and client/runtime exclusion guards
passed. Frozen install passed supply-chain verification. No new test case or
runtime analysis engine was added; one existing fixture now consumes the actual
user-facing template. Full GitHub release CI, browser E2E and Docker remain separate.

Final machine-readable counts, check results and source/dependency hashes are in
[research-mvp-acceptance.json](validation/research-mvp-acceptance.json).
Detailed command/log/JSON evidence is retained outside Git under
`/workspace/.investment-os-foundation/research-mvp/`. The initial template run
correctly rejected an unfilled `SOURCE_SHA256` placeholder; the test substitution
matcher was fixed to include digits. Failed evidence was retained, not relabeled
as passing. No production engine rule was relaxed.

## Security changes and remaining release gates

Current audit exposed a new High compressed-body trailing-byte DoS in
`body-parser` 2.3.0 (GHSA-27r3-jxmh-p828) through the MCP SDK's Express dependency.
The existing override mechanism now pins that v2 path to **2.4.0**. Its required
`content-type` 2.1.0 is a transitive patch dependency, not a new application stack.
Zod's already-v4 paths are locked to **4.6.6**, clearing their collection DoS
finding. The final lock retains original SDK peer ranges and the root Zod v3
contract; a broad trial Zod override that narrowed those ranges was removed.
Frozen install and supply-chain verification remain enabled; no audit exemption
was added. Existing Vite overrides were normalized in lock metadata, not upgraded.

**Release remains BLOCKED:**

- `pnpm audit --prod --audit-level=high` still fails for **Zod 3.25.76**,
  GHSA-mrhx-c7xc-m3w5. Registry has no patched v3 release; advisory patch is
  >=4.6.6. A v3→v4 compatibility migration or reviewed upstream backport is
  separate substantive work; do not hide the finding or force a major override.
  Current audit reports 2 High, 14 Moderate, 0 Critical; body-parser and the old
  v4 instance no longer appear as High findings.
- Pre-existing peer mismatches remain: better-call requests Zod ^4 while one
  context resolves v3; better-auth requests better-sqlite3 ^12 while this project
  uses v13. They are reported, not suppressed. No new SDK peer restriction remains.
- GitHub CI for the actual release HEAD cannot be inspected from this environment
  (`Forbidden`). Owner/reviewer must inspect required jobs on the final candidate;
  local focused checks are not full release CI, browser E2E or Docker acceptance.
- This Codex session has no live NoteMesh connector, ChatGPT frontend or App action
  management tool. The candidate defines 15 Safe Edit tools; installed App
  registration, deployed SHA, OAuth resource/scopes, host confirmations and
  actual frontend invocation must be independently observed. Preserve the
  existing Web-capable App and refresh actions only after an approved release.
- Before live write: approve exact public Source, separate Test Vault, permissions
  and concrete Source/Analysis/Timeline scope; verify actual Sync single-writer,
  protected paths, backup/recovery and deployment. Package `mcp.json` still points
  to existing production; it is not an approved Test Vault connection.

## Acceptance levels and owner action

| Level | State |
| --- | --- |
| Synthetic Integration | PASS only for the final recorded existing-component test selection, including delivered Markdown and failure gates. No live model semantics claimed. |
| Master Analyst Instructions / human review template | Ready to copy into Project; instructions do not guarantee automatic frontend invocation. Use the explicit trigger if needed. |
| Live ChatGPT Integration | BLOCKED / not observed; actual user must send news and the frontend invoke real connected tools whose evidence informs analysis. |
| Test Vault Writeback | BLOCKED / not performed; synthetic temporary files are not user-authorized real Test Vault acceptance. |
| Production | NOT READY; security, CI, live consent/integration, backup/recovery and applicable operational approvals remain. |

Immediate user action: install the three Project files as explained above, then
send one news item with **“วิเคราะห์ข่าวนี้ด้วย Investment OS ยังไม่บันทึก”**.
Use actual approved Read Only tools if present; absent tools must be reported.
After security/release gates and scope approval, follow the same user acceptance
procedure for one public-source Test Vault pilot. No Quant, Trading, Portfolio,
dashboard or autonomous processing was added.

Campaign `investment-os-openai-evaluation-new-17e04411`, its ledger/identity and
reservations remain untouched. Ledger integrity is checked read-only against
the preflight hashes. No paid API call, new campaign, credential/environment
publication, live Vault write or P0 schema approval occurred.
