---
document_id: IOS-GAP-001
title: "Gap Map — Greenfield Master Blueprint v1.0 vs notemesh-readonly"
as_of: 2026-10-31
author: Claude Code
baseline: main@71cc417 (+ open PRs #135, #136 noted separately)
evidence_level: CODE_READ_ONLY — ไม่ได้ตรวจ Railway/Vault จริง; ไม่มีสถานะ DEPLOYED/WRITE_VERIFIED ในเอกสารนี้
---

# Gap Map — Blueprint v1.0 ↔ Repo

## สถานะที่ใช้
- **BUILT** — มีโค้ด + tests ใน `main`
- **PARTIAL** — มีบางส่วน หรือ read-only/preview เท่านั้น
- **DESIGN** — มีเอกสาร/contract แต่ไม่มีโค้ด
- **NONE** — ยังไม่มี

ทุกแถวเป็นระดับ G1–G2 (CODED/CI) เท่านั้น ไม่ใช่ DEPLOYED หรือ PRODUCTION_ACCEPTED

## 0. ข้อแตกต่างระดับสถาปัตยกรรม (ต้องทำ ADR)

| Blueprint | Repo จริง | ผล | ADR ที่ต้องมี |
|---|---|---|---|
| Python + FastAPI | TypeScript + SolidStart/Vinxi + MCP server | ใช้งานได้ ไม่ต้องย้าย | ADR-001: ยอมรับ TS/MCP เป็น core API |
| PostgreSQL | SQLite (`better-sqlite3`, single replica) | พอสำหรับ MVP; จำกัด concurrency/multi-writer | ADR-002: SQLite จนกว่าจะมี trigger ย้าย PG |
| Parquet + DuckDB | ตาราง `bars` ใน SQLite + Drive archive | พอสำหรับ daily bars; ไม่พอสำหรับ backtest ขนาดใหญ่ | ADR-003: Quant store |
| Local-first (Vault agent บนเครื่อง) | Cloud-first: Railway เป็นเจ้าของ Vault + `obsidian-headless` sync | กลับด้านกับ §02.2 | ADR-004: Cloud-owned vault + trust boundary |
| Market data ผ่าน provider ที่ compliant | `market-prices/yahoo.ts` | Blueprint §04 จัด Yahoo เป็น "prototype only" | ADR-005: provider ทางการก่อน Quant production |
| Claim/Edge tables ใน PG | Claim อยู่ใน frontmatter ของ Note + index ใน `notes` | ยังไม่มี `claims`/`relationships` table | ADR-006: Claim/Edge registry |

## 1. Capability map (Blueprint §03)

| Capability | สถานะ | หลักฐานใน repo | Gap หลัก |
|---|---|---|---|
| Document ingestion | PARTIAL | `user-attachment-vault.ts`, `research-source-archive.ts`, `research-source-fetch.ts` (allowlist), `pdf-coverage-m57.ts`, `intake_queue` | ไม่มี parser PDF/Excel ฝั่ง server (Chat ส่ง text ที่ extract เอง); ไม่มี Drive raw inbox สำหรับเอกสาร; ไม่มี XLSX import template |
| Market ingestion | PARTIAL | `market-prices/*` (collector, store, Drive archive, incremental, quality_issues) | provider = Yahoo; ไม่มี FX (Frankfurter), FRED, corporate actions source แยก; calendar ยัง provisional |
| Evidence Registry | PARTIAL | `investment-claim-review.ts`, `evidence-verification-ledger.ts`, `source-identity-m56.ts`, `source-observation-receipt.ts` | read-only บน frontmatter; ไม่มี table `claims`/`claim_evidence`; ไม่มี workflow เปลี่ยนสถานะ verified/rejected |
| Historical retrieval | BUILT | `investment-context.ts`, `queries.ts` (FTS), RI-011 hybrid (PR #136) | ยังไม่มี point-in-time filter (`known_at`) |
| AI Research (Orchestrator/Specialists) | DESIGN | Chat (ChatGPT) ทำนอกระบบ; `research-quality-m55.ts` ตรวจ contract ก่อนเขียน | ไม่มี orchestrator/specialist schema (§07.3) ใน repo — by design ตาม IOS-GOV-001 แต่ต้องมี output schema ให้ตรวจได้ |
| Knowledge Graph (typed edges) | PARTIAL | `links` table (Wikilink), `event-review-relation-m56.ts`, `investment-routing-v2.ts` | ไม่มี typed edge (`predicate`, `evidence_ids`, `verification`, `valid_from/to`) ตาม §08.3 |
| Safe Writeback | BUILT | `safe-edit/engine.ts` (CAS, diff, hash), `safe_edit_operations/events/claims`, `canonical-writeback-workflow.ts`, `revisions`, rollback | writer flags 0/0; WRITE_VERIFIED บน staging ยังไม่มี (IOS-GOV-001 §6.2) |
| Quant analytics | PARTIAL | `market-prices/event-analysis.ts` (event window, relative to ETF proxy) | ไม่มี factor, run artifact (`quant_runs`), signal TTL, backtest, point-in-time |
| Trading & Tactical | NONE | — | ไม่มี `trade_setups`, mandate records |
| Portfolio & Risk | DESIGN | contract ใน `docs/INVESTMENT_DATA_ARCHITECTURE.md` | ไม่มี ledger/import/snapshot table |
| Decision Committee | PARTIAL | `investment-decision-packet.ts`, `thesis-proposal-gate.ts` (read-only) | ไม่มี `decision_records` ledger; ไม่มี approval workflow สำหรับ protected thesis |
| Monitoring | PARTIAL | `mcp/alerts.ts` (ops: disk/sync/indexer), `refreshes`, `tasks` | ไม่มี thesis/evidence/watchlist monitoring |
| Web/LINE | PARTIAL | Web dashboard (SolidStart routes, Playwright e2e) สำหรับ admin/Safe Edit | ไม่มี LINE; ไม่มี research/portfolio dashboard |

## 2. Data entities (Blueprint §05.3)

| Entity | สถานะ | ที่อยู่จริง |
|---|---|---|
| `instruments` | PARTIAL | `instruments` (listing ref เช่น `US:NVDA`); ยังไม่มี immutable listing_id + alias valid_from/to |
| `sources` | PARTIAL | `source_snapshots`, `attachments` (content hash) |
| `events` | NONE | ระบุเป็น next phase ใน `INVESTMENT_DATA_ARCHITECTURE.md` |
| `claims`, `claim_evidence` | NONE (table) | อยู่ใน frontmatter เท่านั้น |
| `notes` | BUILT | `notes`, `revisions` |
| `relationships` | PARTIAL | `links` (untyped) |
| `research_reviews` | PARTIAL | เป็น Note ใน Vault ตาม canonical path |
| `thesis_versions` | NONE (table) | Note + proposal gate |
| `market_bars` | BUILT | `bars`, `quality_issues`, `refreshes` |
| `quant_runs`, `signals` | NONE | — |
| `trade_setups` | NONE | — |
| `decision_records` | NONE | — |
| `portfolio_transactions`, `portfolio_snapshots` | NONE | — |
| `jobs`/`receipts`/`audit_events` | BUILT | `tasks`, `actions`, `safe_edit_events`, `audit.ts` |

## 3. Roadmap phase (Blueprint §18)

| Phase | สถานะ | เหลือก่อนผ่าน gate |
|---|---|---|
| P0 Foundational | PARTIAL | ADR-001..006 ข้างบน; threat model เป็นเอกสารเดียว |
| P1 Data & Evidence MVP | PARTIAL | claim registry table; parser 3 ชนิดเอกสาร; dedup/correction เป็น write workflow |
| P2 Obsidian Closed Loop | PARTIAL (ใกล้) | RI-011 local closed loop ผ่าน CI (PR #136/#137); เหลือ Research staging WRITE_VERIFIED + Event B retrieves A บนระบบจริง |
| P3 Research Desk MVP | DESIGN | specialist output schema + citation check ใน repo |
| P4 Quant & Market Data | PARTIAL | provider ทางการ, `quant_runs`, reproducible run, corporate actions |
| P5 Trading | NONE | — |
| P6 Committee & Portfolio | NONE | ledger + decision ledger |
| P7 Monitoring | PARTIAL (ops only) | thesis/evidence watch |
| P8 Interfaces | PARTIAL | — |
| P9 Hardening | PARTIAL | backup/restore drill บน Research staging; PR #135 security |

## 4. ลำดับงานที่แนะนำ (เล็กสุดก่อน, ไม่ชนกัน)

| # | งาน | Executor ที่เหมาะ | พึ่งพา |
|---|---|---|---|
| 1 | ปิด P2: PR #135 → main, rebase #136, Research staging canary | Codex + Work + Owner | IOS-TASK-SEC-002 (A) |
| 2 | เขียน ADR-001..006 รับรองสถาปัตยกรรมจริง | Claude Code | ไม่มี |
| 3 | Specialist output schema (§07.3) เป็น zod contract + validator read-only | Claude Code | ไม่มี |
| 4 | Typed edge contract (§08.3) — schema + read-only validator ก่อน, ยังไม่สร้าง table | Claude Code | ADR-006 |
| 5 | Claim/Event registry table (P1) | Codex | ADR-006, หลัง #1 เพื่อไม่ชน migration |
| 6 | Market data: provider ทางการ + FX (Frankfurter) adapter | Codex | ADR-005, Owner อนุมัติ provider |
| 7 | Portfolio ledger (P6) | ภายหลัง | P2–P4 |

งาน 2–4 ไม่แตะ `canonical-writeback-workflow.ts`, `safe-edit/*`, auth หรือ `pnpm-lock.yaml` จึงไม่ชนกับ PR ของ Codex

## 5. ขอบเขตหลักฐาน
- อ่านจากโค้ดใน `main@71cc417` และ diff PR #136 เท่านั้น
- ไม่ได้ตรวจ Railway, Vault จริง, writer flags, หรือ PR #135 อย่างละเอียด
- "BUILT" ≠ deployed/verified
