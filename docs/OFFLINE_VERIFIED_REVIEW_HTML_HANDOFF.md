# PR #83 — ส่งข้อเสนอจาก Offline Snapshot ที่ตรวจแล้วไปยังหน้าจอคนอ่าน

## ความหมายสำหรับผู้ใช้

ก่อนหน้านี้หน้าจอ PR #82 แสดงตัวเลขสมมติที่ใส่ไว้ใน HTML
PR #83 เพิ่มช่องทาง **อ่าน Snapshot จริงของข้อมูลที่แยกจาก Production**
ตรวจไฟล์โน้ต, SQLite index และ original-source bytes แล้วสร้าง HTML
ออฟไลน์ให้คนเปิดอ่านก่อนตัดสินใจ

**ตอนนี้ยังเป็นเพียงการทดสอบ** ด้วยโน้ตสังเคราะห์ ไม่มีการเข้าถึง
Production Vault ที่ใช้งานจริงในกระบวนการ CI นี้

ทำงานดังนี้:
1. ผู้ดูแลเตรียม Vault + SQLite + Original Source Archive เป็นสำเนา
   Offline ที่ได้รับอนุญาตและ **แยกจาก DATA_DIR จริงแล้ว**
2. เลือก note path, SHA-256 ที่อ่านมาก่อนหน้า, action,
   relationship, ข้อความเดิม 1 บรรทัด, ข้อความเสนอแก้ และเหตุผล
3. เช็ก note/source/index/manifest ใหม่ด้วย PR #74–#79
   ถ้า mismatch / มี Source Hash ปลอม / path ต้องห้าม → ไม่มีไฟล์ออก
4. สร้าง HTML หนึ่งไฟล์แบบ 0600 ในโฟลเดอร์ส่วนตัวแยกต่างหาก
   ที่ผู้ดูแลสร้างเองล่วงหน้า ชื่อ nm-offline-review-export-*
5. เปิดไฟล์ HTML ใน browser เพื่อดู ก่อน–หลัง และกด
   “ขอแก้ไข / ไม่เห็นชอบ / เห็นชอบในหลักการ” ในหน่วยความจำเท่านั้น

ไม่มีการส่งข้อมูลขึ้นอินเทอร์เน็ต ไม่มีการสร้าง login, signature,
signed approval, Vault patch, MCP endpoint หรือ Safe Edit Apply

## ตัวอย่างการใช้ (เฉพาะข้อมูลสมมติ)

ตั้ง DATA_DIR เป็น live dummy directory เพื่อเปิดใช้งาน
ระบบตรวจไม่ให้นำ output ไปวางทับ live directory โดยห้ามใช้ Railway
และเตรียม ABS_OFFLINE_SNAPSHOT ที่ถูกสร้างโดย workflow ที่ได้รับ
อนุญาตแล้ว โดยไม่ได้ให้ script นี้ทำการ copy production

บนเครื่องส่วนตัว:

    mkdir -m 700 /tmp/nm-offline-review-export-personal

สร้างไฟล์ JSON request (mode 0600) นอก Vault โดยกรอก:

    {
      "notePath": "10_Knowledge/Company Research/SYNTH - Offline Review.md",
      "expectedNoteSha256": "<64-character hash from prior detached read>",
      "action": "metadata_correction_candidate",
      "relationship": "added_detail",
      "reviewRationale": "ต้องตรวจแหล่งต้นฉบับ",
      "oldLine": "ตัวเลขสมมติเดิม 10",
      "newLine": "ตัวเลขสมมติที่เสนอ 12"
    }

จากนั้นใช้คำสั่ง (ส่ง JSON ทาง stdin เพื่อไม่ใส่เนื้อหาโน้ตเป็น
command-line args):

    node --experimental-strip-types scripts/export-offline-review-ui.mjs \
      /ABS_OFFLINE_SNAPSHOT /tmp/nm-offline-review-export-personal < /ABS/review-request.json

หากไฟล์ผ่านการตรวจจะคืน path ของ HTML 0600 และ status
local_html_exported_for_human_review_only หากไม่ผ่าน จะไม่เขียนไฟล์
และคืน error. โฟลเดอร์ส่งออกต้องอยู่นอก Live DATA_DIR, Offline
Snapshot และ source repository และต้องเป็น private 0700

**สิ่งที่สำคัญ:** HTML ที่ส่งออกมีข้อความเดิม/ข้อความเสนอ/ชื่อไฟล์
และ SHA-256 จริงของ Snapshot ข้างในโดยตรง ใครได้ไฟล์นี้อาจอ่าน
ข้อมูลลงทุนเหล่านั้นได้ อย่าอัปโหลด แชร์ หรือเก็บใน cloud sync ที่
ไม่ได้รับอนุญาต ลบไฟล์ที่ไม่ต้องใช้อย่างปลอดภัยตามนโยบายข้อมูล

## Security caveats

- Integrity ของ Stored Bytes ไม่ได้พิสูจน์ตัวผู้เผยแพร่
  ความถูกต้องของ Claim หรือการเป็น Primary Independent Source
- ข้อมูลอาจเปลี่ยนหลัง HTML ถูกสร้าง หน้า HTML **ไม่ตรวจซ้ำ**
- ผู้ใช้กด “เห็นชอบในหลักการ” ได้เฉพาะเมื่อยืนยันอ่าน warning
  แต่ปุ่มยังไม่บันทึก ไม่ลงชื่อ และไม่ใช่ owner approval
- ไม่มี authenticated owner enrollment/replay journal/trusted
  policy pin ใน workflow นี้
- ไม่ให้ export ไป live DATA_DIR, snapshot, repository หรือ Railway
- Renderer เข้ารหัส HTML metacharacters เพื่อลด XSS จากข้อความโน้ต
- สร้างไฟล์ใหม่เท่านั้น (O_EXCL) ไม่เขียนทับไฟล์ใด ๆ
- ไม่มี network fetch, source capture หรือการทำ snapshot อัตโนมัติ
- CI ใช้เฉพาะ Synthetic fixtures ไม่ใช้โน้ตลงทุนจริง
- บันทึกการตัดสินใจในหน้าเว็บไม่ถูกเก็บถาวร

ต้องผ่านการออกแบบและตรวจ Identity/Owner Authorization แยกต่างหาก
ก่อนจะใช้ข้อมูลจากหน้าจอนี้ส่งคำสั่ง Safe Edit จริงได้

**NO MERGE / NO DEPLOY / NO PRODUCTION VAULT MUTATION**

Stack: #75 → #76 → #77 → #78 → #79 → #80 → #81 → #82 → #83
