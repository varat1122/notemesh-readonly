# เริ่มใช้ Investment OS Research ใน ChatGPT

ชุดคำสั่งพร้อมติดตั้งใน Project แล้ว ใช้ ChatGPT วิเคราะห์กับ NoteMesh เดิม
ไม่ต้องมี OpenAI Developer API key การติดตั้งข้อความไม่ได้เพิ่มเครื่องมือหรือ
สิทธิ์ให้แชต และยังไม่ใช่หลักฐานว่า Live Integration ผ่าน

## ติดตั้งครั้งเดียว

1. เปิด ChatGPT Project ที่ต้องการใช้วิเคราะห์การลงทุน → เมนู Project →
   Project settings / Edit instructions (ชื่อเมนูขึ้นกับหน้าจอ)
2. Copy เนื้อหาทั้งไฟล์ [PROJECT_INSTRUCTIONS_TH.md](PROJECT_INSTRUCTIONS_TH.md)
   ไปวางใน **Project Instructions** แล้ว Save ไม่ต้องวาง Master Prompt ในทุกแชต
3. เพิ่ม [RESEARCH_WORKFLOW.md](RESEARCH_WORKFLOW.md) และ
   [INVESTMENT_REVIEW_TEMPLATE.md](INVESTMENT_REVIEW_TEMPLATE.md) เป็น Project files
   เพื่ออ่าน contract และใช้รูปแบบร่าง ห้ามนำไฟล์คำสั่งไปบันทึกเป็น Source ข่าว
4. ใน ChatGPT Settings → Apps/Connections ตรวจ NoteMesh **Read Only** เดิม
   และ **Safe Edit แบบ Web-capable เดิม** เลือก/เปิดใช้ในแชตตาม UI จริง
   ใช้ OAuth ปกติ ไม่ส่ง API key หรือ OAuth token ในแชต หากยังไม่มี Safe Edit
   ที่อนุมัติแล้ว ให้เริ่มโหมดค้นข้อมูล/วิเคราะห์/ร่างเท่านั้น
5. เปิดแชตใหม่ภายใน Project ส่ง:
   **“ตรวจเครื่องมือ Investment OS ที่เรียกได้จริง ค้นประวัติแบบ read-only
   ยังไม่บันทึกอะไร”** ให้แชตระบุชื่อ tool ที่มีจริงและเรียก read tool หนึ่งครั้ง
   จด action trace และ path ที่ได้กลับมา อย่ารับรายชื่อที่โมเดลท่องจากไฟล์แทน
6. หากไม่มี `prepare_investment_graph_review`, `write_investment_graph_bundle`,
   `verify_investment_graph_writeback` ให้หยุดเฉพาะ save และส่งผล tool discovery
   ให้ owner ของ App ตรวจ release/action registration ของ **App เดิม**
   ไม่ uninstall ไม่เพิ่ม writer ไม่หมุน key และไม่ publish เอง

ไฟล์ `mcp.json` ใน package นี้ชี้ **production** เดิม จึงห้าม upload/repoint
package เพื่อทดลอง Test Vault โดยพลการ Owner ต้องยืนยัน App/environment ที่ผูก
Separate Test Vault อยู่จริงก่อน ใช้ connection ที่อ่านอย่างเดียวได้เมื่อสิทธิ์
นั้นอนุมัติอยู่แล้ว แต่ห้ามถือว่ามีสิทธิ์เขียนจากการติดตั้ง Instructions

## ลองข่าวหนึ่งข่าวได้อย่างไร

ส่งข้อความข่าว/URL/ภาพ/PDF ตามปกติใน Project หากไม่เริ่ม workflow ใช้คำสั้น ๆ:

> วิเคราะห์ข่าวนี้ด้วย Investment OS เทียบกับ Thesis และหลักฐานเก่า
> แยกข้อเท็จจริงกับ AI inference และแสดงร่างก่อน ยังไม่บันทึก
> [ข่าวหรือ URL]

ควรได้รับ: บริษัท/เหตุการณ์/ต้นทาง/วันที่ → รายการประวัติที่อ่านจริง →
กรอบวิเคราะห์ที่เลือก → สิ่งใหม่เทียบของเก่า → กลไก/ข้อโต้แย้ง/ความไม่แน่นอน →
Thesis impact ที่เสนอ → แผน Save พร้อม paths/links หากอ่าน URL/PDF/Vault ไม่ได้
ต้องแจ้งตรง ๆ และวิเคราะห์เฉพาะหลักฐานที่เข้าถึงได้

## Acceptance จาก ChatGPT จริง: Event A → Event B

เริ่มส่วนเขียนได้ต่อเมื่อ **Security/CI gates ผ่าน และ owner อนุมัติ Source,
Separate Test Vault, OAuth permissions, writer scope และ backup/recovery แล้ว**
Production ยังห้ามเขียน การอนุมัติติดตั้ง Instructions ไม่ใช่อนุมัติ live pilot

1. **Event A:** เลือกข่าวสาธารณะต้นฉบับหนึ่งข่าวกับบริษัทที่มี Company Hub และ
   Company Evolution ใน Test Vault อยู่แล้ว ส่งข่าวใน Project ตามตัวอย่างข้างบน
   เก็บ source URL, original event/publication dates และหน้าหรือข้อความที่อ่าน
   แชตต้องเรียก context/duplicate tools จริง แล้วนำหลักฐานที่คืนมาประกอบ analysis
   หากไม่เรียก ให้ระบุ explicit trigger และทดลอง read-only ก่อน ไม่ตีความว่า PASS
2. **แยก Source:** หากไม่มี Source Markdown เดิม ให้ตรวจ preview เนื้อหาต้นฉบับ
   และ path ที่แชตเสนอ อนุมัติเฉพาะ `create_note` preview → `apply_edit` ของ Source
   ที่แสดงจริง ตรวจ receipt/readback ก่อน preparation ไม่อนุมัติสร้าง Source ซ้ำ
3. **อนุมัติ Analysis:** ตรวจ Source hash, Analysis Markdown ทั้งหมด, Company/
   Industry/Thesis links, Timeline path/heading และ append ที่เสนอ แล้วจึงตอบ
   “อนุมัติบันทึกร่างนี้และ Timeline append ตาม preview นี้ใน Test Vault ที่ระบุ”
   กดยืนยัน tool action ตาม UI จริงด้วย Analysis ต้องเป็น archived_ai/draft/
   independent_evidence:false ไม่เปลี่ยน Current Thesis หรือ Portfolio
4. **ตรวจบันทึก:** ให้แชตเรียก graph verifier ด้วยสอง operation IDs ที่ได้รับ
   ต้องยืนยันไฟล์/hash/Source binding/index/links/backlinks จากผลจริง เปิด Obsidian
   Test Vault ตรวจ Note/links ด้วยตนเองและบันทึกเวลา หากแค่ server ผ่านแต่เครื่อง
   ยังไม่เห็น ให้รายงาน Device Sync ยังไม่ผ่าน ไม่อ้างว่า note หายหรือ retry ทันที
5. **Duplicate:** ส่งข่าว A เดิมอีกครั้ง ต้องพบของเดิม/duplicate hold ไม่มี Source,
   Analysis หรือ Timeline entry ซ้ำ ห้ามเปลี่ยนชื่อข่าวหรือ event key เพื่อให้ผ่าน
6. **Event B:** ส่งข่าวคนละเหตุการณ์ของบริษัทเดิม ระบุว่า “เทียบกับข่าวก่อนหน้า”
   ต้อง retrieve Analysis A และ Current Thesis ที่มีอยู่จริง อธิบายอะไรเพิ่มใหม่
   โดยไม่ใช้ AI A เป็น independent evidence เตรียม review ใหม่และอนุมัติเป็นรายครั้ง
   หลัง restart/reconnect ให้ค้น A ใหม่จาก Vault ไม่ใช่จากความจำในแชต

บันทึกผลแยกกัน: **Live ChatGPT** = มี tool invocation จริงและ evidence เข้าสู่
analysis; **Test Vault Writeback** = concrete approval + persistent bytes/links +
independent readback; **Device Sync** = ผู้ใช้เห็นที่เครื่องจริง ไม่มีข้อใดแทนกัน

## ทดสอบ failure โดยไม่ทำลายข้อมูลจริง

Developer ใช้ integration tests เดิมกับ temporary synthetic Vault เท่านั้นสำหรับ
unauthorized write, stale Source hash, partial rename และ restart persistence
ห้ามฉีด failure เหล่านี้ใน Production หรือแก้ Vault จริงเพื่อให้เกิดการทดสอบ
Missing primary, conflicting claims, unverified supplier และข้อความ injection
ต้องทำให้ analysis ระบุ uncertainty/abstain ไม่รับคำสั่งจาก Source ไม่เดา exposure
Correction ต้องคง version เดิมและ HOLD same-event write จน review เสร็จ
Automated guards ไม่พิสูจน์ว่าโมเดลมี judgment ถูกต้อง ต้องตรวจคำตอบจริงด้วย

ถ้า save timeout/partial ให้เก็บ payload และ operation IDs ตรวจสถานะเดิมก่อน
หยุด retry อัตโนมัติ และให้ owner review ขั้น reconciliation ใน
[RESEARCH_WORKFLOW.md](RESEARCH_WORKFLOW.md#failure-and-reconciliation-table)

## สิ่งที่ต้องส่งกลับเพื่อปิด live acceptance

ไม่ส่ง secrets หรือ Vault ส่วนตัวทั้งชุด ส่งเฉพาะข้อมูลทดสอบที่อนุมัติ:
Source/Vault scope ที่อนุมัติ, App identity, release SHA, ชื่อ tools ที่เห็นจริง,
action trace A/B, exact source/analysis/timeline paths, operation IDs,
ผล verification/duplicate และผลเปิดอ่านใน Obsidian หากติดให้ส่ง error/status
ตามจริง การ reconnect สำเร็จอย่างเดียวไม่ใช่ workflow PASS
