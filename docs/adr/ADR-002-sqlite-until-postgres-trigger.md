---
adr: 002
title: SQLite until a PostgreSQL trigger is met
status: PROPOSED
date: 2026-10-31
deviates_from: Blueprint v1.0 §05.1 (PostgreSQL as canonical relational store)
---
# ADR-002 SQLite จนกว่าจะถึงเงื่อนไขย้าย PostgreSQL

## Context
ระบบใช้ `better-sqlite3` บน Railway volume, 1 replica, 1 writer (`docs/SAFE_EDIT.md`, `docs/GOOGLE_DRIVE_PRICES.md`) ตารางปัจจุบันรวม notes/links/revisions/safe_edit_*/bars/instruments/source_snapshots/attachments/tasks/actions

## Decision
คง SQLite เป็น relational store สำหรับ pilot ส่วนตัว โดยมีกติกา:
1. Domain ID (`entity_id`, `listing_id`, `claim_id`, …) ไม่ผูกกับ engine
2. Schema ใหม่ต้องมี versioned migration และ backup แบบ WAL-consistent (IOS-GOV-001 §6.1)
3. ห้าม `cp` ไฟล์ DB ขณะ WAL เปิดอยู่
4. Portfolio ledger (เมื่อทำ) แยกไฟล์ DB จาก auth/index DB

## Migration trigger (ย้าย PostgreSQL เมื่อเกิดข้อใดข้อหนึ่ง)
- ต้องการ >1 replica หรือ writer พร้อมกัน
- ผู้ใช้ >1 คน / multi-tenant
- ต้องมี point-in-time recovery ที่ SQLite + volume snapshot ทำไม่ได้
- Portfolio ledger ต้องการ audit/backup ระดับที่ Owner กำหนด

## Alternatives
- ย้าย PG ตอนนี้ — เพิ่มต้นทุน/ops โดยไม่มีปัญหา concurrency จริง

## Consequences
- + ไม่มีต้นทุน hosting เพิ่ม
- − ต้องรักษา single-writer อย่างเคร่งครัด (เป็น operational assertion ไม่ใช่ distributed lock)

## Evidence
`src/server/db.ts`, `docs/INVESTMENT_DATA_ARCHITECTURE.md` (ย่อหน้า SQLite/PostgreSQL)

## Owner approval
ยังไม่อนุมัติ
