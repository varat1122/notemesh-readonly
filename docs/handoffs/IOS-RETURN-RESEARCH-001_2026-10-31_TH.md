---
task_id: IOS-RETURN-RESEARCH-001
executor: Claude Code
as_of: 2026-10-31
outcome: COMPLETED (G1 CODED + local tests; CI ยังไม่รัน)
execution_target: branch ccr-7f1243c0-c9cv8x
---
# IOS Return — Specialist output contract (Blueprint §07.3)

## สิ่งที่ทำ
- `src/server/vault/research-specialist-output.ts` — type + validator แบบ pure (ไม่มี I/O, ไม่ลงทะเบียน MCP tool)
- `compareSpecialistOutputs` — รายงานความเห็นต่างและนับ source ที่ไม่ซ้ำ (ไม่โหวต, P-08 / §07.1)
- ADR-001..006 → ACCEPTED ตาม Owner อนุมัติ

## กติกาที่บังคับ
- claim ที่ไม่ใช่ `ai_inference` ต้องมี source id
- ตัวเลขต้องมี source หรือเป็น `model` ที่ระบุ assumptions (P-09)
- `thesis_changing`/`contradiction` ต้องมี claim ที่มี source อย่างน้อย 1
- ไม่ abstain → ต้องมี mechanism, findings, counter-evidence
- abstain → ต้องมีเหตุผลจาก §07.3, impact = `none`, ไม่มีตัวเลข
- `asOf` ต้องเป็นวันที่จริง หรือ timestamp ที่มี timezone

## หลักฐาน
- vitest ไฟล์นี้ 9/9 ผ่าน, eslint ผ่าน, `tsc --noEmit` ผ่าน (local, node 22; CI ใช้ node 24)
- ไม่ใช้ zod → ไม่ชนกับการอัป zod 4 ใน PR #135

## No-touch
ไม่แตะ safe-edit, canonical-writeback, auth, lockfile, MCP server, Vault, Railway

## Next
- ต่อเข้า MCP เป็น tool read-only `validate_specialist_output` (ต้องแก้ `mcp/server.ts` + catalog test → ชนกับ PR #136 → ทำหลัง rebase)
- Typed edge contract (ADR-006 ขั้น A)
