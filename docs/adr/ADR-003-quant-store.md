---
adr: 003
title: Quant store
status: PROPOSED
date: 2026-10-31
deviates_from: Blueprint v1.0 §05.1 (Parquet + DuckDB)
---
# ADR-003 Quant store

## Context
ปัจจุบันราคารายวันอยู่ในตาราง `bars` (SQLite) + archive บน Google Drive; จำกัด 204 instruments (`market-prices/model.ts`) งาน quant มีแค่ event-window (`event-analysis.ts`)

## Decision
- **ตอนนี้:** `bars` ใน SQLite เป็น canonical สำหรับ daily OHLCV ของ watchlist
- **เมื่อเริ่ม P4 (backtest/factor):** export snapshot แบบ immutable เป็น Parquet (มี `dataset_version` = SHA-256) แล้วรัน DuckDB/Python เป็น batch แยก process
- ทุก run บันทึก `quant_runs` ตาม Blueprint §10.4: `run_id`, `dataset_version`, `code_version`, parameters, `as_of`, `limitations`
- Quant job ห้ามเขียนกลับ `bars`

## Migration trigger
- backtest หลายปีบน universe > 204 instruments หรือ intraday
- query บน SQLite ช้าจนเกิน budget ที่ Owner กำหนด

## Alternatives
- ย้ายทั้งหมดไป DuckDB ตอนนี้ — ยังไม่มี workload ที่ต้องการ

## Consequences
- + reproducibility ผ่าน snapshot hash
- − มี export step เพิ่ม

## Owner approval
ยังไม่อนุมัติ
