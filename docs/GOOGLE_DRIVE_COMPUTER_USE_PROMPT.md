# พรอมป์ต์สำหรับ Computer Use: เชื่อม Investment OS กับ Google Drive

คัดลอกข้อความด้านล่างไปสั่ง Computer Use เมื่อมีคอม บันทึกนี้ไม่มีรหัสผ่าน Client Secret หรือโทเคนจริง

---

ช่วยตั้งค่า Google Drive เป็นที่เก็บข้อมูลราคาหุ้นรายวันของ Investment OS ที่พัฒนาไว้แล้ว ให้ดำเนินงานต่อจากระบบเดิม ไม่สร้างแอป/เซิร์ฟเวอร์ใหม่

เป้าหมาย: ใช้บัญชี Google ของฉันที่มี Drive 2 TB เก็บ snapshot แยกรายหุ้นพร้อมสารบัญ ราคาจากสหรัฐฯ ไทย ฮ่องกง ญี่ปุ่น รองรับอย่างน้อย 200 ตัวและ comparator อีกสูงสุด 4 ตัว ส่วน Railway โหลดมาคำนวณใน RAM และให้ ChatGPT อ่านผ่าน MCP

## ระบบจริง

- GitHub: https://github.com/varat1122/notemesh-readonly
- ตรวจ main และเอกสาร docs/GOOGLE_DRIVE_PRICES.md ล่าสุดก่อนลงมือ ยืนยันว่ามีโค้ด Drive backend และผ่าน CI/Deploy แล้ว อย่ารายงานว่าพร้อมใช้จากการ Merge อย่างเดียว
- Railway project: 88f3c614-6222-4ad3-b80f-a0890a3ef587
- Production environment: 7924e4d4-5a64-4713-afdf-104bfea6953b
- Service NoteMesh: f5de7abf-ede8-4131-9d6c-b5e8eac204b9
- ระบบ: https://notemesh-production-a893.up.railway.app
- หน้าตั้งค่า: https://notemesh-production-a893.up.railway.app/api/market-prices-drive
- Authorized redirect URI ต้องตรงทุกตัว: https://notemesh-production-a893.up.railway.app/api/market-prices-drive/callback

## ขอบเขตที่อนุญาต

ตั้งค่าเฉพาะที่เก็บราคาบน Drive ใช้ drive.file สำหรับไฟล์ที่แอปสร้าง ห้ามเปิด Drive ทั้งบัญชี ห้ามเปิด public sharing ห้ามขยาย Volume/แพ็กเกจ ซื้อโควตา เปิด billing หรือสร้างบริการเสียเงิน ห้ามเปลี่ยน ENCRYPTION_KEY ห้ามลบ/ย้าย Vault หรือฐานข้อมูลเดิม ห้ามแก้ SAFE_EDIT_ENABLED/SAFE_EDIT_SINGLE_WRITER หรือทำ synthetic vault-note canary งาน Safe Edit OAuth เป็นอีกงานที่พักไว้

ทำงานที่ได้รับอนุญาตต่อเนื่องโดยไม่ถามย้ำเรื่องเดิม แต่ให้ฉันเลือกบัญชีและอนุมัติสิทธิ์ Google เองผ่าน secure browser handoff ตามข้อกำหนดของเครื่องมือ หยุดก่อนยอมรับข้อตกลงผูกพัน ค่าใช้จ่าย หรือขยายสิทธิ์อื่น และอธิบายหน้าที่รออนุมัติ อย่าข้าม CAPTCHA หรือ browser security warning

## ขั้นตอน

1. ใช้ Railway/GitHub plugins สำหรับสิ่งที่รองรับ และ Computer Use สำหรับ Google Cloud Console หรือส่วน UI ที่ plugin ไม่รองรับ ตรวจบัญชี Google ให้ฉันยืนยันว่าเป็นบัญชีที่มี 2 TB อย่าเดาบัญชีจากชื่อ
2. เปิด https://console.cloud.google.com/ ค้นหา Project ชื่อ Investment OS ที่มีอยู่ก่อน ถ้าไม่มีให้สร้าง Project สำหรับงานนี้ เปิดเฉพาะ Google Drive API อย่าสมัคร free trial/เพิ่มบัตร/เปิด billing โดยอัตโนมัติ
3. ตั้ง Google Auth Platform/OAuth consent เป็นแอปส่วนตัวของฉัน ชื่อ Investment OS Market Prices ใช้ Web application OAuth client ขอเพียง https://www.googleapis.com/auth/drive.file ตั้ง redirect URI ด้านบน ไม่ใช้ service account หรือ scope drive/drive.readonly ทั้งบัญชี
4. ตรวจ publishing status ตามข้อกำหนด Google ถ้าเป็น External + Testing ให้เพิ่มฉันเป็น test user และแจ้งว่า Drive refresh token จะหมดใน 7 วัน สำหรับใช้งานระยะยาวต้องตั้งสถานะที่เหมาะสมเป็น Production หาก Google ขอ verification/ข้อมูล/การอนุมัติเพิ่ม อย่าสร้างข้อมูลขึ้นเองและอย่ารายงานว่าทำถาวรแล้ว
5. นำ OAuth Client ID และ Client Secret ไปใส่ใน Railway service เดิมโดยตรงผ่านช่องตั้งค่าลับ: MARKET_PRICES_DRIVE_CLIENT_ID และ MARKET_PRICES_DRIVE_CLIENT_SECRET ไม่ส่งค่าผ่านแชต ไม่ใส่ GitHub ไม่แสดงใน log หรือภาพส่งมอบ ใช้ secure credential/handoff ตามเครื่องมือหากจำเป็น อย่าอ่านหรือเปลี่ยน ENCRYPTION_KEY ให้ deploy ตัวแปรและยืนยัน SUCCESS โดยยังไม่เปิด Drive backend
6. ให้ฉัน sign in หน้าผู้ดูแล NoteMesh เดิมผ่าน /login หากยังไม่มี session ห้าม reset รหัสผ่าน เปิดหน้าตั้งค่า Drive แล้วกด Connect Google Drive for price files ให้ฉันเลือกบัญชี/ยืนยัน scope เฉพาะ drive.file
7. เมื่อ callback สำเร็จ ระบบจะเปลี่ยนไปหน้าสะอาดแล้วแสดงค่าเข้ารหัสครั้งเดียว 10 นาที คัดลอกค่าเข้ารหัสนั้นตรงไปยัง Railway variable MARKET_PRICES_DRIVE_CREDENTIAL โดยไม่แสดงในแชต/ภาพ/ไฟล์ ห้ามใช้ OAuth token ของปลั๊กอิน Google Drive ใน ChatGPT แทน หากหน้าหมดอายุหรือรีสตาร์ตก่อนบันทึก ให้เริ่ม consent ใหม่
8. ยืนยันหนึ่ง replica หนึ่ง deployment และไม่มี CLI/collector อื่นเขียน dataset เดียวกัน แล้วจึงตั้ง MARKET_PRICES_STORAGE=google-drive และ MARKET_PRICES_DRIVE_SINGLE_WRITER=1 คง MARKET_PRICES_ENABLED=1 ตรวจแพตช์ตัวแปรก่อน Deploy โดยไม่แตะตัวแปรบริการอื่น
9. รอ Railway deployment เป็น SUCCESS แล้วดู log [market-prices] ต้องมี updated counts และตรวจ catalogueId/verifiedAt และ partition ที่อ่านกลับผ่าน จากสถานะราคา อัปโหลดสำเร็จอย่างเดียวไม่พอ ต้องมี read-back ผ่านด้วย ตรวจว่าโฟลเดอร์ Investment OS - Market Prices และไฟล์รายหุ้น .iop พร้อมสารบัญ .ioc อยู่ใน Drive ส่วนตัว ระบบสร้างเอง ไม่ต้องสร้างโฟลเดอร์ซ้ำหรือแชร์สาธารณะ
10. ยืนยันโหลด snapshot เดิมได้หลัง restart และไม่ดึงประวัติทั้งชุดซ้ำทุกวันโดยไม่จำเป็น ตรวจ initial backfill, daily incremental, overlap และ weekly/corporate-action rebase ห้ามรัน prices:refresh จากเครื่องอื่นพร้อม production CLI prices:status ใน environment ที่ได้รับอนุญาตอ่าน archive ได้โดยไม่เขียน Vault
11. รีเฟรช catalogue ของ Investment OS Read Only โดยรักษาสิทธิ์เดิม แล้วยืนยันว่ารายชื่อจริงมาจากฉันก่อนตั้ง MARKET_PRICES_WATCHLIST เป็น JSON (สูงสุด 200 ตัวพร้อม comparator สูงสุด 4 ตัว) ห้ามนำ tickers จำลองจาก tests หรือเดาจากพอร์ตมาใช้เป็น universe จริง ถ้าฉันยังไม่ให้รายชื่อ ให้คง pilot 8 ตัวและรายงานตามจริง ตั้ง MARKET_PRICES_BATCH_SIZE=5 ได้โดยไม่เร่งเรียกผู้ให้บริการ ตรวจ remainingDue จนเก็บครบหรือรายงาน cooldown แล้วทดสอบ list_price_instruments, read_price_bars, get_price_data_status และ analyze_price_event ผ่านแชตปกติ ถ้าไม่มีเครื่องมือเหล่านี้ ให้รายงานว่าเซิร์ฟเวอร์พร้อมแต่การเชื่อมในแชตยังไม่ผ่าน อย่าอ้างว่าต้องมี OAuth vault:edit เพื่ออ่านราคา
12. ตรวจ /api/health, Read Only, receipt เดิมของ Save Linked Notes และ Obsidian Sync ฝั่งเซิร์ฟเวอร์ ห้ามเขียนโน้ตเพื่อทดสอบ การถึงอุปกรณ์อีกเครื่องเป็นการตรวจอีกขั้น ผลตอบแทนหลังข่าวเป็นความสัมพันธ์ ไม่ใช่หลักฐานว่าข่าวเป็นสาเหตุ

ถ้าเกิดปัญหาการเชื่อม/ขนาด/โควตา ให้คง snapshot เดิมไว้ ห้ามลบหรือข้ามตัวป้องกัน สามารถหยุดฟีเจอร์ราคาด้วย MARKET_PRICES_ENABLED=0 โดยรักษาระบบโน้ต การกลับ disk backend ไม่แก้ข้อจำกัดพื้นที่เดิม

## รูปแบบรายงาน

แยกให้ชัด: โค้ดพร้อม / CI ผ่าน / Deploy สำเร็จ / OAuth บันทึกแล้ว / รับข้อมูลจริงแล้ว / อ่านกลับแล้ว / แชตปกติเรียกได้แล้ว พร้อมจำนวนหลักทรัพย์/แถว วันข้อมูลล่าสุด และสิ่งที่ยังติดขัด ห้ามประกาศเสร็จครบถ้า OAuth, read-back หรือแชตปกติยังไม่ผ่าน เก็บหลักฐานที่ไม่มี credentials เท่านั้น
