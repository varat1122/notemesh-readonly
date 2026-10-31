---
task_id: IOS-RETURN-SEC-003
executor: Claude Code (แทน Codex ระหว่าง token หมด; Owner อนุมัติในแชต 2026-10-31)
as_of: 2026-10-31
outcome: COMPLETED (CI_PASSED on d355d90)
execution_target: PR #135 branch fix/ios-oauth-readonly-resource-scopes-20261030
---
# IOS Return — ยกการแก้ node-forge เข้า PR #135

## Baseline vs Current
| Item | Before | After |
|---|---|---|
| #135 head | `4896dbe` | `d355d90` |
| `pnpm audit --prod --audit-level=high` (local) | 6 high (node-forge ×5 ใหม่) → FAIL | exit 0 (4 low, 22 moderate) |
| node-forge | 1.4.0 + ignore GHSA-86w9 | override `1.4.2`, ถอด ignore |

## Actions
1. นำ 3 ไฟล์จาก #137 (`88a203d`): `pnpm-workspace.yaml`, `pnpm-lock.yaml` (เฉพาะบรรทัด node-forge), `tests/ci/workflows.test.ts`
2. ตรวจ integrity `node-forge@1.4.2` ตรงกับ npm registry (published 2026-10-27)
3. Local: install frozen, audit, lint, typecheck, build, unit tests 1469/1469 (node 22)
4. Push → CI run ใหม่บน `d355d90`

## ยังไม่ได้ทำ / ไม่ได้แตะ
- CI run 41168580979 บน d355d90: audit ✅ test ✅ (unit + E2E) image ✅
- ไม่ merge, ไม่ deploy, ไม่แตะ Production/M4/variables
- Production deploy ของ #135 ยัง HOLD ตามเดิม (legacy `account.issuer` schema)

## Next
- CI เขียว → Owner ตัดสินใจ squash merge #135 (IOS-VERIFY-OPS-001 §4)
- หลัง merge → rebase #136 (IOS-TASK-SEC-002 ทาง A)
