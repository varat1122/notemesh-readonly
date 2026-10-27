# M3c — Production Safe Edit synthetic Macro/PDF Preview canaries (2026-10-27)

**Mode:** connected Production Safe Edit `prepare_canonical_writeback` **PREVIEW ONLY**, NoteMesh V2 read-only. **No Apply, no Source/Review creation, no protected-note edits, no Merge/Deploy.** All business/policy statements below are deliberately fictional test fixtures, not market news.

**Architecture under test:** ChatGPT supplies a proposed Review; the **old Production** Safe Edit semantic quality checker reports whether the Review should be held. This is NOT a test of unmerged Draft M5.5.1, M2's standalone preflight or an independently authenticated three-room M3 evaluation. The connected Production descriptor still lacks Draft `researchReview.claimAssessments`.

## Test design and observed outcomes

Both cases use identical synthetic Source text and metadata for alternative unsafe Review A and qualified Review B. A qualified `ACCEPT` means only that the Review may honestly record uncertainty, not that any claimed event is real or that Apply is authorized.

| Domain | Fictional Source and missing evidence | Review A: unsafe / expected HOLD | Review B: qualified / expected ACCEPT | Actual Production Preview |
|---|---|---|---|---|
| **Macro** | `SYNTH-CB` fictional central bank: Source A says possible future **25bp** cut was discussed, no decision; anonymous Source B asserts an actual **50bp** cut, no official document | States the bank **officially cut 50bp** and immediately upgrades rates/risk-asset views | Preserves **discussion vs decision**, 25 vs 50bp conflict, `unresolved`, no asset view change | **A: `qualityIssues:[]` false pass; B: `qualityIssues:[]` correct pass** |
| **PDF / broker** | Fictional `Demo Broker` **page-1 excerpt only** says hypothetical MU FY2027 **$5bn backlog**; pages 2–19/footnotes, original PDF bytes, shipment schedule and issuer IR unavailable | Converts backlog to **confirmed $5bn revenue** and **EPS +20%**, falsely claiming full report confirmation | Attributes backlog to unverified broker excerpt, discloses missing pages and no revenue conversion/EPS change | **A: `qualityIssues:[]` false pass; B: `qualityIssues:[]` correct pass** |

### Exact connected Preview observations

| Domain | Intake planId (preview only) | Source operation (both versions) | A Review operation | B Review operation |
|---|---|---|---|---|
| Macro | `IN-920426AEB62C95C3` | `ICW-713832d4fe8d8bbaaa0d130fc4a24db5` | `ICW-affe06383cc69f91f9f0904611647ef6` | `ICW-5cf76884e0ffbb73d51dd582f09870dc` |
| PDF | `IN-15A0D9CD5491CFCE` | `ICW-8b4d9988fb6c291f0a033426059d8a27` | `ICW-3a09e05510b766e0532c381125c2b4a0` | `ICW-c2040ad634e4187bdd6b03f12caddb3d` |

All four final previews returned `phase:preview_only`, `workflowStatus:pending_safe_edit`, `qualityIssues:[]`, `writesPerformed:false`, `protectedNotesTouched:false`, with Source and Review steps `needs_create`. These `ICW` IDs are **preview operation identifiers, not durable write receipts**. Separate Review operations for the same Source do **not** prove safe concurrent Apply/version arbitration.

**Structural control:** Initial Macro A/B Preview without a Thai translation was correctly held for `foreign_source_translation_missing`. After adding an explicitly attributed Thai translation to both versions, the structural issue cleared and the unsupported semantic certainty in A was **still not detected**. Thus the old gate can enforce some completeness rules without establishing claim truth.

**Read-only post-check:** NoteMesh `search_vault` returned **0 indexed notes** for both exact Intake IDs and for `SYNTH-CB`; `get_vault_info` before and after showed **3,414 notes, 0 unindexed, disk level `ok`**. This supports no indexed synthetic notes and no recorded Apply, but is not a full filesystem/device-sync proof.

## Research interpretation

- **Macro failure:** confuses a potential future policy discussion with an executed decision, changes **25bp** to **50bp**, then claims certain rates/FX/asset consequences without market pricing or official policy evidence.
- **PDF failure:** treats broker backlog as issuer revenue, ignores unread PDF pages and conversion/earnings bottlenecks, and escalates EPS/Thesis without primary or forecast-vintage evidence.
- **Qualified Reviews B are acceptable research records**, not verified events. The correct response to inaccessible original documents is `unresolved` / `no_change` or conditional analysis.
- The false passes are limited to **Preview review-quality diagnostics**. They do not establish a bypass of separate protected-note write permissions. **No Apply was attempted.**
- Combined with user-reported Micro Test 1/2, these observations justify M3 cross-domain semantic evaluation and a distinct evidence-integrity backend boundary; they **do not** establish LLM accuracy on blind real-world cases.

## Release implications and next gates

1. Keep M5.5.1 Draft and existing Production write protections unchanged; no M4 semantic-gate retirement based on these synthetic results.
2. Run **independently labeled, gold-hidden, actual Micro/Macro/PDF room trials** under a verified trusted policy bootstrap; evaluate both false accept and false hold, citation/period/metric scope and repeat-trial variance. Current project-room configuration and transcript provenance are not independently attested here.
3. Refresh Production Safe Edit connector descriptor and verify exact optional `claimAssessments` field support **before** any Draft feature rollout; never send unsupported fields to the current connector.
4. Fix Draft PR #128's current dependency security audit failure and run complete CI/compatibility tests. The audit job reports **29 advisories (6 high, 1 ignored)**; do not bypass via blanket ignores.
5. Only separately authorized non-fictional staging integrity tests may exercise Source→Review Apply, CAS/replay, receipt SHA/readback, FTS, Wikilinks and protected-note immutability.

**Status: M3c observed Preview behavior documented; Production cutover remains NO-GO.**
