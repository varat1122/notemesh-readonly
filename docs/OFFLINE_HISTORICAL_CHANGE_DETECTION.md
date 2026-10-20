# PR #84 — Historical Intelligence & Change Detection (Offline, NO PROD)

## อธิบายแบบผู้ใช้งาน

**ปัญหา:** คุณอาจส่งข่าว NVDA หรือรายงานเดิมซ้ำโดยไม่รู้ตัว
และจำไม่ได้ว่า AI เคยอ่านหรือบันทึกเรื่องนั้นไว้ใน Vault แล้วหรือยัง

**สิ่งที่ PR นี้เริ่มแก้:** ทดลองสร้างระบบค้นประวัติจาก
Offline Snapshot ที่ผ่านการตรวจ Markdown/SQLite/FTS ภายในแล้ว
ให้ AI อธิบายว่า "ข้อมูลนี้ซ้ำกับรายการไหน / มีตัวเลขต่าง / มีรายละเอียด
เพิ่ม / หรือยังไม่เจอจากขอบเขตที่ตรวจ"

คุณไม่จำเป็นต้องจำรายชื่อโน้ตเอง แต่ AI ต้องแสดง **รายชื่อโน้ตที่
จับคู่ได้และเหตุผล** ไม่ใช่บอกว่า "ใหม่" โดยไม่มีหลักฐาน

## วิธีทำงาน

1. รับข้อมูลข่าวใหม่ในรูปแบบ structured claim ที่ผู้ใช้/ระบบส่งให้
   (entity, metric, period, unit, value, event_key, source URL, SHA-256,
   วันเกิดเหตุ / เผยแพร่ / นำเข้า ถ้ามี)
2. ตรวจว่า snapshot Markdown/SQLite/FTS เป็นชุดที่ตรงกัน และ SHA-256
   manifest ตรงกับค่าที่อ่านไว้ก่อนหน้า โดยห้ามเป็น live DATA_DIR/Railway
3. อ่าน **ทุกแถวของ indexed Markdown สูงสุด 10,000 โน้ต** และ
   structured claim frontmatter สูงสุด 20,000 รายการ ไม่แก้ไฟล์ใด
4. จับคู่ claim แบบระมัดระวังด้วย entity + event key +
   metric + period + unit + literal value + declared source SHA/URL
   ไม่ infer event จากวันที่ import หรือ URL คล้ายกัน
5. อ่านผลอ้างอิงของ FTS เพื่อชี้โน้ตเก่าที่อาจเกี่ยวข้อง (lexical hints)
   แม้ไม่มี structured claim; **ห้ามถือว่า FTS เป็น semantic fact match**
6. แยกผลลัพธ์พร้อมรายชื่อโน้ตที่พบ ความครบถ้วน/ข้อจำกัด และเสนอ
   review queue เฉพาะปัญหาที่สำคัญกว่า

## ความหมายของผลแต่ละแบบ

| Classification | แปลว่า | Workflow |
|---|---|---|
| duplicate_exact_metadata_same_source | event/metric/period/value และ source SHA+URL **ที่ประกาศในโน้ต** ตรงกัน | ไม่เสนอเขียนซ้ำ |
| same_value_new_source_not_corroborated | ค่าเดิมแต่คนละแหล่งหรือเวอร์ชัน | ตรวจผู้เผยแพร่/อิสระก่อนเพิ่มน้ำหนัก |
| possible_correction_or_contradiction | เหตุการณ์และหน่วยตรงกันแต่ตัวเลขต่าง | ส่งให้คนตรวจเป็นลำดับแรก |
| added_detail_same_event | เหตุการณ์เดิม มี metric/รายละเอียดคนละเรื่อง | ตรวจ incremental impact |
| historical_archived_ai_mention_only | พบแค่ AI archive/derivative | ใช้เป็นประวัติได้ ไม่ใช่ independent evidence |
| related_claim_different_or_missing_event_key | บริษัท/metric เกี่ยวข้อง แต่ event key ต่างหรือไม่รู้ | อ่านต้นฉบับ/แก้ metadata |
| not_found_in_scanned_snapshot | ไม่พบ **ใน structured index ของสำเนาที่ตรวจ** | ไม่ประกาศข่าวใหม่โดยอัตโนมัติ |
| unresolved_missing_structured_fields | ข้อมูลใหม่ยังไม่ครบหรือมี metadata ที่ถูกแปลงชนิด | รอข้อมูลจริง |

## ขอบเขตข้อจำกัด (สำคัญ)

- นี่เป็น **Milestone 1: structured metadata matching + lexical recall**
  ไม่ใช่ AI semantic search ที่เข้าใจทุกหน้า Markdown ใน Vault
- Markdown แบบเก่าที่เขียนเป็น narrative อย่างเดียวอาจไม่ถูกจับเป็น
  exact duplicate ได้; ระบบนับจำนวนโน้ตแบบนี้และแสดง FTS hints
- การสแกนทุก row ไม่ได้แปลว่าค้นข้อมูลทุกเครื่อง ทุกแชต ทุกเวอร์ชัน
  หรือแหล่งข้อมูลต้นฉบับครบถ้วน
- Same SHA และ metadata เป็นเพียง **matching declarations** ไม่ได้
  พิสูจน์ original publisher, claim accuracy หรือ independent source
- เอกสารเดียวกันที่แชร์หรือ import หลายโน้ต **ไม่เพิ่มน้ำหนักหลักฐาน**
- archived AI เป็น Historical Context ไม่ใช่หลักฐานอิสระ
- event_date / published_at / imported_at แยกเสมอ ไม่เติมวันเอง
- ตัวเลขที่ขัดแย้งยังไม่บอกว่า "ข่าวใหม่ถูก" หรือข่าวเดิมผิด ต้อง
  อ่าน issuer filings และ source revision จริง
- ยังไม่ได้อ่าน Current Thesis เชิงเนื้อหา, ไม่ปรับราคาเป้าหมาย
  ไม่สรุป market price-in / portfolio actions อัตโนมัติ
- input ข่าวใหม่ยังเป็น **User Input — Unverified** จนตรวจต้นฉบับ
- confidence คือ confidence ของการจับคู่ metadata เท่านั้น ไม่ใช่
  ความมั่นใจว่าการลงทุนถูกต้อง

## สิ่งที่จะพัฒนาต่อ

Milestone 2: เชื่อม retrieval จาก narrative notes พร้อม
event/source-aware citations, duplicate Claim ID register และ
coverage gaps ก่อนเสนอ AI semantic review

Milestone 3: AI เสนอ New/Confirmation/Incremental/Contradiction/Thesis-Changing
โดยแยก verified facts, counterevidence, uncertainty และ required evidence;
แล้วจึงใช้หน้าจอมนุษย์ของ PR #82–#83 สำหรับประเด็นที่ต้องตัดสินใจ

ตัวอย่างผลต่อ NVDA ข้างต้นเป็นเพียงคำอธิบาย workflow
PR นี้ใช้ Synthetic fixture "SYNTH" เท่านั้น ไม่ได้ตรวจ NVDA จริง

No Safe Edit, no signed owner approval, no Vault or source capture,
no MCP/HTTP endpoint, no production access, no merge/deploy.

Stack: #75 → #76 → #77 → #78 → #79 → #80 → #81 → #82 → #83 → #84.
