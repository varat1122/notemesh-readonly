# PR #80 — แยกตัวตนผู้อนุมัติออกจากไฟล์ลงทุน (Offline Dry Run)

## อธิบายแบบผู้ใช้งาน

ถ้า AI บอกว่า "ผู้อนุมัติคือเจ้าของ Vault" เพียงเพราะมีลายเซ็น
เรายังเชื่อไม่ได้: คนอื่นสามารถสร้างกุญแจดิจิทัลของตัวเองแล้วเซ็นเองได้

PR นี้ทดลองเพิ่ม "ทะเบียนกุญแจผู้ตรวจและเจ้าของ" ที่อยู่คนละที่กับ
Vault และไม่รับทะเบียนนี้จากช่องแชตโดยตรง ระบบจะ:
1. เปิดอ่านทะเบียนแบบไม่แก้ไขและไม่ตาม symlink
2. เทียบ hash ของทะเบียนกับค่า hash ที่ operator เตรียมไว้อีกทาง
3. ตรวจว่ากุญแจ Reviewer กับ Owner ไม่ใช่กุญแจเดียวกัน และไม่ถูก disable
4. เช็กว่าทะเบียนยังมีผลและลายเซ็นตรงกับทะเบียนนี้
5. กลับไปอ่าน note, source, SQLite และหลักฐานอีกครั้งผ่าน PR #78/#79
6. **หยุดก่อนอนุมัติหรือเขียน Vault เสมอ**

ผลที่สำเร็จหมายถึง "ทะเบียนทดสอบ + ลายเซ็นสอดคล้องกัน"
**ไม่ใช่** "พิสูจน์แล้วว่าคนนี้เป็นเจ้าของจริง"

## จุดที่ต้องทำโดยเจ้าของก่อนใช้จริง

- เจ้าของต้องลงทะเบียน public key กับ trust authority ผ่านช่องทาง
  ที่เชื่อถือได้เป็นอิสระจาก Vault, chatbot และ request payload
- ต้องมีช่องทางยืนยันตัวบุคคลที่ได้รับอนุญาตจริง พร้อม key rotation,
  revocation และ recovery เมื่อกุญแจหายหรือถูกขโมย
- ต้องป้องกันการนำลายเซ็นเดิมกลับมาใช้ซ้ำด้วย durable nonce journal
- ต้องใช้ audit log ที่เก็บถาวร ตรวจสอบย้อนหลังได้และทนการแก้ไข
- ต้องผูก policy version/hash กับตัวลายเซ็นใน protocol ใหม่:
  PR #79 v1 ยังไม่เซ็น hash ของ registry และยังไม่มี trusted clock
- หลังจากนั้นยังต้องทบทวนสิทธิ์ Safe Edit และ validation อีกครั้ง
  ณ เวลาจะบันทึกจริง

การให้คนส่ง registry พร้อม expected SHA-256 มาด้วยตัวเองสามารถ
ปลอมทั้งคู่ได้ PR นี้จึงระบุ
outOfBandPinAuthenticated=false, independentOwnerIdentityVerified=false,
ownerKeyProvisioningCompleted=false และ ownerApprovalGranted=false

## ขอบเขตและความปลอดภัย

- พัฒนาเฉพาะ offline read-only; ไม่มี UI/HTTP/MCP/CLI หรือ production signer
- ไม่สร้างทะเบียนกุญแจ ไม่สร้าง credential และไม่ฝัง private key ในโค้ด
- ไม่แตะ Obsidian Vault, Current Thesis, Portfolio หรือ Evidence Register
- ไม่ให้สิทธิ์ Safe Edit Apply / canAutoWrite / canAutoUpdateThesis
- ทดสอบด้วยไฟล์ปลอมและ keypair ชั่วคราวใน CI เท่านั้น
- ต้องใช้ไฟล์ registry ที่แยกออกจาก DATA_DIR และ offline snapshot
- ปฏิเสธ Railway runtime, symlink, ไฟล์ที่ group/others เขียนได้,
  registry fingerprint ผิด, policy หมดอายุ, key revoked, note/source เปลี่ยน

## ข้อเท็จจริงเกี่ยวกับ security

การตรวจ file hash ช่วยตรวจการเปลี่ยน byte ระหว่างสองตำแหน่งที่ผู้ใช้ให้
แต่ไม่ได้ยืนยันว่าใครเป็นผู้ให้ hash หรือให้ทะเบียนนั้น ดังนั้นยังไม่ใช่
Independent Trust Anchor จริง

PR #80 เรียกว่า *readiness / dry run* ไม่ใช่ระบบอนุมัติสมบูรณ์
ห้ามใช้เพื่ออนุญาตให้ AI แก้ไฟล์จริง

Stack: #75 -> #76 -> #77 -> #78 -> #79 -> #80
NO MERGE / NO DEPLOY / NO PRODUCTION VAULT MUTATION
