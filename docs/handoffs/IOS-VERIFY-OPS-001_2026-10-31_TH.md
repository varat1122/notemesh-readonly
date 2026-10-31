---
verify_id: IOS-VERIFY-OPS-001
verifier: Claude Code (independent, read-only)
as_of: 2026-10-31
targets: Railway (3 projects), GitHub PR #135 / #137
status: PARTIAL
---
# IOS Verify — Production, Staging และ PR #135

## 1. Production NoteMesh — ACCEPT
| Item | ค่าจริง (Railway) |
|---|---|
| Project / Env | `wholesome-wholeness` / production |
| Service | NoteMesh, 1 replica, volume `notemesh-volume` 1000 MB @ /data (iad) |
| Live deployment | `b8a2b39a-b737-4ae8-b5f2-a4cee6048e2d` SUCCESS, 2026-10-26T07:45Z |
| Commit | `71cc4178` = `main` HEAD ปัจจุบัน |
| Staged / pending | ไม่มี |
คำกล่าว "Production ไม่เปลี่ยนแปลง" → **ยืนยันแล้ว** (ไม่มี deploy ใหม่ตั้งแต่ 2026-10-26)
ยังไม่ได้ตรวจ: writer flags/variables (ไม่ได้อ่าน variables เพื่อไม่ให้ secret ผ่าน log)

## 2. M4 isolated staging — HOLD (สถานะไม่ตรงเอกสาร)
| | IOS-GOV-001 §6.2 (as-of 2026-10-30) | Railway จริง |
|---|---|---|
| Deployment | `8460e2b9…` | `8460e2b9` = **REMOVED**; live = `bda9d3f4-8522-4bf8-85d9-76a5b3979c67` (2026-10-30T05:51Z) |
| Commit | `5592c073` | `06ce7d67` branch `fix/ios-m4-safeedit-003-ci` |
- commit message ของ `06ce7d67` เขียนว่า "Development and CI candidate only; no merge, **deployment** or writer enablement" แต่ถูก deploy ขึ้น M4 staging แล้ว
- ต้องการ: Owner/Chat ยืนยันว่า deploy นี้ได้รับอนุมัติหรือไม่ และ writer flags ยังเป็น 0/0 หรือไม่ ก่อนใช้ M4 staging เป็นหลักฐานใด ๆ
- Project อื่น: `IOS-M4-Recovery-Login-20261029` live `91864a0f` SUCCESS; `notemesh-pilot-001` SLEEPING

## 3. PR #135 — HOLD (audit ไม่ผ่านแล้ววันนี้)
- CI run `41049413226` (2026-10-30 11:37Z) ผ่านครบ ณ เวลานั้น
- **รัน `pnpm audit --prod --audit-level=high` บน head `4896dbe` วันนี้: 6 high (1 ignored)** — node-forge advisory ใหม่ 5 ตัว (GHSA-7wch-p9px-956x, GHSA-jc66-7q78-782g, GHSA-8hrf-8g6f-7xwp, GHSA-hqq3-7jhf-c5jx, GHSA-5x38-2vff-x55p) ออกหลัง CI run
- ตัวแก้ (`node-forge: 1.4.2` override + ถอด ignore GHSA-86w9) มีอยู่ **เฉพาะใน branch ทดสอบ PR #137** (`88a203d`) ยังไม่อยู่ใน #135
- ผล: ถ้า re-run CI บน #135 ตอนนี้ audit จะ FAIL → ทาง A (รอ #135 เข้า main) ติดจนกว่า Codex จะยกการแก้ forge เข้า #135

## 4. PR #135 — ข้อสังเกตประวัติ git (ไม่ block แต่ต้องตัดสินใจตอน merge)
- #135 มี **2 root commits** (`401e010` ของ main และ `6727180` = ประวัติ upstream เดิม) และนำ commit ที่ main ไม่มีมา **270 commits** ผ่าน merge commit `4896dbe`
- diff เนื้อหาจริงเทียบ main มีแค่ 12 ไฟล์ (+317/−215)
- แนะนำ: merge แบบ **squash** เพื่อไม่ให้ประวัติ 2 สายเข้า main

## 5. ข้อมูลอื่นที่ยืนยันจาก PR #135 body
- Production deploy ของ #135 ถูก HOLD โดย Codex เอง (legacy `account.issuer NOT NULL`) ต้อง backup → restore แยก → schema cleanup ก่อน — สอดคล้องกับ IOS-GOV-001

## Next (Executor ที่เหมาะ)
| # | งาน | ผู้ทำ |
|---|---|---|
| 1 | ยก `node-forge 1.4.2` override จาก #137 เข้า #135 แล้วรัน CI ใหม่ | Codex |
| 2 | ยืนยันการ deploy `06ce7d67` บน M4 staging + writer flags | Owner/Chat (หรือ Work) |
| 3 | ตัดสินใจ squash merge #135 | Owner |

## No-touch
อ่านอย่างเดียว: ไม่ได้ deploy, ไม่ได้อ่าน/แก้ variables, ไม่ได้ comment PR, ไม่ได้ push branch ของ Codex
