import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"intake-test-"));process.env.DATA_DIR=root;
const input={sourceChat:"SYNTHETIC TEST",notes:[{title:"Test",eventDate:null,userInput:"Synthetic input",analysis:"Synthetic interpretation",relatedNotes:[]}]};
let client:Client;let server:Awaited<ReturnType<typeof import("./mcp/server")["createMcpServer"]>>;
beforeAll(async()=>{const {createMcpServer}=await import('./mcp/server');server=createMcpServer({read:true,write:false,intake:true,label:'test'});client=new Client({name:'intake-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);});
afterAll(async()=>{await client.close();await server.close();const {db}=await import('./db');db().close();delete process.env.DATA_DIR;});
it('admin catalog includes scoped intake tools without claiming status writes or exposing vault mutations',async()=>{const {listMcpTools}=await import('./mcp/catalog');const catalog=await listMcpTools();expect(catalog).toHaveLength(22);expect(catalog.find(t=>t.name==='submit_investment_notes')).toMatchObject({write:true,intake:true});expect(catalog.find(t=>t.name==='get_submission_status')).toMatchObject({write:false,intake:true});expect(catalog.filter(t=>t.write).map(t=>t.name)).toEqual(['submit_investment_notes']);});
it('reports granted intake access without credential identifiers',async()=>{const result=await client.callTool({name:'get_vault_info',arguments:{}});const data=JSON.parse((result.content as {text:string}[])[0].text);expect(data.connection).toMatchObject({submitAnalysis:true,editExistingNotes:false,deleteNotes:false});expect(data.connection.label).toBeUndefined();});
it('lets an OAuth read connection discover submission scope but refuses calls without queue writes',async()=>{
  const {createMcpServer}=await import('./mcp/server');const {nextIntake}=await import('./intake');nextIntake();
  const {db}=await import('./db');const before=db().prepare('SELECT count(*) AS n FROM intake_queue').get();
  const s=createMcpServer({read:true,write:false,intake:false,label:'oauth:readonly-fixture'});
  const c=new Client({name:'read-scope-fixture',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
  try{await s.connect(b);await c.connect(a);const {tools}=await c.listTools();
    expect(tools.find(t=>t.name==='submit_investment_notes')?._meta?.securitySchemes).toEqual([{type:'oauth2',scopes:['vault:read','inbox:submit']}]);
    for(const [name,args] of [['submit_investment_notes',input],['get_submission_status',{id:'0'.repeat(64)}]] as const){
      const result=await c.callTool({name,arguments:args});expect(result.isError).toBe(true);
      expect(JSON.stringify(result._meta)).toContain('insufficient_scope');expect(JSON.stringify(result._meta)).toContain('inbox:submit');
    }
    expect(db().prepare('SELECT count(*) AS n FROM intake_queue').get()).toEqual(before);
  }finally{await c.close();await s.close();}
});
it('offers only additive submission, no vault mutations, with write annotation',async()=>{const {tools}=await client.listTools();expect(tools.find(t=>t.name==='submit_investment_notes')?.annotations).toMatchObject({readOnlyHint:false,destructiveHint:false,idempotentHint:true});expect(tools.map(x=>x.name)).not.toContain('create_note');expect(tools.map(x=>x.name)).not.toContain('update_note');expect(tools.map(x=>x.name)).not.toContain('delete_note');});
it('submits through MCP, deduplicates retries, leaves vault empty',async()=>{const a=await client.callTool({name:'submit_investment_notes',arguments:input});const b=await client.callTool({name:'submit_investment_notes',arguments:input});expect(a.isError).not.toBe(true);expect(a.content).toEqual(b.content);expect(fs.readdirSync(path.join(root,'vault'))).toEqual([]);});
it('rejects malformed and oversized input',async()=>{const {enqueue}=await import('./intake');expect(()=>enqueue({...input,notes:[]})).toThrow();expect(()=>enqueue({...input,notes:[{...input.notes[0],analysis:'x'.repeat(30001)}]})).toThrow();expect(()=>enqueue({...input,extra:'forbidden'})).toThrow();});
it('persists queue and acknowledges without touching vault',async()=>{const {enqueue,nextIntake,acknowledge,intakeStatus}=await import('./intake');const r=enqueue(input);expect(nextIntake()?.id).toBe(r.id);expect(intakeStatus(r.id).status).toBe('queued');acknowledge({id:r.id,status:'imported',paths:['00_Inbox/test.md'],message:'fixture'});expect(nextIntake()).toBe(null);expect(enqueue(input).status).toBe('imported');expect(()=>intakeStatus('0'.repeat(64))).toThrow();expect(fs.readdirSync(path.join(root,'vault'))).toEqual([]);});
