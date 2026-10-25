/** M4.6 OWNER-ONLY single-note staging writeback. Hidden and disabled by
 * default. Preview creates a journal entry, not a Vault file. A separately
 * authenticated human must independently approve the exact hash before Apply.
 * No bypass of M4 time window, git scope, exclusive locks or checkout CAS.
 */
import {db} from "../db";
import {readVaultFile,resolveNotePath} from "../vault/paths";
import {splitFrontmatter} from "../vault/markdown";
import {assertOwnerResearch,ownerActor} from "./owner-research";
import {assertM4Window} from "./m4-window";
import {exclusive,cleanBase,commitApprovedEdits} from "./git-pilot";
import {preview,apply,status,adminPreview,recordGitPilot,gitPilotContext,sha256,validateApprovedEdit} from "./engine";
import {applySchema} from "./schema";
import {M46_SOURCE} from "./m46-staging-package";
import {z} from "zod";

export const M46_NOTE_ID="m46-nvda-shadow-20261025-one";
export const M46_NOTE_PATH="10_Knowledge/M46 - NVDA - Owner Reviewed Shadow 20261021.md";
export const M46_NOTE_CONTENT=`---
type: investment_review
entity: NVDA
event_key: NVDA|2026-10-21|CAPACITY_EXPANSION|NVIDIA_NEWSROOM
event_date: 2026-10-21
published_at: 2026-10-21
source_type: archived_ai
verification: not_reverified
independent_evidence: false
analysis_origin: m46_staging_shadow
synthetic_environment: true
status: draft
owner_approved: false
---
# M4.6 — NVDA real-news review / ISOLATED STAGING ONLY

> This is source-attributed historical AI research for testing. It is NOT the user's Investment_OS Company Hub, owner-endorsed Thesis, earnings model, or Portfolio. No fact in this draft is permission to update Production.

**Official source:** https://nvidianews.nvidia.com/news/nvidia-and-supply-chain-partners-expand-capacity-to-accelerate-ai-infrastructure-buildout
**Issuer release date:** 2026-10-21. **Research review date:** 2026-10-25.
Selected NVIDIA Newsroom fields were independently read; original complete source bytes not archived or hashed. All targets are future management/supplier plans, not measured shipments or financial results.

## Provisional claims — not canonical or approved
- NVDA-20261021-SUBSTRATE-2P5X: NVIDIA targets aggregate substrate capacity 2.5x over three years with IBIDEN, Samsung Electro-Mechanics and Unimicron. IBIDEN relationship previously announced during 2026.
- NVDA-20261021-AMKOR-GT300PCT: Amkor targeting more than 300% interposer-wafer capacity expansion by 2028.
- NVDA-20261021-KYEC-USD1P1B: NVIDIA announced US$1.1bn testing-capacity reservation advance to KYEC; high-volume US production targeted April 2027. Exact cash timing/accounting treatment are not established.
- NVDA-20261021-SPIL-15X: SPIL target 15x CPO optical engine capacity by mid-2027, further doubling sought by end-2028.

## Historical comparison — no upgrade
Production Investment_OS NVDA Current Thesis is draft_from_archived_evidence / not_reverified, not a user-validated investment view. Existing archive already discussed packaging, CPO capacity, quality/yield and customer financing. No same-metric structured metadata hit among previously scanned 3,372 indexed notes does NOT prove full Vault uniqueness. New issuer-event candidate + incremental announced target details; source/claim dedup remains unresolved. Repeated syndication is not independent confirmation.

## Demand → cash conversion, counterevidence
Supply investment and reservations may alleviate physical bottlenecks if capacity qualifies, yields ramp and systems ship. It does NOT prove customer orders, recognized NVDA revenue, incremental gross margin, EPS, FCF, supplier utilization, or AI customer ROI. Deposits and future ramp could raise working capital and oversupply/underutilization exposure. ASIC alternatives and customer financing constrain downside and economics.

Needed: supplier qualification and yield, dates/volumes, order quality, cash paid/deposits and refund rights, GPU/networking margin and OCF/FCF, end-customer utilization/ROI, dated market price and consensus. No price target, portfolio, protected Thesis or Evidence Register change authorized.

## Proposed Change Log (NOT APPLIED)
2026-10-25 shadow review of 2026-10-21 NVIDIA issuer announcement. Monitor physical capacity conversion, execution, customer economics and cash. Historical C01/C04/C06 issues remain hypotheses. No source/Thesis upgrade or trade decision.

<!-- m46-staging-owner-reviewed:IN-6B8E246C07E25671 -->
`;
const manifest=sha256(JSON.stringify({id:M46_NOTE_ID,path:M46_NOTE_PATH,afterHash:sha256(M46_NOTE_CONTENT)}));
const ops=[{id:M46_NOTE_ID,path:M46_NOTE_PATH,kind:"create"}];
const applyArgs=applySchema;
export function assertOwnerM46(){
 assertOwnerResearch();
 if(process.env.GIT_RESEARCH_M46_SHADOW_TEST!=="1")throw Error("M4.6 staging writer disabled");
}
function bound(actor:string){
 ownerActor(actor);
 const r=status(M46_NOTE_ID,actor),b=r.receipt?.gitPilot;
 if(r.path!==M46_NOTE_PATH||r.afterHash!==sha256(M46_NOTE_CONTENT)||
    b?.manifestHash!==manifest||typeof b.base!=="string")throw Error("M4.6 review journal binding mismatch");
 return {r,b};
}
export function ownerM46Status(actor:string){
 assertOwnerM46();
 const {r,b}=bound(actor);
 return {record:r,base:b.base,manifestHash:manifest,preview:adminPreview(M46_NOTE_ID)};
}
export async function previewOwnerM46(actor:string){
 assertOwnerM46();ownerActor(actor);
 return exclusive(async()=>{
  assertOwnerM46();
  const base=await cleanBase([M46_NOTE_PATH],true);
  const note=gitPilotContext.run({base,operations:ops},()=>preview({
   operationId:M46_NOTE_ID,path:M46_NOTE_PATH,reason:"Owner-reviewed M4.6 source-attributed NVDA shadow research in isolated Staging Test Vault only",
   change:{kind:"create",content:M46_NOTE_CONTENT},
   evidence:{entity:"NVDA",event:"2026-10-21 NVIDIA supply-chain capacity announcement",
     period:"2026-10-21_announcement",originalSource:M46_SOURCE,classification:"unresolved",
     delta:"Primary announcement supplies capacity plans; historical supply and financing risks already existed; full claim dedup outstanding.",
     independent:false,verification:"not_reverified",sourceType:"archived_ai",
     event_date:"2026-10-21",published_at:"2026-10-21",received_at:"2026-10-25",
     imported_at:null,verified_at:null,relatedPaths:[]},
  }),actor);
  if(!note.previewToken)throw Error("M4.6 preview was already started; do not replay");
  recordGitPilot(M46_NOTE_ID,actor,{base,manifestHash:manifest,state:"m46_preview"});
  return {preview:note,base,manifestHash:manifest};
 });
}
function verifiedLocal(actor:string){
 const {r}=bound(actor);
 const txt=readVaultFile(resolveNotePath(M46_NOTE_PATH));
 const parsed=splitFrontmatter(txt);
 const indexed=db().prepare("SELECT n.size,n.frontmatter,f.body FROM notes n JOIN notes_fts f ON f.rowid=n.rowid WHERE n.path=?")
   .get(M46_NOTE_PATH) as {size:number;frontmatter:string;body:string}|undefined;
 if(txt!==M46_NOTE_CONTENT||sha256(txt)!==r.afterHash||r.status!=="written"||
   r.receipt?.write!=="written"||r.receipt?.readback!=="verified"||
   r.receipt?.reindex!=="verified"||!indexed||indexed.size!==Buffer.byteLength(txt)||
   indexed.frontmatter!==JSON.stringify(parsed.data)||indexed.body!==parsed.body)
    throw Error("M4.6 physical/SQLite FTS readback mismatch");
 return r.afterHash;
}
export async function applyOwnerM46(input:unknown,actor:string){
 assertOwnerM46();ownerActor(actor);
 const args=applyArgs.parse(input);
 if(args.operationId!==M46_NOTE_ID)throw Error("M4.6 exact operation refused");
 return exclusive(async()=>{
  assertOwnerM46();
  const {r,b}=bound(actor);
  if(b.state!=="m46_preview"||b.manualReviewRequired)
    return {status:"previously_attempted_no_new_write",record:r,newWriteExecuted:false};
  const approved=validateApprovedEdit(args,actor);
  if(approved.beforeHash!==sha256("")||approved.afterHash!==sha256(M46_NOTE_CONTENT))
    throw Error("M4.6 exact afterHash mismatch");
  if(await cleanBase([M46_NOTE_PATH],true)!==b.base)throw Error("M4.6 approved Git HEAD stale");
  assertM4Window("write");
  const record=(d:Record<string,unknown>)=>recordGitPilot(M46_NOTE_ID,actor,d);
  record({state:"m46_applying"});
  try{
   gitPilotContext.run({base:b.base,operations:ops},()=>apply(args,actor));
   verifiedLocal(actor);
   await commitApprovedEdits(b.base,M46_NOTE_ID,[{path:M46_NOTE_PATH,kind:"A",afterHash:approved.afterHash}],record);
   verifiedLocal(actor);
   record({state:"m46_verified"});
   return {status:"m46_single_note_staging_git_fts_verified",operationId:M46_NOTE_ID,path:M46_NOTE_PATH,
      afterHash:approved.afterHash,record:status(M46_NOTE_ID,actor),deviceSyncVerified:false,
      noProtectedThesisOrPortfolioWrite:true};
  }catch(e){
   record({manualReviewRequired:true});
   throw e;
  }
 });
}
