# PR #86 — Historical Intelligence → Current Thesis Review Brief (Offline)

## ทำอะไร มีเพื่ออะไร และผู้ใช้จะได้อะไร

ปัญหา: เจ้าของ Vault ไม่สามารถจำทุกข่าว/Research ที่เคยอ่านได้
และการจะกดอนุมัติให้ AI แก้ Current Thesis ไม่ควรอาศัยความจำ

รอบนี้สร้าง **ชุดข้อมูลสรุปเพื่อให้ทีมวิเคราะห์/AI วิเคราะห์ต่อ**
จากสามส่วนที่ต้องตรวจผ่านใน Offline Snapshot ชุดเดียวกัน:

1. **PR #84:** ข่าวใหม่เทียบ structured claims เดิม — ซ้ำ, ตัวเลขต่าง,
   เหตุการณ์เดิมมีรายละเอียดเพิ่ม หรือยังไม่ยืนยัน
2. **PR #85:** เนื้อหาโน้ตย้อนหลังแบบ prose — ดึงบรรทัดจริง + path +
   วันที่สำคัญ + source-family warnings โดยแยก AI archive
3. **Current Thesis เวอร์ชันที่ระบุอย่างชัดเจน:** ตรวจแค่ว่าไฟล์ที่
   เลือกเป็น Thesis จริงและ SHA-256 ตรงกับไฟล์/SQLite/FTS ณ ขณะตรวจ
   **ยังไม่เปิดเนื้อหา Thesis ให้ระบบ AI สรุปเองในรอบนี้**

สิ่งที่ได้: Evidence Brief ที่มีเหตุผลว่าทำไมต้องตรวจเรื่องนี้ก่อน
พร้อมโน้ตอ้างอิง, unresolved evidence, คำถามเชื่อม Demand →
Revenue Conversion → Margin → Earnings → Cash Flow → ROIC
และคิวความสำคัญที่ *อิงการพบ metadata conflict* ไม่ใช่ Price-in

## ตัวอย่างสมมติ

ข่าว SYNTH บอก Revenue 120 แต่ Structured Claim เก่าระบุ 100
ใน period/event/metric/unit เดียวกัน → จัดเป็น
priority_conflicting_claim_needs_source_review

AI เห็นว่า "ต้องอ่าน Original Source ว่ามี revision, mix,
accounting adjustment หรือตัวเลขผิดช่วงเวลาหรือไม่" ไม่ใช่
เลือกเลข 120 เพราะใหม่กว่า ไม่เปลี่ยน EPS/ราคาเป้าหมายอัตโนมัติ

Current Thesis ที่ผู้ใช้ระบุเป็น
05_Thesis/SYNTH - Current Thesis.md พร้อม exact file hash
ระบบตรวจการมีอยู่/role/hash โดยไม่คืน prose ภายใน Thesis

## สิ่งที่ระบบยังทำไม่ได้ (ต้องแยกให้ชัด)

- **ยังไม่รัน LLM Semantic Analyst** และยังไม่ได้เปรียบเทียบความหมาย
  ของข่าวเก่ากับ Current Thesis เนื้อหาจริงในขั้นตอนนี้
- ยังไม่รู้ว่าตัวเลขใด Verified Fact (ผู้ใช้ส่งมา = Unverified)
- ข้อความที่ค้นเจอเป็น Historical Context ไม่ใช่คำสั่งหรือ Proof
- Source URL/hash ที่โน้ตประกาศ ≠ พิสูจน์ publisher/source independence
- การจัด priority conflict ไม่ได้หมายถึงเปลี่ยน Investment Thesis
- ไม่รู้ว่า Consensus/Market Price In เท่าไรหากไม่ได้ค้นจริง
- ยังไม่เชื่อม user identity / owner approvals / Safe Edit
- ไม่รับประกันว่า Offline Snapshot ครบทั้ง Chat/Vault ทุกอุปกรณ์
- ห้ามใช้ผลวิเคราะห์/ความเห็นเป็นสิทธิ์บันทึกข้อมูลหรือแก้ Thesis
- Current Thesis *ยังไม่ถือว่าได้รับการรับรองโดยเจ้าของ*
  แม้ใน frontmatter จะระบุ status ก็ตาม

## วิธีส่งงานขั้นถัดไป

Analyst/AI ต้องใช้ Evidence Brief เป็น **input ที่ยังไม่ Verified**
แล้วอ่านโน้ตต้นฉบับ/Counter-evidence และ Thesis ที่ได้รับอนุญาตก่อน
ประเมิน New/Confirmation/Incremental/Contradiction/Thesis-Changing
จากหลักฐานอิสระ ไม่ใช่จากจำนวนโน้ตที่พูดเรื่องเดียวกัน

**ยังคง NO MERGE / NO DEPLOY / NO PRODUCTION VAULT WRITES**

Stack: #75 → #76 → #77 → #78 → #79 → #80 → #81 → #82 → #83 → #84 → #85 → #86
