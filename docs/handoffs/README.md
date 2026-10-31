# IOS Handoffs — Claude Code ↔ Codex

ช่องทางส่งต่องานระหว่าง Engineer สองฝั่งตาม IOS-GOV-001 §9 (One Task → One Executor → One Return → Chat Acceptance)

- `IOS-TASK-<AREA>-<NNN>_YYYY-MM-DD_TH.md` — งานที่ส่งให้ executor หนึ่งราย
- `IOS-RETURN-<AREA>-<NNN>_YYYY-MM-DD_TH.md` — ผลจริงจาก executor
- `IOS-DECISION-<AREA>-<NNN>_YYYY-MM-DD_TH.md` — การตรวจรับของ Chat/Owner

กฎ
- ไม่แก้ branch/PR ของอีกฝ่ายโดยไม่มี Task ที่ระบุชื่อผู้ทำ
- ทุก Return ต้องมี SHA, CI run ID, สิ่งที่ไม่ได้แตะ
- ไม่มี secret, ไม่มี vendor data, ไม่ merge/deploy จากไฟล์ในโฟลเดอร์นี้
- ไฟล์ `.md` เป็นหลักฐานการส่งต่อ ไม่ใช่ server receipt

## บทบาท (Owner กำหนด 2026-10-31)
- **Codex** = ผู้พัฒนาหลัก (Primary Engineer) ของทุก workstream
- **Claude Code** = ส่วนเสริม + **Independent Verifier**: ตรวจ PR/CI/diff ของ Codex, ตรวจสถานะจริงบน GitHub/Railway แบบ read-only, รายงาน `IOS-VERIFY-<AREA>-<NNN>`; เขียนโค้ดเฉพาะเมื่อได้รับมอบหมาย
- Claude Code ไม่ push ไป branch ของ Codex, ไม่ comment บน PR โดยไม่ได้สั่ง, ไม่ merge/deploy/แก้ Railway
- งานที่ Claude ทำไปแล้วบน `ccr-7f1243c0-c9cv8x` (ADR, specialist schema, typed edge) เป็นข้อเสนอให้ Codex รับไปใช้หรือปฏิเสธ
