/**
 * M2: SHADOW-ONLY research decision contract and exact-reference preflight.
 *
 * This module never writes Vault, adds a connector tool, adjudicates financial
 * meaning or upgrades a Source Intake receipt to primary evidence. References
 * bind to exact indexed, re-read source bytes; source authenticity and semantic
 * entailment remain separate from byte/quote integrity.
 */
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {readNote} from "./notes";
import {splitFrontmatter} from "./markdown";
import {validatePrimaryEvidenceReceipt, type PrimaryClaimScope} from "./primary-evidence-receipt-m551";

// This immutable candidate digest is checked against the real policy bytes by
// research-policy-contract.test.ts. A model's copied digest is NOT proof it
// loaded/followed the policy in its trusted instruction layer.
export const M2_POLICY={version:"1.0.0",sha256:"1abcc97f74181398deb0772c6ddee65a8f46d8ed6dd4bc15f1568bfce9c5b3c0"} as const;
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const label=z.string().trim().min(1).max(140);
const narrative=z.string().trim().min(1).max(6000);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const intakeId=z.string().regex(/^IN-[A-F0-9]{16}$/);
const validDate=(s:string)=>{const d=new Date(s+"T00:00:00Z");return /^\d{4}-\d\d-\d\d$/.test(s)&&
  Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;};
const date=z.string().refine(validDate,"Invalid calendar date");
const sourcePath=/^00_Inbox\/ChatGPT\/Investment Intake - (IN-[A-F0-9]{16})\.md$/;
const safeNotePath=/^(?:00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}|10_Knowledge\/(?:Company Research|Industry and Concepts|Macro and Markets)\/[^/]+|01_Companies\/[^/]+|02_Industries_Themes\/[^/]+)\.md$/;

export const m2SourceQuoteRefSchema=z.object({
  intakeId,
  sourcePath:z.string().regex(sourcePath),
  /** SHA-256 over the *whole, current* preserved Source note, not the LLM excerpt. */
  sourceNoteSha256:digest,
  /** Exact byte-equivalent string inside the original-language source code fence. */
  quote:z.string().min(8).max(1600),
  /** Caller-declared, not server-verified PDF page/table/line provenance. */
  documentLocator:z.string().trim().max(160).optional(),
}).strict();
export const m2HistoricalRefSchema=z.object({
  path:z.string().regex(safeNotePath),
  noteSha256:digest,
}).strict();
export const m2CompetingValueSchema=z.object({
  value:label,
  attributedTo:z.string().trim().min(1).max(160),
  publicationDate:date.nullable(),
  /** Missing cited Source is allowed only as explicitly unbound evidence. */
  sourceRef:m2SourceQuoteRefSchema.nullable(),
  independence:z.enum(["unknown","derivative_or_repost","independent_candidate"]),
}).strict();
export const m2ClaimSchema=z.object({
  localClaimKey:z.string().regex(/^[a-z][a-z0-9_-]{1,50}$/),
  entity:label,metric:label,period:label,unit:label,
  denominator:z.string().trim().max(140).nullable(),
  forecastVintage:z.string().trim().max(140).nullable(),
  value:label,
  sourceRefs:z.array(m2SourceQuoteRefSchema).min(1).max(8),
  competingEvidence:z.array(m2CompetingValueSchema).max(8),
  epistemicStatus:z.enum(["attributed","unresolved"]),
  /** `confirmed` retains M5.5.1 server attestation requirement. */
  conclusion:z.enum(["no_change","conditional","confirmed"]),
  primaryEvidence:z.object({
    receiptId:z.string().regex(/^PEV-[A-F0-9]{32}$/),
    primarySourceUrl:z.string().url().max(2000),
    verifiedValue:label,
  }).strict().nullable(),
  reasoningSummary:narrative,
  requiredEvidence:narrative,
}).strict();
export const researchDecisionV2Schema=z.object({
  schemaVersion:z.literal("2.0.0-shadow"),
  policyVersion:z.literal(M2_POLICY.version),
  /** Only an equality check; independent trusted policy injection is M1/M3. */
  policySha256:z.literal(M2_POLICY.sha256),
  intakeId,
  domain:z.enum(["company","industry","macro","asset"]),
  subject:label,
  event:z.object({
    classification:z.enum(["new_event","added_detail","confirmation","duplicate","correction","contradiction","unresolved"]),
    eventDate:date.nullable(),publicationDate:date.nullable(),
    relatedNotes:z.array(m2HistoricalRefSchema).max(12),
    comparisonBasis:narrative,
  }).strict(),
  claims:z.array(m2ClaimSchema).max(24),
  synthesis:z.object({
    headlineTh:narrative,whatChangedTh:narrative,mechanismTh:narrative,
    thesisImplicationTh:narrative,counterEvidenceTh:narrative,requiredEvidenceTh:narrative,
  }).strict(),
}).strict();
export type M2ResearchDecision=z.infer<typeof researchDecisionV2Schema>;
export type M2SourceQuoteRef=z.infer<typeof m2SourceQuoteRefSchema>;

/** A test seam, not a caller-authorized trust boundary. Production/default
 * resolver reads the actual index and note; this module exports NO MCP action.
 */
export interface M2ReadDeps {
  readIndexed(path:string):{content:string;indexed:boolean;searchable:boolean}|null;
  verifyPrimary(scope:PrimaryClaimScope):boolean;
}
export const m2VaultReadDeps:M2ReadDeps={
  readIndexed(path){
    const indexed=Boolean(db().prepare("SELECT 1 FROM notes WHERE path=? LIMIT 1").get(path));
    if(!indexed)return null;
    const searchable=Boolean(db().prepare("SELECT 1 FROM notes_fts WHERE path=? LIMIT 1").get(path));
    try{return {content:readNote(path).content,indexed,searchable};}
    catch{return null;}
  },
  verifyPrimary(scope){try{return validatePrimaryEvidenceReceipt(scope).valid;}catch{return false;}},
};

type SourceCheck={path:string;status:"source_quote_bound_not_primary"|"unbound";issues:string[];warnings:string[]};
const unique=<T>(a:T[])=>[...new Set(a)];
function preservedSubmittedText(body:string):string|null {
  const marker="\n## User-supplied original language text\n\n";
  const at=body.indexOf(marker);
  if(at<0||body.indexOf(marker,at+1)>=0)return null;
  const rest=body.slice(at+marker.length);
  const open=/^(`{3,})text\n/.exec(rest);
  if(!open)return null;
  const end=rest.indexOf("\n"+open[1]+"\n",open[0].length);
  if(end<0)return null;
  return rest.slice(open[0].length,end);
}
function checkSource(ref:M2SourceQuoteRef,deps:M2ReadDeps):SourceCheck {
  const issues:string[]=[],warnings:string[]=[];
  const canonical=`00_Inbox/ChatGPT/Investment Intake - ${ref.intakeId}.md`;
  if(ref.sourcePath!==canonical)issues.push("source_id_path_mismatch");
  let row:ReturnType<M2ReadDeps["readIndexed"]>;
  try{row=deps.readIndexed(ref.sourcePath);}catch{row=null;}
  if(!row||!row.indexed||!row.searchable){issues.push("source_missing_or_not_searchable");
    return {path:ref.sourcePath,status:"unbound",issues,warnings};}
  if(sha(row.content)!==ref.sourceNoteSha256)issues.push("source_note_sha256_mismatch");
  const {data:fm,invalid}=splitFrontmatter(row.content);
  if(invalid||fm.type!=="investment_source_intake"||fm.intake_id!==ref.intakeId)
    issues.push("source_receipt_identity_invalid");
  const sourceText=preservedSubmittedText(row.content);
  const expected=fm.source_text_sha256;
  if(!sourceText||typeof expected!=="string"||!(/^[a-f0-9]{64}$/.test(expected))||
    (sha(sourceText)!==expected&&sha(sourceText+"\n")!==expected))
    issues.push("source_original_text_digest_unbound");
  if(!sourceText?.includes(ref.quote))issues.push("source_quote_not_in_preserved_text");
  if(fm.input_format==="pdf"&&fm.attachment_status!=="hash_readback_verified_user_bytes")
    warnings.push("pdf_original_user_bytes_unverified");
  if(ref.documentLocator)warnings.push("pdf_page_or_table_locator_caller_declared_not_verified");
  return {path:ref.sourcePath,status:issues.length?"unbound":"source_quote_bound_not_primary",issues,warnings};
}
function checkHistorical(path:string,expectedSha:string,deps:M2ReadDeps):string[]{
  let row:ReturnType<M2ReadDeps["readIndexed"]>;
  try{row=deps.readIndexed(path);}catch{row=null;}
  if(!row||!row.indexed||!row.searchable)return ["historical_ref_missing_or_not_searchable"];
  return sha(row.content)===expectedSha?[]:["historical_ref_sha256_mismatch"];
}
export interface M2DecisionPreflight {
  status:"hold_schema"|"hold_references_or_authority"|"structurally_grounded_shadow_only";
  policyStampMatched:boolean;
  sourceQuoteBindings:SourceCheck[];
  /** Only an independently checked server receipt may set this true. */
  serverVerifiedClaimKeys:string[];
  errors:string[];
  warnings:string[];
  writesPerformed:false;
  sourceAuthenticityVerified:false;
  investmentTruthVerified:false;
  canWriteProtectedNotes:false;
}

/** Exact-reference preflight ONLY. Do not equate this outcome with permission
 * to publish a Review, issuer truth or an AI semantic accuracy assessment.
 */
export function preflightResearchDecisionV2(raw:unknown,deps:M2ReadDeps=m2VaultReadDeps):M2DecisionPreflight {
  const parsed=researchDecisionV2Schema.safeParse(raw);
  const empty={policyStampMatched:false,sourceQuoteBindings:[] as SourceCheck[],
    serverVerifiedClaimKeys:[] as string[],writesPerformed:false as const,
    sourceAuthenticityVerified:false as const,investmentTruthVerified:false as const,
    canWriteProtectedNotes:false as const};
  if(!parsed.success)return {status:"hold_schema",...empty,
    errors:unique(parsed.error.issues.map(e=>`${e.path.join(".")||"root"}: ${e.message}`)).slice(0,30),warnings:[]};
  const d=parsed.data,errors:string[]=[],warnings:string[]=[],bindings:SourceCheck[]=[];
  const seen=new Set<string>(),verified:string[]=[];
  for(const claim of d.claims){
    if(seen.has(claim.localClaimKey))errors.push("duplicate_local_claim_key:"+claim.localClaimKey);
    seen.add(claim.localClaimKey);
    const refs=[...claim.sourceRefs,...claim.competingEvidence.flatMap(x=>x.sourceRef?[x.sourceRef]:[])];
    for(const ref of refs){
      if(ref.intakeId!==d.intakeId)warnings.push("related_source_requires_independent_provenance_review");
      const bound=checkSource(ref,deps);bindings.push(bound);
      for(const i of bound.issues)errors.push(claim.localClaimKey+":"+i);
      warnings.push(...bound.warnings);
    }
    if(claim.competingEvidence.some(c=>c.sourceRef===null))
      warnings.push("competing_value_without_preserved_source");
    const vals=unique([claim.value,...claim.competingEvidence.map(c=>c.value)]);
    if(claim.primaryEvidence){
      if(!vals.includes(claim.primaryEvidence.verifiedValue))
        errors.push(claim.localClaimKey+":primary_selected_value_not_in_competing_values");
      const scope:PrimaryClaimScope={receiptId:claim.primaryEvidence.receiptId,
        sourceUrl:claim.primaryEvidence.primarySourceUrl,entity:claim.entity,
        metric:claim.metric,period:claim.period,unit:claim.unit,
        verifiedValue:claim.primaryEvidence.verifiedValue,competingValues:vals};
      let verifiedPrimary=false;
      try{verifiedPrimary=deps.verifyPrimary(scope);}catch{/* Fail closed. */}
      if(!verifiedPrimary)errors.push(claim.localClaimKey+":primary_receipt_not_server_validated");
      else verified.push(claim.localClaimKey);
    }
    if(claim.conclusion==="confirmed"&&(!verified.includes(claim.localClaimKey)||
      claim.epistemicStatus==="unresolved"))
      errors.push(claim.localClaimKey+":confirmed_requires_resolved_server_primary_receipt");
    if(vals.length>1&&claim.conclusion==="confirmed"&&!verified.includes(claim.localClaimKey))
      errors.push(claim.localClaimKey+":conflict_requires_primary_adjudication");
  }
  for(const prior of d.event.relatedNotes){
    for(const i of checkHistorical(prior.path,prior.noteSha256,deps))errors.push("event:"+i);
  }
  if(["duplicate","confirmation","correction","added_detail","contradiction"].includes(d.event.classification)&&
    d.event.relatedNotes.length===0)warnings.push("event_relation_without_verified_historical_pointer");
  // Matching a literal quote is not a semantic truth verdict. No automatic
  // publication or Thesis authority is conferred, even for an empty error set.
  return {status:errors.length?"hold_references_or_authority":"structurally_grounded_shadow_only",
    ...empty,policyStampMatched:true,sourceQuoteBindings:bindings,
    serverVerifiedClaimKeys:verified,errors:unique(errors),warnings:unique(warnings)};
}
