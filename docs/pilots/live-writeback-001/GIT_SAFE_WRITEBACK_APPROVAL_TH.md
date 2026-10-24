# Git Safe Writeback Pilot — Deployment / Acceptance Approval Package

ขอบเขต: สร้างโน้ตใหม่หนึ่งไฟล์เท่านั้น ไม่ใช่ Investment Graph Bundle หรือ production acceptance

## Candidate

Baseline `319b0a08c4b5b8c4bbd042e457ab7a2eefd96a8e`; ใช้ development branch/PR #108 เดิม
Candidate คือ commit ที่เพิ่มไฟล์นี้และ Git pilot code — บันทึก full SHA จาก `git rev-parse HEAD` ก่อนอนุมัติ Deploy
ห้ามใช้ baseline เดิมแทน candidate ที่มี implementation

## Owner ต้องอนุมัติแยกก่อน Apply

1. ตรวจ source/image candidate SHA และ CI จริง เปิดเฉพาะ staging service `0f673bc3-e433-4641-85a8-12b2678eb040`
   project `8ac4a414-9f0b-4a90-bcce-4995e5736d9d`, environment `bce3bde4-29c1-44e5-8cfe-7400db9f7f51`
2. ยืนยัน platform มีหนึ่ง replica ไม่มี deployment overlap/alternate local writer, private test remote ไม่มีผู้เขียนพร้อมกัน
   พักผู้เขียน remote อื่นตลอด pilot และแนะนำ branch protection ห้าม force-push/delete
   trusted temporary pre-push hook ตรวจ advertised remote OID ตรง approved base; Git protocol ตรวจ OID อีกครั้งตอนอัปเดต ref โดยไม่ใช้ force
   `RAILWAY_REPLICA_COUNT=1` เป็น acknowledgement ต้องตรวจจำนวนจริงจาก Railway ด้วย
3. Backup SQLite แบบ WAL-consistent พร้อม journal และ Test Vault/Git metadata ไปยัง staging-only backup ที่อ่านคืนได้
   ตรวจงบ infrastructure US$1/30วันและ usage คงเหลือก่อน compute; ไม่มีการอนุมัติเพิ่มวงเงินใน package นี้
4. ตรวจ staging OAuth/admin session แยกจาก Production และ credential Git จำกัดเฉพาะ Contents write ของ Test Vault
   ห้ามส่ง token ในแชต/URL/log; ใช้ credential storage เดิม ไม่มีการตั้ง credential ในรอบพัฒนา
5. อนุมัติ concrete test note content และการสร้างใน private Test Vault; การอนุมัติ Deploy ไม่แทน approval ของ note

## Exact proposed configuration (ยังไม่ได้ Apply)

```
DATA_DIR=/pilot-001-data
GIT_SAFE_WRITEBACK_PILOT=1
SAFE_EDIT_ENABLED=1
SAFE_EDIT_SINGLE_WRITER=1
RAILWAY_REPLICA_COUNT=1
CLOUD_INTAKE=0
INVESTMENT_GRAPH_BUNDLE_ENABLED=0
```

Railway ต้อง inject project/environment/service IDs ตรงกับข้างต้น ไม่ใช้ Production IDs
Persistent mount `/pilot-001-data`; real Vault root `/pilot-001-data/vault` ต้องไม่มี symlink
Settings เดิมต้องตรงทุกตัว:

```
sync_backend=git
git_remote=https://github.com/varat1122/investment-os-staging-test-vault.git
git_branch=main
```

Remote URL ที่ไม่มี `.git`, SSH URL หรือ branch อื่นจะถูกปฏิเสธโดยตั้งใจ
อย่าเปลี่ยนค่าหรือ credential จริงจน Owner อนุมัติ scope นั้น
ไม่มี public endpoint, OAuth configuration หรือ Writer Flags ถูกแก้โดยงานพัฒนานี้
หากต้องใช้ endpoint เพื่อ ChatGPT/admin approval ให้ Owner ตรวจและอนุมัติ staging-only endpoint/OAuth แยกก่อน

## Acceptance ผ่าน ChatGPT จริง

1. ต่อ Test-only Safe Edit MCP `/api/safe-edit` ด้วย OAuth `vault:read vault:edit`
   ต้องเห็นเพียง `preview_edit`, `create_note`, `apply_edit`, `get_edit_status`
2. ตรวจ Git worktree/index สะอาดและ local HEAD ตรงกับ remote main; note ยังไม่มี
3. `create_note` ด้วย operationId คงที่ เช่น `pilot001-git-20261024-001`, path
   `PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md`, content ที่ Owner ตรวจแล้ว
4. อ่าน diff, beforeHash, afterHash, gitBase; เปิด approvalUrl ลงชื่อเข้า staging admin แล้ว Approve exact diff ภายใน 30 นาที
   OAuth consent หรือข้อความว่าอนุมัติในแชตอย่างเดียวไม่แทน server-recorded approval
5. Host อนุมัติ concrete `apply_edit` โดยใช้ operationId, previewToken เดิมและ expectedHash=beforeHash
6. ตรวจ `get_edit_status`: local write/readback/reindex verified และ `receipt.gitPilot.state=verified`
   receipt มี base, commit, remoteSha256=afterHash
7. ตรวจจาก GitHub Test Vault อิสระว่า commit เพิ่มเฉพาะหนึ่งไฟล์, parent ตรง gitBase,
   bytes รวม newline ตรง afterHash; NoteMesh read_note/search เห็นโน้ตตรงกัน
8. ส่ง apply เดิมอีกครั้ง: ไม่มี commit/push เพิ่ม; protected notes และ production ไม่เปลี่ยน

PASS เฉพาะเมื่อหลักฐานทั้งหมดตรงกัน; hash/commit mismatch = FAIL; missing approval/scope/CI = BLOCKED
Tests กับ bare remote ชั่วคราวเป็น offline integration ไม่ใช่ Live ChatGPT PASS หรือ device-sync PASS

## Partial failure / restart / rollback

`preview` -> local engine stages -> `local_written` -> `push_unknown` -> `pushed` -> `verified`
`push_unknown` อาจหมายถึง remote รับสำเร็จแต่ client timeout ต้องตรวจ remote โดยเจ้าของ ห้าม retry อัตโนมัติ
`partial_hold`, interrupted engine `writing`, stale lock, `pushed` แต่ยังไม่ verified: manual reconciliation เท่านั้น
Crash ระหว่าง local write กับ Git receipt อาจเห็น engine written + Git preview; note existing จะบล็อก replay
`git-pilot-hold` บน persistent DATA_DIR บล็อก background Git reconcile แม้ restart หรือปิด feature flag
Success ก็เก็บ hold ไว้เพื่อจำกัด pilot; background sync จะไม่ resume อัตโนมัติ

Rollback: ปิด writer flags และ pilot flag หยุด computeตามขั้นตอนที่ Owner อนุมัติ
คง hold, DB/WAL/journal/backup, .git และ note ทั้งหมดไว้ ห้ามลบ lock/hold เพื่อแก้ failure อัตโนมัติ
ห้าม `reset --hard`, force push, restore ทับ active DB หรือใช้ image เก่าที่ไม่รู้จัก hold ขณะที่ Git sync ยังทำงาน
Rollback ของ create ไม่ลบ note; การแก้/ลบ remote note ต้อง review และอนุมัติใหม่ต่างหาก
เก็บ SHA/receipt/remote state ก่อนเปิด sync หรือเปลี่ยน image ทุกครั้ง

## ข้อจำกัด

IDs/env flags ไม่ใช่ cryptographic platform attestation; Owner ต้องตรวจ replica/volume/OAuth scope จริง
Atomic หมายถึง local filesystem publication; local write และ network push ไม่เป็น distributed transaction
Remote readback ใช้ authenticated fetch + Git blob bytes ไม่ใช่หลักฐานถึง Obsidian Desktop/Mobile
ยังไม่รองรับ timeline append, protected Thesis, Portfolio หรือ next-event graph acceptance ใน Git pilot นี้
ไม่มี dependency, service, schema stack, paid inference หรือ evaluation campaign ใหม่

## Local validation

125/125 relevant tests passed (6 existing Vitest files); full lint, typecheck, production build passed.
Includes a real temporary bare Git remote; only Railway/filesystem deployment attestation is synthetic in the success fixture.
Policy tests separately cover disabled gate and wrong IDs/root/replica/backend/remote/branch/flags.
GitHub CI, Docker/E2E, live staging/frontend, device sync and fresh dependency audit are not established by these results.
No dependency or lockfile changes. The existing Obsidian pause boundary is byte-for-byte unchanged.
