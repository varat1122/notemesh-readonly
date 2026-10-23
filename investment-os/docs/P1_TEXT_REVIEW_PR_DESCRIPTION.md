# Synthetic text capture and source-linked review drafts

Pasted investment commentary could not enter the synthetic capture workflow because it accepted only PDF/CSV/XLSX. This change adds bounded UTF-8 `.txt` originals and a derived paragraph review queue that preserves exact text, source IDs, Unicode offsets and physical lines. Unknown reporting dates remain unknown, and every item stays unverified pending human review.

An offline Thai demo document links each candidate back to its original paragraph and explains the source/date/denominator checks needed before research use. It uses entirely fictional AI-spending data. Content is HTML-escaped, all links are local fragments, and CSP denies scripts/remote assets. This is a generated static artifact, not a web dashboard or upload endpoint.

Existing capture policies and extraction identities remain unchanged for the original three formats. Derived drafts use immutable checksummed journals and original-source recomputation on replay/readback. No new dependency, schema migration, real source input, paid inference, Vault write, ledger operation or production deployment.

Validation evidence and remaining gates: [P1_TEXT_REVIEW_STATUS.md](P1_TEXT_REVIEW_STATUS.md), [ADR 014](adr/014.md), and [validation/p1-text-review/](validation/p1-text-review/). Real grants, atomic claim review, verified evidence approval, semantic correction handling and coordinated object/database backup remain future work. Full P0/P1 acceptance is not claimed. Intended stacked base: `codex/investment-os-p1-extraction-20261023`.
