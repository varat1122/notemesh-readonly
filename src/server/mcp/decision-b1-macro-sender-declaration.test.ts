/** IOS-ORCH-RI-001 / B1: MACRO_SOURCE_POLICY_V2 sender declaration.
 * Real disposable Safe Edit engine, receipts, FTS and standalone Macro history
 * discovery; only the cloud Sync pause is stubbed. Texts are synthetic fixtures
 * modelled on the structure of an official release, not its original bytes. */
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const actor="oauth:b1-macro-sender-fixture";
const T={timeout:60_000};
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const PROTECTED=["05_Thesis/US Macro - Current Thesis.md","06_Portfolio/Positions.md"];
const wb=()=>import("./canonical-writeback");
async function prepare(input:unknown){const m=await wb();return m.prepareCanonicalWriteback(m.canonicalInputSchema.parse(input),actor);}
async function capture(input:unknown){
  const m=await wb(),data=m.canonicalInputSchema.parse(input),p=m.prepareCanonicalWriteback(data,actor);
  const saved=await m.applyCanonicalWriteback({input:data,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);
  return {data,p,saved,sourcePath:p.previews.find(x=>x.kind==="source_intake")!.path};
}
const disk=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
// The publisher-shaped text never names the country in full; only the sender does.
const BLS="Synthetic fixture modelled on the structure of a BLS PPI release (not the original bytes). U.S. producer prices for final demand rose 0.3 percent in October, seasonally adjusted.";
const V2={version:"RI001-MACRO-SOURCE-SCOPE-2",kind:"country",label:"United States"};
const macro=(text:string,tag:string,macroSubject?:unknown,extra:Record<string,unknown>={})=>({domain:"macro",entities:["United States"],topic:"US PPI "+tag,inputFormat:"text",
  sourceKind:"official_macro",extractedText:text,sourceChat:"B1 macro sender fixture "+tag,sourceUrl:null,eventDate:null,publicationDate:null,
  originalDocumentAccess:"excerpt_only",acquisitionChannel:"assistant_retrieved",contentTypes:["macro_data"],captureOnly:true,
  ...(macroSubject?{macroSubject}:{}),...extra});

beforeAll(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"b1-macro-sender-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,6).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
  for(const f of ["00_Inbox/ChatGPT","01_Companies","10_Knowledge/Macro and Markets","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,f),{recursive:true});
  for(const p of ["01_Companies/AMD.md",...PROTECTED]){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),"# disposable fixture\n");(await import("../vault/indexer")).reindexPath(p);}
});
afterAll(async()=>{
  for(const p of PROTECTED)expect(disk(p)).toBe("# disposable fixture\n");
  (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});

describe("B1 Macro sender declaration v2",()=>{
  let v2Path="";
  it("keeps the original text exact, renders the declaration outside the fence, binds it by receipt and stays Source-only",T,async()=>{
    const {data,p,saved,sourcePath}=await capture(macro(BLS,"v2",V2));
    v2Path=sourcePath;
    expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
    expect(saved.steps.some((s:{kind:string})=>s.kind==="canonical_review")).toBe(false);
    const raw=disk(sourcePath),{splitFrontmatter}=await import("../vault/markdown"),fm=splitFrontmatter(raw).data as Record<string,any>;
    const {preservedSubmittedText,preservedTextSection}=await import("../vault/research-decision-v2");
    expect(preservedSubmittedText(raw)).toBe(BLS);
    expect(fm.source_text_sha256).toBe(sha(BLS));
    expect(fm.macro_subject).toEqual({...V2,key:"UNITED STATES",authority:"sender_declared_not_publisher_authored"});
    const section=preservedTextSection(raw)!,fenceEnd=section.offset+section.text.length;
    const declaration=raw.indexOf("## Sender declaration (not publisher-authored)");
    expect(declaration).toBeGreaterThan(fenceEnd);
    expect(section.text).not.toContain("United States");
    expect(raw.slice(declaration)).toContain("- Macro subject (sender-declared): United States");
    const {receiptProvenance}=await import("../vault/investment-research-context");
    expect(receiptProvenance("source_intake",sourcePath,raw).tier).toBe("server_witnessed");
    const {readMacroSourceScope}=await import("../vault/macro-source-scope");
    expect(readMacroSourceScope(fm.macro_subject,BLS,fm.source_text_sha256)).toEqual(fm.macro_subject);
    const wf=(await import("../vault/investment-writeback-router")).planInvestmentWriteback(data as never).safeEditWorkflow!;
    expect(wf.status).toBe("source_saved_analysis_pending");
    expect((await prepare(macro(BLS,"v2",V2))).previews).toEqual([]);
  });
  it("is found by FTS and by receipt-bound Macro history discovery, without geographic verification",T,async()=>{
    const {searchVault}=await import("../vault/queries");
    expect(searchVault("United States",{limit:20}).hits.map(h=>h.path)).toContain(v2Path);
    const {buildInvestmentContextPack}=await import("../vault/investment-context");
    const {MACRO_HISTORY_POLICY}=await import("../vault/macro-source-scope");
    const pack=buildInvestmentContextPack({question:"United States producer prices October",focus:"macro",
      macroScope:{version:MACRO_HISTORY_POLICY,key:"UNITED STATES",label:"United States"}});
    expect(pack.standaloneSources.flatMap(s=>s.paths)).toContain(v2Path);
    const item=pack.items.find(i=>i.path===v2Path);
    if(item)expect(item.evidenceUse).not.toBe("verified" as never);
    expect(pack.status).toBe("retrieval_only_not_verified");
  });
  it("a header line typed into the text gains no authority beyond a v2 sender declaration",T,async()=>{
    const text="Macro subject: United States\n"+BLS+" (copy with an inserted header line)";
    const {sourcePath}=await capture(macro(text,"header",V2));
    const fm=(await import("../vault/markdown")).splitFrontmatter(disk(sourcePath)).data as Record<string,any>;
    expect(fm.macro_subject.authority).toBe("sender_declared_not_publisher_authored");
    expect(fm.macro_subject.version).toBe("RI001-MACRO-SOURCE-SCOPE-2");
  });
});

describe("B1 v1 compatibility and fail-closed validation",()=>{
  it("v1 and non-macro Source notes are byte-identical to the parent (bca00ea) golden bytes",T,async()=>{
    const router=await import("../vault/investment-writeback-router");
    const line="Macro subject: Fictionland",v1text=line+"\nSynthetic fixture: Fictionland survey text.";
    const v1={domain:"macro",entities:["Fictionland"],topic:"Fictionland survey",inputFormat:"text",sourceKind:"user_commentary",extractedText:v1text,sourceChat:"golden v1",
      sourceUrl:null,eventDate:null,publicationDate:null,captureOnly:true,
      macroSubject:{version:"RI001-MACRO-SOURCE-SCOPE-1",kind:"country",label:"Fictionland",anchor:{quote:line,locator:`utf16:0:${line.length}`,sourceSha256:sha(v1text)}}};
    const plain={domain:"company",entities:["AMD"],topic:"AMD note",inputFormat:"text",sourceKind:"news_media",extractedText:"Synthetic fixture: AMD note without macro scope.",
      sourceChat:"golden plain",sourceUrl:null,eventDate:null,publicationDate:null,captureOnly:true};
    const golden=[[v1,"00_Inbox/ChatGPT/Investment Intake - IN-E04DCD3FD6CD21D1.md","bc2104b8bb8f0c4efb79f5e99f57738b9b1148eb4e66e112421f296adfd89db3"],
      [plain,"00_Inbox/ChatGPT/Investment Intake - IN-38124ACC9E9B5C9F.md","835005379c9f6cc86b85c366eb1e76aad9630d435a5d534ba3457cf4be380036"]] as const;
    for(const [input,p,h] of golden){
      const plan=router.planInvestmentWriteback(input as never),src=plan.safeEditWorkflow!.steps.find(s=>s.kind==="source_intake")!;
      expect([src.path,src.expectedSha256]).toEqual([p,h]);
    }
    const plan=router.planInvestmentWriteback(v1 as never);
    expect(plan.macroScope?.binding).toMatchObject({version:"RI001-MACRO-SOURCE-SCOPE-1",authority:"source_declared_not_geographic_verification"});
    // v1 write + readback still works exactly as before.
    const {sourcePath}=await capture(v1);
    const fm=(await import("../vault/markdown")).splitFrontmatter(disk(sourcePath)).data as Record<string,any>;
    const {readMacroSourceScope}=await import("../vault/macro-source-scope");
    expect(readMacroSourceScope(fm.macro_subject,v1text,fm.source_text_sha256)).toEqual(plan.macroScope!.binding);
    expect(disk(sourcePath)).not.toContain("Sender declaration");
  });
  it("wrong country, wrong domain, mixed versions and invalid labels fail closed; the Source stays unscoped",T,async()=>{
    const {validateMacroSubject}=await import("../vault/macro-source-scope");
    expect(validateMacroSubject({...V2,label:"Vietnam"},BLS,"macro",["United States"])).toEqual({binding:null,reason:"macro_sender_declaration_hold"});
    expect(validateMacroSubject(V2,BLS,"company",["United States"])).toEqual({binding:null,reason:"macro_subject_contract_hold"});
    expect(validateMacroSubject({...V2,label:"United States and China"},BLS,"macro",["United States and China"]).binding).toBeNull();
    expect(validateMacroSubject({...V2,anchor:{quote:"x",locator:"utf16:0:1",sourceSha256:"a".repeat(64)}},BLS,"macro",["United States"]).binding).toBeNull();
    expect(validateMacroSubject({version:"RI001-MACRO-SOURCE-SCOPE-1",kind:"country",label:"United States"},BLS,"macro",["United States"]).binding).toBeNull();
    const {canonicalInputSchema}=await wb();
    expect(canonicalInputSchema.safeParse(macro(BLS,"mixed",{...V2,anchor:{quote:"x",locator:"utf16:0:1",sourceSha256:"a".repeat(64)}})).success).toBe(false);
    expect(canonicalInputSchema.safeParse(macro(BLS,"bad-version",{...V2,version:"RI001-MACRO-SOURCE-SCOPE-3"})).success).toBe(false);
    // A wrong-country declaration never scopes the Source; capture stays Source-only and unscoped.
    const plan=(await import("../vault/investment-writeback-router")).planInvestmentWriteback(macro(BLS+" (wrong-country copy)","wrong",{...V2,label:"Vietnam"}) as never);
    expect(plan.macroScope).toEqual({binding:null,reason:"macro_sender_declaration_hold"});
    const {sourcePath}=await capture(macro(BLS+" (wrong-country copy)","wrong",{...V2,label:"Vietnam"}));
    const raw=disk(sourcePath);
    expect((await import("../vault/markdown")).splitFrontmatter(raw).data.macro_subject).toBeUndefined();
    expect(raw).not.toContain("Sender declaration");
  });
  it("stored bindings are never reinterpreted across versions or accepted after tampering",T,async()=>{
    const {readMacroSourceScope}=await import("../vault/macro-source-scope");
    const v2Bound={...V2,key:"UNITED STATES",authority:"sender_declared_not_publisher_authored"};
    expect(readMacroSourceScope(v2Bound,BLS,sha(BLS))).toEqual(v2Bound);
    expect(()=>readMacroSourceScope({...v2Bound,authority:"source_declared_not_geographic_verification"},BLS,sha(BLS))).toThrow(/macro_source_scope_hold/);
    expect(()=>readMacroSourceScope({...v2Bound,key:"VIETNAM"},BLS,sha(BLS))).toThrow(/macro_source_scope_hold/);
    expect(()=>readMacroSourceScope(v2Bound,BLS,sha(BLS+"x"))).toThrow(/macro_source_text_hold/);
    const line="Macro subject: Fictionland",text=line+"\nSynthetic fixture: Fictionland survey text.";
    const v1Bound={version:"RI001-MACRO-SOURCE-SCOPE-1",kind:"country",label:"Fictionland",anchor:{quote:line,locator:`utf16:0:${line.length}`,sourceSha256:sha(text)},
      key:"FICTIONLAND",authority:"source_declared_not_geographic_verification"};
    expect(readMacroSourceScope(v1Bound,text,sha(text))).toEqual(v1Bound);
    // A v1 note relabelled as v2 is rejected (no reinterpretation, no backfill).
    expect(()=>readMacroSourceScope({...v1Bound,version:"RI001-MACRO-SOURCE-SCOPE-2"},text,sha(text))).toThrow(/macro_source_scope_hold/);
  });
  it("the MCP description forbids inserting a header into publisher text",T,async()=>{
    const {canonicalInputShape}=await wb();
    expect(canonicalInputShape.macroSubject.description).toContain("NEVER insert a \"Macro subject:\" line");
  });
});
