---
task_id: IOS-TASK-SEC-002
as_of: 2026-10-31T00:00:00+07:00
origin: Investment OS / Claude Code
primary_executor: Codex
coordinator: Chat
mode: ENGINEERING_ISOLATED
status: WAITING_OWNER_DECISION
---
# Task: ทำให้ PR #136 ผ่าน audit gate โดยไม่ข้าม audit

## 1. Decision and WHY
PR #136 audit fail เพราะฐาน `main` ขาด security fixes ของ PR #135 (ดู IOS-RETURN-SEC-001)
ทางเลือกต้องให้ Owner เลือก เพราะ PR #135 ผูกกับ OAuth/Auth cutover:
- **A.** รอ #135 เข้า main แล้ว rebase #136 (ไม่มีงานซ้ำ)
- **B.** retarget/rebase #136 บน branch ของ #135 (ผูก #136 กับ #135)
- **C.** แยก PR เฉพาะ dependency overrides ที่ไม่เกี่ยว better-auth เข้า main ก่อน (better-auth critical ยังต้องรอ #135)

## 2. Scope
Repo `varat1122/notemesh-readonly`, PR #136 head `6598e33`. ห้ามแตะ Production/staging/writer flags

## 3. Evidence already PASS (DO NOT REDO)
- PR #136 test + image — PASS — run 41151497577
- PR #137 test/audit/image — PASS — run 41151212569 @ 88a203d

## 4. Work requested (หลัง Owner เลือก)
ทำตามทางเลือกที่เลือก แล้วรัน CI บน #136 ใหม่

## 5. Permissions and hard stops
- ไม่ merge, ไม่ deploy, ไม่เพิ่ม audit.ignore ใหม่เพื่อให้ผ่าน
- หยุดถ้า better-auth upgrade ต้องการ migration schema

## 6. Definition of Done
- CI run บน head ใหม่ของ #136: test, audit, image = success

## 7. Required return
`IOS-RETURN-SEC-002_YYYY-MM-DD_TH.md` พร้อม SHA ใหม่และ run ID
