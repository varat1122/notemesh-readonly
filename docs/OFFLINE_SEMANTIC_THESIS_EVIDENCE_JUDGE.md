# PR #89 — Semantic Thesis Review: ตรวจข้อเสนอ AI กับหลักฐานที่อ้างได้

## สำหรับเจ้าของ Investment OS

ปัญหาที่ต้องแก้ต่อจาก #88 คือ ระบบมีทั้งข่าวเก่า ข้อเสนอวิเคราะห์
และบรรทัดใน Current Thesis แล้ว แต่ยังไม่มีตัวตรวจว่า "คำสรุปของ AI"
อ้างหลักฐานใดจริงหรือไม่ และควรให้คนพิจารณาเรื่องใดก่อน

PR #89 เพิ่ม **ระบบตรวจผลวิเคราะห์แบบมีหลักฐาน (Evidence Judge)**
สำหรับข้อเสนอที่ AI หรือ Analyst สร้างจากข้อมูล Offline Snapshot

ตัวอย่างสมมติ SYNTH:
- Thesis เดิมกล่าวว่า Revenue Conversion ขึ้นกับ Delivery
- ข่าวใหม่ให้ Revenue 120 แต่ในโน้ตเก่ามี 100 สำหรับช่วงเวลาเดียวกัน
- Analyst อาจเสนอ: Delivery เป็นคอขวดที่ควรตรวจ และมีความเสี่ยงที่
  Revenue จะรับรู้ไม่ตรงที่คาด
- ระบบตรวจว่าข้อเสนออ้างบรรทัด Thesis และ historical evidence
  ที่พบจริงหรือไม่ แยกเหตุผลเชิงธุรกิจและ Required Evidence

ถ้า AI แต่งชื่อโน้ต เลขบรรทัด หรือใช้หลักฐานจากประเด็นอื่น
จะถูกปฏิเสธ ถ้าบอกว่า "ซ้ำ" แต่มีตัวเลขขัดแย้ง จะ HOLD

## การจัดคิวให้คนอ่าน

กรณีที่ AI เสนอว่า Thesis อาจเปลี่ยน, มีข้อขัดแย้ง, หรือ
แนวโน้มอาจสวนทาง Thesis เดิม จะเข้า
"must_review_potential_thesis_change_or_conflict"

เรื่องอื่นอยู่ในคิว analyst evidence review ตามหลักฐานที่ยังไม่ครบ
การจัดคิวเป็น rule-based จากความเสี่ยงของข้อเสนอ ไม่ใช่
การตัดสินว่า Thesis เปลี่ยนแล้วจริง

## ความสามารถที่เพิ่ม

1. ใช้ผล PR #88 ผ่าน PR #84–#87 แล้วตรวจ Snapshot ใหม่ทั้งสาย
2. ทุก Model/Analyst Finding ต้องแนบ exact Thesis quote IDs,
   historical supporting IDs, counter-evidence IDs (ถ้ามี)
3. ยืนยันว่าทุก ID มีอยู่จริงและเป็นของ Interpretation ที่เกี่ยวข้อง
   ป้องกันการสร้าง citation ปลอมและ citation ผิดบริษัท/คนละ claim
4. ต้องบอก Economic Channel และความเชื่อมโยงเชิงเหตุผล
   เช่น Demand → Revenue Conversion → Earnings พร้อมระบุว่า
   เป็น *Hypothesis* ไม่ใช่ Verified Fact
5. ต้องบอกข้อจำกัด / สิ่งที่ยังไม่พิสูจน์ / หลักฐานต้นฉบับที่ขาด
6. Counter-evidence ยังไม่ครบให้ระบุว่า "ยังไม่ได้อ่านหรือไม่พบ
   จากชุดที่ตรวจ" ไม่ใช้คำว่าไม่มี counter-evidence แน่นอน
7. หากอ้าง Archived AI ให้เตือนว่าไม่ใช่ Issuer Evidence อิสระ
8. ทุกอย่างเป็น read-only ไม่มี Save/Apply หรือลงชื่อเจ้าของ

## ข้อจำกัดสำคัญ

**PR นี้ยังไม่ได้เรียก LLM เองจริง ๆ** เป็นโครงรับคำวิเคราะห์
จาก Analyst/Model และตรวจความสอดคล้องของหลักฐานผ่าน code
ก่อนเสนอให้เจ้าของดู โมเดลยังไม่ได้ยืนยันเชิงความหมายด้วยตัวมันเอง

- อ้างบรรทัดได้ตรง ≠ ความหมายหรือตัวเลขถูกต้อง
- Claim/เหตุการณ์ยังต้องตรวจ Issuer Filings/IR และ revisions จริง
- ข้อมูล Thesis ที่เลือกผ่าน #88 อาจเป็นข้อมูลลับ
- **ยังไม่มี Owner Identity + independently provisioned entitlement**
  จึงไม่เปิด API/MCP, ไม่เชื่อมกับ external LLM และไม่ส่ง Thesis
  ไปบริษัทโมเดลภายนอกในขั้นนี้
- ยังไม่ได้ตรวจ Counter-evidence หรือ Current Consensus ทั้งหมด
- ไม่อ้างว่า Market Price-in หรือ Portfolio Recommendation
- ความเห็น AI ที่เสนอยังเป็น Unverified Interpretation
- ไม่มีการเขียน Vault, เปลี่ยน Current Thesis, Merge หรือ Deploy

## อะไรต้องทำก่อนเป็น AI Semantic Engine ใช้งานจริง

1. Real owner enroll identity + independent key/policy/entitlement
2. จำกัดสิทธิ์อ่านข้อมูลลงทุนและวิธีส่งเข้าโมเดลที่ได้รับอนุญาต
3. เพิ่ม LLM semantic inference จริงภายใน trust boundary ที่ตรวจได้
4. ให้ระบบตรวจ Primary Source/Counter-evidence และ exact citations
5. Review-by-Exception จัดคิวให้คุณกดอนุมัติอย่างมีข้อมูลเพียงพอ
6. แยก approval-to-read จาก approval-to-write โดยเด็ดขาด

NO MERGE / NO DEPLOY / NO PRODUCTION VAULT MUTATION.

Stack: #75 → #76 → #77 → #78 → #79 → #80 → #81 → #82 →
#83 → #84 → #85 → #86 → #87 → #88 → #89
