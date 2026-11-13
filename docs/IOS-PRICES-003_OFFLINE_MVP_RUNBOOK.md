# Prices MVP — manual offline demonstration

คำสั่งนี้ใช้ข้อมูลแต่งขึ้นทั้งหมด ไม่ได้ดึงราคาหุ้นจริง และไม่เปิด Google Drive หรือ scheduler
ใช้ existing Yahoo parser/collector/SQLite/Drive abstraction และ existing MCP tools
ตรวจสอบใน development worktree ที่ติดตั้ง dependencies ของ repo แล้ว (Node24, pinned pnpm11.16.0)

## คำสั่งเดียว

```sh
node scripts/market-prices.ts dry-run
```

stdout เป็น JSON receipt หนึ่งชุด; diagnostic logs ไป stderr จะบันทึกหลักฐาน local เพิ่มได้:

```sh
node scripts/market-prices.ts dry-run > offline-demo-receipt.json
```

ปรับ allowlist โดยคัดลอก example เป็นไฟล์ของงานทดลอง แล้วเลือก/reorder 1–5 รายการจาก
AAPL, MSFT, SPY, GLD, ^GSPC เท่านั้น ไม่มีการเดา symbols หรือแปลง ETF เป็น index/spot gold
คำสั่งที่ใช้ไฟล์ตัวอย่าง:

```sh
node scripts/market-prices.ts dry-run --watchlist integrations/market-prices/mvp-watchlist.example.json
```

Empty/duplicate/เกิน5/unknownsymbol/malformedJSON/symlink config ถูกปฏิเสธ
ไม่ต้องตั้ง API key, Drive OAuth, feature flags หรือ RIGHTS_REVIEW ใด ๆ
ห้ามใช้ `refresh` หรือ `daily` แทน `dry-run` เพื่อทดลอง live ในงานนี้

## สิ่งที่จะเกิดขึ้น

1. สร้าง temporary lock directory ส่วนตัว และ ephemeral synthetic signing key เฉพาะ process
2. ใช้ `free-first-mvp-v1` profile จำกัด5symbols/10fixture requests ต่อ simulated run
   ไม่มี parallel collection/automatic retries; demoทั้งหมดไม่เกิน40fixture requests
3. สร้าง synthetic daily bars ตั้งแต่2025-10-01 สำหรับ8scenarios:
   backfill, next-day increment, same-day replay, late correction, before holiday,
   holiday/no new session, anomaly/partial rejection และ429 stop
4. Normalizationใช้ Yahoo adapter เดิม; cold-read signed snapshots/catalogue จาก memory repositories
   ไม่มี OAuth หรือ Google HTTP calls ไม่มี mount mutableSQLite บนDrive
5. เชื่อม MCP SDK InMemoryTransport เรียก `read_price_bars` และ `list_price_instruments` จริง
   โดย inject เฉพาะ internal mock archive reader ไม่เพิ่มHTTP/MCPparameterหรือtoolใหม่
6. ทดสอบ tamper rejection และ default live RIGHTS_HOLD โดยไม่ส่ง network request
7. ปิดclient/cache คืนค่า environment/fetchของprocess และลบเฉพาะtemporarydirectoryที่สร้างเอง
   ข้อมูลทุกแท่งและarchiveอยู่ในRAM;ผู้ใช้เลือกเก็บเฉพาะstdout syntheticreceiptได้

## อ่านผลอย่างไร

* `status=OFFLINE_DEMO_COMPLETE` หมายถึง harnessจบครบ ส่วนบางscenarioตั้งใจให้partial_failure
* `syntheticOnly=true`; `series.dataOrigin=synthetic_fixture`;ทุกseriesยังระบุRIGHTS_HOLD
* `requested` แสดงsymbol,assetClass,venue,currency,timezoneและproviderSymbol
  SPYคือETF;GLDคือgoldETFproxy;^GSPCคือindex level และในfixtureไม่มีvolume
* `receipts[].body` มี immutable UUID/jobID,simulatedAt,status,changes(inserted/revised/unchanged),
  total cached rowCount/latestSessionDate/quality flags และactualfixture-request count
  `sha256` ตรวจserializedreceipt;นี่ไม่ใช่proofจากตลาดหรือimmutable remoteauditlog
* next_dayเพิ่มหนึ่งbarต่อsymbol;same_dayมี0fixture requests/0newarchives;
  late_correctionมีAAPL2026-10-01revision;holidayไม่สร้างbar2026-12-25
* `revisionEvidence` แสดงbefore/after syntheticvaluesในsignedSQLiteaudit
* `integrity` มีSHA-256/bytes/archiveID/catalogueIDและtamperRejected=true
* `aiReader.results` เป็นผลจากexistingMCPreaderพร้อมprovenance/quality/latestRefresh
* `cost` ต้องเป็นmarketApiRequests0,googleDriveRequests0,networkAttempts0,apiCostUSD0
  fixtureRequestsไม่ใช่quotaที่ใช้กับYahoo;ข้อมูลfixtureไม่ใช่ประวัติราคาตลาดจริง

## Calendar / future daily operation — ยังไม่เปิดใช้งาน

Demoใช้weekdays+illustrativeexplicitclosures ไม่ใช่officialUScalendarครบชุด
`MARKET_PRICES_SESSION_CLOSURES` รับJSONเช่น `{"US":["2026-12-25"]}` ตามschemaวันจริง
ต้องreview calendar,earlyclose,venuepublicationlagและlatestsourceavailabilityก่อนL2/L3
Normalclose+lagและIANA timezoneรองรับDST แต่ไม่มีการรับรองholiday/calendarfeedโดยอัตโนมัติ

Futureproposalยังเป็น03:23UTC/10:23BangkokหลังpriorUSsession;ไม่สร้างcron/workflow/service
ใช้singleauthoritativepersistentlockrootและdailyreceipt/idempotentreplayเดิมหลังอนุมัติเท่านั้น
หากช้า/ขาด/partial/429ให้receipt+owner-visiblealertและหยุดตามquota/costbudget ไม่loopretry
Backoffconfigurationที่เสนอสำหรับอนาคต:disabled,base60s,factor2,max15min;maxAutomaticRetries0ในMVP
providerterms/approvalต้องอนุญาตก่อนเพิ่มretry policy ไม่ใช่สิทธิ์หลบ429
Recoveryหลังuncertainpublishต้องreconcilecatalogue/snapshot/jobIDก่อนretry ห้ามลบlockหรือhistoryเอง
หลังL3readback/recovery/computestopผ่านจึงเสนอL4ใหม่ ไม่มีactivationในTask003

## เกณฑ์พร้อมไปขั้นต่อไป

Coordinatorตรวจcode/evidenceก่อน แล้วจึงแยกอนุมัติสิทธิ์Yahooautomation/archive/team/AI,
boundedrealtestและprivateDriveOAuth/folder/isolation/recovery/host/billing
Free-of-chargeไม่ใช่license;ไม่มีOPERATOR_ATTESTEDที่สร้างขึ้นเพื่อให้demoผ่าน
DR/NAVยังdisabled;SEC NAVต้องtypedseriesแยก ไม่สร้างOHLCVจากค่าNAVเดียว
