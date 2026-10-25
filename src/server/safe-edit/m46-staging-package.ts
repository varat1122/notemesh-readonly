/** M4.6 fixed read-only staging proposal. Never handed directly to a writer.
 * Converts previously reviewed issuer source + historical read-only evidence
 * into four bounded fixed target notes for future owner-controlled Safe Edit.
 * No customer input, automatic approvals, git push or future window is created.
 */
import {createHash} from "node:crypto";

export const M46_SOURCE="https://nvidianews.nvidia.com/news/nvidia-and-supply-chain-partners-expand-capacity-to-accelerate-ai-infrastructure-buildout";
export const M46_EVENT="NVDA|2026-10-21|CAPACITY_EXPANSION|NVIDIA_NEWSROOM";
export const M46_ROOT="m46-nvda-capacity-shadow-20261025";
export const M46_FILES=[
  {
    role:"source",
    path:"10_Knowledge/M46 - NVDA - Issuer Source 2026-10-21.md",
    content:`---
type: source_review
entity: NVDA
event_key: NVDA|2026-10-21|CAPACITY_EXPANSION|NVIDIA_NEWSROOM
event_date: 2026-10-21
published_at: 2026-10-21
source_type: primary
verification: verified_against_primary
verification_scope: selected_nvidia_newsroom_fields_only
original_source_sha256: null
synthetic_environment: true
owner_approved: false
---
# M4.6 Staging only — NVIDIA original issuer announcement
Publisher: NVIDIA Newsroom, published October 21, 2026.
Original: https://nvidianews.nvidia.com/news/nvidia-and-supply-chain-partners-expand-capacity-to-accelerate-ai-infrastructure-buildout

- IBIDEN, Samsung Electro-Mechanics and Unimicron agreements target 2.5 times substrate capacity over three years in aggregate.
- Amkor targets more than 300% increase in interposer wafer manufacturing capacity by end-2028.
- NVIDIA announced a US$1.1 billion reservation advance to KYEC to support US semiconductor testing capacity; high-volume production is targeted for April 2027.
- SPIL targets 15 times CPO optical-engine capacity by mid-2027, and a further doubling by end-2028.
- NVIDIA management describes capacity as the constraint. These are future plans and commitments, not realized shipments, earnings, or customer ROI.
- The IBIDEN agreement was already announced earlier in 2026; this statement must not be double-counted as wholly new.

Selected public page fields only. No primary bytes or independent supplier documents archived, no exact accounting cash-flow classification established.
`,
  },
  {
    role:"company",
    path:"01_Companies/NVDA.md",
    content:`---
entity: NVDA
type: staging_company_hub
synthetic_environment: true
status: unapproved_fixture
---
# NVDA — Isolated M4.6 Staging Test Hub

NOT the user's real NVIDIA Company Hub. Real issuer story is cited only in this isolated Staging Test Vault. No Current Thesis or Portfolio has been copied here.

[[10_Knowledge/M46 - NVDA - Issuer Source 2026-10-21]]
[[08_Daily_Weekly/Research Indexes/Company Evolution - NVDA]]
[[08_Daily_Weekly/Research Indexes/Investment Review - NVDA - M46-20261021]]
`,
  },
  {
    role:"timeline",
    path:"08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
    content:`---
company: NVDA
type: staging_company_evolution
synthetic_environment: true
verification: not_reverified
status: unapproved_fixture
---
# NVDA — Staging Shadow Timeline

### 2026-10-21 — Supply capacity investment announcement
- Publisher: NVIDIA Newsroom (company announcement, not shipment or realized revenue).
- Source: [[10_Knowledge/M46 - NVDA - Issuer Source 2026-10-21]]
- Draft analysis: [[08_Daily_Weekly/Research Indexes/Investment Review - NVDA - M46-20261021]]
- New issuer announcement candidate; prior Supply/CPO/Financing themes already existed in read-only historical Investment_OS. Claim-level uniqueness unresolved; no authorized Thesis revision.

<!-- m46-staging-marker:IN-6B8E246C07E25671 -->
`,
  },
  {
    role:"analysis",
    path:"08_Daily_Weekly/Research Indexes/Investment Review - NVDA - M46-20261021.md",
    content:`---
type: investment_review
entity: NVDA
event_key: NVDA|2026-10-21|CAPACITY_EXPANSION|NVIDIA_NEWSROOM
event_date: 2026-10-21
published_at: 2026-10-21
analysis_origin: m46_issuer_staging_shadow
source_type: archived_ai
verification: not_reverified
independent_evidence: false
status: draft_unapproved
synthetic_environment: true
owner_approved: false
---
# NVDA — M4.6 Real-News Shadow Review / STAGING ONLY

Primary source: [[10_Knowledge/M46 - NVDA - Issuer Source 2026-10-21]]
Official: https://nvidianews.nvidia.com/news/nvidia-and-supply-chain-partners-expand-capacity-to-accelerate-ai-infrastructure-buildout

## Fixed provisional claim IDs (not owner-approved)
- NVDA-20261021-SUBSTRATE-2P5X — aggregate supplier substrate-capacity target of 2.5x over three years.
- NVDA-20261021-AMKOR-GT300PCT — advanced-packaging interposer-wafer capacity target >300% by end-2028.
- NVDA-20261021-KYEC-USD1P1B — announced US$1.1bn capacity-reservation advance; US high-volume testing target April 2027.
- NVDA-20261021-SPIL-15X — CPO optical-engine capacity target 15x by mid-2027.

## Novelty and historical comparison
Announcement dated 2026-10-21 is a new dated issuer-event candidate; capacity/yield, CPO and financing are established historical investment themes. Past NVDA Current Thesis in Production was draft_from_archived_evidence / not_reverified, not an owner-endorsed thesis. The read-only historical review found no exact structured metadata matches but cannot guarantee full-Vault nonduplication. Prior IBIDEN activity was announced earlier in 2026.

## Mechanism and contrary evidence
Planned supply/capacity -> qualification and yield -> shipments/acceptance -> recognized revenue -> gross profit -> operating profit -> cash -> ROIC. No supported incremental sales, NVDA GPU margin, cash conversion or end-customer utilization estimate from announced supplier capacity alone. Deposits and reservations create capital-commitment/working-capital questions, not proven profit.

Counterevidence: possible future underutilization, cost of ramp, limited customer monetization, competing ASIC demand, extended collection terms, and uncertain supplier realization. The issuer announcement does not prove a company-wide singular bottleneck or durable end-customer ROI.

Required checks: supplier delivery dates, yield/qualified production, cash paid and refund terms, gross and operating margin, customer acceptance/utilization and current price & dated consensus. Price In, numeric valuation impact, probability, protected Thesis/Portfolio changes are not assessed.

## Proposed change log — NOT APPLIED
Maintain/monitor the earlier hypothesis. Treat the selected four forward targets as source-attributed detail and preserve their metric/period units. No Current Thesis, Evidence Register or holdings update without separate owner approval.

[[01_Companies/NVDA]]
[[08_Daily_Weekly/Research Indexes/Company Evolution - NVDA]]
<!-- m46-staging-shadow:IN-6B8E246C07E25671 -->
`,
  },
] as const;
export const M46_MANIFEST=M46_FILES.map(f=>({path:f.path,role:f.role,
  sha256:createHash("sha256").update(f.content).digest("hex"),bytes:Buffer.byteLength(f.content)}));
export const M46_MANIFEST_SHA256=createHash("sha256").update(JSON.stringify(M46_MANIFEST)).digest("hex");
