# Investment OS — จุดค้าง API Test และแผนกลับมาทำต่อ

**ผู้ใช้ขอพักงานทดสอบ API วันที่ 2026-10-20** เพราะยังไม่สะดวก
ไม่ต้องทวง ไม่ต้องตั้งเวลาแจ้ง และไม่ต้องทดลองเรียก API จริงเอง

## คำสั่งกลับมาเริ่มงานนี้

เมื่อผู้ใช้บอก **"ผมจะทดสอบ API แล้ว"** หรือสื่อความหมายเดียวกัน:
1. เปิดบริบท Draft PR #91:
   https://github.com/varat1122/notemesh-readonly/pull/91
2. ตรวจ GitHub CI และไฟล์ใน PR #91 อีกครั้ง ไม่ถือว่ามีการ Merge
3. อธิบายทางเลือกทดสอบบน Google Colab / เครื่องผู้ใช้แบบสั้น ๆ
   โดยมีชุด SYNTH สมมติ 8 กรณี ไม่ใช้ Vault จริง
4. แนะนำให้สร้าง OPENAI_API_KEY **ในบัญชีของผู้ใช้เอง**
   และเก็บไว้เฉพาะช่องซ่อนรหัส/Environment Variable
   ไม่ส่งคีย์ใน Chat, GitHub, Railway หรือ Obsidian
5. เตือนว่า API Billing แยกจาก ChatGPT subscription และอาจมีค่าใช้จ่าย
6. เมื่อมีการรันจริง **จึงค่อย** แสดงคะแนน false duplicate,
   missed critical review, invalid citations และ abstention;
   ถ้ายังไม่มี actual API response ห้ามอ้างว่ารันโมเดลจริงแล้ว
7. คะแนนจาก 8 handwritten, non-held-out synthetic cases
   **ไม่อนุญาต** ให้เปิดอ่านหรือเขียน Production Vault
8. หากไม่มีเครื่อง/คีย์พร้อม ให้อยู่ในสถานะ PAUSED ต่อไป

ไฟล์ Google Colab ที่เคยทำไว้ในแชตเดิมชื่อ:
Investment_OS_OpenAI_API_Synthetic_Test.ipynb
การปรากฏชื่อในโน้ตนี้ไม่ได้ยืนยันว่าดาวน์โหลดหรือรันได้ในบริบทใหม่
หากเข้าถึงไฟล์ไม่ได้ ให้ตรวจไฟล์ก่อนหรือจัดทำใหม่จากโค้ด PR #91

**สถานะ ณ บันทึก:** PR #91 ยังเป็น Draft/unmerged,
ทดสอบด้วย mocked provider transport ใน CI; ไม่มีผล live model score
และไม่มี owner-entitlement/Production authorization

## งานคู่ขนานที่ทำต่อได้โดยไม่ใช้ API Key

**PR #92:** Rule-based Review by Exception สำหรับ report
ที่ผ่าน citation checking ใน PR #89. คัดกรอง proposed conflict /
thesis-changing / challenge ไป human priority;
จัด candidate duplicate ทุกเรื่องไว้ analyst review แทนการทิ้งเงียบ ๆ;
และไม่คืน protected Thesis excerpts ใน queue metadata.

งานนี้ยังเป็น offline logic ไม่ใช้โมเดลจริง, ไม่แก้ Vault, ไม่อนุมัติ
owner access, และไม่ลดข้อกำหนด evidence-based investment research

**NO MERGE / NO DEPLOY / NO PRODUCTION VAULT WRITES.**
