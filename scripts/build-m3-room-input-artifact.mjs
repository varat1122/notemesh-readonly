/**
 * GitHub Actions artifact builder for M3 Gold-free evaluation INPUTS only.
 * Deliberately not the local-only chat-shadow CLIs and not an eval runner.
 * Produces NO model inference, adjudication, connector calls or Vault writes.
 */
import {registerHooks} from "node:module";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";

registerHooks({
  resolve(specifier,context,nextResolve){
    if((specifier.startsWith("./")||specifier.startsWith("../"))&&
      !/\.(?:[cm]?[jt]s|json|node)$/i.test(specifier)){
      try{return nextResolve(specifier,context);}
      catch(error){
        if(error?.code!=="ERR_MODULE_NOT_FOUND")throw error;
        return nextResolve(specifier+".ts",context);
      }
    }
    return nextResolve(specifier,context);
  },
});

if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
  throw Error("M3_PACKET_EXPORT_FORBIDDEN_IN_RAILWAY");
const output=resolve(process.cwd(),"m3-room-input-artifacts");
await mkdir(output,{recursive:true});
const {makeM3ChatRoomBundle}=await import("../src/server/vault/m3-chat-native.ts");
const {makeM3RealCalibrationBundle}=await import("../src/server/vault/m3-real-calibration.ts");
let synthetic=0,historical=0;
for(const room of ["micro","macro","pdf"]){
  for(const [track,bundle] of [
    ["S",makeM3ChatRoomBundle(room)],
    ["H",makeM3RealCalibrationBundle(room)]
  ]){
    if(bundle.room!==room||!bundle.fixtureSha256||!Array.isArray(bundle.cases))
      throw Error("M3_PACKET_EXPORT_INTEGRITY_HOLD");
    if(track==="S"&&bundle.cases.some(c=>c.origin!=="fictional_synthetic_only"))
      throw Error("M3_PACKET_SYNTHETIC_SCOPE_HOLD");
    if(track==="H"&&(bundle.cases.length!==2||bundle.cases.some(c=>
      c.origin!=="source_anchored_historical_candidate"||
      c.sourceItems.some(s=>s.bytesArchivedToVault!==false))))
      throw Error("M3_PACKET_HISTORICAL_SCOPE_HOLD");
    const payload=JSON.stringify(bundle,null,2)+"\n";
    if(/"(?:gold|reviewSafe|reasonCode|requiredCitationIds|reviewerOnly|provisionalDisposition|requiredCitations|critical)"\s*:/.test(payload))
      throw Error("M3_PACKET_HIDDEN_LABEL_LEAK_HOLD");
    const filename=`${track}_${room}.json`;
    await writeFile(resolve(output,filename),payload,{encoding:"utf8",flag:"wx"});
    if(track==="S")synthetic+=bundle.cases.length;else historical+=bundle.cases.length;
  }
}
if(synthetic!==20||historical!==6)
  throw Error("M3_PACKET_CORPUS_COUNT_HOLD");
const readme=`# M3 — Gold-free Room Input Pack (ไม่ใช่ผลทดสอบ)

สร้างอัตโนมัติจาก GitHub Repository SHA ที่แสดงใน GitHub Actions Workflow ของไฟล์ ZIP นี้
- S_micro.json / S_macro.json / S_pdf.json: Synthetic Track S รวม 20 กรณี (Developer Gold ไม่ได้รวมในไฟล์)
- H_micro.json / H_macro.json / H_pdf.json: Historical Calibration Track H รวม 6 กรณี (Provisional Labels ไม่ได้รวม)
- ทุกไฟล์มี fixtureSha256 และ policySha256 ที่สร้างโดย Code จริงใน Repository

**เปิดห้อง ChatGPT Micro, Macro หรือ PDF ที่ได้รับอนุญาต** แล้วส่งไฟล์ของห้องนั้นทีละ Track พร้อม Prompt ในชุด M3 Actual Room Evaluation Kit ที่มีอยู่เดิม เริ่ม S_micro.json หรือ H_micro.json ได้เลย; ไม่มีขั้นตอนติดตั้ง Node/PowerShell หรือ Clone Repository สำหรับผู้ใช้

การทดลองควรมี 3 ครั้งต่อ Room ต่อ Track = 18 Sessions; แต่ละ Session ต้องแยกประวัติ/ผลรอบก่อนและไม่ส่ง Gold/เฉลยหรือ source code ที่มีเฉลยให้โมเดล

คำสั่งที่ส่งคู่กับไฟล์ JSON:
"ทดสอบ Research Review ของแต่ละ case ในไฟล์แนบ โดยใช้เฉพาะหลักฐานใน case และการค้นแบบ Read-only ที่ได้รับอนุญาต ตัดสิน accept_qualified หรือ hold_unsupported ระบุ citedIds เฉพาะในโจทย์ แยกที่มาจาก Fact/Claim/Inference และระบุ missingEvidenceTh เป็นภาษาไทย ตอบเป็น JSON judgments[] ตาม M3 scorer schema ห้าม Safe Edit Apply, ห้ามแก้ Thesis/Portfolio, ห้ามยืนยัน issuer fact/verified_primary จาก URL หรือข้อความอ้างเพียงอย่างเดียว และอย่าอ่านเฉลยหรือผลการทดลองก่อนหน้า"

**สำคัญ:** แพ็กนี้เป็น INPUT เท่านั้น ไม่มี Transcript/ผลคะแนนจริง ชุด H ใช้ผู้เขียนระบบกำหนด provisional labels ยังไม่ใช่ independent adjudication และชุด S เป็นเรื่องสมมติทั้งหมด จึงไม่สามารถใช้ CI หรือการ export เพื่ออนุมัติ Production ได้

NO Production Apply, NO Merge/Deploy, NO verified primary from source URL.
`;
await writeFile(resolve(output,"README_START_TH.md"),readme,{encoding:"utf8",flag:"wx"});
process.stdout.write(JSON.stringify({status:"gold_free_inputs_exported_only",
  syntheticCases:synthetic,historicalCalibrationCases:historical,files:7,
  observedRoomTrials:0,independentGoldVerified:false,
  modelInvoked:false,productionWrites:false,releaseApproved:false})+"\n");
