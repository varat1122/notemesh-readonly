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
