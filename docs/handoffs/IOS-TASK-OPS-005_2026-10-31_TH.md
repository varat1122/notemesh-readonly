---
task_id: IOS-TASK-OPS-005
as_of: 2026-10-31T12:00:00+07:00
origin: Investment OS / Claude Code (prepared for Chat acceptance)
primary_executor: Work
coordinator: Chat
mode: READ_ONLY on Production + ENGINEERING_ISOLATED restore copy
status: WAITING_OWNER_APPROVAL — Work ไม่มี token; Owner ทำเองได้ตาม IOS-RUNBOOK-OPS-005
predecessor: IOS-VERIFY-OPS-001, IOS-RETURN-SEC-003, IOS-RETURN-SEC-004
---
# Task: ทำ Production backup ที่สอดคล้องกัน + restore แยก + ซ้อม schema cleanup บนสำเนา (Gate 1–3 ของ PR #135)

## 1. Decision and WHY
PR #135 (Better Auth 1.7.7 + security fixes) ผ่าน CI แล้ว แต่ **ห้าม merge/deploy** จนกว่า Gate 1–3 ใน
`docs/PR135_PRODUCTION_OAUTH_ROLLOUT.md` (บน branch #135) จะมีหลักฐาน:
Production `account.issuer` เป็น `NOT NULL` ไม่มี default + มี `account_issuer_accountId_uidx`; build ใหม่จะปฏิเสธ auth init บน schema นี้

Tool gap ที่ทำให้ต้องเป็น Work: ต้องเข้า shell/filesystem ของ container บน Railway, หยุด sync/writer, สำรอง SQLite แบบ WAL-consistent และเก็บนอก volume — Chat/Claude Code มีแค่ Railway API (ไม่มี SSH) และ Codex ไม่มี runtime access

**งานนี้ไม่ใช่ cutover:** ไม่แก้ schema บน Production, ไม่ deploy, ไม่ merge — cutover เป็น Task แยกที่ต้องอนุมัติใหม่

## 2. Scope and exact target
| Item | Value (ตรวจ 2026-10-31 แบบ read-only) |
|---|---|
| Railway project | `wholesome-wholeness` (`88f3c614-6222-4ad3-b80f-a0890a3ef587`) |
| Environment | production (`7924e4d4-5a64-4713-afdf-104bfea6953b`) |
| Service | NoteMesh (`f5de7abf-ede8-4131-9d6c-b5e8eac204b9`), 1 replica, iad |
| Volume | `notemesh-volume` (`a963a6cb-b4a6-4ea8-a295-cd5a06765346`) @ `/data`, 1000 MB |
| Live deployment | `b8a2b39a-b737-4ae8-b5f2-a4cee6048e2d`, commit `71cc4178607d717b403ffd143d3a01bff7c94758` |
| Source config | repo `varat1122/notemesh-readonly`, branch `main`, desired pin `a34b34c` (เก่ากว่าตัวที่รันจริง) |
| Variable names | DATA_DIR, ENCRYPTION_KEY, M55_REQUIRE_TYPED_REVIEW, MARKET_PRICES_ENABLED, PORT, SAFE_EDIT_ENABLED, SAFE_EDIT_SINGLE_WRITER, SOURCE_ARCHIVE_USER_AGENT |
| Candidate SHA (สำหรับทดสอบบนสำเนา) | PR #135 head `e9b467e` (ก่อนหน้า `d355d90`) |

**ก่อนเริ่มต้องตรวจซ้ำ (fresh preflight):** deployment ID, commit, volume ID, replica = 1, ไม่มี staged change — ถ้าไม่ตรงตารางนี้ ให้ STOP

## 3. Evidence already PASS (DO NOT REDO)
- PR #135 CI — PASS — run `41168580979` @ `d355d90` (audit/test/image)
- PR #136 CI — PASS — run `41169324203` @ `f07d037` (rebased บน #135)
- Production ไม่เปลี่ยนตั้งแต่ 2026-10-26 — IOS-VERIFY-OPS-001 §1
- M4 cutover/restore evidence **ใช้แทน Production ไม่ได้** (rollout doc Gate 3)

## 4. Work requested (only delta)
1. **Preflight (read-only):** ยืนยันตาราง §2; บันทึก writer flags ปัจจุบัน (rollout doc ระบุพบ `1/1` เมื่อ 2026-10-30) — บันทึกค่าเป็น 0/1 เท่านั้น ห้ามบันทึก secret
2. **Quiesce:** หยุด Obsidian sync และ writer (Safe Edit / intake / market-price collector) อย่างปลอดภัย เพื่อได้ชุดข้อมูลที่ coherent — **ห้ามเปลี่ยนค่า variable ถาวร**; ถ้าวิธีเดียวคือเปลี่ยน variable ให้ STOP และขออนุมัติ
3. **Backup coherent set:** SQLite ผ่าน online backup API / `VACUUM INTO` (รวม committed WAL) **ห้าม `cp` ไฟล์ DB ขณะเปิด WAL**, + vault directory, + รายการ config (ชื่อ variable, ไม่ใช่ค่า)
4. **Encrypt + off-volume:** เข้ารหัสด้วยกุญแจที่ Owner ถือผ่านช่องทาง secure, เก็บนอก volume (เช่น private Drive/Object store ที่ Owner อนุมัติ); บันทึก ciphertext SHA-256 + storage receipt
5. **Resume:** เปิด sync/writer กลับสถานะเดิม; ตรวจ `/api/health`, deployment ID เดิม, sync running
6. **Isolated restore:** decrypt + restore ลงสภาพแวดล้อมแยก (ไม่ใช่ M4, ไม่ใช่ Production volume); รัน `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, นับ row ตารางหลัก, ยืนยัน schema `account.issuer` + index ตรงกับที่ระบุ
7. **ซ้อม schema cleanup บนสำเนา** ด้วย `scripts/account-issuer-cleanup.mjs` (PR #135 `e9b467e`, CI run `41172276011` ผ่าน; อยู่ใน image ที่ `/app/account-issuer-cleanup.mjs`) — procedure ที่ (ก) เก็บ account identity, password hash, OAuth clients/consents/tokens และตาราง/index อื่นทั้งหมด (ข) จัดการ `account.issuer` NOT NULL + `account_issuer_accountId_uidx` (ค) มี rollback procedure; รันบนสำเนา แล้วบูต candidate `d355d90` บนสำเนาเพื่อตรวจ admin sign-in + OAuth metadata
8. ส่ง procedure + ผล diff schema ก่อน/หลัง เป็น artifact (ไม่มีข้อมูลผู้ใช้/secret)

## 5. Permissions and hard stops
- **Authorized (เมื่อ Owner อนุมัติ Task นี้):** อ่าน Production runtime; หยุด/เปิด sync+writer ชั่วคราวเพื่อ backup; สร้าง backup เข้ารหัสนอก volume; สร้างสภาพแวดล้อม restore แยกชั่วคราว
- **Not authorized:** แก้ schema/ข้อมูลบน Production, deploy, redeploy, เปลี่ยน source/branch/auto-deploy, merge PR, แก้ M4/DR-Staging, เปลี่ยน writer flags/OAuth secrets/variables ถาวร, ส่ง secret หรือเนื้อหา vault เข้า GitHub/chat/log, ใช้บริการที่มีค่าใช้จ่ายใหม่โดยไม่ขออนุมัติ
- **Stop if:** preflight ไม่ตรง §2; มี replica/writer อื่น; backup ไม่ผ่าน integrity; restore ไม่ได้; ต้องเปลี่ยน variable ถาวรเพื่อ quiesce; ระบบไม่กลับมา healthy หลัง resume (→ แจ้ง Owner ทันที); พบ auto-deploy ที่ไม่คาดคิด

## 6. Definition of Done
- Production กลับมาสถานะเดิม: deployment `b8a2b39a`, commit `71cc417`, health OK, sync running, writer flags เท่าก่อนเริ่ม
- Backup เข้ารหัสนอก volume พร้อม ciphertext SHA-256 + storage receipt + เวลา quiesce/resume
- Restore แยกผ่าน integrity/FK check, schema ตรงที่ระบุ, Owner ยืนยันว่ามีกุญแจ decrypt ใน recovery channel
- Schema cleanup + rollback procedure ซ้อมผ่านบนสำเนา และ candidate `d355d90` boot + admin sign-in ผ่านบนสำเนา
- ไม่มีการเปลี่ยนแปลงบน Production นอกจากหยุด/เปิด sync+writer ชั่วคราว

## 7. Required return
`IOS-RETURN-OPS-005_YYYY-MM-DD_TH.md` + artifacts (procedure SQL, schema diff, checksums) — ไม่มี secret/vault content
ระบุแยกให้ชัด: สิ่งที่ "ทำสำเร็จจริง" vs "พยายามแต่ไม่สำเร็จ" และหลักฐานที่ตรวจเองได้ vs ที่ operator รายงาน

## 8. งานถัดไป (ยังไม่อนุมัติ — แยก Task)
**IOS-TASK-OPS-006 Cutover:** ต้องจัดการ auto-deploy ก่อน — Railway Production ผูก `main` และ deploy อัตโนมัติ ดังนั้นต้อง (ก) ปิด auto-deploy หรือ (ข) merge ในหน้าต่าง maintenance ที่รัน schema procedure ทันที; รวม Gate 4–5 และ real ChatGPT Read Only reconnect
