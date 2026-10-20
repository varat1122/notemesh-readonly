# PR #88 — เปิดให้ดูเฉพาะบางบรรทัดใน Current Thesis (Offline Dry Run)

## ทำอะไรและทำไม

ก่อนบอกว่าข่าวใหม่เปลี่ยน Thesis, AI ต้องเทียบกับ
ข้อความใน Thesis เดิมจริง ๆ ไม่ใช่ดูแค่ชื่อไฟล์หรือ hash.

PR #88 ทำต้นแบบใน offline snapshot: ผู้ตรวจเลือกไฟล์ Current Thesis,
เวอร์ชัน SHA-256 และบรรทัดที่เจาะจง ไม่เกิน 3 บรรทัด พร้อม
SHA-256 ของแต่ละบรรทัด ไม่เปิดทั้งไฟล์

ระบบตรวจ:
1. ย้อนกลับไปอ่าน Historical Evidence จาก PR #84–#87 ใหม่
2. ตรวจว่า Thesis เป็นไฟล์ตรงบริษัท มีอยู่จริง และเวอร์ชันตรง hash
3. ยืนยันว่าข้อความแต่ละบรรทัดตรงกับไฟล์ ณ เวลาที่อ่าน
4. ไม่คืน YAML, headings, HTML/comment หรือข้อความใน fenced code
5. ตรวจ manifest ของสำเนา Vault อีกครั้งหลังอ่าน
6. คืนบรรทัดที่เลือกพร้อมสมมติฐานที่ Analyst/AI เสนอเพื่อให้ตรวจต่อ

## ตัวอย่างสมมติ (ไม่ใช่ข้อมูล NVDA จริง)

Thesis เดิม SYNTH: "ความเสี่ยงหลักคือ Order-to-Delivery"
ข่าวใหม่เสนอ Revenue 120 เทียบ Claim 100 เดิม
ระบบแสดงบรรทัด Thesis ที่ถูกเลือกและหลักฐานย้อนหลังประกอบ
โดยยังไม่บอกว่าเลขใหม่ถูกหรือ Thesis ต้องเปลี่ยน

## ข้อจำกัดที่ต้องรู้

- ผู้ส่ง input เลือกไฟล์และ hash เองได้ การระบุไฟล์ตรงกัน
  ไม่ได้พิสูจน์ว่าเป็นเจ้าของ Vault จริง หรืออนุญาตให้อ่านได้
- **ห้ามเชื่อมฟังก์ชันนี้กับ endpoint สำหรับ public/prod**
  จนกว่าจะมี independent identity and entitlement verification
- ข้อความที่ดึงมาอาจมีข้อมูลส่วนตัว/ความลับของผู้ลงทุน
  ห้าม export/log/share โดยไม่มี approval ผ่านระบบจริง
- จำกัด 3 บรรทัด, 280 ตัวอักษรต่อบรรทัดใน offline rehearsal
- Quote คือ untrusted historical text; ไม่ใช่ AI instruction
- สนับสนุน/ขัดแย้ง/เปลี่ยน Thesis เป็น stance ที่ผู้เสนอกรอกมา
  โมดูลไม่ได้เรียก LLM หรือประเมิน semantic truth โดยตรง
- SHA-256 ของโน้ต ≠ ยืนยัน issuer, human identity หรือ provenance
- ยังไม่อ่าน Original Source, source corrections, counterevidence ครบ,
  market price, consensus, valuation หรือ history ทุกอุปกรณ์
- ownerApprovalGranted=false, canAutoWrite=false,
  canAutoUpdateThesis=false และ vaultModified=false เสมอ
- ไม่มี signed consent, Safe Edit, Vault write, API, MCP, merge, deploy

## ก่อนใช้จริงต้องทำ

ต้องมีเจ้าของลงทะเบียนสิทธิ์ผ่านช่องทางอิสระ, สิทธิ์ดูเฉพาะโน้ต,
การเพิกถอน/หมดอายุ, traceable audit, source verification,
counterevidence และ UI review-by-exception ที่อธิบายข้อสรุป
ให้เจ้าของตัดสินใจเอง

PR นี้เปิดเป็น Draft ต่อจาก #87; NO MERGE / NO DEPLOY /
NO PRODUCTION VAULT MUTATION
