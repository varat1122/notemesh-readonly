/**
 * Pure renderer for the existing PR #82 self-contained Thai local HTML.
 *
 * The binding checks MUST be done separately (via PR #78/#79) before this
 * renderer is given a packet. Strings here are DISPLAY DATA, not issuer
 * authentication, an approval receipt, or a Safe Edit command.
 */
const SHA=/^[a-f0-9]{64}$/;
const escapeHtml=(value)=>String(value).replace(/[&<>"']/g,ch=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
})[ch]);
function replaceExactlyOnce(text,find,replacement){
  if(!text.includes(find)||text.indexOf(find)!==text.lastIndexOf(find))
    throw Error("offline_review_template_anchor_missing_or_duplicated");
  return text.replace(find,replacement);
}
export function renderOfflineSnapshotReviewHtml(template,packet,request){
  if(typeof template!=="string"||template.length<3500||
    !template.includes("connect-src 'none'")||
    !template.includes("form-action 'none'")||
    !template.includes("default-src 'none'")||
    packet?.status!=="detached_subject_unapproved"||
    !packet.subject||!SHA.test(packet.subjectSha256)||
    packet.canAutoWrite!==false||packet.ownerApprovalGranted!==false||
    !SHA.test(packet.subject.noteSha256)||
    !SHA.test(packet.subject.originalBlobSha256)||
    !Number.isSafeInteger(packet.subject.sourceRevision)||
    packet.subject.sourceRevision<1||
    packet.subject.notePath!==request.notePath||
    packet.subject.action!==request.action||
    packet.subject.relationship!==request.relationship)
    throw Error("offline_review_unverified_packet_or_template_hold");
  for(const field of ["oldLine","newLine","reviewRationale"]){
    if(typeof request[field]!=="string"||request[field].length>600||
      request[field].includes("\0"))
      throw Error("offline_review_unbounded_proposal_hold");
  }
  let html=template;
  const substitutions=[
    [
      "<strong>ข้อมูลตัวอย่างสมมติทั้งหมด</strong> ไม่มีข้อมูลหุ้นจริง และไม่ได้เชื่อม Obsidian, GitHub, Railway, บัญชีผู้ใช้ หรือระบบยืนยันตัวตน",
      "<strong>สำเนา Offline Snapshot ผ่านการตรวจความสอดคล้องของ bytes ภายในแล้วเท่านั้น</strong> ไม่ได้ตรวจผู้เผยแพร่ต้นฉบับ ความถูกต้องของตัวเลข หรือยืนยันตัวตนเจ้าของ Vault",
    ],
    [
      "ตัวอย่างนี้จำลองผลที่ระบบตรวจหลักฐานก่อนหน้าอาจส่งมาให้คนอ่าน ไม่ใช่รายงานบริษัทจริง",
      "หน้านี้สร้างจากการตรวจไฟล์ Markdown, SQLite และ Original-Source Blob ของ Snapshot ที่แยกจาก Production ณ เวลาส่งออกเท่านั้น หากไฟล์เปลี่ยน ต้องตรวจใหม่ทุกครั้ง",
    ],
    ["SYNTH (บริษัทสมมติ)","เอกสารวิจัยใน Snapshot (ยังไม่ยืนยัน Claim)"],
    ["Historical Research Note — ตัวอย่าง","Historical / Review Candidate — Read-only"],
    ["10_Knowledge/Company Research/SYNTH - Review.md",
      escapeHtml(packet.subject.notePath)],
    ["Synthetic snapshot #01 (ไม่ผ่านการยืนยันจากผู้ออกเอกสาร)",
      "Note SHA-256: "+escapeHtml(packet.subject.noteSha256)+
      " | Source SHA-256: "+escapeHtml(packet.subject.originalBlobSha256)+
      " | Revision: "+packet.subject.sourceRevision],
    ["ข้อเดิมอาจต้องตรวจสอบอีกครั้งจากเอกสารต้นทาง ก่อนยกระดับเป็นข้อเท็จจริงใน Thesis",
      escapeHtml(request.reviewRationale)],
    ["ข้อความเดิมอาจต้องตรวจสอบอีกครั้งจากเอกสารต้นทาง ก่อนยกระดับเป็นข้อเท็จจริงใน Thesis",
      escapeHtml(request.reviewRationale)],
    ["ตัวเลขสมมติในโน้ต: 10 (ยังไม่ยืนยัน)",
      escapeHtml(request.oldLine)],
    ["ตัวเลขสมมติในโน้ต: 12 (รอหลักฐานและการตรวจสอบ)",
      escapeHtml(request.newLine)],
    ["ข้อมูลที่ยังขาด: แหล่งต้นฉบับที่ยืนยันได้, การตรวจ claim ตามช่วงเวลา, การลงทะเบียนกุญแจเจ้าของที่เชื่อถือได้, และการอนุมัติที่มีผลทางสิทธิ์",
      "ข้อมูลที่ยังขาด: การยืนยันผู้เผยแพร่ต้นทาง, ความถูกต้องของ Claim และ Timeline, การยืนยันเจ้าของจริง และ Approval ที่ผ่านการตรวจสิทธิ์ แผ่น HTML นี้ไม่ตรวจซ้ำเมื่อเปิด"],
    ["การทดลองนี้ใช้ HTML/JavaScript ภายในไฟล์เท่านั้น ไม่มีการส่งข้อมูลผ่านอินเทอร์เน็ต ไม่มีการเก็บ localStorage/cookie ไม่มีการสร้าง Digital Signature ไม่มีการบันทึกไฟล์หรือแตะ Production Vault เมื่อปิดหน้า ข้อความที่กรอกและผลการตัดสินใจในหน้านี้จะไม่ถูกเก็บไว้",
      "เอกสารนี้มีข้อมูลจาก snapshot อยู่ภายในไฟล์ HTML ที่ส่งออก จึงต้องเก็บให้ปลอดภัยและลบทิ้งอย่างเหมาะสม ไม่มีการส่งข้อมูลผ่านเครือข่าย ไม่บันทึกการตัดสินใจกลับ Vault ไม่มี Signature, Safe Edit หรือ Owner Authorization ข้อมูลและเหตุผลอาจล้าสมัยทันทีเมื่อ Snapshot เปลี่ยน"],
  ];
  for(let i=0;i<substitutions.length;i++){
    const [original,replacement]=substitutions[i];
    if(i===7){
      // Two versions of the old rationale anchor, only one can exist.
      if(!html.includes(original))continue;
    }else if(i===6){
      if(!html.includes(original))continue;
    }
    html=replaceExactlyOnce(html,original,replacement);
  }
  if(html.includes("SYNTH (บริษัทสมมติ)")||
    html.includes("Synthetic snapshot #01")||
    html.includes("ตัวเลขสมมติในโน้ต: 10"))
    throw Error("offline_review_template_fixture_not_replaced_hold");
  return html.replace("</title>",
    " — read-only / unsigned / no owner approval</title>");
}
