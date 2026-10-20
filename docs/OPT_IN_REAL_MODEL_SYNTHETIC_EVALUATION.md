# PR #91 — ทดลอง AI จริงกับข้อมูลสมมติเท่านั้น (Opt-in OpenAI)

## เพื่ออะไร

PR #90 มีระบบทดสอบข่าวและ Thesis จำลอง 8 กรณี รวมถึง
False Duplicate, Missed Thesis-Changing, Citation และ Abstention
แต่ที่ผ่านมาคำตอบที่นำไปตรวจเป็น **Mock** ไม่ใช่ผลโมเดลจริง

PR #91 เพิ่มตัวเรียก **OpenAI Responses API สำหรับชุด SYNTH เท่านั้น**
และนำผลมาผ่านตัวตรวจ PR #90 โดยไม่แตะ Obsidian Vault

## 2 ระดับที่ต้องแยก

**1. CI / Unit Tests — ทำได้ทันที:** จำลองคำตอบ API ผ่าน
injected test transport เพื่อตรวจ JSON Schema, การส่งข้อความ,
การจับ false duplicate, ไม่มี Vault data ใน payload, การไม่เก็บ
responses, การปฏิเสธผล incomplete/unauthorized และ redaction

**2. Real API Evaluation — ยังไม่เกิดขึ้นใน CI:** ต้องมีเจ้าของ
API key ทดลองเองบนเครื่องส่วนตัว และ opt-in อย่างชัดเจนก่อน
จึงนับเป็นโมเดลจริงที่ได้รับคำตอบจาก API. ห้ามใส่ key ใน GitHub,
Railway, Obsidian, Chat หรือไฟล์โค้ด

## วิธีรันบนเครื่องทดสอบที่แยกจาก Production

Prerequisite: Node.js 24+, checkout Draft PR #91 และมี
OpenAI API key ซึ่งผู้ใช้ควบคุมสิทธิ์และค่าใช้จ่าย

รันบน macOS/Linux shell โดยไม่เปิด shell tracing:

    export OPENAI_API_KEY='<set locally; never commit or paste>'
    export NM_ENABLE_SYNTHETIC_OPENAI_RUN=YES
    node --experimental-strip-types scripts/run-synthetic-openai-eval.mjs \
      --execute-synthetic-only

คำสั่งจะส่งข้อมูล SYNTH สมมติ **8 prompts** ไปยัง
https://api.openai.com/v1/responses โดยใช้ model gpt-5-mini
คีย์ใช้ผ่าน environment variable และไม่บันทึกลงไฟล์หรือ GitHub
การเรียก API อาจมีค่าใช้จ่าย และส่งข้อมูลสมมติไปยังผู้ให้บริการ
ตามนโยบาย API ของผู้ให้บริการ แม้ไม่มีข้อมูลจริงก็ตาม

ผลที่พิมพ์ออกมาคือจำนวนข้อที่ตรงกับเฉลยแบบจำลอง และ
unsafeFalseDuplicates, missedCriticalReviews, invalidCitations,
missedAbstentions รวมถึงสถานะการตรวจ API/Model เท่านั้น
ไม่พิมพ์ raw model responses

## ขอบเขตความปลอดภัย

- ไม่เปิดใช้งานเอง อาศัย opt-in 2 ชั้น (flag + environment)
- ไม่ให้รัน live provider ใน GitHub Actions (CI, GITHUB_ACTIONS)
  หรือ Railway; ทดสอบ CI ใช้ mock transport เท่านั้น
- API endpoint เป็น HTTPS แบบ hardcode; ไม่รับ base URL เอง
  ไม่ให้ redirect, ไม่รับ arbitrary prompt/path/user messages
- ส่งได้เฉพาะ 8 fixed prompts SYNTH; ไม่ส่ง real Vault,
  real Current Thesis, notes, screenshots, personal data, files
- ส่ง store:false, output จำกัด, response format เป็น JSON Schema
  และไม่เปิด model tools
- จำกัด timeout, ตรวจ API status, response size และ malformed output
- ไม่บันทึกคำตอบ raw, ข้อมูลลงทุน หรือ key ลง GitHub หรือ Vault
- Output ของ API ถูกจัดว่า untrusted; ไม่มี Vault write permission
- **ตัว callback/injected transport ภายใน unit test ไม่ใช่ security
  sandbox และไม่สามารถยืนยันว่าได้เรียก OpenAI จริง**
- Gold labels ของชุด SYNTH เปิดเผยใน code: ไม่ใช่ held-out dataset;
  แม้โมเดลได้ 8/8 ก็ยังไม่พิสูจน์ความแม่นยำเชิงลงทุนจริง
- API responses มิได้พิสูจน์ fact, source, causation, price-in,
  Thesis-changing หรือ owner approval
- ห้าม Merge/Deploy/Production Vault Mutation

## ก่อนใช้กับข้อมูลจริง

ต้องมี real independent owner entitlement (อ่าน / วิเคราะห์ /
เขียน แยกกัน), การป้องกันการรั่วของ protected Thesis, การยืนยัน
ต้นฉบับและ revision, held-out human-labeled evaluation,
benchmark ที่มีภาษาไทย / ticker จริงโดยได้รับอนุญาตอย่างเหมาะสม
และเกณฑ์ threshold ก่อนอนุญาตให้ AI คัดข่าวจริง

ownerApprovalGranted=false, canAutoWrite=false,
canAutoUpdateThesis=false, productionReleaseAllowed=false
ทุกกรณี แม้ทดสอบโมเดลจริงผ่าน

Stack: #75 ... #90 → #91
NO MERGE / NO DEPLOY / NO PRODUCTION VAULT MUTATION.
