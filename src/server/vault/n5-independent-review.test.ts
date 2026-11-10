import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"n5-independent-")));vault=path.join(root,"vault");
  fs.mkdirSync(vault);process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;vi.restoreAllMocks();});
async function add(p:string,raw:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),raw);
  (await import("./indexer")).reindexPath(p);return p;
}
const input=(label:string)=>({domain:"company" as const,entities:[label],topic:"Synthetic declared issuer event",inputFormat:"text" as const,sourceKind:"user_commentary" as const,extractedText:"Unverified synthetic input retained for independent review only."});
describe("N5 independent boundary probes",()=>{
  it.each(["../NVDA","NVDA\\other","NVDA\tother"])("refuses invalid explicit alias %j consistently",async label=>{
    await add("01_Companies/NVDA.md", "---\naliases: ["+JSON.stringify(label)+"]\n---\n# Synthetic NVDA");
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    const {buildInvestmentContextPack}=await import("./investment-context");
    expect(buildInvestmentContextPack({question:"Synthetic event",issuers:[label]}).issuerResolution[0].status).toBe("invalid_hold");
    expect(planCanonicalRoutingV2(input(label)).companyHubs).toEqual([]);
  });
  it.each(["constructor","__proto__"])("preserves unknown label %s without prototype lookup exception",async label=>{
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const result=planInvestmentWriteback(input(label));
    expect(result.routingV2.companyHubs).toEqual([]);
    expect(result.routes.find(r=>r.kind==="raw_input")?.action).toBe("candidate_create");
  });
  it("does not let a missing indexed Timeline block a raw Source plan",async()=>{
    await add("01_Companies/NVDA.md","# Synthetic NVDA");
    const timeline=await add("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md","# Synthetic timeline");
    fs.unlinkSync(path.join(vault,timeline));
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const result=planInvestmentWriteback(input("NVDA"));
    expect(result.routes.find(r=>r.kind==="raw_input")?.action).toBe("candidate_create");
    expect(result.routes.find(r=>r.kind==="company_timeline_candidate")?.action).toBe("link_existing_or_hold");
  });
  it("allows a unique normalized alias without mutating protected notes or the database",async()=>{
    await add("01_Companies/NVDA.md",'---\naliases: ["Nvidia Corporation", "NVIDIA CORPORATION"]\n---\n# Synthetic NVDA');
    const protectedPath=await add("05_Thesis/NVDA - Current Thesis.md","# Protected fixture\nNever write.");
    const {db}=await import("../db");
    const before=db().prepare("SELECT total_changes() AS n").get();
    const bytes=fs.readFileSync(path.join(vault,protectedPath));
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const result=planInvestmentWriteback(input("Nvidia Corporation"));
    expect(result.routingV2.companyHubs[0]).toMatchObject({path:"01_Companies/NVDA.md",resolution:"indexed_alias"});
    expect(result.gates.canAutoWrite).toBe(false);
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect(fs.readFileSync(path.join(vault,protectedPath))).toEqual(bytes);
  });
  it("preserves existing slash-separated Industry aliases outside the Company identity boundary",async()=>{
    const p=await add("02_Industries_Themes/Data Center.md",'---\naliases: ["AI/Data Center"]\n---\n# Synthetic industry');
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    expect(planCanonicalRoutingV2({domain:"industry",entities:["AI/Data Center"],topic:"Synthetic industry event"}).industryHubs)
      .toEqual([expect.objectContaining({path:p,resolution:"indexed_alias"})]);
  });
});
