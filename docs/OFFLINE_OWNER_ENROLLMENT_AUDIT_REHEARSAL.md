# PR #81 — แบบซ้อมลงทะเบียนกุญแจเจ้าของ + สมุดบันทึก Offline

## อ่านแบบคนใช้งาน

เราทำสองชิ้นต่อจาก #80

**ชิ้นแรก: พิสูจน์ว่าคนเซ็นถือกุญแจนั้นจริง**
ระบบสร้างโจทย์สุ่มที่ใช้ได้ 10 นาที ผู้ถือกุญแจต้องเซ็นโจทย์นั้น
ด้วย private key ของตัวเอง ระบบตรวจว่า signature ตรง public key
ในทะเบียนที่นำมาทดสอบหรือไม่

สิ่งที่พิสูจน์: "คนเซ็นถือ private key ที่ตรงกับ public key นี้"
สิ่งที่ **ยังพิสูจน์ไม่ได้**: "คนนี้เป็นเจ้าของ Vault จริง"
เพราะยังไม่มีผู้ตรวจตัวตน และไม่มี authority provisioned
ที่เชื่อถือได้แยกจาก request

**ชิ้นที่สอง: สมุดบันทึกเหตุการณ์**
ระบบเขียนผลการตรวจทะเบียนลงไฟล์ JSON ต่อเนื่องทีละรายการ
ใน scratch directory ที่ผู้พัฒนา **สร้างเองล่วงหน้าและอนุญาตโดยตรง**
นอก Railway, production DATA_DIR, offline Vault snapshot และ repo

แต่ละรายการมี checksum ผูกกับรายการก่อนหน้า ตรวจพบ
- เปลี่ยนเนื้อหารายการกลางทาง
- ลบรายการระหว่างกลาง
- ส่ง hash หัวสมุดเก่าให้ระบบเขียนต่อ
- ใช้ challenge digest ซ้ำในสมุดเล่มเดียวกัน
- symlink, file permissions ไม่ปลอดภัยหรือการเขียนพร้อมกันผ่าน lock

ไฟล์ถูก sync ลง OS/filesystem ก่อนตอบสำเร็จ (fsync attempt)
แต่ **ไม่ใช่ audit log ที่แก้ไขไม่ได้** และไม่ได้พิสูจน์ durable
end-to-end ในระดับ disk/cloud/network/offsite backup

### ข้อจำกัดที่ต้องรู้

- ถ้ามีคนลบรายการสุดท้ายและไม่มี head hash จากผู้ดูแลที่เก็บไว้
  **แยกต่างหากอย่างเชื่อถือได้** ระบบตรวจไม่เจอแน่นอน
- Hash-chain ไม่เท่ากับ cryptographic signed audit authority
- Lock file ช่วยป้องกัน simultaneous writer ใน directory เดียว
  ไม่ใช่ distributed transaction หรือ replication
- Journal แยกนี้ไม่ได้ทำให้ signature จาก #79 กลายเป็น owner approval
- ยังไม่ได้ผูก challenge issuance กับ registry ที่ผ่าน identity proof;
  พิสูจน์แค่ key possession
- Challenge nonce ยังไม่ถูก consume อย่างปลอดภัยข้ามทุก session
  ไฟล์บันทึกจำกัด local dry run ไม่ใช่ replay prevention สำหรับ prod
- ไม่มี UI, login provider, credential enrollment, signer private key
  custody, MCP/HTTP/API exposure, workflow automation หรือ Safe Edit
- PR นี้ไม่แตะ Production Vault / Current Thesis / Evidence Register,
  ไม่แก้ Railway และไม่เปิด permission เพิ่ม

### ในการทดสอบ

CI สร้าง Ed25519 keypair ปลอม และไดเรกทอรีชั่วคราว
ใน /tmp/ ที่มีชื่อ nm-offline-review-audit-* และ mode 0700
แล้วทิ้งหลังทดสอบ (ไม่มีข้อมูลผู้ใช้)

## จะเปิดใช้จริงต้องมีอะไรอีก

1. เจ้าของลงทะเบียน identity + public key กับผู้รับรอง/ช่องทาง
   ที่เชื่อถือได้ (นอก chat และ Vault) โดยมี recovery/revocation
2. ระบบ trust anchor ลงนามกำกับ registry และ verifier ตรวจ pin
   จากภายนอก request เอง (caller ห้ามเลือก pin)
3. Signed receipt protocol รุ่นใหม่ผูก trusted policy/registry hash
   และ enrollment evidence ทุกครั้งที่ขออนุมัติ
4. Audit/replay ledger แบบ durable ข้าม restart/replica,
   ทน rollback, มี external checkpoint และ key revocation
5. ตรวจ source version/claim evidence ใหม่ที่ execution time
   พร้อม UI กดอนุมัติแสดง exact before/after และ nonce แบบ one-use
6. แยกอนุมัติ deployment/merge/Safe Edit/Production Vault อย่างชัดเจน

**ทุก function ยังคืน ownerApprovalGranted=false และ
canAutoWrite=false เสมอ** ไม่มีการนำโน้ตจริงมาใช้ซ้อม

Stack: #75 → #76 → #77 → #78 → #79 → #80 → #81
NO MERGE / NO DEPLOY / NO PRODUCTION VAULT MUTATION
