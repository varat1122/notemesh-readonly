# IOS-ORCH-RI-001 — N9 PDF Native Page Evidence Preview

**Scope:** CI-only Draft PR stacked on N8. No Merge, Deploy, Production/shared Staging mutation, live Vault write or paid server. The feature is OFF unless an operator explicitly sets `N9_PDF_PAGE_TEXT_PREVIEW_ENABLED=1`.

## Why it matters

N8 compares two persisted and receipted broker forecast observations. N8 cannot prove that a claimed source excerpt actually appeared on the specified original PDF page. N9 supplies the smallest reliable **native text** cross-check for one already-stored user attachment, without fabricating visual coverage.

## Contract

- Inputs: persisted generated Broker Claim path, full note SHA-256, original user PDF attachment SHA-256, one-based PDF page number.
- Readback: verify existing Claim and Source via their Safe Edit receipts, index, links and physical bytes. Source's existing `attachment_path` and `attachment_status` must bind exactly the requested content-addressed PDF attachment. No arbitrary file paths.
- Native parser: `pdfinfo` reads actual page count; `pdftotext` reads the selected page from the PDF bytes through stdin. Fixed command names, fixed flags, no shell, no network. Execution/output and existing attachment size are bounded.
- Matching: a normalized full Source excerpt and strict numeric value anchor must match selected page's native text. No semantic approximation or unit conversion. The source excerpt still originates from the separate, previously validated structured claim.
- Output: only a **pending semantic review** candidate and digests/page metadata, not full PDF text; publisher and visually inspected table/footnote/chart confidence remain false.
- Missing native text, encrypted/invalid/oversized PDF, wrong page, mismatched attachment or Claim hashes, unverifiable receipts, incomplete Source association or parser-disabled flag → HOLD. No writable operation.
- All claims remain `unverified`, evidence increment 0; no graph or protected Thesis/Portfolio writes.

## Native tool / deployment boundary

Native PDF parsing uses Poppler, installed only in the **candidate image and CI runner** by the code changes; no separate service is required. It is a subprocess parsing untrusted user content and therefore must be security-reviewed before enabling the opt-in flag on any non-disposable environment. Parser availability and normal/negative cases are tested with synthetic two-page PDFs. At most one page is processed per request.

**Not yet solved:** original broker/publisher authentication, rights/license, text extracted from scanned images, full PDF 50 MB archive lifecycle (current user attachment contract has a 4 MB cap), charts/figures/footnotes visual inspection, primary economic validation, full document coverage or investment conclusions.
