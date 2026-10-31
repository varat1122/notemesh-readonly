---
task_id: IOS-RETURN-OPS-005A
executor: Claude Code (แทน Codex/Work ที่ไม่มี token; Owner: "ทำอะไรก็ได้ที่ทำได้")
as_of: 2026-10-31
outcome: COMPLETED (engineering part of OPS-005 step 7; Production untouched)
---
# IOS Return — เตรียม schema cleanup + runbook สำหรับ OPS-005

## สิ่งที่ทำ
1. **Schema diff Better Auth 1.7.2 vs 1.7.7** (migrate DB ใหม่ด้วยแต่ละเวอร์ชันแล้วเทียบทุก table/column/index):
   ต่างกันแค่ `account.issuer` (NOT NULL, no default) และ `account_issuer_accountId_uidx` — ไม่มีจุดอื่นที่ 1.7.7 จะเขียนพัง
2. **`scripts/account-issuer-cleanup.mjs`** บน PR #135 (`e9b467e`):
   - default = report อย่างเดียว; `--apply` = DROP INDEX + DROP COLUMN ใน transaction เดียว
   - commit เฉพาะเมื่อ integrity/FK ผ่าน, row count เท่าเดิม, schema object อื่นไม่เปลี่ยน (SHA-256), account columns = ชุดของ 1.7.7
   - ปฏิเสธเมื่อ: account จาก provider อื่น, `(providerId, accountId)` ซ้ำ, index/trigger/view อื่นอ้าง issuer, integrity/FK ไม่ผ่าน, WAL ไม่ว่าง (แอปยังเปิด)
   - output ไม่มีค่าใน row (มีแค่ชื่อ table + จำนวน)
   - ใส่ใน image ที่ `/app/account-issuer-cleanup.mjs` ไม่ถูกเรียกตอน boot
3. **Tests** `src/server/account-issuer-cleanup.test.ts`: สร้าง account ตาม DDL 1.7.2 จริงบน instance ที่มี admin → cleanup → boot 1.7.7 → admin login ด้วยรหัสเดิมผ่าน; refuse provider อื่น; refuse WAL ค้าง
4. **Runbook** `IOS-RUNBOOK-OPS-005_2026-10-31_TH.md` ให้ Owner ทำ OPS-005 เองผ่าน Railway CLI

## หลักฐาน
- Local: lint, typecheck, build, unit 1472/1472 (เดิม 1469 + 3), CLI smoke (check/apply/idempotent/bad args)
- CI run `41172276011` บน `e9b467e`: audit ✅ test ✅ image ✅
- Runbook ขั้น 3/4/6 รันตามตัวอักษรบนข้อมูลจำลองที่มี WAL ค้าง: `VACUUM INTO` ได้ข้อมูลใน WAL ครบ, base64 round-trip ตรงกัน
- ตรวจ Railway: ไม่มี service ใดผูก branch ของ #135 → push ไม่ทำให้ deploy

## ข้อค้นพบ
- เปิด SQLite ไฟล์เดียวกันจาก 2 library ใน **process เดียวกัน** (better-sqlite3 + node:sqlite) → `disk I/O error` ⇒ สคริปต์ต้องรันใน process แยก และ `--apply` ต้องหยุดแอปก่อน (บังคับด้วย WAL check)
- Rollback หลัง cleanup: commit `71cc417` (Production ปัจจุบัน) มี `backfillAccountIssuer()` ที่เพิ่มคอลัมน์กลับเองถ้าไม่มี → app-only rollback น่าจะ boot ได้ แต่ยังต้องใช้ backup เป็นหลักตาม rollout doc
- M4 staging (`notemesh-m53-isolated-staging`) มี `watchPatterns` เป็น manual gate → deploy `06ce7d6` เกิดจากการกด deploy ตั้งใจ ไม่ใช่ auto-deploy (ยังต้องให้ Owner ยืนยันว่าได้อนุมัติ)

## No-touch
ไม่แตะ Production/M4/variables, ไม่ merge, ไม่ deploy
