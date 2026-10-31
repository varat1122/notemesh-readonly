---
runbook_id: IOS-RUNBOOK-OPS-005
for_task: IOS-TASK-OPS-005
as_of: 2026-10-31
author: Claude Code
executor: Owner (ทำเองบนเครื่องตัวเอง เพราะ Work/Codex ไม่มี token)
status: DRAFT — ขั้น 3, 4 (base64 round-trip), 6 และสคริปต์ขั้น 7 รันผ่านบนข้อมูลจำลองที่มี WAL ค้าง; ตัว `railway ssh` ยังไม่ได้ทดสอบจาก session นี้
---
# Runbook — Production backup + restore บนเครื่องตัวเอง + ซ้อม schema cleanup

ทำตาม IOS-TASK-OPS-005 แบบคนทำเอง ทุกขั้นมี **ตรวจ** — ถ้าไม่ผ่านให้หยุดแล้วส่งผลกลับมา
ห้ามวางค่า secret, password หรือเนื้อหาโน้ตลงแชต/GitHub

## 0. เตรียมเครื่อง (ครั้งเดียว)
- Railway CLI: `npm i -g @railway/cli` แล้ว `railway login`
- Node 22.13+ (มี `node:sqlite`), `git`, `pnpm`, และ `age` (หรือ `gpg`) สำหรับเข้ารหัส
- โฟลเดอร์ทำงานที่ไม่ sync ขึ้น cloud อัตโนมัติ เช่น `~/ios-backup-20261031`

```sh
mkdir -p ~/ios-backup-20261031 && cd ~/ios-backup-20261031
railway link        # เลือก project wholesome-wholeness → environment production → service NoteMesh
railway status      # ต้องเห็น wholesome-wholeness / production / NoteMesh
```

## 1. Preflight (อ่านอย่างเดียว)
```sh
railway ssh -- 'echo ok; node -v; ls -la /data; du -sh /data/vault /data/home; ls -la /data/app.sqlite*'
```
**ตรวจ:** ต่อได้, มี `/data/app.sqlite` และ `/data/vault`; ขนาดรวมต้องน้อยกว่าที่ว่างใน `/tmp` (`railway ssh -- df -h /tmp /data`)
ถ้าคำสั่ง `railway ssh -- ...` แบบส่งคำสั่งตรงใช้ไม่ได้ ให้ `railway ssh` เข้า shell แล้วพิมพ์คำสั่งใน quote ทีละบรรทัดแทน

## 2. หยุดตัวเขียน (ชั่วคราว ไม่แก้ variable)
1. เปิดหน้า admin ของ NoteMesh → แท็บ Status → **Stop Sync** → ต้องขึ้น `stopped`
2. ช่วงนี้ **ห้ามใช้ ChatGPT บันทึก/Safe Edit** ลง Vault
3. เลี่ยงช่วง market-price refresh (หลัง 06:00 UTC = 13:00 น.) — ทำก่อน 12:30 น. หรือหลัง 14:00 น.
บันทึกเวลาเริ่ม (quiesce_at)

## 3. Backup ใน container
```sh
railway ssh -- 'set -e; cd /tmp; rm -rf iosbk; mkdir iosbk;
node -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"/data/app.sqlite\");d.exec(\"VACUUM INTO \x27/tmp/iosbk/app.sqlite\x27\");d.close();const b=new DatabaseSync(\"/tmp/iosbk/app.sqlite\",{readOnly:true});console.log(\"integrity:\",b.prepare(\"PRAGMA integrity_check\").get().integrity_check);b.close()";
tar -C /data --exclude=./app.sqlite --exclude=./app.sqlite-wal --exclude=./app.sqlite-shm -czf /tmp/iosbk/data-files.tgz .;
sha256sum /tmp/iosbk/*'
```
- `VACUUM INTO` สร้างสำเนาที่สอดคล้องกันจาก process แยก รวมข้อมูลที่ commit แล้วใน WAL (ไม่ใช้ `cp`)
- **ตรวจ:** `integrity: ok` และจด SHA-256 ของ 2 ไฟล์

## 4. ดึงไฟล์ลงเครื่องแล้วเปิดระบบกลับ
```sh
railway ssh -- 'base64 -w0 /tmp/iosbk/app.sqlite' | base64 -d > app.sqlite
railway ssh -- 'base64 -w0 /tmp/iosbk/data-files.tgz' | base64 -d > data-files.tgz
shasum -a 256 app.sqlite data-files.tgz      # ต้องตรงกับขั้น 3 ทุกตัวอักษร
railway ssh -- 'rm -rf /tmp/iosbk'
```
แล้ว: หน้า admin → **Start Sync Service** → รอ `running`; ตรวจ `https://notemesh-production-a893.up.railway.app/api/health` ตอบ OK
บันทึกเวลา (resume_at) — ถ้าระบบไม่กลับมา healthy ให้หยุดทุกอย่างและแจ้งทันที

## 5. เข้ารหัส + เก็บนอก volume
```sh
age-keygen -o ios-backup.key            # เก็บไฟล์นี้ในที่ปลอดภัยของคุณ (password manager) ห้ามอัปโหลดคู่กับ backup
age -r "$(grep -o 'age1.*' ios-backup.key)" -o app.sqlite.age app.sqlite
age -r "$(grep -o 'age1.*' ios-backup.key)" -o data-files.tgz.age data-files.tgz
shasum -a 256 *.age > ciphertext-sha256.txt
```
อัปโหลด `*.age` + `ciphertext-sha256.txt` ไปที่เก็บส่วนตัว (เช่น Google Drive ส่วนตัว) แล้วจด ID/ลิงก์ (storage receipt)
**ตรวจ:** ดาวน์โหลดกลับมา 1 ครั้ง แล้ว SHA-256 ต้องตรง `ciphertext-sha256.txt`

## 6. Restore แยกบนเครื่อง (ไม่ใช่ Production, ไม่ใช่ M4)
```sh
mkdir -p restore/data && cd restore
age -d -i ../ios-backup.key -o data/app.sqlite ../app.sqlite.age
age -d -i ../ios-backup.key -o data-files.tgz ../data-files.tgz.age && tar -C data -xzf data-files.tgz
node -e '
const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("data/app.sqlite",{readOnly:true});
console.log("integrity:",d.prepare("PRAGMA integrity_check").get().integrity_check);
console.log("fk violations:",d.prepare("PRAGMA foreign_key_check").all().length);
console.log("account cols:",d.prepare("PRAGMA table_info(account)").all().map(c=>c.name).join(","));
console.log("issuer index:",!!d.prepare("SELECT 1 FROM sqlite_master WHERE name=\x27account_issuer_accountId_uidx\x27").get());'
```
**ตรวจ:** `integrity: ok`, `fk violations: 0`, มี `issuer` ใน account cols, `issuer index: true`

## 7. ซ้อม schema cleanup บนสำเนา (สคริปต์ใน PR #135)
```sh
git clone https://github.com/varat1122/notemesh-readonly.git nm && cd nm
git checkout e9b467e     # หรือ head ล่าสุดของ PR #135 ที่ CI ผ่าน
cp ../data/app.sqlite ../app.sqlite.precleanup            # จุด rollback ของการซ้อม
node scripts/account-issuer-cleanup.mjs ../data/app.sqlite            # report: ต้องเป็น needs_cleanup, refusals: []
node scripts/account-issuer-cleanup.mjs ../data/app.sqlite --apply    # ต้องเป็น cleaned, counts before = after
```
**ถ้าได้ `refused`** ให้หยุด แล้วส่ง output (ไม่มี secret) กลับมา

## 8. บูต candidate บนสำเนา (ปิด sync โดยใช้ key ใหม่)
```sh
pnpm install --frozen-lockfile && pnpm build
DATA_DIR="$(cd .. && pwd)/data" ENCRYPTION_KEY="$(openssl rand -base64 32)" PORT=3999 node .output/server/index.mjs
```
- ใช้ `ENCRYPTION_KEY` **ใหม่แบบสุ่ม** โดยตั้งใจ: รหัส Obsidian ที่เก็บไว้จะถอดไม่ได้ → สำเนานี้ **จะไม่ต่อ Obsidian Sync** ไปแตะ Vault จริง
- เปิด `http://localhost:3999/login` → login ด้วยบัญชี admin เดิม → ต้องเข้าได้
- `curl -s localhost:3999/api/health` ต้อง OK
- (ข้อจำกัด: OAuth token ที่เข้ารหัสด้วย key เดิมจะใช้ไม่ได้บนสำเนานี้ — ไม่ใช่สิ่งที่ทดสอบในรอบนี้)
- เสร็จแล้ว Ctrl+C และลบโฟลเดอร์ `restore/` (มีข้อมูลจริง)

## 9. Rollback ของการซ้อม (พิสูจน์ว่ากลับได้)
```sh
cp ../app.sqlite.precleanup ../data/app.sqlite
node scripts/account-issuer-cleanup.mjs ../data/app.sqlite   # ต้องกลับเป็น needs_cleanup
```

## 10. ส่งกลับ (ไม่มี secret)
คัด output ต่อไปนี้ใส่ `IOS-RETURN-OPS-005_2026-10-31_TH.md` หรือวางในแชต:
- ผลขั้น 1, SHA-256 ขั้น 3/4, เวลา quiesce_at/resume_at, health หลัง resume
- `ciphertext-sha256.txt` + storage receipt (ชื่อไฟล์/ID — ไม่ใช่ลิงก์สาธารณะ)
- output ขั้น 6, ขั้น 7 (JSON ทั้งก้อน), ผล login ขั้น 8, ผลขั้น 9

**สิ่งที่ runbook นี้ไม่ทำ:** แก้ schema บน Production, deploy, merge, เปลี่ยน variables — นั่นคือ OPS-006 (ต้องอนุมัติแยก และต้องจัดการ auto-deploy จาก `main` ก่อน)
