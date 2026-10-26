# P0 — Chat → Vault: Related Historical Source/Review Links (2026-10-26)

Status: **OPEN / NOT FIXED**. This is an engineering backlog, not an applied Vault edit or Investment Thesis update.

## Production evidence

- New Source: `00_Inbox/ChatGPT/Investment Intake - IN-32DA15B9A49C0B89.md`
- New Review: `10_Knowledge/Company Research/Investment Review - MU - IN-32DA15B9A49C0B89.md`
- Prior Source: `00_Inbox/ChatGPT/Investment Intake - IN-BEB9518EA4759BB9.md`
- Prior Review: `10_Knowledge/Company Research/Investment Review - MU - IN-BEB9518EA4759BB9.md`
- New Review says **added_detail / confirmation** of the older Source, but the old Intake ID is **plain prose**, not a resolved Obsidian Wikilink. Production `get_links(outgoing)` returned exactly four targets: its own Source, `01_Companies/MU.md`, `02_Industries_Themes/Memory.md`, `02_Industries_Themes/AI Infrastructure.md`. Neither prior Source nor prior Review is linked.
- The new Source and Review **were successfully written**: Source receipt `ICW-bd20c39d7176baee2f63202136f0a909`, SHA `322ec354ae021f9d3ed84c44042085d2584d7ee08c90c8f739b1e56c103513c9`; Review receipt `ICW-783045b327c0ef6f59805c9ff92492fc`, SHA `52ad505918744ce45cb86397662a104fc0ed7a3162714d28209f7338e8da3ab0`. Both `write/readback/reindex: verified`; Search Index returned two notes. Not a durability failure.
- Source verification is `not_reverified`; original attributed BofA report unavailable. Cross-device Sync remains unverified.

## Required engineering work

1. **Typed relation contract:** extend canonical M5.5/M5.6 plan input with validated prior `intakeId`, Source/Review paths, explicit relation type (`added_detail | confirmation | correction | contradiction | duplicate | unresolved`), comparison rationale and source/chronology provenance. Keep Source ID, Event Key and Review Version distinct.
2. **Read-only pre-write validation:** only existing, indexed, readback-verifiable prior Source/Review paths may be linked. Validate type, Intake ID, and original-source provenance. A similarity candidate is not a verified duplicate or an independent evidence vote. Fail closed/hold unresolved cases.
3. **Machine-readable graph:** render a `## Related historical records` section in a new nonprotected Canonical Review containing actual `[[00_Inbox/ChatGPT/Investment Intake - IN-BEB9518EA4759BB9]]` and, where appropriate, a resolved `[[10_Knowledge/Company Research/Investment Review - MU - IN-BEB9518EA4759BB9]]`. Clearly label the relation as analyst-reviewed, with vintage, verification limits and **no double-counting**. Preserve Company/Industry links.
4. **Repair existing MU Review:** propose an **add-only, Safe Edit CAS-previewed** correction to `IN-32DA15B9A49C0B89` only after separate review/authorization; never overwrite the original content or create another Source/Review. Require actual post-apply SHA, readback, FTS and `get_links(outgoing)`. This backlog **does not authorize** an immediate edit.
5. **Fresh Chat orchestration:** update the canonical save skill/caller to supply explicit relation metadata based on historical retrieval, not bare Intake IDs embedded in prose. Prevent duplicate application on retries.
6. **Regression and Acceptance:** fresh added-detail→prior Source/Review links resolved; exact duplicate→no new Review; same issuer/date but distinct claim→hold/no automatic link; multi-company primary routing unchanged; CAS/reindex/index and protected-record invariance tested.

## Acceptance checklist

- [ ] New MU Review explicitly links the prior Source and Review as appropriate, visible in NoteMesh outgoing links **after a verified authorized apply**.
- [ ] Repeated Source is not counted twice; no duplicate Canonical Review or fake independent confirmation.
- [ ] A fresh genuine Micro added-detail source is saved and graph-linked correctly without manual post-save repair, subject to evidence checks.
- [ ] No Current Thesis, Evidence Register, Company Evolution Timeline or Portfolio auto-write.
- [ ] Original Source bytes and existing historical notes preserved; Device Sync not claimed without device readback.

**Priority: P0 before resuming M5.7 PDF expansion.**
