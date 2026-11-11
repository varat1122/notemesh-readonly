# IOS-ORCH-RI-001 — N9 PDF Native Page Evidence Preview

**Scope:** CI-only Draft PR stacked on N8. No Merge, Deploy, Production/shared Staging mutation, live Vault write or paid server. The feature is OFF unless an operator explicitly sets `N9_PDF_PAGE_TEXT_PREVIEW_ENABLED=1`.

## Why it matters

N8 compares two persisted and receipted broker forecast observations. N8 cannot prove that a claimed source excerpt actually appeared on the specified original PDF page. N9 supplies the smallest reliable **native text** cross-check for one already-stored user attachment, without fabricating visual coverage.

## Contract

- Inputs: persisted generated Broker Claim path, full note SHA-256, original user PDF attachment SHA-256, one-based PDF page number.
- Readback: verify existing Claim and Source via their Safe Edit receipts, index, links and physical bytes. Source's existing `attachment_path` and `attachment_status` must bind exactly the requested content-addressed PDF attachment. No arbitrary file paths.
- Native parser (method `IOS-RI001-N9-POPPLER-TEXT-2`): asynchronous `pdfinfo` reads actual page count; `pdftotext` reads the selected page from PDF bytes through stdin. Fixed executables/flags, no shell or caller-selected filesystem paths. One active parse per process across emitted bundles, **zero waiting queue**; additional requests return `n9_pdf_parser_busy` HOLD.
- Locator: `locatorAgreement` explicitly reports agreement/conflict/ambiguity/unverifiability against a single explicit Claim page locator (`page N`, `PDF page N`, `p. N`, `หน้า N`). Conflicting, ranged, multiple, decimal or unstructured locators HOLD; no inference from headings or text. Pages are one-based physical pages, not inferred printed page labels. Agreement remains **caller-declared locator consistency**, not independently authenticated publisher metadata.
- Matching: a normalized full Source excerpt and strict numeric value anchor must match selected page's native text. No semantic approximation or unit conversion. The source excerpt still originates from the separate, previously validated structured claim.
- Output: only a **pending semantic review** candidate and digests/page metadata, not full PDF text; publisher and visually inspected table/footnote/chart confidence remain false.
- Missing native text, encrypted/invalid/oversized PDF, wrong page, mismatched attachment or Claim hashes, unverifiable receipts, incomplete Source association or parser-disabled flag → HOLD. No writable operation.
- After asynchronous parsing, repeat Claim/Source receipt, physical/index readback and original attachment hash checks before returning a match; changes during parsing HOLD. Native parser errors are bounded reason codes, never raw stderr or environment contents.
- All claims remain `unverified`, evidence increment 0; no graph or protected Thesis/Portfolio writes.

## Native tool / deployment boundary

Native PDF parsing uses Poppler, bubblewrap and util-linux `prlimit`, installed only in the **candidate image and CI runner**. `scripts/build-n9-pdf-runtime.mjs` constructs a small runtime root from fixed distro ELF binaries, their resolved libraries and optional Poppler character maps. It never processes caller input. The production root is part of the immutable, root-owned application image; it is not DATA_DIR. Do not put credentials, server configuration or other application files in this artifact.

Every parser runs as a non-root user inside required user/mount/PID/network namespaces, with all capabilities dropped and further user namespaces disabled. Only this runtime root is mounted read-only, plus `/dev/null` and a private 1 MiB tmpfs. Host root, DATA_DIR, Vault, `/proc`, home and credentials are not mounted. Environment is exactly `PATH=/bin`, `LANG=C`, `LC_ALL=C`, `HOME=/tmp`, `TMPDIR=/tmp`; bubblewrap adds its sandbox `PWD=/tmp`. No inherited application environment, host network or extra inherited descriptors. There is no executable/mount override in the public interface.

Limits: input 4 MiB, 2,000-page document count, selected page text 12,000 bytes, combined stdout/stderr 128 KiB per child, 8 seconds total wall time for both children, 4 seconds CPU per child, address space 256 MiB, 32 file descriptors, 1 MiB file size, no core dumps and process limit 1 after sandbox setup. Timeout/output overflow kills the process group; the PID namespace and parent-death rule cover descendants. Admission is retained until `close`. If cleanup is not confirmed within 1 second, the slot is quarantined for the process lifetime and further calls HOLD. No temporary PDF file is written.

**Fail closed:** unavailable bubblewrap, runtime artifact, namespace permissions, limits, parser or cleanup → HOLD, never unsandboxed execution. Root execution and overlapping DATA_DIR/runtime roots are refused. The host kernel and trusted packaged sandbox/runtime remain dependencies; this is not a claim of immunity to kernel or sandbox vulnerabilities. Docker/hosting security profiles may prohibit user namespaces. No host security setting is relaxed by this patch; such a runtime must keep N9 OFF until separately authorized isolation verification succeeds. Image build/health success alone does not establish parser enablement readiness.

Local/CI tests use benign two-page text PDFs, a benign native capability probe (filesystem, host network, environment, descriptor and resource-limit denial), and a sleeping test child for real deadline/reaping checks. They do not exercise malicious or resource-exhaustion PDFs. Native parsing must receive independent delta review before any enablement; the feature remains **default OFF**, including the CI image startup. No N8 receipt or authority contract changes.

**Not yet solved:** original broker/publisher authentication, rights/license, text extracted from scanned images, full PDF 50 MB archive lifecycle (current user attachment contract has a 4 MB cap), charts/figures/footnotes visual inspection, primary economic validation, full document coverage or investment conclusions.
