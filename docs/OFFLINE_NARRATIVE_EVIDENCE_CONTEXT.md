# PR #85 — ค้นประวัติที่เขียนเป็นข้อความทั่วไป (Offline Narrative Evidence)

## ทำไปเพื่ออะไร

ปัญหาของนักลงทุนคือ ข่าวใหม่อาจถูกกล่าวถึงในโน้ตเก่าหลายแห่ง
ซึ่งไม่ได้ทำเป็นตารางหรือ Claim ID และผู้ใช้ไม่มีเวลาจำ/อ่านทุกไฟล์

PR #84 เทียบข้อมูลที่จัดโครงสร้างได้แล้ว ส่วน PR #85 เพิ่มการ
**ค้นคำในข้อความเก่าและดึงบรรทัดจริงพร้อมชื่อโน้ต/เลขบรรทัด**
เพื่อให้ AI ในอนาคตมีชุดหลักฐานสำหรับอ่านเปรียบเทียบเชิงเหตุและผล

ตัวอย่างสมมติ: ข่าว SYNTH เรื่อง Capacity/Delivery
ระบบคืนชื่อโน้ตประวัติ บรรทัดข้อความที่พบ ช่วงเวลาใน frontmatter
และคำที่ทำให้จับคู่ได้ โดยยังไม่บอกว่าตรงกันในเชิงความหมายหรือถูกต้อง

## เช็กอะไรจริง

- ใช้ Offline Snapshot ที่แยกจาก Production แล้วเท่านั้น
- ตรวจ Physical Markdown/SQLite/FTS/Attachments ครอบคลุมผ่าน PR #74
  และตรวจ manifest SHA-256 ที่ทราบก่อนหน้า
- ใช้ FTS5 โดยทำ keyword เป็น literal phrase ที่ bounded ไม่รัน query grammar
  จากข้อความผู้ใช้
- จำกัด candidate 80 โน้ตและคืนบรรทัดจาก 12 โน้ตสูงสุด
- สำหรับแต่ละ candidate เปิด Markdown แบบ readonly/nofollow,
  ตรวจ mtime/size, hash, index frontmatter และ FTS body
- Return line number จริงแบบ 1-based พร้อม excerpt จากไฟล์ที่อ่าน
- แสดง event_date, published_at และ imported_at แยกกัน ไม่ปนกัน
- ระบุ source URL/hash ว่าเป็น **คำประกาศในโน้ตเท่านั้น**
- หากหลายโน้ตอ้าง URL+hash เดียวกัน ให้แสดงว่ามาจากตระกูลแหล่งเดียวกัน
  ไม่ถือว่า 2 โน้ต = 2 หลักฐานอิสระ
- กรอง protected Thesis/Portfolio จาก excerpt อัตโนมัติ
- Archived AI ที่พบใช้เพื่ออ้างประวัติ ไม่ใช่หลักฐานอิสระ
- ตรวจ coverage ซ้ำตอนท้าย หากไฟล์ระหว่างทางไม่ตรง ให้ HOLD

## สิ่งที่ยังสรุปไม่ได้

**ระบบนี้ยังไม่ใช่ semantic AI จริง** เป็น lexical retrieval จาก FTS
พร้อมตัวอย่างข้อความจากไฟล์จริงที่ตรวจเวอร์ชันแล้วเท่านั้น

- คำพ้องความหมาย การสะกดต่าง ภาษาไทยที่เว้นวรรคต่าง หรือความหมาย
  ที่สื่อโดยไม่ใช้คำค้นตรง ๆ อาจหาไม่เจอ
- FTS ค้นได้จำกัด 80 ผล และคืน 12; หาก truncated จะบอกตรง ๆ
- แม้พบคำเหมือนกัน ไม่ใช่หลักฐานว่าข่าวซ้ำ / ผิด / ใหม่ หรือ Thesis เปลี่ยน
- ข้อความเก่าถือเป็น untrusted data ไม่ใช่คำสั่งให้ AI
- ยังไม่พิสูจน์ issuer/source version/counter-evidence/current thesis
- ห้ามสรุป Earnings, Valuation, Portfolio Change จากการพบคำ
- ไม่ตรวจว่ารวม History ข้ามอุปกรณ์/Cloud/Chat ครบทั้งหมด

## Review by Exception ในอนาคต

1. PR #84 เปรียบเทียบ Structured Claims
2. PR #85 ดึงอ้างอิงจากโน้ต narrative ที่เกี่ยวข้อง
3. AI อ่าน excerpts และอ่านแหล่งต้นทางจริงเพิ่ม ตรวจ Claim ID/date/period
   แล้วเสนอ New/Duplicate/Added Detail/Correction/Contradiction/Unresolved
4. เปรียบเทียบ Current Thesis และ counter-evidence แบบ read-only
5. จัดคิวให้เจ้าของดูเฉพาะข้อขัดแย้งและ Thesis-Changing
6. ใช้หน้าจอ #82/#83 แสดง Before/After พร้อมเหตุผลที่ตรวจได้
7. ห้ามแก้ Production จนผ่าน Owner Authorization/Approve ทุกชั้น

**ขอบเขต PR นี้:** Code/API function ฝั่ง offline ใน development branch
เท่านั้น ไม่มี CLI/MCP/HTTP endpoint ไม่มี Merge/Deploy/Safe Edit Apply
และไม่มีการแตะ Production Vault

Stack: #75 → #76 → #77 → #78 → #79 → #80 → #81 → #82 → #83 → #84 → #85.
