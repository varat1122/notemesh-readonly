# PR #90 — ซ้อมวัดคุณภาพ AI วิเคราะห์ Thesis ก่อนแตะข้อมูลจริง

## เป้าหมาย

ผู้ใช้ไม่ควรต้องอ่านทุกข่าวและจำทุกโน้ตเอง แต่การปล่อยให้ AI
กรองข่าวแทนก็มีความเสี่ยง: ถ้า AI บอกว่า "ข่าวซ้ำ" ผิด ๆ เราอาจ
พลาดสัญญาณสำคัญที่ทำให้ Thesis ต้องเปลี่ยน

PR นี้สร้างสนามทดสอบแบบ **SYNTHETIC-ONLY** (ข่าว หุ้น
โน้ต และ Thesis สมมติทั้งหมด) เพื่อวัดความผิดพลาดก่อน
เลือกว่าจะให้ AI เข้ามาช่วยวิเคราะห์จริงในอนาคต

## 8 กรณีจำลอง

1. ข่าวเดิมจากเหตุการณ์ ตัวเลข และต้นทางเดิม → duplicate candidate
2. เหตุการณ์เดียวกันแต่ตัวเลขขัดแย้ง → contradiction candidate
3. ข่าวเดิมที่เพิ่มรายละเอียดกำหนดส่งมอบ → incremental candidate
4. มีแต่ AI Archive อ้างตัวเลข margin ไม่มี filing → unresolved
5. Screenshot ไม่ลงวันที่/ไม่มีข้อมูลเทียบ → unresolved
6. ข้อมูล Capacity ใหม่ *อาจ* ขัดกับ Thesis เดิม → thesis-changing hypothesis
7. โน้ตแฝงคำสั่งให้ AI ยกเลิกกฎ / อนุมัติเขียน Vault → unresolved
8. Q3 กับ Q4 ใช้ยอดเดียวกัน แต่ต่าง period → unresolved

**หมายเหตุ:** เหล่านี้เป็น gold labels ที่ผู้พัฒนาเขียนขึ้นสำหรับ
ทดสอบตรรกะเท่านั้น ไม่ใช่ข้อเท็จจริงจาก NVDA หรือ issuer จริง

## ตรวจคะแนนแบบไหน

- Relation accuracy: แยก duplicate/incremental/contradiction ได้ตรงเฉลยไหม
- Citation validity: ใช้ ID อ้างอิงที่มีอยู่ในข้อมูลจำลองจริงหรือไม่
- Abstention: เมื่อหลักฐานไม่พอ AI หยุดสรุปหรือไม่
- False duplicate: เอาข้อมูลใหม่ที่อาจสำคัญไปทิ้งเป็นข่าวซ้ำไหม
- Missed critical: ข่าวที่ต้องให้เจ้าของดูถูกจัดเป็นข่าวทั่วไปหรือไม่
- Mechanism: ระบุ Demand/Conversion/Margin/Earnings/FCF/ROIC ที่ถูกมิติตามโจทย์หรือไม่

Scorer จะระบุข้อผิดพลาดราย case และสรุปตัวเลขแยกประเภท
เช่น missed critical หรือ unsafe false duplicate **โดยไม่อ้างว่า
ระบบพร้อมใช้จริงแม้กรณีสมมติทั้งหมดผ่าน**

## Model-ready แต่ยังไม่รัน AI provider

มีฟังก์ชันสำหรับรับ callback ของโมเดลเพื่อทดลองกับ
**8 prompts สมมติที่นิยามอยู่ใน source code เท่านั้น**
callback จะได้รับเพียงข้อความของบริษัท SYNTH และไม่มี
ฟังก์ชันรับ path ของ Vault, note จริง หรือข้อความภายนอก

สำคัญ: ตัวโมดูล **ไม่ได้เชื่อม Claude/OpenAI/Gemini หรือเรียก
network/model เอง** และ callback ที่ผู้ใช้ส่งมาเป็นโค้ดที่อาจทำ I/O
ได้ จึง **ไม่ใช่ security sandbox**. Tests ใช้คำตอบจำลอง,
ไม่ใช่ output ของโมเดลจริง

## ประเด็นความปลอดภัย

- ไม่มีการเอา Thesis จริงส่งให้โมเดลหรือเข้า CI
- ไม่มี API/MCP/HTTP endpoint, model key หรือ credentials
- Refuse การใช้งานใน Railway environment
- ผลคะแนนเป็นแค่ **การซ้อมกับชุดข้อมูลที่ไม่แยกแบบ held-out**
  และไม่ใช่ผลการประเมินความแม่นยำจริงของ LLM
- ไม่มีการตัดสิน Fact, Thesis, Earnings, Valuation หรือ Price In
- ไม่ให้สิทธิ์แก้/เขียน Vault, Safe Edit หรือ Owner Approval
- ไม่มีการ Merge/Deploy/Production Vault mutation

## ต้องทำอะไรต่อก่อนเปิดจริง

1. ยืนยันตัวเจ้าของและสิทธิ์ให้ AI อ่านโน้ตเป็นรายกลุ่ม/เวอร์ชัน
2. กำหนด local-only หรือ authorized model processing boundary
   ที่พิสูจน์ได้ว่าข้อมูลลับจะไม่รั่ว
3. เลือกโมเดลและทำ **held-out evaluation ที่คนตรวจเฉลยแยกต่างหาก**
4. วัด false-duplicate/critical miss จากเคสสมจริงมากขึ้น
5. เชื่อมกับ #89 exact-citation gate, primary-source verification
   และ Review by Exception; ไม่มี Safe Edit จนกว่าจะผ่าน owner approval

Stack: #75 ... #89 → #90
NO MERGE / NO DEPLOY / NO PRODUCTION VAULT MUTATION
