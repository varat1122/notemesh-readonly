# M4 — Owner-reviewed Investment Research Writeback

## สิ่งที่ส่งมอบ

ต่อยอด PR #112 ที่ `ec33c93d6c05c6738af81c92e83be30ed48cf74c` ใน branch M4 แยก
ไม่มีการแก้ PR #112/main, ไม่มี deployment, live Vault write, restore, credential change หรือ paid inference
Source repo ตรวจผ่านหน้า GitHub ที่ไม่ล็อกอินได้ว่า Public: เอกสารและ fixtures นี้ใช้ข้อมูลสมมติเท่านั้น

เส้นทาง: ChatGPT วิเคราะห์จาก source/history → export graph bundle JSON เดิม → เจ้าของ import → ตรวจ full diff สองไฟล์
→ เปิด admin approval เดิมคนละรายการ → Check approvals → Owner Apply ครั้งเดียว → Safe Edit → Git transaction → graph/remote readback
Web transport นี้เป็น human-operated route; ไม่ใช่ proxy ของ MCP และไม่เปลี่ยนชื่อ tool/ปลอม `oauth:` เพื่อหลบ platform block

## ติดตั้งใน ChatGPT Project

ใช้ Master Analyst Instructions เดิม แล้วแนบไฟล์นี้เพิ่ม ผู้ใช้เริ่มด้วยข่าวตามปกติ
เมื่อขอบันทึกและ direct MCP write ถูก platform block ให้รายงาน block และเสนอแพ็กเกจสำหรับเจ้าของตรวจเท่านั้น
ใช้ชื่อ tool เดิม `prepare_investment_graph_review` (read-only) เพื่อรับ source SHA/canonical paths/history
Git endpoint เปิดเผย read-only preparation เดิมเพิ่ม ไม่เปิด graph mutation tool
หากไม่มี tool หรือ source note/company/timeline ยังไม่มี ให้หยุดที่ missing prerequisite ห้ามสร้าง hash/path ขึ้นเอง

คำสั่งสั้น:
> วิเคราะห์ข่าวนี้โดยใช้ประวัติจาก Vault แล้วเตรียม Research Review Package ให้เจ้าของตรวจ ยังไม่บันทึก

Export **existing `InvestmentGraphBundleInput` JSON** จาก `src/server/safe-edit/investment-graph-bundle.ts`:
`operationRoot, issuer, eventKey, period, timelineDate, timelineHeading, analysisPath, timelinePath, sourcePath, analysisMarkdown, expectedSourceSha256`
ไม่มี schema ใหม่ ไม่มี approved/actor/token fields ใน package และไม่อนุญาต `recoverTimelineOnly=true`
Analysis ต้องเป็น `investment_review`, `source_type: archived_ai`, `independent_evidence: false`, `verification: not_reverified|unverified`, `status: draft`
ต้องมี `operation_id`, event/operation markers, source_path/source_sha256 และ canonical Source/Company/Timeline links ตาม contract เดิม
AI ไม่กรอกตัวเลข/เหตุผลที่ไม่มีหลักฐาน และไม่อ้างว่า archived analysis เป็นหลักฐานอิสระ

## ขั้นตอนของเจ้าของหลังแยกอนุมัติ Staging Deployment

1. ตรวจ CI ของ exact candidate และ scope/isolation/backup/usage ก่อนอนุมัติ deployment แยกต่างหาก
2. เปิด staging `/api/staging-research-review` และ sign in ด้วย admin ของ staging (ระบบเดิม single-admin)
3. วาง JSON แล้ว Import: มี journal/coordination metadata และ previews แต่ยังไม่มี note write/commit/push
4. ตรวจ full diff ของ Analysis ใหม่และ Timeline append, source SHA, context และ reference-anchor hashes
   Thesis/Evidence Register อ่านเพื่อเปรียบเทียบเท่านั้น; missing references จะแสดง null ไม่ถือว่า approved thesis
5. เปิด approvalUrl ของแต่ละรายการใน tab แยก ตรวจ exact diff แล้ว Approve ทั้งสองรายการ
   เป็น approval อิสระจาก AI/เครื่องมือ; ไม่ได้อ้างว่าต้องมีมนุษย์สองคน ระบบเดิมมี admin เดียว
6. กลับ tab เดิม Check approvals: Apply ปรากฏเมื่อทั้งคู่ approved และยังไม่หมดอายุ (30 นาที)
7. กด Apply ครั้งเดียว: ตรวจทั้งสอง token/approval/HEAD/source/history/CAS ก่อนเริ่มเขียน
8. ตรวจผลต้องเป็น `owner_research_git_and_graph_verified` และ Git stage `research_verified`
   ตรวจ Test Vault GitHub independently: parent SHA, diff เพิ่ม Analysis หนึ่งไฟล์+แก้ Timeline หนึ่งไฟล์,
   remote blob SHA-256/physical bytes/SQLite FTS/Wikilinks/backlink ตรง receipt
9. ข่าว B เรียก preparation/context ใหม่: ต้องพบ A เป็น archived AI/non-independent ไม่สร้าง Event A ซ้ำ

## Proposed staging config — ยังไม่ Apply

คง Test Vault remote และ project/environment/service allowlist เดิมจาก `git-pilot-policy.ts`
คง `DATA_DIR` บน persistent staging mount, backend Git, branch main ของ **private Test Vault** เดิม
Owner ต้องตรวจ Test Vault visibility/credential scope จริงก่อนทดลอง ไม่มี production mount/Sync/OAuth sharing

```
GIT_SAFE_WRITEBACK_PILOT=1
GIT_RESEARCH_WRITEBACK_M4=1
SAFE_EDIT_ENABLED=1
SAFE_EDIT_SINGLE_WRITER=1
RAILWAY_REPLICA_COUNT=1
CLOUD_INTAKE=0
INVESTMENT_GRAPH_BUNDLE_ENABLED=0
```

M4 flag default OFF; Graph MCP flag คง OFF และ Obsidian paused-Sync boundary ไม่เปลี่ยน
หนึ่ง replica จริง ไม่ใช่แค่ env acknowledgement; ไม่มี rolling overlap หรือ alternate writer
Admin session/OAuth ใช้ staging-only credentials เดิม ไม่มีการสร้าง/rotate credentials ในงานนี้
Direct ChatGPT `apply_edit` ยังคงเคารพ platform authorization; ไม่มีการอ้างว่า frontend write ผ่านแล้ว

## Failure / Recovery / Rollback

Package/IDs และ before/after hashes ถูก bind ใน journal เดิม; browser ไม่ส่งเนื้อหาใหม่ตอน Apply
`research_preview` → `research_applying` → Git `push_unknown`/`pushed`/`verified` → `research_verified`
สอง note เป็น local atomic publication ทีละไฟล์ ไม่ใช่ distributed/multi-file atomic transaction
หาก Timeline เขียนไม่สำเร็จ Analysis อาจอยู่แล้ว ต้องรายงาน partial/manual review ไม่ประกาศสำเร็จ
หลังเริ่ม Apply ทุกผลที่ไม่แน่ชัดเป็น terminal สำหรับ transport นี้: replay อ่านสถานะโดยไม่เขียน/commit/push ซ้ำ
ใช้ GET `/api/staging-research-review?operationRoot=<same root>` ภายใต้ session เดิมตรวจ receipt แบบ read-only
`git-pilot-hold` และ stale transaction lock อยู่บน persistent data root เพื่อบล็อก background push หลัง restart
ห้ามลบ lock/hold, reset, force push หรือสร้าง operation ใหม่เพื่อข้าม partial state

Rollback ขั้นแรก: แยกอนุมัติปิด writers/M4 flagและหยุด service; เก็บ DB/WAL/journal/hold/.git/notes ไว้ครบ
ห้ามนำ image เก่าที่ไม่รู้จัก hold กลับมารันพร้อม Git sync; ห้าม live restore/ลบ created Analysis อัตโนมัติ
Reconciliation/restore หรือ Test Vault correction ใด ๆ ต้องแยก owner scope/backup/approval อีกครั้ง

## Acceptance boundaries / external blockers

Synthetic fixtures: deployment attestation เท่านั้นถูกจำลอง; auth-route tests จำลอง session adapter
Safe Edit, local Git/bare remote, SQLite/FTS และ graph verification เป็น implementation จริง
Local dashboard E2E ใช้ browser จริงบน synthetic server แต่ไม่ใช่ ChatGPT frontend หรือ Live Staging PASS
Public source visibility ยืนยันแล้ว; ไม่เปลี่ยน visibility ไม่ส่ง private Vault data/secrets เข้า source repo
GitHub API ของ cloud session ตอบ Forbidden: PR metadata/creation/CI API ต้องใช้สิทธิ์ Owner หรือ restore connection
CI ถูกตั้งให้รันเฉพาะ branch M4 นี้ด้วย เพื่อให้ push trigger validation ได้แม้ PR API ใช้ไม่ได้

Known reviewed dependency exceptions ต้องรายงานตาม audit จริง ไม่อ้างว่า audit-policy PASS เท่ากับ zero advisories
M1 ไม่เปิดทดสอบสดซ้ำ, M2 ยังคง PAUSED, M3 CI ตาม Owner เป็น historical evidence ไม่ใช่ proof ของ candidate M4
Live Staging, ChatGPT tool registration, production readiness และ device sync ยัง NOT VERIFIED
