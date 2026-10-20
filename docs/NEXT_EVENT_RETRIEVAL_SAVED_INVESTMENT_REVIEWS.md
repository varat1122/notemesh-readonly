# PR #105 — Saved Analysis Returns on the Next Real Historical Retrieval

## Product North Star and fixed failure

The non-negotiable goal is **AI analysis → exact Obsidian Markdown links → authorized Safe Writeback → persisted readback → retrieved and interpreted correctly on the NEXT event**.

PRs #99–104 proved individual stages, but the **production `buildInvestmentContextPack`** had a selection defect: the new `08_Daily_Weekly/Research Indexes/Investment Review - ...` files were classified as generic `research` and explicitly rejected in issuer-focused research because they were not in `10_Knowledge/Company Research/`. Even an accurately written, linked Analysis Note could therefore be invisible to the next investment question.

## Change — real Retrieval, not a new synthetic-only validator

- `Investment Review - ...` is now an explicit lower-trust **`analysis` historical role**, not a new authoritative issuer source or Thesis.
- Bounded direct lookup by canonical issuer prefix discovers at most the **two newest eligible** saved Reviews even if the next user's question uses totally different words from the past reasoning.
- Source captures saved under `07_Sources/ChatGPT/` with `source_type=user_supplied`, `type=research_note` and matching issuer are now a separate low-trust **`capture`** role (maximum two per context), rather than being silently excluded as generic AI archive. They remain **unverified supplied content**, not authenticated primary issuer documents.
- A Review is only admitted if its **indexed YAML frontmatter** says: `type=investment_review`, issuer matches, `source_type=archived_ai`, `independent_evidence=false`, `status=draft`, `analysis_origin` declared, `verification=not_reverified|unverified`. Wrong-issuer, mislabeled primary or silently upgraded verified Reviews are excluded.
- `namedIssuer` recognizes the prefix to prevent incidental other-company mention from polluting the target issuer's packet.
- Source/Thesis/Timeline priority and overall token budget remain unchanged; review quota is **two** with lower baseline weight than original sources.
- Every returned `Item` now explicitly includes note-declared `declaredSourceType`, `declaredIndependentEvidence`, and `declaredEventKey`, making it impossible to confuse an AI draft with an original issuer filing by looking only at `verification`.
- Warnings explicitly state archived AI analysis **never corroborates source facts independently**.

## Tests

The real indexed temp Vault test now writes a canonical Review, calls the **real `buildInvestmentContextPack` for a different issuer question** and confirms it rediscovers the earlier Review without keyword overlap, with `role=analysis`, independent=false and unverified status. A second test confirms wrong-issuer and attempted primary-status promotion are rejected without blocking a legitimate draft Review.

## Important boundaries

No model call, no real Vault writer, no deployment and no changes to Current Thesis or Portfolio. This is an upstream Retrieval fix for the existing PR #104 writeback workflow, not proof of real owner-authorized persistent closed loop. Retrieved historical AI must be critically compared against fresh filings and counter-evidence; its presence does not establish correctness of its old causal explanation.

The dependency Security Audit findings in PR #104 remain a separate Release Blocker and must be remediated before merge/deploy.

**Draft only. No production modifications, paid API testing or device Sync claims.**
