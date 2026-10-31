---
adr: 005
title: Market data provider policy
status: ACCEPTED
accepted: 2026-10-31 (Owner, in chat)
date: 2026-10-31
relates_to: Blueprint v1.0 §04, §21.4
---
# ADR-005 Market data provider

## Context
`market-prices/yahoo.ts` ดึง chart endpoint ของ Yahoo Blueprint §04 จัด Yahoo/yfinance เป็น "unofficial, prototype only, not primary production feed"

## Decision
- Yahoo ใช้ได้เฉพาะ **research pilot ส่วนตัว** ต่อไป ข้อมูลที่ได้ติด label `provider=yahoo`, `license=unofficial_personal`
- ห้ามใช้ผล Yahoo เป็นฐาน **Quant production, backtest ที่อ้างผล, หรือแชร์ต่อ**
- ก่อน P4 ต้องเลือก provider ทางการผ่าน vendor checklist (§04): coverage US/TH/HK/JP, adjustment, corporate actions, terms, rate limit, ต้นทุน
- FX รายวัน: เพิ่ม Frankfurter (daily reference rate, ไม่ใช่ executable FX)
- ทุก adapter ใหม่ต้อง normalize ตาม §21.4 และไม่ fallback ข้าม provider เงียบ ๆ

## Alternatives
- เปลี่ยนตอนนี้ — ยังไม่มี Owner อนุมัติค่าใช้จ่าย/สิทธิ์

## Consequences
- งาน Quant production ถูก block จนกว่า provider ผ่าน checklist + Owner อนุมัติ

## Owner approval
ACCEPTED โดย Owner 2026-10-31 (อนุมัติ ADR ทั้งชุดในแชต) — การอนุมัติ ADR ไม่เปิดสิทธิ์ deploy, ค่าใช้จ่าย หรือ provider ใหม่
