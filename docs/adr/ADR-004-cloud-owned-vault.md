---
adr: 004
title: Cloud-owned Vault with one-way device sync
status: ACCEPTED
accepted: 2026-10-31 (Owner, in chat)
date: 2026-10-31
deviates_from: Blueprint v1.0 §02.2 (local-first Vault agent)
---
# ADR-004 Cloud-owned Vault

## Context
Blueprint เสนอ local-first (Vault บนเครื่อง + agent) แต่ระบบจริง: Railway volume ถือ Vault, `obsidian-headless` ทำ sync, Safe Edit หยุด sync ก่อน CAS/rename (`safe-edit/sync.ts`), 1 server writer

## Decision
Server บน Railway เป็น **writer เดียวของ Vault**
- อุปกรณ์ (Obsidian desktop/mobile) เป็นผู้อ่าน/ผู้รับ sync
- การเขียนทุกครั้งผ่าน Safe Edit (preview → apply → receipt → readback → reindex)
- Server sync `running` ≠ อุปกรณ์ได้รับแล้ว (REMOTE_SYNC_VERIFIED ต้องตรวจแยก — IOS-GOV-001 §8.3)
- Sync ไม่ใช่ backup: ต้องมี backup ของ volume + DB แยก และทดสอบ restore

## Trust boundary
- Cloud ไม่มีสิทธิ์อ่าน folder บนเครื่องผู้ใช้
- ห้ามมี writer ที่สอง (desktop plugin, CLI) เขียน Vault เดียวกันพร้อมกัน

## Alternatives
- Local-first ตาม Blueprint — ต้องมีเครื่องเปิดตลอดเวลาเพื่อให้ ChatGPT/MCP เข้าถึง

## Consequences
- + ChatGPT เข้าถึงได้ตลอด
- − ความเสี่ยงอยู่ที่ volume เดียว → backup/restore drill เป็น gate บังคับ (P9)

## Evidence
`src/server/safe-edit/sync.ts`, `src/server/sync/`, `docs/SAFE_EDIT.md`, `READ_ONLY_DEPLOYMENT.md`

## Owner approval
ACCEPTED โดย Owner 2026-10-31 (อนุมัติ ADR ทั้งชุดในแชต) — การอนุมัติ ADR ไม่เปิดสิทธิ์ deploy, ค่าใช้จ่าย หรือ provider ใหม่
