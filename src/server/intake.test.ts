import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"intake-test-"));process.env.DATA_DIR=root;
const input={sourceChat:"SYNTHETIC TEST",notes:[{title:"Test",eventDate:null,userInput:"Synthetic input",analysis:"Synthetic interpretation",relatedNotes:[]}]};
let client:Client;let server:Awaited<ReturnType<typeof import("./mcp/server")["createMcpServer"]>>;
let saveClient:Client;let saveServer:typeof server;
beforeAll(async()=>{
  const {createMcpServer}=await import('./mcp/server');const {createSaveMcpServer}=await import('./mcp/save-server');
  const access={read:true,write:false,intake:true,label:'oauth:intake-test',scopes:['vault:read','inbox:submit']};
  server=createMcpServer(access);saveServer=createSaveMcpServer(access);
  client=new Client({name:'research-intake-test',version:'1'});saveClient=new Client({name:'save-intake-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  const [c,d]=InMemoryTransport.createLinkedPair();await saveServer.connect(d);await saveClient.connect(c);
});
afterAll(async()=>{await client.close();await server.close();await saveClient.close();await saveServer.close();const {db}=await import('./db');db().close();delete process.env.DATA_DIR;});
it('admin research catalog matches the read-only wire surface and excludes separately scoped intake tools',async()=>{
  const {listMcpTools}=await import('./mcp/catalog');const catalog=await listMcpTools();expect(catalog).toHaveLength(28);
  expect(catalog.map(t=>t.name).sort()).toEqual((await client.listTools()).tools.map(t=>t.name).sort());
  for(const t of catalog)expect(t).toMatchObject({write:false,intake:false,annotations:{readOnlyHint:true}});
  for(const name of ['submit_investment_notes','get_submission_status','create_note','apply_edit','apply_canonical_writeback'])
    expect(catalog.find(t=>t.name===name)).toBeUndefined();
});
it('reports research-only access even for a credential with intake scope, without credential identifiers',async()=>{const result=await client.callTool({name:'get_vault_info',arguments:{}});const data=JSON.parse((result.content as {text:string}[])[0].text);expect(data.connection).toMatchObject({submitAnalysis:false,editExistingNotes:false,deleteNotes:false});expect(data.connection.label).toBeUndefined();});
it('keeps submission absent from research and refuses a read-only token on the separate Save resource without queue writes',async()=>{
  const {createMcpServer}=await import('./mcp/server');const {nextIntake}=await import('./intake');nextIntake();
  const {createSaveMcpServer}=await import('./mcp/save-server');
  const {db}=await import('./db');const before=db().prepare('SELECT count(*) AS n FROM intake_queue').get();
  const access={read:true,write:false,intake:false,label:'oauth:readonly-fixture',scopes:['vault:read']};
  const s=createMcpServer(access),save=createSaveMcpServer(access);
  const c=new Client({name:'read-scope-fixture',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
  const sc=new Client({name:'save-read-scope-fixture',version:'1'});const [sa,sb]=InMemoryTransport.createLinkedPair();
  try{await s.connect(b);await c.connect(a);const {tools}=await c.listTools();
    await save.connect(sb);await sc.connect(sa);
    const saveTools=(await sc.listTools()).tools;
    expect(saveTools.map(t=>t.name).sort()).toEqual(['get_submission_status','submit_investment_notes']);
    for(const tool of saveTools)expect(tool._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:['vault:read','inbox:submit']}]);
    for(const [name,args] of [['submit_investment_notes',input],['get_submission_status',{id:'0'.repeat(64)}]] as const){
      expect(tools.find(t=>t.name===name)).toBeUndefined();
      expect((await c.callTool({name,arguments:args})).isError).toBe(true);
      const result=await sc.callTool({name,arguments:args});expect(result.isError).toBe(true);
      expect(JSON.stringify(result._meta)).toContain('insufficient_scope');expect(JSON.stringify(result._meta)).toContain('inbox:submit');
      expect(JSON.stringify(result._meta)).toContain('/.well-known/oauth-protected-resource/api/save-analysis');
    }
    expect(db().prepare('SELECT count(*) AS n FROM intake_queue').get()).toEqual(before);
  }finally{await c.close();await s.close();await sc.close();await save.close();}
});
it('offers only additive submission and read-only receipt on Save, no vault mutations',async()=>{const {tools}=await saveClient.listTools();expect(tools.map(x=>x.name).sort()).toEqual(['get_submission_status','submit_investment_notes']);expect(tools.find(t=>t.name==='submit_investment_notes')?.annotations).toMatchObject({readOnlyHint:false,destructiveHint:false,idempotentHint:true});expect(tools.find(t=>t.name==='get_submission_status')?.annotations).toMatchObject({readOnlyHint:true});expect(tools.map(x=>x.name)).not.toContain('create_note');expect(tools.map(x=>x.name)).not.toContain('update_note');expect(tools.map(x=>x.name)).not.toContain('delete_note');});
it('submits through the Save MCP, deduplicates retries, leaves vault empty',async()=>{const a=await saveClient.callTool({name:'submit_investment_notes',arguments:input});const b=await saveClient.callTool({name:'submit_investment_notes',arguments:input});expect(a.isError).not.toBe(true);expect(a.content).toEqual(b.content);expect(fs.readdirSync(path.join(root,'vault'))).toEqual([]);});
it('rejects malformed and oversized input',async()=>{const {enqueue}=await import('./intake');expect(()=>enqueue({...input,notes:[]})).toThrow();expect(()=>enqueue({...input,notes:[{...input.notes[0],analysis:'x'.repeat(30001)}]})).toThrow();expect(()=>enqueue({...input,extra:'forbidden'})).toThrow();});
it('persists queue and acknowledges without touching vault',async()=>{const {enqueue,nextIntake,acknowledge,intakeStatus}=await import('./intake');const r=enqueue(input);expect(nextIntake()?.id).toBe(r.id);expect(intakeStatus(r.id).status).toBe('queued');acknowledge({id:r.id,status:'imported',paths:['00_Inbox/test.md'],message:'fixture'});expect(nextIntake()).toBe(null);expect(enqueue(input).status).toBe('imported');expect(()=>intakeStatus('0'.repeat(64))).toThrow();expect(fs.readdirSync(path.join(root,'vault'))).toEqual([]);});
