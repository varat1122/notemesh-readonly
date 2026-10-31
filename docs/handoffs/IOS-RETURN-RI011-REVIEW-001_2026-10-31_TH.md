---
task_id: IOS-RETURN-RI011-REVIEW-001
executor: Claude Code
as_of: 2026-10-31T00:00:00+07:00
outcome: COMPLETED (read-only code review)
execution_target: PR #136 @ 6598e33 — production code only (server.ts, investment-hybrid-readonly.ts, canonical-writeback-workflow.ts)
artifact_version: 1
---
# IOS Return — Code review RI-011 (PR #136)

## Executive result
ไม่พบ bug ที่ทำให้เขียนข้อมูลผิดหรือรายงาน SAVED/VERIFIED ผิด ทุก gate ยังเป็น `false` และ HOLD แบบ conservative
พบข้อปรับเล็ก 2 จุด (ไม่ block merge) — ส่งให้ Codex พิจารณาเมื่อ rebase ตาม IOS-TASK-SEC-002

## Findings
| # | Severity | File | ประเด็น | ผลกระทบ |
|---|---|---|---|---|
| 1 | low | `canonical-writeback-workflow.ts` (หลัง Review→Source link check) | ถ้า Review เป็น `hold_index_repair` และมี `qualityIssues` ด้วย state ถูกเขียนทับเป็น `hold_quality_gate` → status รายงาน `hold_research_quality` แทน `hold_conflict_or_index` | ยังปลอดภัย (`readyForNextNews=false`) แต่ซ่อนว่าลิงก์ index เสีย ผู้ใช้อาจแก้คุณภาพแล้วเจอ HOLD อีกรอบ แนะนำ: ไม่เขียนทับเมื่อ state เป็น `hold_index_repair` |
| 2 | low | `investment-hybrid-readonly.ts` readback excerpt | หา index บน `content.toLowerCase()` แล้ว slice บน `content` เดิม; อักขระที่ lower-case แล้วยาวขึ้น (เช่น `İ`) ทำให้ offset เลื่อน | แค่ excerpt/line number คลาด ไม่กระทบ classification; ภาษาไทย/อังกฤษปกติไม่โดน |
| 3 | info | `comparableSource` | ยอมรับเฉพาะ `https:`; trailing slash ต่างกัน = คนละ source | conservative → HOLD_ORIGINAL_SOURCE_IDENTITY / ไม่ match ถือว่าถูกตามหลัก P-01 |
| 4 | info | `candidateCapReached = length>=12` | ผลครบ 12 พอดีก็ HOLD | conservative ยอมรับได้ |

## ตรวจแล้วถูกต้อง
- `normalizedAmount` ใช้ BigInt scaled ไม่มี float; `1.5 USD bn == 1500 USD mn` ถูก
- Review→Source link check ใช้ `links(source_path, resolved_path)` ตรง schema ใน `src/server/db.ts`; `hold_index_repair` ทำให้ `blocked=true` → ไม่ `saved_verified`
- self-source HOLD repair: ไม่ HOLD เฉพาะเมื่อ candidate เดียวคือ Source ของตัวเองและ scan ไม่ truncated
- MCP tool ลงทะเบียนเป็น `READ` และ fence ข้อความ historical ทุก field ที่มาจาก Vault (prompt-injection boundary)

## Evidence / no-rerun
ไม่รัน tests ซ้ำ — CI run 41151497577 job `test` PASS บน SHA เดียวกัน (IOS-GOV-001 §11.2)

## Safety & no-touch
ไม่แก้ branch #136, ไม่ comment บน PR, ไม่ merge/deploy
