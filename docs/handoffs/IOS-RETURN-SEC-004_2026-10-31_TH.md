---
task_id: IOS-RETURN-SEC-004
executor: Claude Code (แทน Codex; Owner อนุมัติ 2026-10-31)
as_of: 2026-10-31
outcome: PENDING_CI
execution_target: PR #136 branch feat/ri011-readonly-hybrid-reconcile-20261031
---
# IOS Return — Rebase PR #136 บน PR #135

## Owner decision
- **ไม่ merge #135** ตอนนี้: Railway Production (`wholesome-wholeness`/NoteMesh) ผูก `varat1122/notemesh-readonly@main` และ deploy อัตโนมัติ (#125/#126/#127 deploy ทุกครั้งหลัง merge) → merge #135 = deploy ขึ้น Production ก่อน schema gate ของ `account.issuer`
- rebase #136 บน #135 แทน (ทาง A ใหม่)

## Baseline vs Current
| Item | Before | After |
|---|---|---|
| #136 head | `6598e33` (base main@71cc417) | `f07d037` (base `d355d90`) |
| PR base | `main` | `fix/ios-oauth-readonly-resource-scopes-20261030` |
| diff vs base | 13 files +1382/−7 | 13 files +1382/−7 (เท่าเดิม) |

## Evidence (local, node 22)
`git rebase --onto d355d90 71cc417` 21 commits ไม่มี conflict; install frozen, audit exit 0, lint, typecheck, build, tests 1518/1518 (112 files)
Force push ใช้ `--force-with-lease` ผูกกับ head เดิม `6598e33`

## No-touch
ไม่ merge, ไม่ deploy, ไม่แตะ Railway/Vault/variables

## Next
- CI บน `f07d037`
- หลัง #135 squash-merge → retarget #136 เป็น `main` และ rebase อีกครั้ง (squash ตัด ancestry)
