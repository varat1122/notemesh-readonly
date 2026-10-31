---
task_id: IOS-RETURN-GRAPH-001
executor: Claude Code
as_of: 2026-10-31
outcome: COMPLETED (G1 CODED + local tests; CI ยังไม่รัน)
execution_target: branch ccr-7f1243c0-c9cv8x
---
# IOS Return — Typed edge contract (Blueprint §08, ADR-006 ขั้น A)

## สิ่งที่ทำ
- `src/server/vault/research-typed-edge.ts` — `TypedEdge`, `validateTypedEdge`, `canAutoPersist` (pure, ไม่มี I/O/migration)
- `isAsOf` ใน `research-specialist-output.ts` export เพื่อใช้ร่วม

## กติกาที่บังคับ
- predicate ตาม taxonomy §08.2 พร้อมชนิด node ที่อนุญาตทั้งสองฝั่ง (เช่น `supplier_to` = company→company)
- node id รูปแบบ `<kind>:<id>`; ห้าม self-edge
- `verified` ต้องมี evidence และ origin ไม่ใช่ AI; `supplier_to/customer_of/partner_of` ต้องเป็น source ที่ attributed (ไม่ใช่ user/social)
- `potential_beneficiary_of/potential_risk_from` ห้าม `confirmed`, ห้าม auto-persist
- `confirmed` ต้อง `verified`; hypothesis ที่ active ต้องมี `reviewBy`
- `claim_updates_thesis`, `decision_references_thesis` ต้อง `owner_approval`
- auto-persist ได้เฉพาะ citation/identity/taxonomy (`issuer_of`, `source_supports/contradicts_claim`, `company_operates_in_industry`, `review_related_to`) ที่ verified + มี evidence + origin ไม่ใช่ AI/social
- retract ต้องมีเหตุผล, supersede ต้องชี้ edge ใหม่; ไม่มีการลบ

## หลักฐาน
- vitest 2 ไฟล์ 17/17 ผ่าน, eslint ผ่าน, `tsc --noEmit` ผ่าน (local node 22)
- ไม่ได้รัน full suite: เพิ่มเฉพาะ module ใหม่ที่ไม่มีใคร import

## No-touch
ไม่แตะ safe-edit, canonical-writeback, auth, lockfile, MCP server, DB schema, Vault, Railway

## Next
- ADR-006 ขั้น B (table `relationships` derived จาก Note) → Codex หลัง #135/#136 เข้า main
- ต่อ validator ทั้งสองเข้า MCP read-only tool หลัง #136 rebase
