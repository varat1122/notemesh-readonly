---
adr: 001
title: Core runtime — TypeScript + MCP server
status: PROPOSED
date: 2026-10-31
deviates_from: Blueprint v1.0 §02.2 (Python + FastAPI)
---
# ADR-001 Core runtime: TypeScript + MCP

## Context
Blueprint เสนอ Python/FastAPI แต่ระบบที่ทำงานจริงคือ NoteMesh: TypeScript, SolidStart/Vinxi, `@modelcontextprotocol/sdk`, Better Auth OAuth, Docker บน Railway พร้อม tests ~1,500 ชุด และ Safe Edit ที่ผ่าน CI แล้ว

## Decision
ใช้ TypeScript + MCP เป็น core API ของ Investment OS ต่อไป
- MCP tools และ HTTP API ในอนาคตเรียก domain function เดียวกัน (`docs/INVESTMENT_DATA_ARCHITECTURE.md`)
- Python อนุญาตเฉพาะ **งาน batch/quant แบบแยก process** (ADR-003) ที่อ่าน/เขียนผ่าน contract ที่กำหนด ไม่ใช่ server ตัวที่สอง

## Alternatives
- เขียนใหม่ด้วย Python/FastAPI — ทิ้ง auth/Safe Edit/tests ที่ผ่านแล้ว; ไม่มีประโยชน์ที่วัดได้
- Hybrid สอง server — สร้าง source of truth ซ้อน (ขัด P-02)

## Consequences
- + ใช้ของที่ผ่าน gate แล้วต่อได้ทันที
- − ไลบรารี quant ของ TS น้อยกว่า Python → แยกงานนั้นตาม ADR-003

## Evidence
`package.json`, `src/server/mcp/server.ts`, `.github/workflows/ci.yml`

## Migration trigger
ไม่มีแผนย้าย จะทบทวนเมื่อ MCP SDK/Vinxi หยุดดูแล หรือมีข้อจำกัดที่ทำให้ gate ผ่านไม่ได้

## Owner approval
ยังไม่อนุมัติ
