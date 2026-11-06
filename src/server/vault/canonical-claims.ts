/** Source-scoped observations using the existing structured-claim Note contract.
 * Pure planning / SELECT-only validation. Safe Edit is the sole writer. */
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {assertReviewChronology,type ReviewLineageRecord} from "../safe-edit/research-lineage";
import {readNote} from "./notes";
import {canonicalHttpSourceUrl} from "../source-url";
import {splitFrontmatter} from "./markdown";
import {indexedRead,createReceipt} from "./investment-research-context";
import type {WritebackInput} from "./investment-writeback-router";

const text=(max:number)=>z.string().trim().min(1).max(max);
export const evidenceClassSchema=z.enum(["reported_actual","management_guidance","analyst_estimate","unverified_claim"]);
export const intakeClaimsSchema=z.array(z.object({
  entity:text(120),metric:text(140),value:text(150),unit:text(80),period:text(120),
  evidenceClass:evidenceClassSchema,statement:text(2500),
  sourceLocator:text(500),sourceExcerpt:text(3000),qualification:text(200).optional(),
  verification:z.literal("unverified").default("unverified")
}).strict()).min(1).max(8).optional().describe("Up to 8 source-anchored claim observations, persisted through existing Safe Edit only. Actual and management guidance are different identities. sourceExcerpt must occur verbatim in extractedText; values/qualifications must appear literally. Statements and evidence-class labels are caller-attributed/unverified; literal excerpt anchoring does not validate semantic fidelity, issuer authenticity or investment conclusions. Semantic fidelity requires a reviewer. This does not issue primary receipts or relationship edges. Do not combine with legacy singular claim.");
const date=z.string().datetime({offset:true}).nullable();
export const researchLineageSchema=z.object({knowledgeCutoffAsOf:date}).strict().optional()
  .describe("Caller-declared historical knowledge cutoff, nullable when unknown. Review creation time is runtime-generated and retained on an identical prepared retry. Caller timestamps/model-version assertions are not accepted; the originating LLM version is not exposed by this runtime.");
export type IntakeClaim=NonNullable<z.infer<typeof intakeClaimsSchema>>[number];
export type ResearchLineage=z.infer<typeof researchLineageSchema>;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const norm=(s:string)=>s.trim().normalize("NFC").toLowerCase().replace(/\s+/g," ");
export const claimPath=(id:string)=>`10_Knowledge/Company Research/Investment Claim - ${id}.md`;
const idFor=(intakeId:string,c:IntakeClaim)=>"ICL-"+sha(JSON.stringify([intakeId,norm(c.entity),norm(c.metric),norm(c.period),norm(c.unit),c.evidenceClass])).slice(0,32).toUpperCase();
const fence=(value:string)=>{const ticks="`".repeat(Math.max(2,...(value.match(/`+/g)??[]).map(s=>s.length))+1);return `${ticks}text\n${value}\n${ticks}`;};
/** Public read-time boundary, deliberately not added to immutable claim bytes. */
export const claimInterpretationBoundary={statementStatus:"caller_attributed_unverified",
  evidenceClassStatus:"caller_declared_unverified",semanticFidelity:"not_assessed",
  factUsability:"not_verified_fact",sourceExcerptBinding:"literal_received_source_only"} as const;

/** Recover chronology from the exact written receipt first, or at most sixteen
 * matching-input previews plus a sentinel. Unrelated proposal history cannot
 * exhaust this bound. No journal writes or arbitrary first/last selection. */
export function lineageMetadata(input:WritebackInput,reviewPath:string,sourcePath:string,claims:{content:string}[]):{
  metadata:Record<string,unknown>;issues:string[];
}{
  if(!input.researchLineage&&!input.claims)return {metadata:{},issues:[]};
  const l=researchLineageSchema.parse(input.researchLineage)??{knowledgeCutoffAsOf:null};
  const fingerprint=sha(JSON.stringify([sourcePath,input.researchReview??input.completedAnalysis,l,
    claims.map(c=>sha(c.content))]));
  let created=new Date().toISOString(),historical=false;const issues:string[]=[];
  if(db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get()){
    let written:string|null=null;
    try{const raw=readNote(reviewPath).content;
      if(splitFrontmatter(raw).data.analysis_input_sha256===fingerprint)written=raw;
    }catch{/* File/index absence is classified by the workflow's normal readback. */}
    let rows:ReviewLineageRecord[]=[];
    if(written!==null){
      // A valid historical write wins over abandoned previews. A bad current
      // receipt is an explicit HOLD, never a replacement proposal.
      const fm=splitFrontmatter(written).data;
      if(typeof fm.analysis_created_at==="string")created=fm.analysis_created_at;
      try{
        const id=createReceipt("canonical_review",reviewPath,written);
        rows=[db().prepare("SELECT * FROM safe_edit_operations WHERE id=?").get(id) as ReviewLineageRecord];
      }catch{issues.push("review_lineage_written_receipt_unverified");}
    }else{
      rows=db().prepare(`SELECT id,actor,payload,after_text,after_hash,status FROM safe_edit_operations
        WHERE json_valid(payload) AND json_extract(payload,'$.path')=? AND instr(after_text,?)>0
        ORDER BY id LIMIT 17`).all(reviewPath,`\nanalysis_input_sha256: "${fingerprint}"\n`) as ReviewLineageRecord[];
    }
    historical=written!==null||rows.length>0;
    if(rows.length>16)issues.push("review_lineage_scan_limit");
    else{
      const times=new Set<string>();
      for(const r of rows){
        const fm=splitFrontmatter(r.after_text).data;
        if(fm.analysis_input_sha256!==fingerprint){issues.push("review_lineage_input_unverified");continue;}
        const event=db().prepare("SELECT at FROM safe_edit_events WHERE operation_id=? AND actor=? AND event='preview' ORDER BY at LIMIT 1").get(r.id,r.actor) as {at:string}|undefined;
        try{assertReviewChronology(r,event?.at);times.add(String(fm.analysis_created_at));}
        catch{issues.push("review_runtime_chronology_unverified");}
      }
      if(times.size>1)issues.push("review_runtime_chronology_ambiguous");
      if(times.size===1)created=[...times][0];
    }
  }
  if(l.knowledgeCutoffAsOf&&Date.parse(l.knowledgeCutoffAsOf)>Date.parse(created)){
    if(historical)issues.push("knowledge_cutoff_after_analysis");else throw Error("knowledge_cutoff_after_analysis");
  }
  return {metadata:{knowledge_cutoff_as_of:l.knowledgeCutoffAsOf,analysis_created_at:created,
    analysis_input_sha256:fingerprint,knowledge_cutoff_provenance:"caller_declared",
    analysis_created_at_provenance:"runtime_canonical_review_proposal",model_version:null,model_version_status:"not_exposed"},issues:[...new Set(issues)]};
}
export function planClaimNotes(input:WritebackInput,intakeId:string,sourcePath:string){
  const parsed=intakeClaimsSchema.parse(input.claims);
  if(!parsed)return [];
  if(input.claim||input.domain!=="company")throw Error("claim_persistence_requires_company_scope_and_no_legacy_claim");
  const url=input.sourceUrl?canonicalHttpSourceUrl(input.sourceUrl):null;
  if(!url)throw Error("claim_source_url_required");
  const records=new Map<string,{id:string;path:string;content:string;issues:string[]}>();
  for(const c of parsed){
    if(!input.entities.some(e=>norm(e)===norm(c.entity)))throw Error("claim_entity_outside_source_scope");
    const id=idFor(intakeId,c),path=claimPath(id),issues:string[]=[];
    if(!input.extractedText.includes(c.sourceExcerpt)||!c.sourceExcerpt.includes(c.value)||c.qualification&&!c.sourceExcerpt.includes(c.qualification))issues.push("claim_literal_source_anchor_missing");
    const row={claim_id:id,entity:c.entity,metric:c.metric,value:c.value,unit:c.unit,period:c.period,
      evidence_class:c.evidenceClass,qualification:c.qualification??null,statement:c.statement,
      source_locator:c.sourceLocator,source_excerpt:c.sourceExcerpt,original_source:url,
      source_path:sourcePath,verification:"unverified",origin_independence_increment:0};
    const fm={type:"investment_structured_claim_register",claim_persistence_version:"RI001-1",domain:"company",entity:c.entity,
      intake_id:intakeId,source_type:"attributed",verification:"unverified",original_source:url,
      original_source_path:sourcePath,source_text_sha256:sha(input.extractedText),
      event_date:input.eventDate??null,published_at:input.publicationDate??null,
      origin_family:intakeId,origin_independence_increment:0,claims:[row]};
    const content=["---",...Object.entries(fm).map(([k,v])=>`${k}: ${JSON.stringify(v)}`),"---","",
      `# ข้ออ้างที่อ้างจากต้นฉบับ — ${id}`,"",`Source token: InvestmentIntake${intakeId.slice(3)}`,`Claim token: ${id}`,"",
      `ต้นฉบับ: [[${sourcePath.slice(0,-3)}]]`,"",
      "## ข้อมูลรายข้อ (ยังไม่ใช่ข้อเท็จจริงที่ยืนยันโดยอิสระ)","",fence(JSON.stringify(row,null,2)),"",
      "บทวิเคราะห์ที่อ้างข้ออ้างนี้ค้นได้จาก backlink ที่ผ่าน readback/index/receipt; ไม่มีบทวิเคราะห์หรือความสัมพันธ์ใหม่ที่อนุมานขึ้นเอง",""] .join("\n");
    const prior=records.get(id);if(prior&&prior.content!==content)throw Error("conflicting_claims_in_same_identity");
    records.set(id,{id,path,content,issues});
  }
  return [...records.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

/** Fresh binding witness for generated claims only. Never initialize receipts. */
export function readPersistedClaim(path:string){
  if(!/^10_Knowledge\/Company Research\/Investment Claim - ICL-[A-F0-9]{32}\.md$/.test(path))throw Error("claim_path_invalid");
  const note=indexedRead(path),fm=note.fm,claims=fm.claims as Record<string,unknown>[];
  if(fm.type!=="investment_structured_claim_register"||fm.claim_persistence_version!=="RI001-1"||!Array.isArray(claims)||claims.length!==1)throw Error("claim_metadata_invalid");
  const c=claims[0],intakeId=String(fm.intake_id),sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${intakeId}.md`;
  if(!/^IN-[A-F0-9]{16}$/.test(intakeId)||fm.original_source_path!==sourcePath||c.source_path!==sourcePath||c.verification!=="unverified"||fm.verification!=="unverified")throw Error("claim_source_binding_invalid");
  const input=intakeClaimsSchema.parse([{entity:c.entity,metric:c.metric,value:c.value,unit:c.unit,period:c.period,
    evidenceClass:c.evidence_class,statement:c.statement,sourceLocator:c.source_locator,sourceExcerpt:c.source_excerpt,
    qualification:c.qualification??undefined,verification:c.verification}])![0];
  if(c.claim_id!==idFor(intakeId,input)||claimPath(String(c.claim_id))!==path||fm.entity!==c.entity||fm.original_source!==c.original_source)throw Error("claim_identity_invalid");
  const source=indexedRead(sourcePath);
  if(source.fm.intake_id!==intakeId||source.fm.type!=="investment_source_intake"||source.fm.source_text_sha256!==fm.source_text_sha256||
    canonicalHttpSourceUrl(String(source.fm.source_url))!==c.original_source)throw Error("claim_source_binding_invalid");
  const block=/^(`{3,})text\n([^]*?)\n\1(?:\n|$)/m.exec(source.body);
  if(!block||![block[2],block[2]+"\n"].some(s=>sha(s)===fm.source_text_sha256)||!block[2].includes(input.sourceExcerpt)||
    !input.sourceExcerpt.includes(input.value)||input.qualification&&!input.sourceExcerpt.includes(input.qualification))throw Error("claim_source_anchor_invalid");
  if(!db().prepare("SELECT 1 FROM notes_fts WHERE path=? AND notes_fts MATCH ?").get(sourcePath,"InvestmentIntake"+intakeId.slice(3)))throw Error("claim_source_index_missing");
  const receiptKey=createReceipt("structured_claim",path,note.raw),sourceReceiptKey=createReceipt("source_intake",sourcePath,source.raw);
  if(!db().prepare("SELECT 1 FROM notes_fts WHERE path=? AND notes_fts MATCH ?").get(path,`"${c.claim_id}"`)||
    !db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=?").get(path,sourcePath))throw Error("claim_index_link_missing");
  const inbound=db().prepare(`SELECT DISTINCT source_path FROM links WHERE resolved_path=?
    UNION SELECT path AS source_path FROM notes WHERE json_valid(frontmatter) AND
      json_extract(frontmatter,'$.type')='investment_research_review' AND json_extract(frontmatter,'$.intake_id')=? AND
      EXISTS (SELECT 1 FROM json_each(frontmatter,'$.claim_ids') WHERE value=?)
    ORDER BY source_path LIMIT 9`).all(path,intakeId,c.claim_id as string) as {source_path:string}[];
  const reviewReferences:string[]=[];let reviewScanComplete=inbound.length<=8;
  for(const link of inbound.slice(0,8))try{
    const r=indexedRead(link.source_path);
    if(r.fm.type!=="investment_research_review")continue;
    if(!/^10_Knowledge\/Company Research\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/.test(link.source_path)||r.fm.review_scope!=="company"||r.fm.intake_id!==intakeId||r.fm.original_source_path!==sourcePath||!Array.isArray(r.fm.claim_ids)||!r.fm.claim_ids.includes(c.claim_id))throw Error("review_claim_binding_invalid");
    const reviewReceipt=createReceipt("canonical_review",link.source_path,r.raw);
    const journal=db().prepare("SELECT * FROM safe_edit_operations WHERE id=?").get(reviewReceipt) as ReviewLineageRecord;
    const event=db().prepare("SELECT at FROM safe_edit_events WHERE operation_id=? AND actor=? AND event='preview' ORDER BY at LIMIT 1").get(reviewReceipt,journal.actor) as {at:string}|undefined;
    assertReviewChronology(journal,event?.at);
    if(!db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=?").get(link.source_path,sourcePath)||
      !db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=?").get(link.source_path,path)||
      !db().prepare("SELECT 1 FROM notes_fts WHERE path=? AND notes_fts MATCH ?").get(link.source_path,"InvestmentIntake"+intakeId.slice(3)))throw Error("review_index_link_missing");
    reviewReferences.push(link.source_path);
  }catch{reviewScanComplete=false;}
  return {claim:c,receiptKey,sourceReceiptKey,sourcePath,intakeId,reviewReferences,reviewScanComplete,
    bindingStatus:"receipt_readback_index_link_verified" as const,originIndependenceIncrement:0 as const,interpretationBoundary:claimInterpretationBoundary};
}
