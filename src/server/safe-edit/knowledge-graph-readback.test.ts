import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {splitFrontmatter} from "../vault/markdown";
import {checkInvestmentGraphAgainstReadbackPort}
  from "./knowledge-graph-readback";

const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
const BASE="08_Daily_Weekly/Research Indexes/";
const ANALYSIS=BASE+"Investment Review - SYNTH - FY26Q3.md";
const TIMELINE=BASE+"Company Evolution - SYNTH.md";
const SOURCE="07_Sources/ChatGPT/SYNTH Primary Event.md";
const HUB="01_Companies/SYNTH.md";
const INDUSTRY="02_Industries_Themes/AI Networking.md";
const THESIS="05_Thesis/SYNTH - Current Thesis.md";
const ROOT="ios-graph-fy26q3";
const EVENT="SYNTH-FY26Q3-ARRIVAL";
const ref=(p:string)=>"[["+p.slice(0,-3)+"]]";
const input=()=>({
  analysisOperationId:ROOT+"-analysis",
  timelineOperationId:ROOT+"-timeline",
  analysisPath:ANALYSIS,timelinePath:TIMELINE,sourcePath:SOURCE,
});
const mark="<!-- investment-os-operation:"+ROOT+" -->";
const event="<!-- investment-os-event:"+EVENT+" -->";
function fixture(){
  const sourceRaw=[
    "---","entity: SYNTH","type: research_note",
    "source_type: user_supplied","verification: unverified",
    "event_key: "+EVENT,"---",
    "# Original Event",
    "User-supplied source capture, not publisher authenticated.","",
  ].join("\n");
  const notes=new Map<string,string>([
    [ANALYSIS,[
      "---","type: investment_review","entity: SYNTH",
      "event_key: "+EVENT,
      "verification: not_reverified","source_type: archived_ai",
      "analysis_origin: synthetic_ai_draft",
      "independent_evidence: false","status: draft",
      "source_path: "+SOURCE,"source_sha256: "+sha(sourceRaw),"---",
      "# SYNTH Review",mark,event,
      "AI working capital hypothesis, not an issuer verified fact.",
      ...[SOURCE,TIMELINE,HUB,INDUSTRY,THESIS].map(ref),"",
    ].join("\n")],
    [TIMELINE,[
      "---","entity: SYNTH","type: company_evolution","---",
      "# Evolution","Prior events preserved.",mark,event,
      "- "+ref(ANALYSIS)+" — unverified AI research index.","",
    ].join("\n")],
    [SOURCE,sourceRaw],
    [HUB,"---\nentity: SYNTH\n---\n# Company\n"],
    [INDUSTRY,"---\ntype: industry\n---\n# Networking\n"],
    [THESIS,"---\nentity: SYNTH\nverification: not_reverified\n---\n# Draft Thesis\n"],
  ]);
  const receipts=new Map<string,unknown>();
  const mkReceipt=(id:string,p:string)=>{
    const content=notes.get(p)!;
    return {
      operationId:id,status:"written",path:p,
      beforeHash:sha("old-version"),afterHash:sha(content),
      receipt:{
        operationId:id,path:p,beforeHash:sha("old-version"),
        afterHash:sha(content),
        write:"written",readback:"verified",reindex:"verified",
        sync:"unverified",remoteSync:"unverified",mobileSync:"unverified",
      },
    };
  };
  receipts.set(ROOT+"-analysis",mkReceipt(ROOT+"-analysis",ANALYSIS));
  receipts.set(ROOT+"-timeline",mkReceipt(ROOT+"-timeline",TIMELINE));
  const edges=new Map([
    [ANALYSIS,[SOURCE,TIMELINE,HUB,INDUSTRY,THESIS].map(p=>({
      target:p.slice(0,-3),resolved_path:p,
    }))],
    [TIMELINE,[{target:ANALYSIS.slice(0,-3),resolved_path:ANALYSIS}]],
  ]);
  const port:Parameters<typeof checkInvestmentGraphAgainstReadbackPort>[1]={
    getReceipt:id=>receipts.get(id) as ReturnType<
      Parameters<typeof checkInvestmentGraphAgainstReadbackPort>[1]["getReceipt"]>,
    getPhysical:p=>{
      const v=notes.get(p);
      if(v===undefined)throw Error("synthetic test note not found");
      return v;
    },
    getIndexed:p=>{
      const raw=notes.get(p);
      if(raw===undefined)return null;
      const fm=splitFrontmatter(raw);
      return {
        path:p,
        frontmatter:Object.keys(fm.data).length?
          JSON.stringify(fm.data):null,
        body:fm.body,size:Buffer.byteLength(raw,"utf8"),mtime:0,
      };
    },
    getEdges:p=>edges.get(p)??[],
    noteExists:p=>notes.has(p),
  };
  return {port,notes,receipts,edges};
}
describe("PR #103 actual Safe Edit receipt and Knowledge Graph readback contract",()=>{
  it("checks both durable receipt stages and physical exact-path graph links",()=>{
    const f=fixture(),r=checkInvestmentGraphAgainstReadbackPort(
      input(),f.port);
    expect(r.status).toBe(
      "graph_integrity_proven_against_supplied_readback_source");
    expect(r.verifiedPersistedAnalysisAndTimelineCount).toBe(2);
    expect(r.fullPathOutgoingWikilinksResolved).toBe(5);
    expect(r.livingTimelineBacklinkVerified).toBe(true);
    expect(r.physicalMarkdownAndFTSAgree).toBe(true);
    expect(r.reviewedSourceVersionVerified).toBe(true);
    expect(r.archivedAIIsIndependentEvidence).toBe(false);
    expect(r.originalSourceIndependentlyAuthenticated).toBe(false);
    expect(r.vaultWrittenByVerifier).toBe(false);
    expect(r.mobileDeviceSyncVerified).toBe(false);
    expect(r.noteTextPathsAndOAuthTokensReturned).toBe(false);
    const result=JSON.stringify(r);
    for(const secret of [SOURCE,TIMELINE,ANALYSIS,THESIS,
      "Original Event","AI working capital"])
      expect(result).not.toContain(secret);
  });
  it("rejects preview-only or interrupted receipts before any graph success",()=>{
    const f=fixture();
    const a=f.receipts.get(ROOT+"-analysis") as
      {status:string;receipt:{write:string}};
    a.status="preview";
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_operation_not_independently_written_hold");
    a.status="written";a.receipt.write="pending";
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_operation_not_independently_written_hold");
  });
  it("rejects physically changed Analysis after a previously successful receipt",()=>{
    const f=fixture();
    f.notes.set(ANALYSIS,f.notes.get(ANALYSIS)!+"\nlate edit");
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_physical_hash_disagrees_with_receipt_hold");
  });
  it("rejects misleading role promotion from archived AI to original evidence",()=>{
    const f=fixture();
    f.notes.set(SOURCE,f.notes.get(SOURCE)!.replace(
      "source_type: user_supplied","source_type: archived_ai"));
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_source_analysis_provenance_not_separated_hold");
  });
  it("rejects basename-fallback, dangling or wrong-issuer links",()=>{
    const f=fixture();
    const e=f.edges.get(ANALYSIS)!;
    e[0].resolved_path="07_Sources/Other Same Basename.md";
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_dangling_or_wrong_wikilink_target_hold");
    const g=fixture();
    g.notes.set(ANALYSIS,g.notes.get(ANALYSIS)!.replace(
      "[[01_Companies/SYNTH]]","[[01_Companies/OTHER]]"));
    // Immutable expected after-hash catches this first.
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),g.port))
      .toThrow("graph_readback_physical_hash_disagrees_with_receipt_hold");
  });
  it("detects a missing or duplicated Timeline backlink or event marker",()=>{
    const f=fixture();
    f.edges.set(TIMELINE,[]);
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_missing_company_timeline_backlink_hold");
    const g=fixture();
    g.notes.set(TIMELINE,g.notes.get(TIMELINE)!+"\n"+mark);
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),g.port))
      .toThrow("graph_readback_physical_hash_disagrees_with_receipt_hold");
  });
  it("rejects traversal, unrelated operation IDs and protected write targets",()=>{
    const f=fixture();
    const bad=input();bad.sourcePath="07_Sources/../05_Thesis/SYNTH - Current Thesis.md";
    expect(()=>checkInvestmentGraphAgainstReadbackPort(bad,f.port))
      .toThrow("graph_readback_unbound_or_uncanonical_request_hold");
    const op=input();op.timelineOperationId="different-timeline";
    expect(()=>checkInvestmentGraphAgainstReadbackPort(op,f.port))
      .toThrow("graph_readback_unbound_or_uncanonical_request_hold");
    const protectedTarget=input();protectedTarget.timelinePath=THESIS;
    expect(()=>checkInvestmentGraphAgainstReadbackPort(
      protectedTarget,f.port)).toThrow(
      "graph_readback_unbound_or_uncanonical_request_hold");
  });
  it("fails if FTS does not reflect the physical Analysis body",()=>{
    const f=fixture(),original=f.port.getIndexed;
    f.port.getIndexed=p=>{
      const row=original(p);
      return p===ANALYSIS&&row?{...row,body:"outdated index"}:row;
    };
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_physical_markdown_fts_mismatch_hold");
  });
  it("rejects changed Source bytes even when its index has caught up",()=>{
    const f=fixture();
    f.notes.set(SOURCE,f.notes.get(SOURCE)!+"\nChanged original claim.\n");
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_source_changed_since_review_hold");
  });
  it("rejects stale Source FTS even when the reviewed bytes are unchanged",()=>{
    const f=fixture(),getIndexed=f.port.getIndexed;
    f.port.getIndexed=p=>{
      const row=getIndexed(p);
      return p===SOURCE&&row?{...row,body:"stale original source index"}:row;
    };
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_physical_markdown_fts_mismatch_hold");
  });
  it.each(["source_path","source_sha256"])("holds legacy receipts missing %s rather than inventing a binding",field=>{
    const f=fixture();
    const old=f.notes.get(ANALYSIS)!;
    const unbound=old.split("\n").filter(line=>!line.startsWith(field+":")).join("\n");
    f.notes.set(ANALYSIS,unbound);
    // This models a genuinely persisted legacy Analysis, not a hash-tampered note.
    const receipt=f.receipts.get(ROOT+"-analysis") as
      {afterHash:string;receipt:{afterHash:string}};
    receipt.afterHash=receipt.receipt.afterHash=sha(unbound);
    expect(()=>checkInvestmentGraphAgainstReadbackPort(input(),f.port))
      .toThrow("graph_readback_reviewed_source_binding_missing_or_mismatched_hold");
  });
  it("rejects substitution of a same-event Source at a different indexed path",()=>{
    const f=fixture(),other="10_Knowledge/Company Research/Same Event.md";
    f.notes.set(other,f.notes.get(SOURCE)!);
    expect(()=>checkInvestmentGraphAgainstReadbackPort({...input(),sourcePath:other},f.port))
      .toThrow("graph_readback_reviewed_source_binding_missing_or_mismatched_hold");
  });
});
