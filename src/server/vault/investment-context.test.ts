import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Frozen RV1-MI-04 prompt, unchanged. The corpus below is NEW SYNTHETIC data;
// it is not a snapshot of the installed connector or the actual H05 receipt.
const MI04_QUESTION="AMD Q3 ปี 2026 โตแรงหรือไม่ และมีหลักฐานเพียงพอหรือยังที่จะสรุปว่าราคาหุ้นถูก ลูกค้า AI ได้ ROI และต้องเพิ่มน้ำหนักลงทุน? ตอบแยกส่วนที่พิสูจน์ได้กับสิ่งที่ต้องหาเพิ่ม";

let root: string;
let vault: string;
beforeEach(() => {
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"investment-context-")));
  vault=path.join(root,"vault");
  fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});

// Synthetic, explicitly declared mappings only; these fixtures are not a
// production security master or evidence that any live Hub has these aliases.
async function tsmcHub(aliases="[TSM]"){
  await addExtra("01_Companies/TSMC.md",`---\naliases: ${aliases}\n---\n# TSMC issuer context`);
  await addExtra("05_Thesis/TSMC - Current Thesis.md","# TSMC draft\nNot owner endorsed.");
  await addExtra("05_Thesis/TSMC - Evidence Register.md","# TSMC evidence\n## Counter-evidence\nCapacity assumptions require validation.");
  await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - TSMC.md","# TSMC chronology");
  await addExtra("08_Daily_Weekly/Research Indexes/Primary Evidence - TSMC Q3.md",
    "---\nverification: not_reverified\n---\n# TSMC original-source candidate");
}
describe("MI04 minimal retrieval scope and excerpt budget",()=>{
  it.each(["setext","link_definition"])("MI04 final repro empty counter section: %s",async syntax=>{
    await addExtra("01_Companies/ALFA.md","# ALFA");
    const target="10_Knowledge/Company Research/ALFA - earnings empty section.md";
    const raw="# ALFA earnings\n## Counter-evidence\n\n"+(syntax==="setext"?"Bull case\n---------\nDemand improved.":"[ref]: https://example.org/fixture");
    await addExtra(target,raw);
    const build=(await import("./investment-context")).buildInvestmentContextPack;
    for(const maxNotes of [11,8]){
      const p=build({question:"ALFA earnings",issuers:["ALFA"],maxNotes});
      expect.soft(p.items.find(i=>i.path===target)!.counterEvidenceExcerptIncluded).toBe(false);
      expect.soft(p.researchCoverage[0].counterEvidence.paths).not.toContain(target);
      expect.soft(p.researchCoverage[0].counterEvidence.scanComplete).toBe(false);
    }
  });
  it("MI04 final repro citation: selected counter quote does not cite the earlier withdrawn statement",async()=>{
    await addExtra("01_Companies/ALFA.md","# ALFA");
    const target="10_Knowledge/Company Research/ALFA - earnings duplicate quote.md";
    const quote="Cash conversion fell.";
    const raw="# Earnings\nAccording to the summary, the statement “Cash conversion fell.” was withdrawn.\n\n## Counter-evidence\nCash conversion fell.";
    await addExtra(target,raw);
    const judge=await import("./research-judge");
    const {packet}=judge.buildResearchJudgePacket({domain:"company",entities:["ALFA"],topic:"earnings",
      inputFormat:"text",sourceKind:"news_media",contentTypes:["other"],extractedText:"Synthetic incoming text; no save requested."},"oauth:mi04-final");
    const history=judge.verifyResearchJudgeEnvelope(packet,"oauth:mi04-final").history.find(h=>h.path===target)!;
    expect(history.counterEvidence).toBe(true);expect(history.excerpt).toContain(quote);
    expect(raw.indexOf(quote)).toBe(52);expect(raw.lastIndexOf(quote)).toBe(111);
    expect(history.citationSpans.find(s=>s.text===quote)).toEqual({start:111,end:132,text:quote});
  });
  it("MI04 delta repro 3: treats an explicit attribution as provenance, not an additional issuer",async()=>{
    const build=await fixture();
    await addExtra("01_Companies/JPM.md","# JPM");await addExtra("01_Companies/ASML.md","# ASML");
    const question="According to JPM, what did ASML report for Q3?";
    const p=build({question});
    expect(p.question).toBe(question);
    expect(p.issuers).toEqual(["ASML"]);
    expect(p.issuerResolution).toEqual([expect.objectContaining({contextKey:"ASML",status:"exact_existing_title"})]);
  });
  it.each(["setext_h1","definition_title","definition_multiline","comment"])("MI04 final section control: %s is not counter body",async syntax=>{
    await addExtra("01_Companies/ALFA.md","# ALFA");
    const tails={setext_h1:"Bull case\n========\nDemand improved.",
      definition_title:'[ref]: https://example.org/fixture\n  "Invisible title"',
      definition_multiline:'[ref]:\n https://example.org/fixture\n "Invisible\n title"',
      comment:"<!--\nInvisible comment\n-->"};
    const target="10_Knowledge/Company Research/ALFA - earnings syntax.md";
    await addExtra(target,"# ALFA earnings\n## Counter-evidence\n\n"+tails[syntax as keyof typeof tails]);
    const p=(await import("./investment-context")).buildInvestmentContextPack({question:"ALFA earnings",issuers:["ALFA"]});
    expect(p.items.find(i=>i.path===target)!.counterEvidenceExcerptIncluded).toBe(false);
    expect(p.researchCoverage[0].counterEvidence.reasons).toContain("counter_evidence_excerpt_missing");
  });
  it.each(["\n","\r\n"])("MI04 final selected offsets survive Setext, repeated text, UTF16 and newline %j",async newline=>{
    await addExtra("01_Companies/ALFA.md","# ALFA");
    const target="10_Knowledge/Company Research/ALFA - earnings exact offsets.md",quote="Cash conversion fell.";
    const raw=["# ALFA earnings","🔎 “"+quote+"” was withdrawn.","Counter-evidence","----------------",quote].join(newline);
    await addExtra(target,raw);
    const p=(await import("./investment-context")).buildInvestmentContextPack({question:"ALFA earnings",issuers:["ALFA"]});
    const item=p.items.find(i=>i.path===target)!;
    expect(item.counterEvidenceExcerptIncluded).toBe(true);
    for(const span of item.citationSpans)expect(raw.slice(span.start,span.end)).toBe(item.excerpt.slice(span.excerptStart,span.excerptEnd));
    const judge=await import("./research-judge");
    const {packet}=judge.buildResearchJudgePacket({domain:"company",entities:["ALFA"],topic:"earnings",
      inputFormat:"text",sourceKind:"news_media",contentTypes:["other"],extractedText:"Synthetic text only."},"oauth:mi04-final");
    const history=judge.verifyResearchJudgeEnvelope(packet,"oauth:mi04-final").history.find(h=>h.path===target)!;
    expect(history.citationSpans.find(s=>s.text===quote)).toEqual({start:raw.lastIndexOf(quote),end:raw.lastIndexOf(quote)+quote.length,text:quote});
  });
  it("MI04 delta repro 2: includes readable counter text at both MCP and Judge allocation boundaries",async()=>{
    await addExtra("01_Companies/NVDA.md","# NVDA");
    const build=(await import("./investment-context")).buildInvestmentContextPack;
    const target="10_Knowledge/Company Research/NVDA - earnings boundary.md";
    const evidence="Cash conversion fell in this synthetic scenario.";
    for(const maxNotes of [11,8]){
      const allocation=Math.floor(12000/maxNotes);
      const prefix="[Source lines 1-4]\n# NVDA earnings\n",heading="## Counter-evidence";
      // The heading ends at the exact visible edge; its evidence is line 4.
      const raw="# NVDA earnings\n"+"x".repeat(allocation-prefix.length-heading.length-1)+"\n"+heading+"\n"+evidence;
      await addExtra(target,raw);
      const p=build({question:"NVDA earnings",issuers:["NVDA"],focus:"earnings",...(maxNotes===8?{maxNotes}: {})});
      const item=p.items.find(i=>i.path===target)!;
      expect(item).toBeDefined();
      expect.soft(item.excerpt, `maxNotes=${maxNotes}`).toContain(evidence);
      expect(item.counterEvidenceExcerptIncluded).toBe(true);
      expect(item.excerpt.length).toBeLessThanOrEqual(allocation);
      expect(p.excerptChars).toBeLessThanOrEqual(12000);
    }
  });
  it("keeps excerpt allocation stable when an omitted raw archive appears",async()=>{
    await addExtra("01_Companies/NVDA.md","# NVDA\nSynthetic identity");
    const target="10_Knowledge/Company Research/NVDA - earnings context.md";
    await addExtra(target,"---\ncompany: NVDA\nverification: not_reverified\n---\n# NVDA earnings\n"+"Synthetic background. ".repeat(130));
    const build=(await import("./investment-context")).buildInvestmentContextPack;
    const before=build({question:"NVDA earnings",issuers:["NVDA"],maxNotes:5,maxChars:4500});
    await addExtra("07_Sources/ChatGPT/Archive NVDA.md","# NVDA earnings\nSynthetic repost only.");
    const after=build(before.retrieval.scope);
    const {judgeScopeWitness}=await import("./research-judge-scope");
    // Public FTS scores may shift with corpus statistics; the authority witness
    // binds paths/bytes/excerpts, not those untrusted display scores.
    expect(judgeScopeWitness(after)).toEqual(judgeScopeWitness(before));
    expect(after.omitted).toContain("07_Sources/ChatGPT/Archive NVDA.md");
  });
  it("MI04 delta roles: preserves genuine multi-issuer, explicit scope and ambiguous target aliases",async()=>{
    for(const issuer of ["ORBX","ALFA","BETA"])await addExtra(`01_Companies/${issuer}.md`,"# "+issuer);
    const build=(await import("./investment-context")).buildInvestmentContextPack;
    expect(build({question:"According to ORBX, what did ALFA and BETA report?"}).issuers.sort()).toEqual(["ALFA","BETA"]);
    expect(build({question:"Compare ORBX and ALFA earnings"}).issuers.sort()).toEqual(["ALFA","ORBX"]);
    expect(build({question:"According to ORBX, compare ORBX and ALFA earnings"}).issuers.sort()).toEqual(["ALFA","ORBX"]);
    expect(build({question:"According to ORBX, what did ALFA report?",issuers:["ORBX"]}).issuers).toEqual(["ORBX"]);
    expect(build({question:"According to ORBX, what did ALFA report?",issuers:[]}).issuers).toEqual([]);
    expect(build({question:"According to ORBX, what is the outlook?"}).issuers).toEqual([]);
    await addExtra("01_Companies/ALFA.md","---\naliases: [SHARED]\n---\n# ALFA");
    await addExtra("01_Companies/BETA.md","---\naliases: [SHARED]\n---\n# BETA");
    const ambiguous=build({question:"According to ORBX, what did SHARED report?"});
    expect(ambiguous.issuerResolution[0].status).toBe("ambiguous_hold");
    expect(ambiguous.items.every(i=>i.role==="rules")).toBe(true);
  });
  it.each(["heading_only","next_heading","oversized","duplicate_outside"])("MI04 delta counter negative: %s never certifies missing visible evidence",async fault=>{
    await addExtra("01_Companies/NVDA.md","# NVDA");
    const build=(await import("./investment-context")).buildInvestmentContextPack;
    const target="10_Knowledge/Company Research/NVDA - earnings missing counter.md";
    const evidence="Cash conversion fell in this synthetic scenario.";
    const body=fault==="heading_only"?"":fault==="next_heading"?"## Support\nUnrelated supporting text.":
      fault==="oversized"?"Long synthetic risk statement. ".repeat(100):"x".repeat(3000)+"\n"+evidence;
    const raw="# NVDA earnings\n"+(fault==="duplicate_outside"?evidence+"\n":"")+"Intro. ".repeat(300)+"\n## Counter-evidence\n"+body;
    await addExtra(target,raw);
    for(const maxNotes of [11,8]){
      const p=build({question:"NVDA earnings",issuers:["NVDA"],focus:"earnings",maxNotes});
      const item=p.items.find(i=>i.path===target)!;
      expect(item.counterEvidenceExcerptIncluded).toBe(false);expect(item.truncated).toBe(true);
      expect(p.researchCoverage[0].counterEvidence).toMatchObject({status:"SCAN_INCOMPLETE",paths:[],scanComplete:false});
      expect(p.researchCoverage[0].counterEvidence.reasons).toContain("counter_evidence_excerpt_missing");
      expect(p.incomplete.join(" ")).toContain("readable evidence is missing");
    }
  });
  it("MI04 delta public MCP and sealed Judge show exact counter text and citation spans",async()=>{
    for(const issuer of ["ORBX","ALFA"])await addExtra(`01_Companies/${issuer}.md`,"# "+issuer);
    const target="10_Knowledge/Company Research/ALFA - earnings boundary.md";
    const evidence="Cash conversion fell in this synthetic scenario.";
    const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
    const {InMemoryTransport}=await import("@modelcontextprotocol/sdk/inMemory.js");
    const server=(await import("../mcp/server")).createMcpServer({read:true,write:false,label:"mi04-delta-read"});
    const client=new Client({name:"mi04-delta",version:"1.0"});
    const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
    try{
      for(const maxNotes of [11,8]){
        const allocation=Math.floor(12000/maxNotes),heading="## Counter-evidence";
        const raw="# ALFA earnings\n"+"x".repeat(allocation-"[Source lines 1-4]\n# ALFA earnings\n".length-heading.length-1)+"\n"+heading+"\n"+evidence;
        await addExtra(target,raw);
        const response=await client.callTool({name:"investment_context_pack",arguments:{
          question:"According to ORBX, what did ALFA report for Q3?",focus:"earnings",...(maxNotes===8?{maxNotes}:{})}});
        expect(response.isError).not.toBe(true);
        const text=(response.content as Array<{type:string;text?:string}>).find(c=>c.type==="text")!.text!;
        const p=JSON.parse(text) as import("./investment-context").Pack;
        expect(p.issuers).toEqual(["ALFA"]);
        const item=p.items.find(i=>i.path===target)!;
        expect(item.counterEvidenceExcerptIncluded).toBe(true);expect(item.excerpt).toContain(evidence);
        expect(item.excerpt).toContain("source lines 3-4]");
        if(maxNotes===8){
          const judge=await import("./research-judge");
          const {packet}=judge.buildResearchJudgePacket({domain:"company",entities:["ALFA"],topic:"earnings",
            inputFormat:"text",sourceKind:"news_media",contentTypes:["other"],extractedText:"Synthetic incoming text; no save requested."},"oauth:mi04-delta");
          const body=judge.verifyResearchJudgeEnvelope(packet,"oauth:mi04-delta");
          const history=body.history.find(h=>h.path===target)!;
          expect(history.counterEvidence).toBe(true);expect(history.excerpt).toContain(evidence);
          expect(history.citationSpans).toContainEqual({start:raw.indexOf(evidence),end:raw.indexOf(evidence)+evidence.length,text:evidence});
          for(const span of history.citationSpans)expect(raw.slice(span.start,span.end)).toBe(span.text);
          expect(history.citationSpans.some(s=>s.text.includes("[Counter-evidence / risk section"))).toBe(false);
          expect(body.coverage.researchCoverage).toEqual(p.researchCoverage);
          // Current Judge builds its own scope without historyCutoff. This is
          // exact-text/citation coverage, NOT end-to-end Judge PIT acceptance.
          expect(body.scopeWitness?.scope.historyCutoff).toBeUndefined();
        }
        expect(fs.readFileSync(path.join(vault,target),"utf8")).toBe(raw);
      }
    }finally{await client.close();await server.close();}
  });
  it("uses verified indexed aliases, preserves explicit scope and refuses ambiguous identity",async()=>{
    const build=await fixture();await tsmcHub();
    expect(build({question:"TSM earnings"}).issuerResolution[0]).toMatchObject({contextKey:"TSMC",status:"indexed_alias"});
    expect(build({question:"TSM earnings",issuers:[]}).issuers).toEqual([]);
    expect(build({question:"NVDA earnings",issuers:["TSM"]}).issuers).toEqual(["TSM"]);
    await addExtra("01_Companies/OTHER.md","---\naliases: [TSM]\n---\n# OTHER");
    expect(build({question:"TSM earnings"}).issuerResolution[0].status).toBe("ambiguous_hold");
    expect(build({question:"Unrelated tsm vocabulary"}).issuers).toEqual([]);
  });
  it("does not interpret a broker mention inside another issuer's research title as primary issuer",async()=>{
    const build=await fixture();
    await addExtra("01_Companies/JPM.md","# JPM");await addExtra("01_Companies/ASML.md","# ASML");
    await addExtra("10_Knowledge/Company Research/ASML - JPM Q3 Preview.md","---\ncompany: ASML\n---\n# ASML JPM Q3 Preview\nSynthetic broker commentary.");
    const p=build({question:"JPM earnings"});
    expect(p.issuers).toEqual(["JPM"]);expect(p.items.some(i=>i.path.includes("ASML - JPM"))).toBe(false);
  });
  it("resolves the unchanged question through existing Hub identity, excluding cross-issuer history",async()=>{
    const build=await fixture();
    await addExtra("01_Companies/AMD.md","# AMD\nSynthetic issuer Hub.");
    await addExtra("01_Companies/AI.md","# AI\nSynthetic acronym/ticker collision.");
    await addExtra("10_Knowledge/Company Research/AMD - Q3 prior analysis.md","---\ncompany: AMD\nsource_type: chatgpt_analysis\nverification: not_reverified\npublished_at: 2026-11-02\n---\n# AMD Q3 historical context\nSynthetic analyst context only.\n## Counter-evidence\nSynthetic cash conversion uncertainty.");
    const p=build({question:MI04_QUESTION});
    expect(p.question).toBe(MI04_QUESTION);expect(p.issuers).toEqual(["AMD"]);
    expect(p.issuerResolution[0]).toMatchObject({contextKey:"AMD",status:"exact_existing_title"});
    expect(p.items.some(x=>x.path.includes("AMD - Q3"))).toBe(true);
    expect(p.items.some(x=>x.path.includes("NVDA"))).toBe(false);
    expect(build({question:"AI earnings"}).issuers).toEqual(["AI"]);
  });
  it("retains counter-evidence in a bounded excerpt even when the matching introduction fills its allocation",async()=>{
    const build=await fixture();
    const target="10_Knowledge/Company Research/NVDA - earnings prior analysis.md";
    await addExtra(target,"---\ncompany: NVDA\nsource_type: chatgpt_analysis\nverification: not_reverified\n---\n# NVDA earnings\n"+
      "Synthetic introduction NVDA earnings. ".repeat(100)+"\n"+"Background only.\n".repeat(15)+"## Counter-evidence\nSynthetic cash conversion downside; not independently verified.");
    const p=build({question:"NVDA earnings",issuers:["NVDA"],focus:"earnings",maxNotes:5,maxChars:4500});
    const item=p.items.find(x=>x.path===target);
    expect(item).toBeDefined();expect(item?.counterEvidenceExcerptIncluded).toBe(true);
    expect(item?.excerpt).toContain("Synthetic cash conversion downside");
    expect(p.excerptChars).toBeLessThanOrEqual(4500);expect(p.selected).toBeLessThanOrEqual(5);
    expect(item?.declaredVerification).toBe("not_reverified");
  });
  it("explains note, character and role omissions without claiming complete recall",async()=>{
    const build=await fixture();
    for(let i=0;i<10;i++)await addExtra(`10_Knowledge/Company Research/NVDA - earnings detail ${i}.md`,
      "---\ncompany: NVDA\n---\n# NVDA earnings\n"+"Synthetic earnings detail. ".repeat(100));
    const notes=build({question:"NVDA earnings",issuers:["NVDA"],maxNotes:5,maxChars:18000});
    expect(notes.discovery.paths.some(p=>p.reasons.includes("note_budget"))).toBe(true);
    const roles=build({question:"NVDA earnings",issuers:["NVDA"],maxNotes:16,maxChars:18000});
    expect(roles.discovery.paths.some(p=>p.reasons.includes("role_quota"))).toBe(true);
    expect(roles.discovery.coverage_incomplete).toBe(true);
    // Explicitly dense roles consume the independently bounded character budget.
    for(const name of ["05_Thesis/NVDA - Current Thesis.md","05_Thesis/NVDA - Evidence Register.md",
      "01_Companies/NVDA.md","08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
      "08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2.md"])
      await addExtra(name,"# NVDA earnings\n"+"Synthetic lengthy context. ".repeat(100));
    const chars=build({question:"NVDA earnings",issuers:["NVDA"],maxNotes:16,maxChars:4500});
    expect(chars.discovery.paths.some(p=>p.reasons.includes("excerpt_budget"))).toBe(true);
    expect(chars.excerptChars).toBeLessThanOrEqual(4500);
  });
});
describe("RI-001 issuer context resolution",()=>{
  it("F1 failure detail truncation preserves operational HOLD and exact failure counts",async()=>{
    const build=await fixture();
    for(let i=0;i<85;i++)await addExtra(`10_Knowledge/Macro and Markets/Vietnam GDP risk ${i}.md`,
      "---\ncountry: Vietnam\n---\n# Vietnam GDP\n## Risk\nUnverified economic context.\n");
    const notes=await import("./notes"),read=notes.readNote;
    const fault=vi.spyOn(notes,"readNote").mockImplementation(p=>{if(p.includes("Vietnam GDP risk"))throw Error("private failure");return read(p);});
    try{
      const pack=build({question:"Vietnam GDP risk",focus:"macro",industry:"Vietnam"});
      expect(pack.retrieval.status).toBe("operational_hold");
      expect(pack.retrieval.reads.failed).toBeGreaterThan(64);
      expect(pack.retrieval.failures).toHaveLength(64);expect(pack.retrieval.failuresTruncated).toBe(true);
      expect(pack.retrieval.reads.attempted).toBe(pack.retrieval.reads.read+pack.retrieval.reads.failed);
      expect(pack.retrieval.selection.failed).toBeGreaterThan(64);
      expect(pack.omitted.some(p=>p.includes("Vietnam GDP risk"))).toBe(false);
      expect(JSON.stringify(pack.retrieval)).not.toContain("private failure");
    }finally{fault.mockRestore();}
  });
  it.each(["source_type","source_tier"])("RC4 caller %s primary and URL never fill macro primary-verification gap or add ranking bonus",async key=>{
    const build=await fixture();
    const rel="10_Knowledge/Macro and Markets/Vietnam GDP declaration.md";
    const body="# Vietnam GDP declaration\nVietnam GDP release candidate, not verified.\n";
    await addExtra(rel,"---\ncountry: Vietnam\n---\n"+body);
    const request={question:"Vietnam GDP",industry:"Vietnam",focus:"macro" as const,maxNotes:16};
    const before=build(request),score=before.items.find(x=>x.path===rel)!.score;
    await addExtra(rel,`---\ncountry: Vietnam\n${key}: primary\nsource_url: https://example.gov/gdp\n---\n`+body);
    const after=build(request);
    expect(after.incomplete.join(" ")).toMatch(/primary.*verif/i);
    expect(after.items.find(x=>x.path===rel)!.score).toBe(score);
    expect(after.items.find(x=>x.path===rel)!.evidenceUse).toBe("unverified_candidate");
  });
  it("RC4 a Primary Evidence filename never fills the issuer primary-verification gap",async()=>{
    const build=await fixture();
    const pack=build({question:"NVDA earnings",issuers:["NVDA"]});
    expect(pack.items.some(x=>x.path.includes("Primary Evidence"))).toBe(true);
    expect(pack.incomplete.join(" ")).toContain("Server-verified primary evidence not established");
  });
  it("reuses the existing indexed Hub alias contract to retrieve TSMC context for TSM",async()=>{
    const build=await fixture();await tsmcHub();
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    expect(planCanonicalRoutingV2({domain:"company",entities:["TSM"],topic:"earnings"}).companyHubs[0].resolution).toBe("indexed_alias");
    const pack=build({question:"TSM earnings",issuers:["TSM"],maxNotes:14});
    expect(pack.items.map(x=>x.path)).toContain("08_Daily_Weekly/Research Indexes/Primary Evidence - TSMC Q3.md");
    expect(pack.issuerResolution).toEqual([expect.objectContaining({requested:"TSM",status:"indexed_alias",contextKey:"TSMC",hubPath:"01_Companies/TSMC.md"})]);
    expect(pack.issuers).toEqual(["TSM"]);
    expect(pack.incomplete).not.toContain("05_Thesis/TSM - Current Thesis.md");
    expect(pack.items.find(x=>x.role==="evidence_register")?.counterEvidenceExcerptIncluded).toBe(true);
    expect(pack.status).toBe("retrieval_only_not_verified");
  });
  it("does not guess TSM→TSMC from names, prose, broker mentions or prefix similarity",async()=>{
    const build=await fixture();await tsmcHub("[]");
    await addExtra("01_Companies/TSMX.md","# TSMX\nTSM is a casual mention, not an alias.");
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("unresolved");
    expect(pack.items.some(x=>/TSMC|TSMX/.test(x.path))).toBe(false);
    expect(pack.incomplete.join(" ")).toContain("unresolved");
  });
  it.each([false,true])("fails closed on ambiguous alias, including exact-title collision=%s",async exact=>{
    const build=await fixture();await tsmcHub();
    await addExtra(`01_Companies/${exact?"TSM":"OTHER"}.md`,"---\naliases: [TSM]\n---\n# Another issuer");
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("ambiguous_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it.each(["changed","missing"])("refuses %s Hub alias readback",async mode=>{
    const build=await fixture();await tsmcHub();
    const file=path.join(vault,"01_Companies/TSMC.md");
    if(mode==="missing")fs.unlinkSync(file);else fs.writeFileSync(file,"---\naliases: []\n---\n# Changed without reindex");
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("readback_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it("does not silently strip market/exchange/DR qualifiers or substitute a price instrument",async()=>{
    const build=await fixture();await tsmcHub();
    for(const id of ["US:TSM","NYSE:TSM","TH:TSM80","2330.TW","TSM80"]){
      const pack=build({question:id+" earnings",issuers:[id]});
      expect(pack.issuers).toEqual([id]);
      expect(pack.items.some(x=>x.path.includes("TSMC"))).toBe(false);
      expect(pack.issuerResolution[0].status).toBe("unresolved");
    }
  });
  it("allows only an explicit qualified alias as company-context linkage, not security equivalence",async()=>{
    const build=await fixture();await tsmcHub('["US:TSM"]');
    const pack=build({question:"TSM issuer earnings",issuers:["US:TSM"]});
    expect(pack.items.map(x=>x.path)).toContain("01_Companies/TSMC.md");
    expect(pack.issuers).toEqual(["US:TSM"]);
    expect(pack.warnings.join(" ")).toContain("not security/listing equivalence");
  });
  it("keeps MRVL missing roles visible even alongside the complete NVDA control",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Company Research/MRVL historical.md","---\ncompany: MRVL\nsource_type: chatgpt_history\n---\n# MRVL historical earnings");
    const before=fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"));
    const pack=build({question:"NVDA MRVL historical earnings",issuers:["NVDA","MRVL"],maxNotes:16,maxChars:18000});
    expect(pack.items.some(x=>x.path.includes("MRVL historical"))).toBe(true);
    expect(pack.issuerCoverage.find(x=>x.requested==="MRVL")?.missingRoles).toEqual(expect.arrayContaining(["thesis","evidence_register","timeline","source"]));
    expect(pack.issuerCoverage.find(x=>x.requested==="NVDA")?.missingRoles).toEqual([]);
    expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"))).toEqual(before);
  });
  it("never drops invalid issuer scope into an unscoped or macro query",async()=>{
    const build=await fixture();
    const pack=build({question:"NVDA earnings",issuers:["../NVDA"],focus:"macro"});
    expect(pack.issuerResolution[0].status).toBe("invalid_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it.each(["aliases","alias","company_name","ticker"])("reuses explicit %s metadata without adding a curated TSM alias",async field=>{
    const build=await fixture();await tsmcHub("[]");
    await addExtra("01_Companies/TSMC.md",`---\n${field}: TSM\n---\n# TSMC issuer context`);
    expect(build({question:"TSM results",issuers:["TSM"]}).issuerResolution[0].status).toBe("indexed_alias");
  });
  it("does not establish uniqueness from a truncated Hub scan",async()=>{
    const build=await fixture();await tsmcHub();
    const {db}=await import("../db");
    const insert=db().prepare("INSERT INTO notes(path,title,mtime,size,frontmatter) VALUES (?,?,0,0,'{}')");
    db().transaction(()=>{for(let i=0;i<3001;i++)insert.run(`01_Companies/Fixture-${i}.md`,"Fixture");})();
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("index_limit_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it("preserves protected bytes, index rows and auth state across read-only retrieval",async()=>{
    const build=await fixture();await tsmcHub();
    const protectedPaths=["05_Thesis/NVDA - Current Thesis.md","05_Thesis/TSMC - Evidence Register.md",
      "08_Daily_Weekly/Research Indexes/Company Evolution - TSMC.md","06_Portfolio/Account.md","06_Portfolio/Trade.md"];
    for(const p of protectedPaths.slice(3))await addExtra(p,"# Protected synthetic fixture\nNever infer an execution.");
    const bytes=protectedPaths.map(p=>fs.readFileSync(path.join(vault,p)));
    const {db}=await import("../db");
    const before=db().prepare("SELECT * FROM notes ORDER BY path").all();
    const changes=db().prepare("SELECT total_changes() AS n").get();
    for(const issuers of [["TSM"],["NVDA"],["MRVL"],["TH:TSM80"]])build({question:"company earnings and risks",issuers});
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(changes);
    expect(db().prepare("SELECT * FROM notes ORDER BY path").all()).toEqual(before);
    protectedPaths.forEach((p,i)=>expect(fs.readFileSync(path.join(vault,p))).toEqual(bytes[i]));
  });
});

describe("RI-001 macro relevance and archive independence",()=>{
  it.each(["null","[]","42"])("treats non-object legacy index metadata %s as absent, never primary evidence",async metadata=>{
    const build=await fixture();
    const note="10_Knowledge/Macro and Markets/Vietnam GDP legacy.md";
    await addExtra(note,"# Vietnam GDP\nLegacy commentary without primary verification.");
    const {db}=await import("../db");
    db().prepare("UPDATE notes SET frontmatter=? WHERE path=?").run(metadata,note);
    const pack=build({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});
    expect(pack.items.map(x=>x.path)).toContain(note);
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
  it("does not report a counter-evidence heading that was clipped out of the excerpt",async()=>{
    const build=await fixture();
    await addExtra("05_Thesis/NVDA - Evidence Register.md","# NVDA evidence\n"+"x".repeat(2500)+"\n## Counter-evidence\nRisks not in the selected excerpt.");
    const item=build({question:"NVDA evidence",issuers:["NVDA"]}).items.find(x=>x.role==="evidence_register")!;
    expect(item.excerpt).not.toContain("## Counter-evidence");
    expect(item.counterEvidenceExcerptIncluded).toBe(false);
  });
  it("reports bounded recall when many archive hits compete for the lexical window",async()=>{
    const build=await fixture();
    for(let i=0;i<105;i++)await addExtra(`07_Sources/ChatGPT/Vietnam GDP ${i}.md`,"# Vietnam GDP\nVietnam GDP recap.");
    const pack=build({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});
    expect(pack.incomplete.join(" ")).toContain("Search window truncated");
    expect(pack.items.filter(x=>x.evidenceUse==="historical_context_only")).toHaveLength(1);
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
  it("supports a multiword explicit macro scope without broadening to similarly named countries",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/United States GDP.md","# United States GDP\nUnited States GDP release.");
    await addExtra("10_Knowledge/Macro and Markets/United Kingdom GDP.md","# United Kingdom GDP\nUnited Kingdom GDP release.");
    const pack=build({question:"What is the latest United States GDP",industry:"United States macro and markets",focus:"macro"});
    expect(pack.items.some(x=>x.path.includes("United States"))).toBe(true);
    expect(pack.items.some(x=>x.path.includes("United Kingdom"))).toBe(false);
  });
  it("retrieves subject-scoped official candidates ahead of unrelated country releases and AI recaps",async()=>{
    const build=await fixture();
    const target="10_Knowledge/Macro and Markets/Vietnam GDP original.md";
    await addExtra(target,"---\ncountry: Vietnam\nsource_type: primary\nsource_url: https://example.gov/gdp\nverification: not_reverified\n---\n# Vietnam GDP\nVietnam GDP output release.\n## Counter-evidence\nPrior estimates may be revised.");
    for(let i=0;i<12;i++){
      await addExtra(`10_Knowledge/Macro and Markets/Vietnam GDP recap ${i}.md`,"---\ncountry: Vietnam\nsource_type: chatgpt_history\nverification: verified_against_primary\n---\n# Vietnam GDP GDP GDP\nVietnam GDP archived AI recap.");
      await addExtra(`10_Knowledge/Macro and Markets/Vietnam fisheries ${i}.md`,"---\ncountry: Vietnam\nsource_type: primary\nsource_url: https://example.gov/fish\n---\n# Vietnam fisheries\nUnrelated fish landings report.");
    }
    const pack=build({question:"Vietnam GDP",industry:"Vietnam macro and markets",focus:"macro",maxNotes:5});
    expect(pack.items.map(x=>x.path)).toContain(target);
    // H2: country context remains eligible even without subject vocabulary.
    // It has a bounded background slot and cannot displace the requested release.
    const background=pack.items.filter(x=>x.path.includes("fisheries"));
    expect(background.length).toBeLessThanOrEqual(1);
    for(const item of background)expect(pack.items.findIndex(x=>x.path===target)).toBeLessThan(pack.items.indexOf(item));
    expect(pack.items.filter(x=>x.evidenceUse==="historical_context_only").length).toBeLessThanOrEqual(1);
    expect(pack.items.find(x=>x.path===target)?.counterEvidenceExcerptIncluded).toBe(true);
    expect(pack.status).toBe("retrieval_only_not_verified");
  });
  it("does not use an archived primary declaration to fill the macro primary-evidence gap",async()=>{
    const build=await fixture();
    await addExtra("07_Sources/ChatGPT/Vietnam GDP.md","---\ncountry: Vietnam\nsource_type: primary\nsource_url: https://example.gov/gdp\nverification: verified_against_primary\n---\n# Vietnam GDP\nHistorical AI recap only.");
    const pack=build({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});
    expect(pack.items.find(x=>x.path.includes("Vietnam GDP"))?.evidenceUse).toBe("historical_context_only");
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
  it("retains explicitly requested archive history without treating copies as independent evidence",async()=>{
    const build=await fixture();
    for(let i=0;i<7;i++)await addExtra(`10_Knowledge/Macro and Markets/Vietnam GDP archive ${i}.md`,"---\ncountry: Vietnam\nsource_type: chatgpt_export\n---\n# Vietnam GDP historical summary");
    const pack=build({question:"Vietnam GDP historical archive",industry:"Vietnam",focus:"macro"});
    expect(pack.items.filter(x=>x.evidenceUse==="historical_context_only").length).toBeGreaterThan(0);
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
});
async function fixture(){
  const { reindexPath }=await import("./indexer");
  const add=(p:string,raw:string)=>{
    const abs=path.join(vault,p);fs.mkdirSync(path.dirname(abs),{recursive:true});
    fs.writeFileSync(abs,raw);reindexPath(p);
  };
  add("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md",
    "# Evidence and Update Rules\n\nNVDA events must distinguish reported earnings from archived analysis.");
  add("08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md",
    "# Investment Evolution Master\n\nNVDA timeline history and valuation methodology.");
  add("01_Companies/NVDA.md","# NVDA\n\nNVDA business description and Data Center infrastructure.");
  add("05_Thesis/NVDA - Current Thesis.md",
    "---\nverification: not_reverified\nstatus: draft_from_archived_evidence\n---\n# NVDA Thesis\n\nNVDA draft risks and catalysts, not owner endorsed.");
  add("05_Thesis/NVDA - Evidence Register.md",
    "---\nverification: not_reverified\n---\n# Evidence Register\n\nNVDA prior claims; " +
    Array.from({length:24},(_,i)=>"Source claim chronology "+i+".").join("\n") +
    "\n## ข้อขัดแย้งที่ต้องอ่านร่วมกัน\nCustomer monetization not independently verified; GPU competitors and margin pressure.");
  add("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
    "# NVDA Evolution\n\nNVDA earnings event and margin progression.");
  add("08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2.md",
    "---\nverification: verified_against_primary\nevent_date: 2026-08-26\npublished_at: 2026-08-26\n---\n# NVDA Earnings\n\nNVDA FY27Q2 company revenue, not analyst consensus.");
  add("02_Industries_Themes/AI Infrastructure.md",
    "# AI Infrastructure\n\nNVDA GPU industry demand and capacity tradeoffs.");
  for(let n=0;n<12;n++)add("07_Sources/ChatGPT/Entries/Archive-"+n+".md",
    "# Chat quote NVDA\n\nNVDA revenue rumor duplicate NVDA rumors.");
  const {buildInvestmentContextPack}=await import("./investment-context");
  return buildInvestmentContextPack;
}
async function addExtra(p:string,raw:string){
  const abs=path.join(vault,p);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,raw);
  const {reindexPath}=await import("./indexer");
  reindexPath(p);
}
describe("investment context retrieval",()=>{
  it("reads issuer, draft thesis, evidence, industry and company timeline before archive duplicates",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA earnings and GPU capacity risk",issuers:["NVDA"],focus:"earnings",maxNotes:11,maxChars:12000});
    const paths=p.items.map(x=>x.path);
    expect(p.status).toBe("retrieval_only_not_verified");
    expect(paths).toContain("05_Thesis/NVDA - Current Thesis.md");
    expect(paths).toContain("05_Thesis/NVDA - Evidence Register.md");
    expect(paths).toContain("08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2.md");
    expect(paths).toContain("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md");
    expect(paths.filter(x=>x.startsWith("07_Sources/ChatGPT/"))).toHaveLength(0);
    expect(p.items.find(x=>x.role==="thesis")?.declaredVerification).toBe("not_reverified");
    expect(p.items.find(x=>x.role==="thesis")?.schemaCompatibility.role).toBe("thesis");
    expect(p.items.find(x=>x.role==="thesis")?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
    expect(p.items.find(x=>x.role==="source")?.schemaCompatibility.declaredVerification).toBe("verified_against_primary");
  });
  it("returns counter-evidence passage with its own source line pointer, not just a flattering lead excerpt",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA earnings",issuers:["NVDA"],maxNotes:11,maxChars:12000});
    const evidence=p.items.find(x=>x.role==="evidence_register");
    expect(evidence).toBeDefined();
    expect(evidence?.counterEvidenceExcerptIncluded).toBe(true);
    expect(evidence?.excerpt).toContain("Counter-evidence / risk section: source lines");
    expect(evidence?.excerpt).toContain("Customer monetization not independently verified");
  });
  it("stays within requested excerpt and note caps even when many archives match",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA GPU",issuers:["NVDA"],maxNotes:5,maxChars:4500});
    expect(p.selected).toBeLessThanOrEqual(5);
    expect(p.excerptChars).toBeLessThanOrEqual(4500);
    expect(p.omitted.length).toBeGreaterThan(0);
  });
  it("marks absent required roles rather than silently inventing thesis or sources",async()=>{
    const build=await fixture();
    const p=build({question:"ZZZZ company earnings",issuers:["ZZZZ"],maxNotes:10});
    expect(p.incomplete.some(x=>x.includes("ZZZZ"))).toBe(true);
    expect(p.incomplete.some(x=>x.includes("No Current Thesis"))).toBe(true);
  });
  it("never promotes an archived verification flag to independently verified facts",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA earnings",issuers:["NVDA"]});
    expect(p.warnings.join(" ")).toContain("not");
    expect(p.items.find(x=>x.role==="thesis")?.declaredVerification).toBe("not_reverified");
    expect(p.items.find(x=>x.role==="source")?.declaredVerification).toBe("verified_against_primary");
  });
  it("distinguishes issuer JPM from broker JPM and rejects another issuer's timeline",async()=>{
    const build=await fixture();
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - AAPL.md",
      "# AAPL evolution\nJPM broker research on consumer devices, not JPMorgan bank earnings.");
    await addExtra("10_Knowledge/Industry and Concepts/JPM Hardware Model.md",
      "# JPM Hardware Model\nJPM technology research on optical networking and cloud hardware.");
    await addExtra("10_Knowledge/Company Research/JPM - Bank Credit Losses.md",
      "# JPM bank credit risk\nJPMorgan banking, bank lending credit losses and earnings.");
    await addExtra("10_Knowledge/Company Research/ASML - JPM Q3 Preview.md",
      "# ASML semiconductor estimates\nJPM research Q3 preview on ASML chip equipment; not JPM bank results.");
    const p=build({question:"JPM banking loan growth and credit losses",
      issuers:["JPM"],industry:"banking",focus:"earnings",maxNotes:12});
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain("10_Knowledge/Company Research/JPM - Bank Credit Losses.md");
    expect(paths).not.toContain("08_Daily_Weekly/Research Indexes/Company Evolution - AAPL.md");
    expect(paths).not.toContain("10_Knowledge/Industry and Concepts/JPM Hardware Model.md");
    expect(paths).not.toContain("10_Knowledge/Company Research/ASML - JPM Q3 Preview.md");
    expect(p.incomplete).toContain("No Current Thesis selected; owner-endorsed thesis is unknown.");
  });
  it("anchors a country macro query and does not request a company Current Thesis",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/2026-10 - Vietnam GDP.md",
      "# Vietnam GDP macro growth\nVietnam policy, GDP and central bank liquidity.");
    await addExtra("10_Knowledge/Macro and Markets/2026-10 - US CMBS.md",
      "# US CMBS macro\nUnited States property debt and GDP liquidity.");
    await addExtra("01_Companies/NVO.md",
      "# NVO company\nHealthcare developments and incidental Vietnam mention.");
    const p=build({question:"Vietnam GDP economic growth and central bank liquidity",
      industry:"Vietnam macro and markets",focus:"macro",maxNotes:12});
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain("10_Knowledge/Macro and Markets/2026-10 - Vietnam GDP.md");
    expect(paths).not.toContain("10_Knowledge/Macro and Markets/2026-10 - US CMBS.md");
    expect(paths).not.toContain("01_Companies/NVO.md");
    expect(p.incomplete.some(x=>x.includes("Current Thesis")||x.includes("Evidence Register"))).toBe(false);
  });
  it("excludes incidental country mentions in Japan and US-Russia headlines and surfaces missing macro primary-source evidence",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/2026-10-04 - Japan BOJ forecast.md",
      "# Japan monetary outlook\nJapan interest-rate forecast; Vietnam is mentioned once in a broader ASEAN note.");
    await addExtra("10_Knowledge/Macro and Markets/2026-10-04 - US-Russia oil deal.md",
      "# US Russia crude\nTrade pact news; Vietnam is incidental, not the main economic topic.");
    await addExtra("10_Knowledge/Macro and Markets/2026-10-03 - Vietnam GDP Q3.md",
      "# Vietnam GDP third quarter\nHistorical Vietnam macro commentary, without an original official primary source URL.");
    const p=build({question:"Vietnam GDP third quarter economic growth and bank liquidity",
      industry:"Vietnam macro and markets",focus:"macro",maxNotes:10});
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain("10_Knowledge/Macro and Markets/2026-10-03 - Vietnam GDP Q3.md");
    expect(paths).not.toContain("10_Knowledge/Macro and Markets/2026-10-04 - Japan BOJ forecast.md");
    expect(paths).not.toContain("10_Knowledge/Macro and Markets/2026-10-04 - US-Russia oil deal.md");
    expect(p.incomplete.some(x=>x.includes("primary macro/statistical"))).toBe(true);
  });
  it("recognizes a country-scoped original primary statistical note without claiming its figures were reverified",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/2026-10-07 - Vietnam official GDP 2026Q3.md",
      `---
domain: macro
country: Vietnam
source_type: primary
source_url: https://www.nso.gov.vn/official-gdp
verification: not_reverified
published_at: 2026-10-07
---
# Vietnam original GDP quarterly statistics
Official-file source candidate (no verified numeric facts in this synthetic test).`);
    await addExtra("10_Knowledge/Macro and Markets/2026-10-08 - Vietnam GDP Bot recap.md",
      "# Vietnam GDP commentary\nVietnam GDP growth Q3 2026 official release repost commentary without source verification.");
    const p=build({question:"Vietnam GDP 2026Q3 official release",industry:"Vietnam macro and markets",focus:"macro",maxNotes:10});
    expect(p.items.some(x=>x.path==="10_Knowledge/Macro and Markets/2026-10-07 - Vietnam official GDP 2026Q3.md")).toBe(true);
    const paths=p.items.map(x=>x.path);
    expect(paths.indexOf("10_Knowledge/Macro and Markets/2026-10-07 - Vietnam official GDP 2026Q3.md"))
      .toBeLessThan(paths.indexOf("10_Knowledge/Macro and Markets/2026-10-08 - Vietnam GDP Bot recap.md"));
    expect(p.incomplete.some(x=>x.includes("primary macro/statistical"))).toBe(true);
    expect(p.status).toBe("retrieval_only_not_verified");
    expect(p.items.find(x=>x.path.includes("official GDP"))?.declaredVerification).toBe("not_reverified");
  });
  it("rejects absent research question",async()=>{
    const build=await fixture();
    expect(()=>build({question:"  "})).toThrow(/Question/);
  });
});


describe("legacy Company Index routing across both retained Vault locations", () => {
  it("retrieves a canonical older history index and never falsely reports it missing", async () => {
    const build=await fixture();
    const legacy="10_Knowledge/Indexes/Company - NVDA.md";
    await addExtra(legacy,"# Company - NVDA\\n\\nArchived historical NVIDIA source-linked events; not new issuer verification.");
    const p=build({question:"NVDA historical investment research", issuers:["NVDA"], maxNotes:16});
    expect(p.items.map(x=>x.path)).toContain(legacy);
    expect(p.incomplete.some(x=>x.includes("No legacy Company Index found for NVDA"))).toBe(false);
    expect(p.incomplete).not.toContain("08_Daily_Weekly/Research Indexes/Company - NVDA.md");
    // Old navigation must not be mistaken for independently verified primary evidence.
    expect(p.items.find(x=>x.path===legacy)?.role).toBe("research");
    expect(p.items.find(x=>x.path===legacy)?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
  });
  it("preserves discoverability of both indexes if both coexist without bulk moving history", async () => {
    const build=await fixture();
    const newer="08_Daily_Weekly/Research Indexes/Company - NVDA.md";
    const older="10_Knowledge/Indexes/Company - NVDA.md";
    await addExtra(newer,"# Newer navigational view NVDA\\nExisting source note links.");
    await addExtra(older,"# Older navigational view NVDA\\nHistorical chat event links.");
    const p=build({question:"NVDA historic company events", issuers:["NVDA"],maxNotes:16});
    expect(p.items.map(x=>x.path)).toContain(newer);
    expect(p.items.map(x=>x.path)).toContain(older);
    expect(p.incomplete.some(x=>x.includes("No legacy Company Index"))).toBe(false);
  });
});


describe("old event retrieval for safe new-input reconciliation", () => {
  it("prefers the original CRWD × CLEAR archived analysis over generic CRWD recaps", async () => {
    const build=await fixture();
    await addExtra("01_Companies/CRWD.md", "# CRWD\nCrowdStrike enterprise cybersecurity.");
    const eventPath="10_Knowledge/Company Research/2026-08-31 - CrowdStrike × CLEAR - Stock160726-190.md";
    await addExtra(eventPath, [
      "---", "type: knowledge_note", "company: [CRWD]", "verification: not_reverified",
      "source_records:", "  - 07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0190.md",
      "---", "# CrowdStrike × CLEAR biometric identity partnership",
      "CRWD x CLEAR archived user conversation, not issuer verified."
    ].join("\n"));
    await addExtra("10_Knowledge/Company Research/CRWD - Generic software recap.md",
      "# CRWD software overview\nHistoric CRWD AI security growth overview; no CLEAR partnership.");
    await addExtra("10_Knowledge/Company Research/ASML - CLEAR wafer process.md",
      "# ASML CLEAR wafer process\nASML source unrelated to CRWD security.");
    const p=build({
      question:"CRWD CrowdStrike CLEAR biometric identity partnership Stock160726 190",
      issuers:["CRWD"],maxNotes:14,maxChars:14000
    });
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain(eventPath);
    expect(paths).not.toContain("10_Knowledge/Company Research/ASML - CLEAR wafer process.md");
    const event=p.items.find(x=>x.path===eventPath);
    expect(event?.declaredVerification).toBe("not_reverified");
    expect(event?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
  });
});


describe("multi-issuer archived research matching", () => {
  it("retains a jointly tagged INTC/CRWD archived security event for the CRWD question", async () => {
    const build=await fixture();
    const target="10_Knowledge/Company Research/2026-09-02 - INTC × CRWD security.md";
    await addExtra(target, [
      "---", "company: [INTC, CRWD]", "verification: not_reverified", "---",
      "# Intel INTC and CRWD security",
      "CRWD silicon and cloud security discussion from archived chat, not issuer verified."
    ].join("\n"));
    const p=build({question:"CRWD INTC silicon security historical event",issuers:["CRWD"],maxNotes:14});
    // R4 restores the pre-R3 positive contract; joint subjects are not merely
    // incidental related metadata. Selection remains unverified history only.
    expect(p.items.map(x=>x.path)).toContain(target);
    expect(p.items.find(x=>x.path===target)?.declaredVerification).toBe("not_reverified");
    expect(p.items.find(x=>x.path===target)?.evidenceUse).toBe("historical_context_only");
    expect(p.items.find(x=>x.path===target)?.sourceBinding).toBeUndefined();
    expect(p.researchFallback.candidates.some(x=>x.path===target)).toBe(false);
  });
});


describe("bounded canonical Timeline → Industry retrieval",()=>{
  it("selects the exact linked existing Industry even when issuer question lacks sector terms",async()=>{
    const build=await fixture();
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
      "# NVDA Evolution\nNVDA earnings\n[[02_Industries_Themes/AI Infrastructure|AI Infrastructure]]");
    const pack=build({question:"NVDA company cash conversion and valuation risk",issuers:["NVDA"],maxNotes:12,maxChars:16000});
    expect(pack.items.map(x=>x.path)).toContain("02_Industries_Themes/AI Infrastructure.md");
    expect(pack.items.find(x=>x.path==="02_Industries_Themes/AI Infrastructure.md")?.role).toBe("industry");
    expect(pack.incomplete.some(x=>x.includes("No industry/TAM"))).toBe(false);
  });
  it("ignores incidental co-mention and a nonexistent/noncanonical Industry link",async()=>{
    const build=await fixture();
    await addExtra("02_Industries_Themes/Unrelated Banking.md",
      "# Unrelated Banking\nLegacy banking note also says NVDA but is not linked from NVIDIA's Timeline.");
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
      "# NVDA\n[[02_Industries_Themes/AI Infrastructure]]\n[[02_Industries_Themes/Nonexistent Concept]]");
    const pack=build({question:"NVDA operating cash generation",issuers:["NVDA"],maxNotes:12,maxChars:16000});
    expect(pack.items.map(x=>x.path)).toContain("02_Industries_Themes/AI Infrastructure.md");
    expect(pack.items.map(x=>x.path)).not.toContain("02_Industries_Themes/Unrelated Banking.md");
    expect(pack.items.map(x=>x.path)).not.toContain("02_Industries_Themes/Nonexistent Concept.md");
  });
  it("honors caller's explicitly supplied different industry scope over inherited Timeline link",async()=>{
    const build=await fixture();
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
      "# NVDA Evolution\n[[02_Industries_Themes/AI Infrastructure]]");
    await addExtra("02_Industries_Themes/Optical.md","# Optical research\nNo direct NVIDIA AI infrastructure connection asserted.");
    const pack=build({question:"NVDA optical packaging supply",issuers:["NVDA"],industry:"Optical",maxNotes:12,maxChars:16000});
    expect(pack.items.map(x=>x.path)).not.toContain("02_Industries_Themes/AI Infrastructure.md");
  });
});

// P0-RS: NEW SYNTHETIC fixtures, NOT bytes/receipts of the real Nov02 note.
// No writer/prepare/approval calls; these test bounded retrieval mechanics only.
const p0Id="IN-1D4C8B163A1DDB49";
async function p0Fixture(issuer="NVDA",date="2026-11-02",period="FY27Q3"){
  const build=await fixture();
  if(issuer!=="NVDA")await addExtra(`01_Companies/${issuer}.md`,`# ${issuer} synthetic issuer`);
  const review=`10_Knowledge/Company Research/Investment Review - ${issuer} - ${p0Id}.md`;
  const intake=`00_Inbox/ChatGPT/Investment Intake - ${p0Id}.md`;
  await addExtra(intake,`---\ntype: investment_source_intake\nintake_id: ${p0Id}\nsource_url: null\nevent_date: null\n---\n# Synthetic unreceipted intake\n${issuer} historical AI synthesis. No original issuer document or receipt.\n`);
  await addExtra(review,`---\ntype: investment_research_review\nintake_id: ${p0Id}\ncompany: [${issuer}]\nsource_type: chatgpt_analysis\nverification: not_reverified\nevent_date: null\npublished_at: null\nanalysis_created_at: ${date}T00:00:00.000Z\nknowledge_cutoff_as_of: ${date}T00:00:00.000Z\n---\n# ${issuer} ${period} baseline — SYNTHETIC FIXTURE\nHistorical AI analysis, not primary evidence. FAVORABLE/Medium is an old analytical opinion. $204.64 dated Oct30 and FY27/FY28 P/E are historical unverified examples, not current consensus.\n${"Historical baseline detail. ".repeat(35)}\nAI Infrastructure\n## Counter-evidence\nUnverified earlier assumptions require new source evidence.\n`);
  return {build,review,intake,issuer,date,period};
}
async function p0Record(id:string,pack:unknown,extra:unknown={}){
  if(!process.env.P0_EVIDENCE_DIR)return;
  const {createHash}=await import("node:crypto"),hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
  const paths=fs.readdirSync(vault,{recursive:true}).filter((p):p is string=>typeof p==="string"&&p.endsWith(".md")).sort();
  const manifest=paths.map(p=>({path:p,sha256:hash(fs.readFileSync(path.join(vault,p)))}));
  const {db}=await import("../db");
  const index=db().prepare("SELECT path,frontmatter FROM notes ORDER BY path").all();
  const fts=db().prepare("SELECT path,title,body FROM notes_fts ORDER BY path").all();
  fs.mkdirSync(process.env.P0_EVIDENCE_DIR,{recursive:true});
  fs.writeFileSync(path.join(process.env.P0_EVIDENCE_DIR,id+".json"),JSON.stringify({id,target_kind:"candidate_source",fixture_kind:"NEW_SYNTHETIC_NOT_ORIGINAL_VAULT",manifest,fixture_hash:hash(JSON.stringify(manifest)),index_hash:hash(JSON.stringify({index,fts})),output_hash:hash(JSON.stringify(pack)),pack,extra},null,2));
}
describe("P0 oracle v0.2 candidate-only retrieval",()=>{
  it.each([undefined,"AI Infrastructure"])("R01/R02 legacy positive industry=%s: selected without a Source receipt",async industry=>{
    const f=await p0Fixture();const {db}=await import("../db");
    const before=db().prepare("SELECT total_changes() n").get();
    const protectedPath=path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),bytes=fs.readFileSync(protectedPath);
    const request={question:"NVDA Nov02 FY27Q3 historical baseline and earnings",issuers:["NVDA"],industry,maxNotes:16,maxChars:18000};
    const pack=f.build(request);await p0Record(industry?"R02-industry":"R02-null",pack,{request});
    expect(pack.items.find(x=>x.path===f.review)).toMatchObject({evidenceUse:"historical_context_only",declaredVerification:"not_reverified",researchTrust:{usage_tier:"historical_analysis_only",independent_evidence_increment:0,comparator_eligible:false,primary_authority:false,analysis_as_of:"2026-11-02T00:00:00.000Z"},chronology:{eventDate:{status:"UNKNOWN",value:null},publicationDate:{status:"UNKNOWN",value:null}}});
    expect(pack.contextBundles[0]).toMatchObject({status:"HOLD",reason:"legacy_review_scope_missing",sourcePath:null,sourceReceiptId:null,reviewReceiptId:null});
    expect(pack.items.map(x=>x.path)).not.toContain(f.intake);
    expect(db().prepare("SELECT 1 FROM sqlite_master WHERE name='safe_edit_operations'").get()).toBeUndefined();
    expect(db().prepare("SELECT total_changes() n").get()).toEqual(before);expect(fs.readFileSync(protectedPath)).toEqual(bytes);
  });
  it("R01 original-style earnings query retains the dated historical baseline",async()=>{
    const f=await p0Fixture(),p=f.build({question:"NVDA earnings revenue cash risks",issuers:["NVDA"],industry:"AI Infrastructure",focus:"earnings",maxNotes:12});
    await p0Record("R01",p);expect(p.items.some(x=>x.path===f.review)||p.researchFallback.candidates.some(x=>x.path===f.review)).toBe(true);
  });
  it.each(["no_match","flood"])("R05 eligible issuer analysis survives industry %s without admitting ASML or Optical override",async variant=>{
    const f=await p0Fixture();const target="10_Knowledge/Company Research/NVDA - Prior baseline detail.md";
    await addExtra(target,"---\ncompany: [NVDA]\nsource_type: chatgpt_analysis\nverification: not_reverified\n---\n# NVDA prior baseline detail\nHistorical attributed analysis. "+(variant==="flood"?"AI Infrastructure "+"long history ".repeat(300):""));
    if(variant==="flood")for(let i=0;i<121;i++)await addExtra(`07_Sources/ChatGPT/Entries/P0Flood${i}.md`,"# AI Infrastructure\n"+"AI Infrastructure ".repeat(20));
    await addExtra("10_Knowledge/Company Research/ASML - NVDA prior baseline.md","# ASML issuer\nNVDA is a customer reference, not issuer identity.");
    const p=f.build({question:"NVDA prior baseline detail",issuers:["NVDA"],industry:variant==="flood"?"AI Infrastructure":"Optical",maxNotes:16,maxChars:18000});
    await p0Record("R05-"+variant,p);
    expect(p.items.map(x=>x.path)).toContain(target);expect(p.items.map(x=>x.path)).not.toContain("10_Knowledge/Company Research/ASML - NVDA prior baseline.md");
    if(variant==="no_match")expect(p.items.map(x=>x.path)).not.toContain("02_Industries_Themes/AI Infrastructure.md");
  });
  it.each([5,12,16])("R03 real FTS flood per-term window / cap %s and exclusive diagnostics",async maxNotes=>{
    const f=await p0Fixture();
    for(let i=0;i<121;i++)await addExtra(`07_Sources/ChatGPT/Entries/P0Flood${i}.md`,"# AI Infrastructure\n"+"AI Infrastructure ".repeat(20));
    const {searchVault}=await import("./queries");
    const windows=["AI","Infrastructure"].map(term=>({term,result:searchVault(term,{limit:100}),ordered:searchVault(term,{limit:100,offset:100})}));
    for(const {result} of windows){expect(result.total).toBeGreaterThanOrEqual(122);expect(result.hits).toHaveLength(100);expect(result.hits.every(x=>x.path.includes("P0Flood"))).toBe(true);}
    const p=f.build({question:"NVDA Nov02 FY27Q3 baseline",issuers:["NVDA"],industry:"AI Infrastructure",maxNotes,maxChars:18000});
    await p0Record("R03-"+maxNotes,p,{windows});
    expect(p.items.some(x=>x.path===f.review)||p.researchFallback.candidates.some(x=>x.path===f.review)).toBe(true);
    expect(p.discovery.reasons).toContain("fts_window_truncated");
    expect(p.discovery.coverage_incomplete).toBe(true);expect(p.discovery.countsStatus).toBe("COUNTS_UNRECONCILED");
    expect(p.discovery.uniqueDiscoveredPaths).toBeNull();
    expect(Object.values(p.discovery.observedTerminalCounts).reduce((a,b)=>a+b,0)).toBe(p.discovery.observedUniquePaths);
    expect(new Set(p.discovery.paths.map(x=>x.path)).size).toBe(p.discovery.paths.length);
    expect(p.discovery.paths.find(x=>x.path===f.review)?.disposition).toMatch(/SELECTED|FALLBACK_EXPOSED/);
  });
  it("R03 small control retains bounded omissions and separate trust flags",async()=>{
    const f=await p0Fixture(),p=f.build({question:"NVDA baseline FY27Q3",issuers:["NVDA"],maxNotes:5});
    await p0Record("R03-small",p);
    expect(p.discovery.paths.find(x=>x.path===f.review)).toMatchObject({disposition:"SELECTED",reasons:expect.arrayContaining(["legacy_review_scope_unverified","restricted_low_trust"])});
    expect(p.discovery.paths.some(x=>x.disposition==="OMITTED_BUDGET"||x.disposition==="FALLBACK_EXPOSED")).toBe(true);
  });
  it("R06 forged company/primary verification remains restricted, never receipted",async()=>{
    const f=await p0Fixture();await addExtra(f.review,fs.readFileSync(path.join(vault,f.review),"utf8").replace("source_type: chatgpt_analysis","source_type: primary\nreview_scope: company").replace("verification: not_reverified","verification: verified"));
    const p=f.build({question:"NVDA baseline",issuers:["NVDA"],maxNotes:16});await p0Record("R06",p);
    expect(p.contextBundles.every(b=>b.status==="HOLD"&&b.reviewReceiptId===null&&b.sourceReceiptId===null)).toBe(true);
    expect(p.items.find(x=>x.path===f.review)?.researchTrust).toMatchObject({primary_authority:false,comparator_eligible:false,independent_evidence_increment:0});
    expect(p.discovery.paths.find(x=>x.path===f.review)?.reasons).toContain("receipt_binding_unverified");
  });
  it("R07 finite empty canonical scope is explicit, without claiming whole Vault absence",async()=>{
    const build=await fixture(),p=build({question:"NVDA baseline",issuers:["NVDA"],maxNotes:16});await p0Record("R07-absent",p);
    expect(p.researchCoverage[0].canonicalReview).toMatchObject({status:"NOT_FOUND",scanComplete:true,finding:"NOT_FOUND_WITHIN_VERIFIED_SCOPE"});
    expect(p.discovery.countsStatus).toBe("COUNTS_UNRECONCILED");
    expect(p.discovery.coverage_incomplete).toBe(true);
  });
  it("R07 malformed scope twin is incomplete rather than false absence",async()=>{
    const f=await p0Fixture();await addExtra(f.review,"---\ntype: unknown\n---\n# NVDA baseline\nUnclassifiable metadata.");
    const p=f.build({question:"NVDA baseline",issuers:["NVDA"]});await p0Record("R07-incomplete",p);
    expect(p.items.map(x=>x.path)).not.toContain(f.review);
    expect(p.researchCoverage[0].canonicalReview).toMatchObject({status:"SCAN_INCOMPLETE",finding:"SCAN_INCOMPLETE"});
    expect(p.discovery.paths.find(x=>x.path===f.review)).toMatchObject({disposition:"OTHER_EXCLUDED",reasons:expect.arrayContaining(["canonical_not_admitted"])});
  });
  it.each(["deleted","read_error","index_drift"])("required %s cannot be rescued as a budget omission",async fault=>{
    const f=await p0Fixture();const notes=await import("./notes");let spy:ReturnType<typeof vi.spyOn>|undefined;
    if(fault==="deleted")fs.unlinkSync(path.join(vault,f.review));
    if(fault==="index_drift")fs.writeFileSync(path.join(vault,f.review),"---\ncompany: [ASML]\n---\n# Changed without index\nNVDA");
    if(fault==="read_error"){const read=notes.readNote;spy=vi.spyOn(notes,"readNote").mockImplementation(p=>{if(p===f.review)throw Error("DO_NOT_LEAK_PRIVATE_ERROR");return read(p);});}
    try{const p=f.build({question:"NVDA baseline",issuers:["NVDA"]});await p0Record("read-"+fault,p);
      expect(p.retrieval.status).toBe("operational_hold");expect(p.items.map(x=>x.path)).not.toContain(f.review);
      expect(p.discovery.paths.find(x=>x.path===f.review)?.disposition).toBe("READBACK_HOLD");expect(JSON.stringify(p)).not.toContain("DO_NOT_LEAK_PRIVATE_ERROR");
    }finally{spy?.mockRestore();}
  });
  it.each(["NVDA","TESTX"])("R04 metamorphic historical trust for %s never gains primary authority",async issuer=>{
    const f=await p0Fixture(issuer,issuer==="NVDA"?"2026-11-02":"2025-07-03",issuer==="NVDA"?"FY27Q3":"FY26Q1");
    const p=f.build({question:`${issuer} ${f.period} baseline`,issuers:[issuer],maxNotes:16});await p0Record("R04-"+issuer,p);
    expect(p.items.find(x=>x.path===f.review)).toMatchObject({evidenceUse:"historical_context_only",researchTrust:{independent_evidence_increment:0,comparator_eligible:false,primary_authority:false,owner_thesis_authority:false}});
  });
  it("new industry exception rechecks physical issuer metadata before selection",async()=>{
    const f=await p0Fixture(),target="10_Knowledge/Company Research/NVDA - Drift detail.md";
    await addExtra(target,"---\ncompany: [NVDA]\n---\n# NVDA drift detail\nHistorical only.");
    fs.writeFileSync(path.join(vault,target),"---\ncompany: [ASML]\n---\n# ASML current bytes");
    const p=f.build({question:"NVDA drift detail",issuers:["NVDA"],industry:"Optical",maxNotes:16});await p0Record("industry-readback-drift",p);
    expect(p.items.map(x=>x.path)).not.toContain(target);expect(p.retrieval.status).toBe("operational_complete");
    expect(p.discovery.paths.find(x=>x.path===target)?.disposition).toBe("READBACK_HOLD");
  });
  it("bounded details truncate without losing aggregate counts or certifying absence",async()=>{
    const f=await p0Fixture();for(let i=0;i<85;i++)await addExtra(`10_Knowledge/Company Research/NVDA - Detail ${i}.md`,"# NVDA historical detail");
    const p=f.build({question:"NVDA historical detail",issuers:["NVDA"],industry:"Optical",maxNotes:5});await p0Record("bounded-details",p);
    expect(p.discovery.paths).toHaveLength(64);expect(p.discovery.detailsTruncated).toBe(true);expect(p.discovery.observedUniquePaths).toBeGreaterThan(64);
    expect(Object.values(p.discovery.observedTerminalCounts).reduce((a,b)=>a+b,0)).toBe(p.discovery.observedUniquePaths);
    expect(p.discovery.coverage_incomplete).toBe(true);expect(p.discovery.uniqueDiscoveredPaths).toBeNull();
  });
  it("selected history hashes change under the existing read-only Judge witness",async()=>{
    const f=await p0Fixture();const {judgeScopeWitness}=await import("./research-judge-scope");
    const req={question:"NVDA FY27Q3 baseline",issuers:["NVDA"],maxNotes:5};
    const before=judgeScopeWitness(f.build(req));
    await addExtra(f.review,fs.readFileSync(path.join(vault,f.review),"utf8")+"\nSynthetic later counter-evidence.\n");
    const after=judgeScopeWitness(f.build(req));await p0Record("selected-history-freshness",after,{before});
    expect(before.selection.find(x=>x.path===f.review)?.sha256).not.toBe(after.selection.find(x=>x.path===f.review)?.sha256);
    expect(before).not.toEqual(after);
  });

});

// R2: new synthetic mechanics. Metadata shape follows ORCH's read-only report;
// none of these bytes, counts or receipts are a copy of the installed Vault.
const r2Question="NVDA FY27Q3 November 17 earnings baseline November 2 historical analyst synthesis";
async function r2Nov02(count=3){
  const f=await p0Fixture();
  await addExtra(f.review,fs.readFileSync(path.join(vault,f.review),"utf8")
    .replace("published_at: null","published_at: 2026-11-02\nsource_kind: archived_chat\nreview_scope: company"));
  for(let i=1;i<count;i++){
    const id=`IN-${String(i).padStart(16,"0")}`;
    await addExtra(`10_Knowledge/Company Research/Investment Review - NVDA - ${id}.md`,
      `---\ntype: investment_research_review\nintake_id: ${id}\nreview_scope: company\ncompany: [NVDA]\npublished_at: 2026-11-${String(3+i).padStart(2,"0")}\nevent_date: null\nsource_type: chatgpt_analysis\nsource_kind: archived_chat\nverification: not_reverified\n---\n# NVDA historical analyst synthesis — SYNTHETIC ONLY\nFY27Q3 November earnings baseline. No receipt or primary verification asserted.\n`);
  }
  return f;
}
describe("P0 R2 narrow remediation",()=>{
  it.each([undefined,"AI Infrastructure"])("actual-metadata-shaped 3-review control industry=%s",async industry=>{
    const f=await r2Nov02(),request={question:r2Question,issuers:["NVDA"],industry,focus:"earnings" as const,maxNotes:16,maxChars:18000};
    const p=f.build(request);await p0Record("R2-actual-shape-"+(industry?"industry":"none"),p,{request,actual_runtime_root_cause:"NOT_ESTABLISHED_BY_SYNTHETIC_FIXTURE"});
    expect(p.items.find(x=>x.path===f.review)).toMatchObject({evidenceUse:"historical_context_only",chronology:{publicationDate:{value:"2026-11-02"},eventDate:{value:null}},researchTrust:{primary_authority:false,independent_evidence_increment:0,comparator_eligible:false}});
    expect(p.contextBundles.find(b=>b.reviewPath===f.review)).toMatchObject({status:"HOLD",reviewReceiptId:null,sourceReceiptId:null});
  });
  it("9+ canonical helper overflow exposes unread path only as a diagnostic HOLD",async()=>{
    const f=await r2Nov02(10),notes=await import("./notes"),spy=vi.spyOn(notes,"readNote");
    try{
      const p=f.build({question:r2Question,issuers:["NVDA"],industry:"AI Infrastructure",focus:"earnings",maxNotes:16,maxChars:18000});
      const targetReads=spy.mock.calls.filter(([p])=>p===f.review).length;
      await p0Record("R2-overflow",p,{targetReads,canonicalCount:10});
      expect(targetReads).toBe(0);expect(p.items.map(x=>x.path)).not.toContain(f.review);
      expect(p.researchCoverage[0].canonicalReview.scanComplete).toBe(false);
      expect(p.researchFallback.candidates.find(x=>x.path===f.review)).toMatchObject({bindingStatus:"HOLD",reason:"canonical_read_limit",sha256:null,receiptId:null,researchTrust:null,accessStatus:"AVAILABLE_NOT_RETRIEVED",metadataBasis:"index_only_unverified"});
      expect(p.discovery.paths.find(x=>x.path===f.review)?.reasons).toContain("canonical_read_limit");
      expect(p.discovery.paths.find(x=>x.path===f.review)?.reasons).not.toContain("receipt_binding_unverified");
    }finally{spy.mockRestore();}
  });
  it("optional historical stale index has candidate READBACK_HOLD without required operational HOLD",async()=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - Optional detail.md";
    await addExtra(target,"---\ncompany: [NVDA]\nsource_type: chatgpt_analysis\nverification: not_reverified\n---\n# NVDA optional detail\nHistorical analysis only.");
    fs.writeFileSync(path.join(vault,target),"---\ncompany: [ASML]\n---\n# Changed without reindex");
    const p=build({question:"NVDA optional detail",issuers:["NVDA"],industry:"Optical",maxNotes:16});await p0Record("R2-optional-stale",p);
    expect(p.items.map(x=>x.path)).not.toContain(target);
    expect(p.discovery.paths.find(x=>x.path===target)?.disposition).toBe("READBACK_HOLD");
    expect(p.retrieval.status).toBe("operational_complete");
    expect(p.retrieval.failures.some(x=>x.path===target)).toBe(false);
    expect(p.researchCoverage[0].counterEvidence.scanComplete).toBe(false);
  });
  it.each([undefined,"Optical"])("incidental AMD/NVDA and ASML spoof rejected industry=%s",async industry=>{
    const build=await fixture();
    const paths=["10_Knowledge/Company Research/AMD - NVDA customer detail.md","10_Knowledge/Company Research/ASML - NVDA spoof detail.md"];
    await addExtra(paths[0],"---\ncompany: [AMD, NVDA]\nsource_type: chatgpt_analysis\n---\n# AMD supplier detail\nNVDA is incidental only.");
    await addExtra(paths[1],"---\ncompany: [NVDA]\nsource_type: primary\nverification: verified\n---\n# ASML actual subject\nNVDA metadata is deliberately spoofed.");
    const p=build({question:"NVDA customer spoof detail",issuers:["NVDA"],industry,maxNotes:16});await p0Record("R2-issuer-spoof-"+(industry??"none"),p);
    for(const target of paths)expect(p.items.map(x=>x.path)).not.toContain(target);
    expect(p.researchFallback.candidates.find(x=>x.path===paths[0])).toMatchObject({kind:"historical_related",bindingStatus:"HOLD",issuerAttribution:"not_established"});
    expect(p.researchFallback.candidates.map(x=>x.path)).not.toContain(paths[1]);
  });
  it("industry exception with forged verification remains historical and cannot fill primary authority",async()=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - Attributed detail.md";
    await addExtra(target,"---\ncompany: [NVDA]\nsource_type: primary\nverification: verified\n---\n# NVDA attributed detail\nUnverified caller declaration, not a primary receipt.");
    const p=build({question:"NVDA attributed detail",issuers:["NVDA"],industry:"Optical",maxNotes:16});await p0Record("R2-forged-trust",p);
    const item=p.items.find(x=>x.path===target)!;expect(item.evidenceUse).toBe("historical_context_only");
    expect(item.researchTrust?.primary_authority??false).toBe(false);expect(item.researchTrust?.comparator_eligible??false).toBe(false);expect(item.researchTrust?.independent_evidence_increment??0).toBe(0);
    expect(p.incomplete.join(" ")).toContain("Server-verified primary evidence not established");
  });
  it("diagnostic count limits do not unconditionally pollute Pack incomplete",async()=>{
    const build=await fixture(),p=build({question:"NVDA earnings",issuers:["NVDA"],maxNotes:16});await p0Record("R2-incomplete",p);
    expect(p.incomplete.join(" ")).not.toContain("Discovery counts unreconciled");
    expect(p.discovery.countsStatus).toBe("COUNTS_UNRECONCILED");
  });
  it("empty canonical scope defines its boundaries even when noncanonical research exists",async()=>{
    const build=await fixture();await addExtra("10_Knowledge/Company Research/NVDA - Legacy baseline.md","# NVDA historical baseline");
    const p=build({question:"NVDA historical baseline",issuers:["NVDA"],maxNotes:16});await p0Record("R2-canonical-scope",p);
    expect(p.items.some(x=>x.path.endsWith("NVDA - Legacy baseline.md"))).toBe(true);
    expect(p.researchCoverage[0].canonicalReview).toMatchObject({finding:"NOT_FOUND_WITHIN_VERIFIED_SCOPE",scopeDefinition:{pathPrefixes:["10_Knowledge/Company Research/Investment Review - NVDA - "],intakeId:null,excludedPaths:[],metadataLimit:100,physicalReviewReadLimit:8,includesNonCanonicalResearch:false}});
  });
  it.each(["ticker","question"])("bounded %s FTS flood does not certify scope exclusion or absence",async variant=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - Rarelexeme baseline.md";
    await addExtra(target,"---\ncompany: [NVDA]\n---\n# NVDA Rarelexeme baseline\n"+"Historical unverified filler ".repeat(400));
    for(let i=0;i<130;i++)await addExtra(`07_Sources/ChatGPT/Entries/R2Flood${i}.md`,"# NVDA\n"+(variant==="question"?"NVDA Rarelexeme ":"NVDA ").repeat(30));
    const {searchVault}=await import("./queries");const ticker=searchVault("NVDA",{limit:100}),question=searchVault("Rarelexeme",{limit:30});
    const p=build({question:"NVDA Rarelexeme",issuers:["NVDA"],industry:"Optical",maxNotes:16});await p0Record("R2-flood-"+variant,p,{ticker,question,target});
    expect(ticker.total).toBeGreaterThan(100);expect(ticker.hits).toHaveLength(100);expect(ticker.hits.map(x=>x.path)).not.toContain(target);
    expect(p.discovery.reasons).toContain("fts_window_truncated");expect(p.items.map(x=>x.path)).not.toContain(target);
    if(variant==="ticker"){
      expect(question.hits.map(x=>x.path)).toContain(target);
      expect(p.discovery.reasons).toContain("issuer_lexical_window_not_returned");
      expect(p.discovery.detailsTruncated).toBe(true);
    }else{
      expect(question.total).toBeGreaterThan(30);expect(question.hits).toHaveLength(30);expect(question.hits.map(x=>x.path)).not.toContain(target);
      expect(p.discovery.paths.some(x=>x.path===target)).toBe(false);
    }
    expect(p.discovery.uniqueDiscoveredPaths).toBeNull();expect(p.discovery.coverage_incomplete).toBe(true);
  });
});

describe("P0 R2 diagnostic and freshness safeguards",()=>{
  it("ordinary nonmatch is not labelled as an unknown scan failure",async()=>{
    const build=await fixture(),target="10_Knowledge/Macro and Markets/Japan GDP.md";
    await addExtra(target,"# Japan GDP\nVietnam GDP is only a comparison reference, not the note subject.");
    const p=build({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});await p0Record("R2-nonmatch",p);
    expect(p.items.map(x=>x.path)).not.toContain(target);
    expect(p.discovery.paths.find(x=>x.path===target)).toMatchObject({disposition:"OTHER_EXCLUDED",reasons:["not_selected_in_bounded_context"]});
  });
  it("rejected optional stale candidate still changes the exact selected-history witness",async()=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - Optional freshness.md";
    await addExtra(target,"---\ncompany: [NVDA]\nsource_type: chatgpt_analysis\n---\n# NVDA optional freshness\nHistorical only.");
    const req={question:"NVDA optional freshness",issuers:["NVDA"],industry:"Optical",maxNotes:16};
    const {judgeScopeWitness}=await import("./research-judge-scope"),before=judgeScopeWitness(build(req));
    expect(before.selection.some(x=>x.path===target)).toBe(true);
    fs.writeFileSync(path.join(vault,target),"---\ncompany: [ASML]\n---\n# ASML changed scope without index");
    const p=build(req),after=judgeScopeWitness(p);await p0Record("R2-optional-witness",p,{before,after});
    expect(p.retrieval.status).toBe("operational_complete");expect(after.selection.some(x=>x.path===target)).toBe(false);expect(after).not.toEqual(before);
  });
});

// R3 NEW SYNTHETIC candidate-only fixtures; no installed-runtime assertions.
describe("P0 R3 targeted corrective lab",()=>{
  it.each(["AI","GPU","EPS","FY26"])("generic %s prefix is contextual, not an invented issuer conflict",async prefix=>{
    const build=await fixture(),target=`10_Knowledge/Company Research/${prefix} - NVDA historical detail.md`;
    await addExtra(target,"---\ncompany: [NVDA]\nsource_type: chatgpt_analysis\n---\n# NVDA historical detail\nSynthetic historical only.");
    for(const industry of [undefined,"Optical"]){
      const p=build({question:"NVDA historical detail",issuers:["NVDA"],industry,maxNotes:16});await p0Record(`R3-generic-${prefix}-${industry??"none"}`,p);
      expect(p.items.map(x=>x.path)).toContain(target);
      expect(p.items.find(x=>x.path===target)?.evidenceUse).toBe("historical_context_only");
    }
  });
  it("legitimate AI ticker alias and NVIDIA name alias retain resolved context",async()=>{
    const build=await fixture();
    await addExtra("01_Companies/C3AI.md","---\naliases: [AI]\n---\n# C3AI synthetic issuer mapping");
    await addExtra("01_Companies/NVDA.md","---\naliases: [NVIDIA]\n---\n# NVDA synthetic issuer mapping");
    for(const [label,company] of [["AI","C3AI"],["NVDA","NVIDIA"]]){
      const target=`10_Knowledge/Company Research/${label} - Alias detail.md`;
      await addExtra(target,`---\ncompany: [${company}]\nsource_type: chatgpt_analysis\n---\n# ${label} alias detail\nHistorical only.`);
      const p=build({question:`${label} alias detail`,issuers:[label],industry:"Optical",maxNotes:16});await p0Record("R3-alias-"+label,p);
      expect(p.items.map(x=>x.path)).toContain(target);expect(p.items.find(x=>x.path===target)?.evidenceUse).toBe("historical_context_only");
    }
  });
  it("registered unrelated generic ticker and ASML metadata spoof never become NVDA history",async()=>{
    const build=await fixture();await addExtra("01_Companies/AI.md","# AI distinct synthetic issuer");
    const paths=["10_Knowledge/Company Research/AI - NVDA detail.md","10_Knowledge/Company Research/ASML - NVDA detail.md"];
    for(const p of paths)await addExtra(p,"---\ncompany: [NVDA]\n---\n# Deliberate title/metadata conflict\nNVDA");
    const p=build({question:"NVDA detail",issuers:["NVDA"],industry:"Optical",maxNotes:16});await p0Record("R3-conflicting-titles",p);
    for(const x of paths){expect(p.items.map(i=>i.path)).not.toContain(x);expect(p.researchFallback.candidates.map(i=>i.path)).not.toContain(x);}
  });
  it.each(["AMD, NVDA","NVDA, AMD"])("comparative company order [%s] is related fallback, never primary selection",async companies=>{
    const build=await fixture(),target="10_Knowledge/Company Research/AMD - NVDA comparative detail.md";
    await addExtra(target,`---\ncompany: [${companies}]\nverification: verified\nsource_type: primary\n---\n# AMD and NVDA comparison\nSynthetic comparative analysis, no primary verification.`);
    for(const industry of [undefined,"Optical"]){
      const p=build({question:"NVDA comparative detail",issuers:["NVDA"],industry,maxNotes:16});await p0Record(`R3-multi-${companies}-${industry??"none"}`,p);
      expect(p.items.map(x=>x.path)).not.toContain(target);
      expect(p.researchFallback.candidates.find(x=>x.path===target)).toMatchObject({kind:"historical_related",intakeId:null,bindingStatus:"HOLD",sha256:null,receiptId:null,researchTrust:null,reason:"declared_multi_issuer_relation",issuerAttribution:"not_established",metadataBasis:"index_only_unverified"});
      expect(p.discovery.paths.find(x=>x.path===target)?.reasons).not.toContain("issuer_identity_conflict");
    }
  });
  it.each(["TSM, NVDA","NVDA, TSM"])("matching title inside company [%s] is not an order conflict",async companies=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - TSM comparison.md";
    await addExtra(target,`---\ncompany: [${companies}]\n---\n# NVDA TSM comparative historical analysis`);
    const p=build({question:"NVDA TSM comparison",issuers:["NVDA"],maxNotes:16});await p0Record("R3-order-"+companies,p);
    // ORCH R4: the explicit title subject stays selected independent of company[] order.
    expect(p.items.map(x=>x.path)).toContain(target);
    expect(p.items.find(x=>x.path===target)?.evidenceUse).toBe("historical_context_only");
    expect(p.researchFallback.candidates.some(x=>x.path===target)).toBe(false);
    expect(p.discovery.paths.find(x=>x.path===target)?.reasons).not.toContain("issuer_identity_conflict");
  });
  it.each(["drift","missing","EACCES","EIO","unknown"])("optional %s is explicit in scoped coverage without error leakage",async fault=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - Optional adverse history.md";
    await addExtra(target,"---\ncompany: [NVDA]\nsource_type: chatgpt_analysis\n---\n# NVDA adverse history\nUnverified counter-evidence.");
    if(fault==="drift")fs.writeFileSync(path.join(vault,target),"---\ncompany: [ASML]\n---\n# Changed without index");
    if(fault==="missing")fs.unlinkSync(path.join(vault,target));
    const notes=await import("./notes"),read=notes.readNote;
    const spy=vi.spyOn(notes,"readNote").mockImplementation(p=>{if(p===target&&["EACCES","EIO","unknown"].includes(fault))throw Object.assign(Error("SECRET_PRIVATE_ERROR"),{code:fault});return read(p);});
    try{
      const p=build({question:"NVDA optional adverse history",issuers:["NVDA"],industry:"Optical",maxNotes:16});await p0Record("R3-optional-"+fault,p);
      const reason=({drift:"optional_history_metadata_drift",missing:"optional_history_missing_file",EACCES:"optional_history_permission_denied",EIO:"optional_history_io_error",unknown:"optional_history_read_error"} as const)[fault as "drift"];
      expect(p.items.map(x=>x.path)).not.toContain(target);expect(p.retrieval.status).toBe("operational_complete");
      expect(p.researchCoverage[0].counterEvidence).toMatchObject({scanComplete:false,reasons:expect.arrayContaining([reason])});
      expect(p.discovery.paths.find(x=>x.path===target)).toMatchObject({disposition:"READBACK_HOLD",reasons:expect.arrayContaining([reason])});
      expect(p.incomplete.join(" ")).toContain(reason);expect(JSON.stringify(p)).not.toContain("SECRET_PRIVATE_ERROR");
    }finally{spy.mockRestore();}
  });
  it("question FTS flood explicitly warns of unknown unobserved adverse candidates",async()=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - Rareadverse baseline.md";
    await addExtra(target,"---\ncompany: [NVDA]\n---\n# NVDA Rareadverse baseline\n"+"Unverified adverse analysis ".repeat(400));
    for(let i=0;i<130;i++)await addExtra(`07_Sources/ChatGPT/Entries/R3Flood${i}.md`,"# NVDA\n"+"NVDA Rareadverse ".repeat(30));
    const p=build({question:"NVDA Rareadverse",issuers:["NVDA"],industry:"Optical",maxNotes:16});await p0Record("R3-question-flood",p);
    expect(p.discovery).toMatchObject({questionTermTruncation:{limit:30,queries:expect.arrayContaining(["RAREADVERSE"]),unobservedCandidatePaths:null,unobservedCandidateCount:null}});
    expect(p.discovery.paths.some(x=>x.path===target)).toBe(false);
    expect(p.incomplete.join(" ")).toContain("Unobserved candidate paths/count are unknown");
    expect(p.researchCoverage[0].counterEvidence.reasons).toContain("question_term_fts_window_truncated");
    expect(p.researchCoverage[0].counterEvidence.scanComplete).toBe(false);
  });
  it("deferred canonical pointer precedes already-read fallback without expanding limits",async()=>{
    const f=await r2Nov02(9);
    for(const issuer of ["TESTB","TESTC"]){
      await addExtra(`01_Companies/${issuer}.md`,`# ${issuer} synthetic issuer`);
      for(let i=1;i<=8;i++){
        const id=`IN-${String(issuer==="TESTB"?100+i:200+i).padStart(16,"0")}`;
        await addExtra(`10_Knowledge/Company Research/Investment Review - ${issuer} - ${id}.md`,`---\ntype: investment_research_review\nreview_scope: company\nintake_id: ${id}\ncompany: [${issuer}]\npublished_at: 2026-11-10\n---\n# ${issuer} synthetic unreceipted review`);
      }
    }
    const p=f.build({question:r2Question,issuers:["NVDA","TESTB","TESTC"],maxNotes:5});await p0Record("R3-deferred-priority",p);
    expect(p.researchFallback.truncated).toBe(true);expect(p.researchFallback.candidates).toHaveLength(12);
    expect(p.researchFallback.candidates[0]).toMatchObject({path:f.review,reason:"canonical_read_limit",sha256:null,receiptId:null,bindingStatus:"HOLD"});
    expect(p.items.map(x=>x.path)).not.toContain(f.review);
  });
});

// R4 ORCH policy controls: syntactic subject attribution, not semantic evidence
// or real-world ticker/alias verification. All notes are disposable synthetic data.
describe("P0 R4 issuer correction",()=>{
  it.each(["HBM","DRAM","CAPEX","Q3FY26"])("unregistered %s title marker does not displace the explicit issuer",async marker=>{
    const build=await fixture(),target=`10_Knowledge/Company Research/${marker} - NVDA historical detail.md`;
    await addExtra(target,"---\ncompany: [NVDA]\nsource_type: chatgpt_analysis\n---\n# NVDA historical detail\nSynthetic unverified context.");
    for(const industry of [undefined,"Optical"]){
      const p=build({question:"NVDA historical detail",issuers:["NVDA"],industry,maxNotes:16});await p0Record(`R4-marker-${marker}-${industry??"none"}`,p);
      expect(p.items.find(x=>x.path===target)).toMatchObject({evidenceUse:"historical_context_only"});
      expect(p.discovery.paths.find(x=>x.path===target)?.reasons).not.toContain("issuer_identity_conflict");
    }
  });
  it.each(["HBM","DRAM","CAPEX","Q3FY26"])("registered %s ticker/alias retains its own identity before marker interpretation",async label=>{
    const build=await fixture();await addExtra("01_Companies/MARKERCO.md",`---\naliases: [${label}]\n---\n# Synthetic explicit alias mapping`);
    const own=`10_Knowledge/Company Research/${label} - Own detail.md`,spoof=`10_Knowledge/Company Research/${label} - NVDA spoof.md`;
    await addExtra(own,"---\ncompany: [MARKERCO]\nsource_type: chatgpt_analysis\n---\n# Synthetic own detail");
    await addExtra(spoof,"---\ncompany: [NVDA]\n---\n# NVDA forged attribution");
    const p=build({question:label+" own detail",issuers:[label],industry:"Optical",maxNotes:16});
    expect(p.issuerResolution[0]).toMatchObject({contextKey:"MARKERCO",status:"indexed_alias"});
    expect(p.items.find(x=>x.path===own)?.evidenceUse).toBe("historical_context_only");
    const other=build({question:"NVDA spoof detail",issuers:["NVDA"],industry:"Optical",maxNotes:16});
    expect(other.items.some(x=>x.path===spoof)).toBe(false);
    expect(other.researchFallback.candidates.some(x=>x.path===spoof)).toBe(false);
    expect(other.discovery.paths.find(x=>x.path===spoof)?.reasons).toContain("issuer_identity_conflict");
  });
  it.each(["NVIDIA Corporation","NVIDIA"])("unknown metadata label %s does not veto an explicit NVDA title or become an alias",async label=>{
    const build=await fixture(),target="10_Knowledge/Company Research/NVDA - Named company historical detail.md";
    await addExtra(target,`---\ncompany: [${label}]\nverification: verified\nsource_type: primary\n---\n# NVDA historical detail\nSynthetic unverified declaration only.`);
    for(const industry of [undefined,"Optical"]){
      const p=build({question:"NVDA historical detail",issuers:["NVDA"],industry,maxNotes:16});await p0Record(`R4-unknown-${label}-${industry??"none"}`,p);
      const item=p.items.find(x=>x.path===target);expect(item?.evidenceUse).toBe("historical_context_only");
      expect(item?.sourceBinding).toBeUndefined();expect(item?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
      expect(p.discovery.paths.find(x=>x.path===target)?.reasons).toContain("declared_company_identity_unresolved");
      expect(p.issuerResolution).toEqual([expect.objectContaining({requested:"NVDA",contextKey:"NVDA",status:"exact_existing_title"})]);
      expect(p.contextBundles.some(x=>x.reviewPath===target)).toBe(false);
    }
    const unmapped=build({question:label+" historical detail",issuers:[label],maxNotes:16});
    expect(unmapped.issuerResolution[0].contextKey).toBeNull();
  });
  it.each(["INTC, CRWD","CRWD, INTC"])("joint title and metadata [%s] select both supported subjects without trust promotion",async companies=>{
    const build=await fixture();for(const issuer of ["INTC","CRWD"])await addExtra(`01_Companies/${issuer}.md`,`# ${issuer} synthetic issuer`);
    const target="10_Knowledge/Company Research/INTC × CRWD security.md";
    await addExtra(target,`---\ncompany: [${companies}]\nverification: not_reverified\n---\n# INTC and CRWD security\nSynthetic comparative historical discussion.`);
    for(const issuer of ["INTC","CRWD"]){
      const p=build({question:issuer+" security historical",issuers:[issuer],industry:"Optical",maxNotes:16});
      expect(p.items.find(x=>x.path===target)).toMatchObject({evidenceUse:"historical_context_only",declaredVerification:"not_reverified"});
      expect(p.discovery.paths.find(x=>x.path===target)?.reasons).toContain("historical_joint_subject");
      expect(p.researchFallback.candidates.some(x=>x.path===target)).toBe(false);
    }
  });
  it.each(["metadata","body"])("joint title with unsupported %s does not establish selected issuer evidence",async fault=>{
    const build=await fixture();await addExtra("01_Companies/CRWD.md","# CRWD synthetic issuer");
    const target="10_Knowledge/Company Research/INTC × CRWD security.md";
    await addExtra(target,`---\ncompany: [${fault==="metadata"?"CRWD":"INTC, CRWD"}]\n---\n# ${fault==="body"?"CRWD only":"INTC and CRWD"} synthetic history`);
    const p=build({question:"CRWD security historical",issuers:["CRWD"],industry:"Optical",maxNotes:16});
    expect(p.items.some(x=>x.path===target)).toBe(false);
    expect(p.discovery.paths.find(x=>x.path===target)?.reasons).toContain("joint_subject_unconfirmed");
    expect(p.contextBundles.some(x=>x.reviewPath===target)).toBe(false);
  });
  it("a secondary company tag cannot borrow primary attribution from a different title subject",async()=>{
    const build=await fixture();await addExtra("01_Companies/TSM.md","# TSM synthetic issuer");
    const target="10_Knowledge/Company Research/NVDA - TSM comparative detail.md";
    await addExtra(target,"---\ncompany: [TSM, NVDA]\n---\n# NVDA and TSM comparison\nSynthetic only.");
    const p=build({question:"TSM comparative detail",issuers:["TSM"],maxNotes:16});
    expect(p.items.some(x=>x.path===target)).toBe(false);
    expect(p.researchFallback.candidates.find(x=>x.path===target)).toMatchObject({kind:"historical_related",bindingStatus:"HOLD",receiptId:null,issuerAttribution:"not_established"});
  });
});

// R4-M1: optional joint history has candidate-level readback authority only.
// These are new disposable fixtures, not installed Vault or semantic evidence.
describe("P0 R4-M1 optional joint readback",()=>{
  async function jointFixture(){
    const build=await fixture();
    for(const issuer of ["INTC","CRWD"])await addExtra(`01_Companies/${issuer}.md`,`# ${issuer} synthetic issuer`);
    const target="10_Knowledge/Company Research/INTC × CRWD security.md";
    const raw="---\ncompany: [INTC, CRWD]\nverification: not_reverified\nsource_type: chatgpt_analysis\n---\n# INTC and CRWD security\nSynthetic comparative historical discussion.\n";
    await addExtra(target,raw);
    return {build,target,raw};
  }
  for(const industry of [undefined,"Optical"]){
    const request={question:"INTC CRWD security historical",issuers:["INTC"],industry,maxNotes:8,maxChars:12000};
    it.each(["drift","missing","EACCES","EIO","unknown"])(`optional %s industry=${industry??"none"} quarantines only the candidate`,async fault=>{
      const f=await jointFixture(),notes=await import("./notes"),read=notes.readNote;
      if(fault==="drift")fs.writeFileSync(path.join(vault,f.target),f.raw.replace("company: [INTC, CRWD]","company: [AMD]"));
      if(fault==="missing")fs.unlinkSync(path.join(vault,f.target));
      const spy=vi.spyOn(notes,"readNote").mockImplementation(p=>{
        if(p===f.target&&["EACCES","EIO","unknown"].includes(fault))throw Object.assign(Error("R4M1_PRIVATE_ERROR"),{code:fault});
        return read(p);
      });
      try{
        const {db}=await import("../db"),changes=db().prepare("SELECT total_changes() n").get();
        const protectedPath=path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),protectedBytes=fs.readFileSync(protectedPath);
        const p=f.build(request);await p0Record(`R4M1-${fault}-${industry??"none"}`,p);
        const reason=({drift:"optional_history_metadata_drift",missing:"optional_history_missing_file",EACCES:"optional_history_permission_denied",EIO:"optional_history_io_error",unknown:"optional_history_read_error"} as const)[fault as "drift"];
        expect(p.items.some(x=>x.path===f.target)).toBe(false);
        expect(p.researchFallback.candidates.some(x=>x.path===f.target)).toBe(false);
        expect(p.retrieval.status).toBe("operational_complete");expect(p.retrieval.reads.failed).toBe(0);
        expect(p.discovery.paths.find(x=>x.path===f.target)).toMatchObject({disposition:"READBACK_HOLD",reasons:expect.arrayContaining([reason])});
        expect(p.researchCoverage[0].counterEvidence).toMatchObject({scanComplete:false,reasons:expect.arrayContaining([reason])});
        expect(p.incomplete.join(" ")).toContain(reason);expect(JSON.stringify(p)).not.toContain("R4M1_PRIVATE_ERROR");
        expect(db().prepare("SELECT total_changes() n").get()).toEqual(changes);expect(fs.readFileSync(protectedPath)).toEqual(protectedBytes);
        expect(spy.mock.calls.filter(([p])=>p===f.target)).toHaveLength(fault==="missing"?0:1);
      }finally{spy.mockRestore();}
    });
    it(`valid joint industry=${industry??"none"} selects low-trust bytes with one physical read`,async()=>{
      const f=await jointFixture(),notes=await import("./notes"),spy=vi.spyOn(notes,"readNote");
      try{
        for(const issuer of ["INTC","CRWD"]){
          spy.mockClear();const p=f.build({...request,issuers:[issuer]});
          expect(p.retrieval.status).toBe("operational_complete");
          expect(p.items.find(x=>x.path===f.target)).toMatchObject({evidenceUse:"historical_context_only",declaredVerification:"not_reverified",researchTrust:{independent_evidence_increment:0,comparator_eligible:false,primary_authority:false,owner_thesis_authority:false}});
          expect(p.items.find(x=>x.path===f.target)?.sourceBinding).toBeUndefined();
          expect(p.discovery.paths.find(x=>x.path===f.target)?.reasons).toContain("historical_joint_subject");
          expect(p.incomplete.join(" ")).not.toContain("optional_history_");
          expect(spy.mock.calls.filter(([p])=>p===f.target)).toHaveLength(1);
          await p0Record(`R4M1-valid-${issuer}-${industry??"none"}`,p);
        }
      }finally{spy.mockRestore();}
    });
    it(`drift industry=${industry??"none"} invalidates prior Judge selection and preserves incomplete sealed coverage`,async()=>{
      const f=await jointFixture(),scope=await import("./research-judge-scope");
      const before=f.build(request),witness=scope.judgeScopeWitness(before),actor="oauth:r4m1-disposable";
      expect(witness.selection.some(x=>x.path===f.target)).toBe(true);
      expect(scope.judgeScopeCurrent(witness,before.retrieval,[],p0Id,actor)).toBe(true);
      fs.writeFileSync(path.join(vault,f.target),f.raw.replace("company: [INTC, CRWD]","company: [AMD]"));
      const after=f.build(request);
      expect(after.retrieval.status).toBe("operational_complete");
      expect(scope.judgeScopeCurrent(witness,before.retrieval,[],p0Id,actor)).toBe(false);
      expect(scope.judgeScopeWitness(after).selection.some(x=>x.path===f.target)).toBe(false);
      // A fresh packet records remaining healthy reads and the rejected history;
      // it is NOT a semantic PASS or non-Source authorization.
      const {buildResearchJudgePacket}=await import("./research-judge");
      const packet=buildResearchJudgePacket({domain:"company",entities:["INTC"],topic:"CRWD security historical",sourceKind:"user_commentary",inputFormat:"text",sourceChat:"R4-M1 disposable fixture",extractedText:"INTC synthetic source text only.",captureOnly:true},actor);
      const body=JSON.parse(packet.packet.body);
      expect(body.coverage.retrieval.status).toBe("operational_complete");
      expect(body.coverage.status).toBe("bounded_not_exhaustive");
      expect(body.coverage.researchCoverage[0].counterEvidence).toMatchObject({scanComplete:false,reasons:expect.arrayContaining(["optional_history_metadata_drift"])});
      expect(body.coverage.incomplete.join(" ")).toContain("optional_history_metadata_drift");
      expect(body.history.some((x:{path:string})=>x.path===f.target)).toBe(false);
      expect(body.scopeWitness.selection.some((x:{path:string})=>x.path===f.target)).toBe(false);
      await p0Record(`R4M1-witness-${industry??"none"}`,after,{previousWitness:witness,freshCoverage:body.coverage});
    });
    it(`required canonical drift industry=${industry??"none"} remains operational HOLD`,async()=>{
      const f=await p0Fixture();
      fs.writeFileSync(path.join(vault,f.review),"---\ncompany: [AMD]\n---\n# Changed without index\nNVDA");
      const p=f.build({question:"NVDA baseline",issuers:["NVDA"],industry,maxNotes:8});
      expect(p.retrieval.status).toBe("operational_hold");expect(p.retrieval.reads.failed).toBeGreaterThan(0);
      expect(p.items.some(x=>x.path===f.review)).toBe(false);
      expect(p.discovery.paths.find(x=>x.path===f.review)?.disposition).toBe("READBACK_HOLD");
      expect(p.incomplete.join(" ")).not.toContain("optional_history_metadata_drift");
      const {judgeScopeWitness}=await import("./research-judge-scope");
      expect(()=>judgeScopeWitness(p)).toThrow("research_judge_scope_operational_hold");
      await p0Record(`R4M1-required-${industry??"none"}`,p);
    });
  }
});

describe("Typed Macro history scope isolation",()=>{
 it.each(["issuer","focus","key"])("rejects inconsistent internal scope: %s",async fault=>{
  const {buildInvestmentContextPack}=await import("./investment-context");
  const macroScope={version:"RI001-MACRO-HISTORY-1" as const,key:fault==="key"?"OTHERLAND":"FICTIONLAND",label:"Fictionland"};
  expect(()=>buildInvestmentContextPack({question:"Fictionland documentation",macroScope,focus:fault==="focus"?"earnings":"macro",...(fault==="issuer"?{issuers:["NVDA"]}:{})})).toThrow();
 });
 it("missing prior Source reports bounded absence, without claiming primary evidence or a receipt",async()=>{
  const {buildInvestmentContextPack}=await import("./investment-context"),scope={version:"RI001-MACRO-HISTORY-1" as const,key:"FICTIONLAND",label:"Fictionland"};
  const p=buildInvestmentContextPack({question:"C1 is a pilot label, not the country",focus:"macro",macroScope:scope});
  expect(p.retrieval.scope.macroScope).toEqual(scope);expect(p.macroCoverage.map(s=>s.scope)).toEqual(["FICTIONLAND"]);
  expect(p.items).toEqual([]);expect(p.standaloneSources).toEqual([{contextKey:"FICTIONLAND",paths:[],complete:true,reasons:[]}]);
  expect(p.retrieval.status).toBe("operational_complete");expect(p.incomplete.length).toBeGreaterThan(0);
 });
});
