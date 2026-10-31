---
adr: 006
title: Claim and typed-edge registry
status: PROPOSED
date: 2026-10-31
relates_to: Blueprint v1.0 §05.3, §08
---
# ADR-006 Claim / Edge registry

## Context
ปัจจุบัน claim อยู่ใน frontmatter ของ Note และอ่านผ่าน index `notes`; ความสัมพันธ์มีแค่ `links` (Wikilink, ไม่มีชนิด) Blueprint §08 ห้ามใช้ Wikilink เป็นหลักฐานความสัมพันธ์เศรษฐกิจ

## Decision
แบ่ง 2 ขั้น:
1. **ขั้น A (ตอนนี้, ไม่มี migration):** กำหนด contract เป็น zod schema ใน repo — `Claim`, `ClaimEvidence`, `TypedEdge` (subject, predicate จาก taxonomy §08.2, object, `assertion_origin`, `evidence_source_ids`, `verification`, `strength`, `valid_from/to`, `review_by`, `link_policy`) พร้อม validator read-only สำหรับ frontmatter เดิม
2. **ขั้น B (P1, หลัง PR #135/#136 เข้า main):** สร้างตาราง `claims`, `claim_evidence`, `relationships` เป็น **index ที่สร้างจาก Note** (Note = canonical, table = derived, rebuild ได้)

กติกา
- `supplier_to` / `customer_of` / `partner_of` ต้องมี `evidence_source_ids` ที่ไม่ว่าง และ `verification` ≠ `unverified`
- `potential_beneficiary_of` / `potential_risk_from` default = hypothesis, ห้าม auto-promote
- edge ถูก retract/supersede ไม่ลบ

## Alternatives
- Table เป็น canonical — ขัด ADR-004 (Vault คือความจำที่มนุษย์อ่าน) และทำให้ต้อง sync สองทาง

## Consequences
- + ขั้น A ไม่ชนกับงาน Codex และใช้ตรวจ Note ได้ทันที
- − ขั้น B ต้องมี rebuild job + test ว่า table ตรงกับ Note

## Owner approval
ยังไม่อนุมัติ
