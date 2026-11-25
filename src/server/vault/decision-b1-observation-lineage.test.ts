/** IOS-ORCH-RI-001 / B1: typed claim observations and SAME-instance prior lineage.
 * Real disposable Safe Edit engine, journal, receipts, filesystem, FTS and link
 * index; only the cloud Sync pause is stubbed (as in the existing suites). Every
 * text is a synthetic fixture modelled on the structure of public releases; none
 * is an original publisher byte copy and nothing here asserts a market fact. */
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const actor="oauth:b1-observation-fixture";
const T={timeout:60_000};
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const PROTECTED=["05_Thesis/AMD - Current Thesis.md","06_Portfolio/Positions.md","08_Daily_Weekly/Research Indexes/Company Evolution - AMD.md"];
const wb=()=>import("../mcp/canonical-writeback");
async function prepare(input:unknown){const m=await wb();return m.prepareCanonicalWriteback(m.canonicalInputSchema.parse(input),actor);}
async function capture(input:unknown){
  const m=await wb(),data=m.canonicalInputSchema.parse(input),p=m.prepareCanonicalWriteback(data,actor);
  const saved=await m.applyCanonicalWriteback({input:data,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);
  return {data,p,saved};
}
const disk=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
const fmOf=async(p:string)=>(await import("./markdown")).splitFrontmatter(disk(p)).data as Record<string,any>;
async function claimNote(planId:string,metric:string,period:string){
  const dir=["10_Knowledge/Macro and Markets","10_Knowledge/Company Research"];
  for(const d of dir)for(const f of fs.readdirSync(path.join(vault,d))){
    if(!f.startsWith("Investment Claim - ICL-"))continue;
    const p=`${d}/${f}`,fm=await fmOf(p),c=fm.claims?.[0];
    if(fm.intake_id===planId&&c?.metric===metric&&c?.period===period)return {path:p,id:c.claim_id as string,fm,row:c};
  }
  throw Error(`claim not found ${planId} ${metric} ${period}`);
}
const noteCount=()=>["00_Inbox/ChatGPT","10_Knowledge/Macro and Markets","10_Knowledge/Company Research"].reduce((n,d)=>n+fs.readdirSync(path.join(vault,d)).length,0);

// ---- BLS PPI shaped fixtures (macro, URL-backed RI001-2 + observation) ----
const P0_TEXT="Synthetic fixture modelled on the structure of the BLS PPI release of 15 Oct 2026 (not the original bytes). "+
  "The Producer Price Index for final demand rose 1.3 percent in September, seasonally adjusted. "+
  "Final demand prices rose 0.5 percent in August. On an unadjusted basis, final demand prices rose 6.3 percent for the 12 months ended in September.";
const P1_TEXT="Synthetic fixture modelled on the structure of the BLS PPI release of 13 Nov 2026 (not the original bytes). "+
  "The Producer Price Index for final demand rose 0.3 percent in October, seasonally adjusted. September was revised to 1.4 percent and August was revised to 0.4 percent. "+
  "On an unadjusted basis, final demand prices rose 6.5 percent for the 12 months ended in October.";
const MOM="PPI final demand percent change",YOY="PPI final demand 12-month percent change";
const bls=(text:string,tag:string,date:string,claims:unknown[])=>({domain:"macro",entities:["United States"],topic:"US PPI final demand "+tag,inputFormat:"text",
  sourceKind:"official_macro",extractedText:text,sourceChat:"B1 synthetic BLS fixture "+tag,sourceUrl:`https://www.bls.gov/news.release/archives/synthetic-${tag}.htm`,
  publisher:"BLS (attributed)",eventDate:date,publicationDate:date,originalDocumentAccess:"excerpt_only",acquisitionChannel:"assistant_retrieved",
  contentTypes:["macro_data"],captureOnly:true,claims});
const obs=(releaseVintage:string,vintageStatus:string,prior?:{claimId:string;relation:string},seasonalAdjustment="seasonally_adjusted",seriesId="WPSFD4")=>
  ({seriesId,seasonalAdjustment,releaseVintage,vintageStatus,...(prior?{prior}:{})});
const ppi=(metric:string,value:string,period:string,excerpt:string,observation:unknown,extra:Record<string,unknown>={})=>({entity:"United States",metric,value,unit:"percent",period,
  evidenceClass:"reported_actual",statement:"Attributed to the BLS fixture: "+excerpt,sourceLocator:"synthetic paragraph",sourceExcerpt:excerpt,observation,verification:"unverified",...extra});
const P0_CLAIMS=[ppi(MOM,"1.3","September 2026","rose 1.3 percent in September, seasonally adjusted",obs("2026-10-15","first_release")),
  ppi(MOM,"0.5","August 2026","rose 0.5 percent in August",obs("2026-10-15","revised")),
  ppi(YOY,"6.3","12 months ended September 2026","rose 6.3 percent for the 12 months ended in September",obs("2026-10-15","first_release",undefined,"not_seasonally_adjusted"))];

// ---- AMD shaped fixtures (company; URL-backed and received) ----
const MILESTONE="World Labs acquisition milestone";
const amd=(text:string,tag:string,date:string,claims:unknown[],url:string|null)=>({domain:"company",entities:["AMD"],topic:"AMD World Labs "+tag,inputFormat:"text",
  sourceKind:url?"issuer_release":"regulatory_filing",extractedText:text,sourceChat:"B1 synthetic AMD fixture "+tag,sourceUrl:url,publisher:"AMD (attributed)",
  eventDate:date,publicationDate:date,originalDocumentAccess:"excerpt_only",acquisitionChannel:"assistant_retrieved",contentTypes:["reported_fact"],captureOnly:true,claims});
const amdClaim=(metric:string,value:string,unit:string,period:string,excerpt:string,observation:unknown)=>({entity:"AMD",metric,value,unit,period,evidenceClass:"reported_actual",
  statement:"Attributed to the AMD fixture: "+excerpt,sourceLocator:"synthetic paragraph",sourceExcerpt:excerpt,observation,verification:"unverified"});
const na=(releaseVintage:string,vintageStatus:string,prior?:{claimId:string;relation:string})=>obs(releaseVintage,vintageStatus,prior,"not_applicable",null as unknown as string);

beforeAll(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"b1-observation-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,9).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
  for(const f of ["00_Inbox/ChatGPT","01_Companies","10_Knowledge/Company Research","10_Knowledge/Macro and Markets"])fs.mkdirSync(path.join(vault,f),{recursive:true});
  for(const p of ["01_Companies/AMD.md",...PROTECTED]){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),"# AMD disposable fixture\n");(await import("./indexer")).reindexPath(p);}
});
afterAll(async()=>{
  for(const p of PROTECTED)expect(disk(p)).toBe("# AMD disposable fixture\n");
  (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});

const state:{p0?:string;p0Sep?:Awaited<ReturnType<typeof claimNote>>;p0Aug?:Awaited<ReturnType<typeof claimNote>>;p0Yoy?:Awaited<ReturnType<typeof claimNote>>;
  p1?:string;p1Sep?:Awaited<ReturnType<typeof claimNote>>;p1Aug?:Awaited<ReturnType<typeof claimNote>>;p0Bytes?:Record<string,string>}={};

describe("B1 BLS PPI vintages",()=>{
  it("P0 first vintages save Source-only with a versioned observation identity and null lineage",T,async()=>{
    const {data,p,saved}=await capture(bls(P0_TEXT,"p0","2026-10-15",P0_CLAIMS));
    expect(p.previews.map(x=>x.kind).sort()).toEqual(["source_intake","structured_claim","structured_claim","structured_claim"]);
    expect(saved.steps.some((s:{kind:string})=>s.kind==="canonical_review")).toBe(false);
    const wf=(await import("./investment-writeback-router")).planInvestmentWriteback(data as never).safeEditWorkflow!;
    expect(wf.status).toBe("source_saved_analysis_pending");
    state.p0=p.planId;
    state.p0Sep=await claimNote(p.planId,MOM,"September 2026");state.p0Aug=await claimNote(p.planId,MOM,"August 2026");
    state.p0Yoy=await claimNote(p.planId,YOY,"12 months ended September 2026");
    const {readPersistedClaim,CLAIM_OBSERVATION_VERSION}=await import("./canonical-claims");
    for(const c of [state.p0Sep,state.p0Aug,state.p0Yoy]){
      expect(c.fm).toMatchObject({claim_persistence_version:"RI001-2",claim_observation_version:CLAIM_OBSERVATION_VERSION,verification:"unverified"});
      expect(c.row.observation_lineage).toBeNull();
      expect(readPersistedClaim(c.path)).toMatchObject({bindingStatus:"receipt_readback_index_link_verified",intakeId:p.planId});
    }
    expect(state.p0Aug!.row.observation).toEqual({seriesId:"WPSFD4",seasonalAdjustment:"seasonally_adjusted",releaseVintage:"2026-10-15",vintageStatus:"revised"});
    // The observation is part of identity: the same claim without it is a different (legacy RI001-2) ID.
    const {observation:_o,...legacy}=P0_CLAIMS[0] as Record<string,unknown>;void _o;
    const legacyPlan=(await import("./investment-writeback-router")).planInvestmentWriteback({...bls(P0_TEXT,"p0","2026-10-15",[legacy])} as never).safeEditWorkflow!;
    expect(legacyPlan.steps.filter(s=>s.kind==="structured_claim").map(s=>s.path)).not.toContain(state.p0Sep!.path);
    // Idempotent retry: nothing new to write, bytes unchanged.
    state.p0Bytes=Object.fromEntries([state.p0Sep,state.p0Aug,state.p0Yoy].map(c=>[c!.path,sha(disk(c!.path))]));
    expect((await prepare(bls(P0_TEXT,"p0","2026-10-15",P0_CLAIMS))).previews).toEqual([]);
  });
  it("P1 Sep 1.3→1.4 and Aug 0.5→0.4 bind server-verified same-instance lineage; Oct 0.3 is a separate first release",T,async()=>{
    const claims=[ppi(MOM,"0.3","October 2026","rose 0.3 percent in October, seasonally adjusted",obs("2026-11-13","first_release")),
      ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",obs("2026-11-13","revised",{claimId:state.p0Sep!.id,relation:"revision_of"})),
      ppi(MOM,"0.4","August 2026","August was revised to 0.4 percent",obs("2026-11-13","revised",{claimId:state.p0Aug!.id,relation:"revision_of"}))];
    const {p,saved}=await capture(bls(P1_TEXT,"p1","2026-11-13",claims));
    expect(saved.steps.some((s:{kind:string})=>s.kind==="canonical_review")).toBe(false);
    state.p1=p.planId;state.p1Sep=await claimNote(p.planId,MOM,"September 2026");state.p1Aug=await claimNote(p.planId,MOM,"August 2026");
    const oct=await claimNote(p.planId,MOM,"October 2026");
    expect(oct.row.observation_lineage).toBeNull();
    const {readPersistedClaim}=await import("./canonical-claims");const {createReceipt}=await import("./investment-research-context");const {db}=await import("../db");
    for(const [now,prior] of [[state.p1Sep,state.p0Sep],[state.p1Aug,state.p0Aug]] as const){
      const knownAt=(db().prepare("SELECT at FROM safe_edit_events WHERE operation_id=? AND event='written'").get(createReceipt("structured_claim",prior!.path,disk(prior!.path))) as {at:string}).at;
      expect(now!.row.observation_lineage).toEqual({prior_claim_id:prior!.id,relation:"revision_of",prior_intake_id:state.p0,
        prior_receipt_key:createReceipt("structured_claim",prior!.path,disk(prior!.path)),prior_source_receipt_key:readPersistedClaim(prior!.path).sourceReceiptKey,
        prior_release_vintage:"2026-10-15",prior_known_at:new Date(knownAt).toISOString(),status:"server_verified_same_instance_receipt_not_fact"});
      expect(Date.parse(now!.row.observation_lineage.prior_known_at)).toBeLessThanOrEqual(Date.now());
      expect(readPersistedClaim(now!.path)).toMatchObject({bindingStatus:"receipt_readback_index_link_verified",intakeId:p.planId});
    }
    // Old vintages stay immutable.
    for(const [p0,h] of Object.entries(state.p0Bytes!))expect(sha(disk(p0))).toBe(h);
    expect((await prepare(bls(P1_TEXT,"p1","2026-11-13",claims))).previews).toEqual([]);
  });
  const variant=(n:number)=>P1_TEXT.replace("13 Nov 2026",`13 Nov 2026 variant ${n}`)+" September was originally reported at 1.3 percent.";
  it.each([
    ["Sep vs Oct YoY are different observation periods",()=>ppi(YOY,"6.5","12 months ended October 2026","rose 6.5 percent for the 12 months ended in October",
      obs("2026-11-13","revised",{claimId:state.p0Yoy!.id,relation:"revision_of"},"not_seasonally_adjusted")),/observation_prior_identity_mismatch/],
    ["seasonal basis mismatch (NSA vs SA)",()=>ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",
      obs("2026-11-13","revised",{claimId:state.p0Sep!.id,relation:"revision_of"},"not_seasonally_adjusted")),/observation_prior_identity_mismatch/],
    ["series mismatch",()=>ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",
      obs("2026-11-13","revised",{claimId:state.p0Sep!.id,relation:"revision_of"},"seasonally_adjusted","OTHER-SERIES")),/observation_prior_identity_mismatch/],
    ["revision with an unchanged value",()=>ppi(MOM,"1.3","September 2026","originally reported at 1.3 percent",
      obs("2026-11-13","revised",{claimId:state.p0Sep!.id,relation:"revision_of"})),/observation_revision_value_unchanged/],
    ["confirmation with a different value",()=>ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",
      obs("2026-11-13","unchanged_repeat",{claimId:state.p0Sep!.id,relation:"confirmation_of"})),/observation_confirmation_value_differs/],
    ["first_release cannot have a prior",()=>ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",
      obs("2026-11-13","first_release",{claimId:state.p0Sep!.id,relation:"revision_of"})),/observation_first_release_has_no_prior/],
    ["revised with a confirmation relation",()=>ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",
      obs("2026-11-13","revised",{claimId:state.p0Sep!.id,relation:"confirmation_of"})),/observation_revised_requires_prior_revision_of/],
    ["fake prior claim",()=>ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",
      obs("2026-11-13","revised",{claimId:"ICL-"+"0".repeat(32),relation:"revision_of"})),/observation_prior_claim_unverified/],
    ["future release vintage",()=>ppi(MOM,"0.3","October 2026","rose 0.3 percent in October, seasonally adjusted",obs("2099-01-01","first_release")),/observation_release_vintage_in_future/],
    ["vintage not earlier than the prior",()=>ppi(MOM,"1.4","September 2026","September was revised to 1.4 percent",
      obs("2026-10-15","revised",{claimId:state.p0Sep!.id,relation:"revision_of"})),/observation_prior_vintage_not_earlier/],
    ["non-actual evidence class",()=>({...ppi(MOM,"0.3","October 2026","rose 0.3 percent in October, seasonally adjusted",obs("2026-11-13","first_release")),evidenceClass:"management_guidance"}),/observation_requires_reported_actual/],
  ] as const)("%s fails closed before any write",T,async(_name,make,reason)=>{
    const before=noteCount(),n=Math.floor(Math.random()*1e9);
    await expect(prepare(bls(variant(n),"neg-"+n,"2026-11-13",[make()]))).rejects.toThrow(reason);
    expect(noteCount()).toBe(before);
  });
  it("same-intake prior, a non-observation prior and a tampered prior all fail closed",T,async()=>{
    // Same intake (re-sent P0 Source with an extra self-referencing claim).
    await expect(prepare(bls(P0_TEXT,"p0","2026-10-15",[...P0_CLAIMS,ppi(MOM,"1.3","September 2026 restated","rose 1.3 percent in September, seasonally adjusted",
      obs("2026-10-16","revised",{claimId:state.p0Aug!.id,relation:"revision_of"}))]))).rejects.toThrow(/observation_prior_same_intake/);
    // A legacy claim without observation cannot anchor a lineage.
    const legacyText="Synthetic fixture: final demand rose 2.0 percent in July, seasonally adjusted (legacy note).";
    const {p}=await capture(bls(legacyText,"legacy","2026-09-12",[{...ppi(MOM,"2.0","July 2026","rose 2.0 percent in July, seasonally adjusted",undefined)}].map(c=>{const {observation:_x,...r}=c as Record<string,unknown>;void _x;return r;})));
    const legacy=await claimNote(p.planId,MOM,"July 2026");
    expect(legacy.fm.claim_observation_version).toBeUndefined();
    await expect(prepare(bls(P1_TEXT+" July was revised to 2.1 percent.","legacy-prior","2026-11-14",[ppi(MOM,"2.1","July 2026","July was revised to 2.1 percent",
      obs("2026-11-14","revised",{claimId:legacy.id,relation:"revision_of"}))]))).rejects.toThrow(/observation_prior_not_observation/);
    // Tamper with a receipted prior: it can no longer anchor lineage, and the
    // existing lineage that pointed at it no longer reads back.
    fs.appendFileSync(path.join(vault,state.p0Aug!.path),"\nTampered after receipt.\n");(await import("./indexer")).reindexPath(state.p0Aug!.path);
    await expect(prepare(bls(P1_TEXT+" Second August revision to 0.35 percent.","tamper","2026-11-15",[ppi(MOM,"0.35","August 2026","Second August revision to 0.35 percent",
      obs("2026-11-15","revised",{claimId:state.p0Aug!.id,relation:"revision_of"}))]))).rejects.toThrow(/observation_prior_claim_unverified/);
    const {readPersistedClaim}=await import("./canonical-claims");
    expect(()=>readPersistedClaim(state.p1Aug!.path)).toThrow(/claim_observation_lineage_invalid/);
    expect(readPersistedClaim(state.p1Sep!.path).bindingStatus).toBe("receipt_readback_index_link_verified");
  });
});

describe("B1 AMD milestones (company; URL-backed and received)",()=>{
  const AGREE="Synthetic fixture modelled on an AMD issuer release of 28 Sep 2026: AMD agreed to acquire World Labs; closing is expected by year end, subject to conditions.";
  const CLOSE="Synthetic fixture modelled on an AMD issuer release of 16 Nov 2026: AMD completed its acquisition of World Labs; the closing took place on 13 Nov 2026.";
  const FORM="Synthetic fixture modelled on an issuer Form 8-K/A of 16 Nov 2026: the closing took place on 13 Nov 2026 and 14,978,322 shares of AMD common stock were issued.";
  const ids:{agree?:string;close?:string}={};
  it("agreement and completed closing are distinct milestones, never a revision pair",T,async()=>{
    const a=await capture(amd(AGREE,"agree","2026-09-28",[amdClaim(MILESTONE,"agreed to acquire","milestone","2026-09-28","AMD agreed to acquire World Labs",na("2026-09-28","first_release"))],
      "https://ir.amd.com/news-events/press-releases/detail/synthetic-agree"));
    ids.agree=(await claimNote(a.p.planId,MILESTONE,"2026-09-28")).id;
    const c=await capture(amd(CLOSE,"close","2026-11-16",[amdClaim(MILESTONE,"completed its acquisition","milestone","2026-11-13","AMD completed its acquisition of World Labs",na("2026-11-16","first_release"))],
      "https://ir.amd.com/news-events/press-releases/detail/synthetic-close"));
    const close=await claimNote(c.p.planId,MILESTONE,"2026-11-13");ids.close=close.id;
    expect(close.fm).toMatchObject({claim_persistence_version:"RI001-2",claim_observation_version:"RI001-OBS-1"});
    await expect(prepare(amd(CLOSE+" (variant)","close-as-revision","2026-11-16",[amdClaim(MILESTONE,"completed its acquisition","milestone","2026-11-13","AMD completed its acquisition of World Labs",
      na("2026-11-16","revised",{claimId:ids.agree!,relation:"revision_of"}))],"https://ir.amd.com/news-events/press-releases/detail/synthetic-close-variant"))).rejects.toThrow(/observation_prior_identity_mismatch/);
  });
  it("8-K/A share count is a received-source added detail; it cannot be marked a confirmation of the closing claim",T,async()=>{
    const f=await capture(amd(FORM,"8ka","2026-11-16",[amdClaim("World Labs closing shares issued","14,978,322","shares","2026-11-13","14,978,322 shares of AMD common stock were issued",na("2026-11-16","first_release"))],null));
    const shares=await claimNote(f.p.planId,"World Labs closing shares issued","2026-11-13");
    expect(shares.fm).toMatchObject({claim_persistence_version:"RI001-3",claim_observation_version:"RI001-OBS-1",origin:"received_user_source",original_source:null});
    expect((await import("./canonical-claims")).readPersistedClaim(shares.path).bindingStatus).toBe("receipt_readback_index_link_verified");
    await expect(prepare(amd(FORM+" (variant)","8ka-confirm","2026-11-16",[amdClaim("World Labs closing shares issued","14,978,322","shares","2026-11-13","14,978,322 shares of AMD common stock were issued",
      na("2026-11-16","unchanged_repeat",{claimId:ids.close!,relation:"confirmation_of"}))],null))).rejects.toThrow(/observation_prior_identity_mismatch/);
    // Same closing milestone on the same release day is not an earlier vintage.
    await expect(prepare(amd(FORM+" AMD completed its acquisition of World Labs.","8ka-same-day","2026-11-16",[amdClaim(MILESTONE,"completed its acquisition","milestone","2026-11-13","AMD completed its acquisition of World Labs",
      na("2026-11-16","unchanged_repeat",{claimId:ids.close!,relation:"confirmation_of"}))],null))).rejects.toThrow(/observation_prior_vintage_not_earlier/);
  });
});

describe("B1 compatibility and authority boundaries",()=>{
  it("legacy claims without observation keep the exact parent (bca00ea) RI001-1/2/3 IDs and bytes",T,async()=>{
    // Golden values were produced by the unchanged parent tree for these exact inputs.
    const router=await import("./investment-writeback-router");
    const claim={entity:"AMD",metric:"World Labs acquisition milestone",value:"completed its acquisition",unit:"milestone",period:"2026-11-13",
      evidenceClass:"reported_actual",statement:"AMD says it completed its acquisition of World Labs (attributed, unverified).",
      sourceLocator:"paragraph 1",sourceExcerpt:"AMD completed its acquisition of World Labs",verification:"unverified"};
    const text="Synthetic fixture: AMD completed its acquisition of World Labs; the closing took place on 13 Nov 2026.";
    const companyUrl={domain:"company",entities:["AMD"],topic:"AMD World Labs",inputFormat:"text",sourceKind:"issuer_release",extractedText:text,
      sourceChat:"golden",sourceUrl:"https://ir.amd.com/news-events/press-releases/detail/9999/synthetic",eventDate:"2026-11-16",publicationDate:"2026-11-16",captureOnly:true,claims:[claim]};
    const macroUrl={...companyUrl,domain:"macro",entities:["United States"],topic:"US PPI",sourceKind:"official_macro",
      extractedText:"Synthetic fixture: final demand rose 0.3 percent in October, seasonally adjusted.",sourceUrl:"https://www.bls.gov/news.release/archives/synthetic.htm",
      claims:[{...claim,entity:"United States",metric:"PPI final demand percent change",value:"0.3",unit:"percent",period:"October 2026",
        statement:"BLS reports final demand rose 0.3 percent (attributed).",sourceExcerpt:"final demand rose 0.3 percent in October"}]};
    const received={...companyUrl,sourceUrl:null,extractedText:text+" Received copy."};
    const golden={
      RI001_1:[companyUrl,"10_Knowledge/Company Research/Investment Claim - ICL-BE79960A6F5ED771833E11EE963FBADF.md","22e686741bf099a700d710ca3b49089465836e7bb042d04c864206fa52bea19d"],
      RI001_2:[macroUrl,"10_Knowledge/Macro and Markets/Investment Claim - ICL-4C5368BF9EA910291C9A14987A628F0D.md","a9639603f1bc1f1e45790ae68547c68ff94f681d586f52cd7f93f905d51ab376"],
      RI001_3:[received,"10_Knowledge/Company Research/Investment Claim - ICL-4DFA557EDED05A015A41130F744F28A3.md","a9b7da64d53a3350106fa096580c971a9e9d5cf7ff737ca9deb1855cbefd787c"]} as const;
    for(const [,[input,claimPath,claimSha]] of Object.entries(golden)){
      const step=router.planInvestmentWriteback(input as never).safeEditWorkflow!.steps.find(s=>s.kind==="structured_claim")!;
      expect([step.path,step.expectedSha256]).toEqual([claimPath,claimSha]);
    }
  });
  it("caller-supplied knownAt/receivedAt and unknown observation fields are rejected by the strict schema",T,async()=>{
    const {canonicalInputSchema}=await wb();
    const ok=bls(P0_TEXT,"strict","2026-10-15",[P0_CLAIMS[0]]);
    expect(canonicalInputSchema.safeParse(ok).success).toBe(true);
    expect(canonicalInputSchema.safeParse({...ok,knownAt:"2026-01-01T00:00:00Z"}).success).toBe(false);
    expect(canonicalInputSchema.safeParse({...ok,receivedAt:"2026-01-01T00:00:00Z"}).success).toBe(false);
    expect(canonicalInputSchema.safeParse({...ok,claims:[{...(P0_CLAIMS[0] as object),knownAt:"2026-01-01T00:00:00Z"}]}).success).toBe(false);
    expect(canonicalInputSchema.safeParse({...ok,claims:[{...(P0_CLAIMS[0] as object),observation:{...obs("2026-10-15","first_release"),knownAt:"2026-01-01"}}]}).success).toBe(false);
    expect(canonicalInputSchema.safeParse({...ok,claims:[{...(P0_CLAIMS[0] as object),observation:obs("2026-02-30","first_release")}]}).success).toBe(false);
  });
  it("an opted-in numeric Review stays HOLD under RISK-1.1 (G5/G9) with no Review receipt",T,async()=>{
    const m=await wb(),j=await import("./research-judge");
    const review={headlineTh:"ข้อมูลทดสอบ AMD ปิดดีลซื้อกิจการ World Labs",translationTh:"ข้อความสมมติจากเอกสารผู้ออกหลักทรัพย์",
      whatChangedTh:"ข้อความระบุการปิดดีลและจำนวนหุ้นที่ออก ยังไม่ได้ตรวจเอกสารต้นฉบับฉบับเต็ม",mechanismTh:"ผลต่อจำนวนหุ้นและงบการเงินยังต้องตรวจสอบจากเอกสารต้นฉบับ",
      thesisImplicationTh:"ยังไม่ปรับสมมติฐานการลงทุนจากข้อมูลทดสอบนี้",counterEvidenceTh:"ข้อมูลเป็นเพียงบางส่วนของเอกสารและอาจมีรายละเอียดที่ยังไม่ครบ",
      requiredEvidenceTh:"ตรวจเอกสาร 8-K/A ต้นฉบับและข่าวประกาศของบริษัทก่อนใช้ ข้อความนี้เป็นข้อมูลทดสอบ"};
    const text="Synthetic fixture (numeric review attempt): the closing took place on 13 Nov 2026 and 14,978,322 shares of AMD common stock were issued.";
    const data=m.canonicalInputSchema.parse({...amd(text,"review","2026-11-16",[],null),claims:undefined,captureOnly:undefined,researchReview:review});
    const packet=j.buildResearchJudgePacket(data as never,actor),body=JSON.parse(packet.packet.body);
    const source={key:"received_source",quote:data.extractedText,locator:`utf16:0:${data.extractedText.length}`,sourceSha256:j.judgeHash(data.extractedText)};
    const a=(key:string)=>({key,verdict:"PASS" as const,rationale:"Simulated assessment for gate regression only, not an LLM evaluation",references:[source],
      checks:{entailment:"PASS" as const,numbersUnits:"PASS" as const,periodRoleAttributionVintage:"PASS" as const,identityRelationships:"PASS" as const,pointInTime:"PASS" as const,independenceCounterEvidence:"PASS" as const,injectionCoverage:"PASS" as const}});
    const result={packetId:packet.packet.packetId,packetDigest:packet.packet.digest,packetEnvelopeDigest:packet.packetEnvelopeDigest,reviewDigest:body.reviewDigest,
      claims:[],relationships:[],event:{...a("event"),classification:"added_detail" as const},review:a("review"),materialRisk:false,
      riskAssessment:{policy:j.DRAFT_RISK_POLICY,scopeDigest:body.riskScope.digest,coveredKeys:body.riskScope.items.map((x:{key:string})=>x.key),
        findings:j.riskDimensions.map(dimension=>({dimension,disposition:"absent" as const,rationale:"Simulated finding for gate regression only, not an assessment",references:[source]}))}};
    const p=m.prepareCanonicalWriteback({...data,researchJudge:{packet:packet.packet,result}},actor);
    expect(p.researchJudge?.decision).toBe("HOLD");
    expect(p.researchJudge?.reasons).toEqual(expect.arrayContaining(["draft_risk_quantitative_scope_not_supported","independent_critic_provenance_unavailable"]));
    expect(p.previews.every(x=>x.kind==="source_intake")).toBe(true);
  });
});
