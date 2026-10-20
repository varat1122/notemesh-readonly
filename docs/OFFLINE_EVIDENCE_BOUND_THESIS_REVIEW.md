# PR #87 — AI เสนอผลกระทบต่อ Thesis โดยต้องชี้หลักฐานได้ (Offline Only)

## ทำอะไร เพื่ออะไร

เป้าหมายคือให้ AI ทำงานตรวจข้อมูลให้คุณมากขึ้น ไม่โยนข่าวทุกชิ้นให้คุณ
อ่านเอง: ระบบรวบรวมข่าวเก่า/โน้ตเก่า/หมายเลขบรรทัด แล้วรับ
**ข้อเสนอความเห็นเชิงวิเคราะห์** ว่าข้อมูลใหม่น่าจะเกี่ยวกับ Demand,
Revenue Conversion, Gross/Operating Profit, Earnings, Cash Flow,
ROIC หรือ Valuation อย่างไร

**PR นี้ยังไม่มีการเรียก LLM ให้คิดเองจริง** — นักวิเคราะห์หรือ AI
ภายนอกต้องเสนอสมมติฐานเป็น input; ส่วนใหม่ของเราตรวจเข้มว่า
หลักฐานที่แต่ละข้อเสนออ้างนั้นมีอยู่จริงในผล Offline Snapshot ล่าสุด

## มันตรวจอะไร

- อ่าน Evidence Brief จาก #86 ใหม่ทุกครั้ง เพื่อตรวจ Physical Vault
  Snapshot/SQLite/FTS/Manifest ว่ายังตรงกัน
- ทุก hypothesis ต้องมีคำอธิบาย, Economic Channel,
  ลิงก์โน้ตที่พบ, รายการหลักฐานที่ยังต้องหา และความไม่แน่นอน
- Citation ของ structured claim ต้องตรง note path + source SHA
  ของ #84; citation ของข้อความธรรมดาต้องตรง note path +
  physical note SHA + เลขบรรทัด + hash ของ excerpt ใน #85
- ปฏิเสธ citation ที่ AI แต่งขึ้น เปลี่ยนเลขบรรทัด หรืออ้าง Thesis
  แบบไม่มีหลักฐานจากส่วนนี้
- เก็บรายการที่ AI เสนอเป็น "Unverified Interpretation" เท่านั้น
- ถ้าเสนอว่าเป็น duplicate แต่ #84 พบตัวเลขขัดแย้ง
  ต้องยกระดับให้มนุษย์ตรวจ ไม่ปล่อยให้ AI ทิ้งข่าวนั้นไปเอง
- ถ้าอ้าง archived AI เป็นหลักฐานสนับสนุน ระบบเตือนว่า
  เป็นเพียง Historical Context ไม่ใช่ Independent Issuer Evidence
- ถ้าเสนอ thesis-changing โดยไม่มี Thesis Version ที่เลือกไว้
  ระบบต้องเตือนว่าการเปลี่ยน Thesis ยังไม่ได้ตรวจ

## ตัวอย่างสมมติ

SYNTH Revenue Q3 เก่า 100 แต่มีข้อความใหม่ว่า 120:

**สิ่งที่ AI สามารถเสนอเพื่อให้ตรวจ**
"ข้อมูลใหม่อาจเพิ่มความคาดหวังต่อ Revenue Conversion
แต่ต้องตรวจ Issuer Earnings Release / Period / Corrections ก่อน"

ระบบผูกข้อเสนอนั้นกับโน้ตเก่าและบรรทัดจริงใน Snapshot ได้
แต่จะไม่สรุปว่า "Revenue เติบโตขึ้นแน่นอน" หรือ "เพิ่ม Target Price"

## ระวังให้ชัด

- Exact evidence link = ได้เจอข้อความจริงตามบันทึก
  **ไม่ใช่** บอกว่าข้อความนั้นถูกต้อง หรือ AI ตีความถูก
- ผู้ส่งสมมติฐานอาจเป็น AI หรือ analyst ที่ยังไม่ยืนยันตัวตน
- ยังไม่มี LLM semantic reasoning engine, independently checked
  counter-evidence, market prices, consensus หรือ current valuation
- Thesis Version ใน #86 เป็น hash/metadata เท่านั้น ไม่คืน Thesis prose
  และ **ยังไม่ได้เทียบ Current Thesis เชิงความหมาย**
- แม้ข้อเสนอระบุ thesis-changing ระบบไม่ให้สถานะ Thesis-Changing Fact
- ไม่มี issuer original document authentication/cross-device completeness
- ไม่มี owner registration/owner approval/Save/Apply/write/copy production
- ห้ามใช้ผลนี้เป็น input ของระบบเขียน Vault จนกว่าจะผ่าน
  Evidence/Identity/Authorization checks อีกขั้นอย่างอิสระ

## ขั้นต่อไป

ออกแบบช่องทางให้ AI/analyst **อ่านเฉพาะเนื้อหาที่ได้รับอนุญาต**
โดยผูก Current Thesis version/claim กับ counter-evidence จริง
แยก Analyst View จาก Verified Fact และทำ Thesis Review แบบครบวงจร
ก่อนส่งเฉพาะรายการที่สำคัญเข้า UI #82–#83

PR #87 เป็น Draft และห้าม Merge/Deploy/Production Vault writes
ตามข้อจำกัดที่ตกลงกันไว้

Stack: #75 → #76 → #77 → #78 → #79 → #80 → #81 → #82 → #83 → #84 → #85 → #86 → #87
