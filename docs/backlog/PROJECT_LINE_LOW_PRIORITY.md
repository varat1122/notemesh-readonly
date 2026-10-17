# Project LINE (โปรเจกต์ไลน์) — Future Investment OS Workflow

**Status:** BACKLOG / NOT STARTED  
**Priority:** LOW — defer until Investment OS core Read → Historical Analysis → Safe Writeback → Readback is stable.  
**Recorded:** 2026-10-18 (Asia/Bangkok)

## เป้าหมายที่ผู้ใช้ต้องการ

1. **News Watch:** AI ติดตามข่าวที่อาจกระทบพอร์ตจริง / Investment Universe สูงสุดราว 200 หุ้น จาก X/Twitter, Bloomberg (เฉพาะที่ได้รับสิทธิ์), บริษัท/IR, SEC, สื่อและแหล่งข้อมูลอื่น โดยแยกข่าวจริง ข่าวซ้ำ ข่าวลือ ความเห็น และข้อเท็จจริงที่ยืนยันแล้ว
2. **Daily LINE Brief:** สรุปข่าวสำคัญทุกสิ้นวันตามเวลาประเทศไทย ส่งให้ผู้ใช้คนเดียวผ่าน LINE พร้อมสิ่งที่เกิดขึ้น หุ้น/ธีมที่ได้รับผลกระทบ เหตุผลระดับ Earnings/Cash/Thesis, event/publication dates, links และหลักฐานที่ยังขาด; อาจเพิ่ม alert ระหว่างวันเฉพาะเรื่อง material ภายหลัง
3. **LINE → Investment OS → Vault:** ผู้ใช้ส่งข้อความ ลิงก์ ภาพ PDF ทาง LINE → webhook ตรวจลายเซ็น → authorized actor + queue → รับ binary ตามจริงและบันทึก SHA/attribution → dedup → อ่าน historical Vault → วิเคราะห์ใน OpenAI API → separate Raw Source / AI Analysis → gated Safe Edit/approval/readback/reindex → ตอบกลับ LINE เป็น receipt
4. **Reusable knowledge:** โน้ตที่เก็บทำให้ ChatGPT (เมื่อเชื่อม Vault) และ Portfolio App/Web ในอนาคตนำไปใช้ต่อได้ ไม่ใช่อ้างว่า LINE Bot สามารถส่งข้อความเข้า ChatGPT UI conversation เดิมได้โดยตรง

## ความยาก (ประเมินเบื้องต้น)

| Function | Complexity | Relative variable cost | Notes |
|---|---|---|---|
| สรุปข้อมูลที่ Investment_OS มีอยู่แล้ววันละครั้งและส่ง LINE | ง่าย | ต่ำ | messaging OA quota, scheduler, one user |
| รับ text/link/image/PDF ผ่าน LINE Bot | ปานกลาง | ต่ำ–กลาง | signed webhook, auth, storage, expiry, attachments |
| ตรวจประวัติและเขียนกลับ Vault ปลอดภัย | ปานกลาง–สูง | ขึ้นกับขนาดข้อมูล | ต้องใช้ Safe Edit original/review/receipt และ dedup |
| ติดตาม X API อัตโนมัติ | ปานกลาง–สูง | กลาง–สูง | official read-API charges; filter/watchlist + cache |
| ดึง Bloomberg news feed แบบ automated | สูง | อาจสูงมาก | enterprise license, permission and redistribution limitations |
| เชื่อมผลกระทบต่อพอร์ตแบบ event study / alert | สูง | กลาง–สูง | verified current positions, exact price bars, latency, event dates |

## Token & cost discipline

- **LINE webhook, scheduler, signature validation, deterministic filters, SQL queries, hashes, storage and dedup by themselves do NOT use AI tokens.** มีค่าโครงสร้างพื้นฐานและ messaging ตามการใช้งานได้
- **OpenAI API** คิดแยกจาก ChatGPT Plus/Pro. ค่า AI แปรตาม input/output tokens, media/PDF extraction, number of runs, retrieval amount และเครื่องมือเฉพาะที่ใช้
- สิ่งที่เปลือง: วิเคราะห์ทุกโพสต์เต็ม ๆ, อ่านบทความ/ PDF ยาวเป็นร้อยชิ้นซ้ำหลายรอบ, ใส่ Vault ทั้งคลังใน prompt, polling ข่าวถี่มาก, วิเคราะห์ 200 Tickers แยก 200 prompts โดยไม่กรองก่อน, response ยาวโดยไม่จำเป็น; X/data licenses อาจแพงกว่า AI
- สิ่งที่ประหยัด: ingestion watermark, source-family & story dedup, holdings/ticker/keyword prefilter, low-cost short classification before deep analysis, top-N relevant events only, indexed historical excerpts only, one daily batch, source+context cache, usage/cost log by source and per workflow, budget kill switch; no auto-pay expansion
- ค่า LINE OA Thailand package/allowance ต้องตรวจใหม่เมื่อเริ่มทำ; LINE Messaging API ส่ง push นับโควตา แต่ Reply messages ไม่ถูกนับแบบเดียวกัน
- ค่า X official API เปลี่ยนได้; developer page 2026-10-18 แสดงตัวอย่าง $0.005 ต่อ post read (โปรด Verify ใหม่ก่อนทำงบ)
- Bloomberg Terminal login ≠ permission to programmatically capture, redistribute or store full news articles; ต้องดู licensed Data License/rights; เริ่มจาก IR/regulator/publicly licensed content

## System design / source restrictions

`LINE user → LINE OA Messaging API → signed HTTPS webhook → Railway queue → authorized user allowlist → message ID + source URL dedup → original byte archive & metadata → historical Obsidian retrieval → AI analysis with source/claim attribution → Safe Edit preview/approval/apply → receipt → optional LINE acknowledgement`.

Security: validate X-Line-Signature over original request bytes; don't log API credentials or personal portfolio holdings; grant least-privilege scoped OAuth/keys; retry idempotently; protect from prompt injection / forged news / untrusted links; no restricted media archives if licenses prohibit it. Store dates independently: event, publisher, LINE receive, ingest, verification. LINE attachment bytes might be transformed or expire; archive promptly if permitted, never claim byte-identical third-party publisher originals from screenshots.

## Future activation sequence (not started)

- **LINE-0 Feasibility:** confirm sources, licenses, actual portfolio source, single authorized recipient, desired Thailand end-of-day cutoff, acceptable fees + total API cap and privacy policy.
- **LINE-1 Easy first:** one daily digest from existing verified Investment OS feed to personal LINE OA; no costly third-party scraping yet.
- **LINE-2 Two-way:** receive LINE messages / attachments, parse and run safe historical analysis + gated Vault Raw/Review writeback; prove readback/Sync separately.
- **LINE-3 News monitoring:** issuer IR / filings / authorized news feeds, relevance scoring and event/source dedup; add official X API after usage budget approval; Bloomberg only if licensed.
- **LINE-4 Advanced:** intraday thesis-changing alerts, current portfolio exposures, backtests and news → 1/3/5/10/30-session price studies.

## Success conditions for eventual release

- Relevant news with verifiable provenance, materiality explanation and counter-evidence; current holdings not inferred from stale snapshots.
- Per-event cost logs, predictable quotas, source rights, auth and dedup tests.
- LINE incoming real attachment → original+analysis separate vault notes → actor-authorized Safe Edit receipt + exact readback; no changes to protected Current Thesis without explicit approval.
- A complete LINE outgoing daily summary receipt. Obsidian desktop/mobile Sync independently confirmed.
- **No implementation, scheduling, webhook registration, bot creation, API purchase or deployment authorized by merely recording this backlog.**

## Checked vendor documentation (2026-10-18)

- LINE Messaging API: https://developers.line.biz/en/docs/messaging-api/pricing/
- LINE receiving webhook and media: https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- LINE Notify ended in 2025: https://developers.line.biz/en/news/2024/10/07/line-notify-will-be-discontinued/
- Thailand LINE OA pricing: https://lineforbusiness.com/th/service/line-oa-features
- OpenAI API separate billing: https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- X developer platform: https://developer.twitter.com/
- Bloomberg Data License: https://professional.bloomberg.com/products/data/data-license/
