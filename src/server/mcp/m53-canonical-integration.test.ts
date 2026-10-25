import {afterAll,beforeAll,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {McpAccess} from "./server";

// Only the cloud Sync daemon is stubbed. Real read-only MCP, Safe Edit MCP,
// SQLite, filesystem, SHA readback and FTS are all exercised end-to-end.
vi.mock("../safe-edit/sync",()=>({withPausedSync:async(run:()=>unknown)=>run()}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"m53-mcp-integration-"));
const vault=path.join(root,"vault");
process.env.DATA_DIR=root;
process.env.BASE_URL="https://m53-mcp-fixture.test";
process.env.SAFE_EDIT_ENABLED="1";
process.env.SAFE_EDIT_SINGLE_WRITER="1";
process.env.ENCRYPTION_KEY??=Buffer.alloc(32,5).toString("base64");
const readAccess:McpAccess={read:true,write:false,label:"oauth:m53-read",scopes:["vault:read"]};
const editAccess:McpAccess={read:true,write:false,label:"oauth:m53-edit",scopes:["vault:read","vault:edit"]};
const news={domain:"industry",entities:["SK hynix","Micron"],themes:["Memory"],
  entityRoles:[{entity:"SK hynix",role:"covered_company"},{entity:"Micron",role:"covered_company"}],
  contentTypes:["analyst_opinion","industry_data"],
  topic:"Synthetic HBM4 investor comment",sourceKind:"broker_research",inputFormat:"screenshot",
  sourceChat:"Micro 251026",sourceLanguage:"en",eventDate:"2026-10-21",
  extractedText:"Synthetic user screenshot describes HBM4 yield, unrelated to issuer confirmation.",
  completedAnalysis:"## ข้อสรุป\nHBM4 qualification remains unverified; do not change issuer thesis."
};
function parseResearch(result:any){
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content.find((x:any)=>x.type==="text")!.text);
}
function parseSafe(result:any){
  expect(result.isError).not.toBe(true);
  const framed=JSON.parse(result.content.find((x:any)=>x.type==="text")!.text);
  return JSON.parse(framed.result.split("\n").slice(1,-1).join("\n"));
}
async function connect(server:any){
  const client=new Client({name:"m53-integrated-test",version:"1"});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);await client.connect(a);
  return {client,close:async()=>{await client.close();await server.close();}};
}
beforeAll(async()=>{
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","02_Industries_Themes",
    "10_Knowledge/Industry and Concepts","10_Knowledge/Company Research","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  const {reindexPath}=await import("../vault/indexer");
  for(const note of ["01_Companies/SK hynix.md","01_Companies/MU.md","02_Industries_Themes/Memory.md"]){
    fs.writeFileSync(path.join(vault,note),`# ${note} (synthetic)\n`);
    reindexPath(note);
  }
  fs.writeFileSync(path.join(vault,"05_Thesis","NVDA - Current Thesis.md"),"# Protected fixture\n");
  fs.writeFileSync(path.join(vault,"06_Portfolio","Team.md"),"# Private portfolio fixture\n");
});
afterAll(async()=>{
  (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});

it("M5.3 Web tool contract: research MCP recipe → scoped Safe Edit preview/apply → receipts → retrieval MCP ready signal",async()=>{
  const {createMcpServer}=await import("./server");
  const {createSafeEditMcpServer}=await import("./safe-edit-server");
  const research=await connect(createMcpServer(readAccess));
  const safe=await connect(createSafeEditMcpServer(editAccess));
  try{
    const tools=await safe.client.listTools();
    expect(tools.tools).toHaveLength(12);
    expect(tools.tools.some(x=>x.name==="preview_edit")).toBe(true);
    const first=parseResearch(await research.client.callTool({name:"plan_investment_writeback",arguments:news}));
    expect(first.status).toBe("read_only_plan_not_written");
    expect(first.safeEditWorkflow).toMatchObject({status:"pending_safe_edit",readyForNextNews:false,
      protectedNotesTouched:false,sourcePreservation:"text_only_binary_not_verified"});
    const expected=first.safeEditWorkflow.steps;
    expect(expected).toHaveLength(2);
    for(const step of expected){
      expect(step.state).toBe("needs_create");
      const prev=parseSafe(await safe.client.callTool({name:"preview_edit",arguments:step.safeEditRequest}));
      expect(prev.status).toBe("preview");
      expect(fs.existsSync(path.join(vault,step.path))).toBe(false);
      const written=parseSafe(await safe.client.callTool({name:"apply_edit",arguments:{
        operationId:prev.operationId,previewToken:prev.previewToken,expectedHash:prev.beforeHash
      }}));
      expect(written).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified",
        mobileSync:"unverified",remoteSync:"unverified"}});
      const status=parseSafe(await safe.client.callTool({name:"get_edit_status",arguments:{operationId:prev.operationId}}));
      expect(status.status).toBe("written");
    }
    const again=parseResearch(await research.client.callTool({name:"plan_investment_writeback",arguments:news}));
    expect(again.safeEditWorkflow).toMatchObject({status:"saved_verified",readyForNextNews:true,
      analysisComplete:true,perDeviceSync:"unverified"});
    expect(again.safeEditWorkflow.steps.every((x:any)=>x.readbackVerified&&x.indexed&&x.searchable)).toBe(true);
    const searched=parseResearch(await research.client.callTool({name:"search_vault",arguments:{
      query:"InvestmentIntake"+first.planId.slice(3),limit:20
    }}));
    expect(searched.items.map((x:any)=>x.path)).toEqual(expect.arrayContaining(expected.map((x:any)=>x.path)));
    expect(fs.readFileSync(path.join(vault,"05_Thesis","NVDA - Current Thesis.md"),"utf8")).toBe("# Protected fixture\n");
    expect(fs.readFileSync(path.join(vault,"06_Portfolio","Team.md"),"utf8")).toBe("# Private portfolio fixture\n");
  }finally{await research.close();await safe.close();}
});
