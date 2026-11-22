import { afterAll, beforeAll, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const state = vi.hoisted(() => ({verified:false,paused:false,kind:"obsidian"}));
vi.mock('./sync', () => ({syncKind:()=>state.kind,syncBackend:()=>({isEditPaused:()=>state.paused,status:()=>({state:'running',startedAt:1}),getLogs:()=>state.verified?[{line:'[sync-policy] Verified bidirectional sync.',ts:2}]:[]})}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-intake-'));
process.env.DATA_DIR=root; process.env.CLOUD_INTAKE='1';
const input={sourceChat:'SYNTHETIC CLOUD TEST',notes:[{title:'Cloud fixture',eventDate:null,userInput:'Synthetic',analysis:'No investment facts',relatedNotes:['Company.md']}]};
beforeAll(async()=>{const {setSetting}=await import('./db');setSetting('vault_configured','true');fs.writeFileSync(path.join(root,'vault/Company.md'),'original');});
afterAll(async()=>{const {db}=await import('./db');db().close();delete process.env.DATA_DIR;delete process.env.CLOUD_INTAKE;fs.rmSync(root,{recursive:true,force:true});});
it('waits for verified upload-capable Sync before writing',async()=>{const {enqueue,intakeStatus}=await import('./intake');const {processCloudIntake}=await import('./cloud-intake');const r=enqueue(input);processCloudIntake();expect(intakeStatus(r.id).status).toBe('queued');expect(fs.readdirSync(path.join(root,'vault'))).toEqual(['Company.md']);});
it('imports without desktop, preserves original, links and durable receipt; retries do not duplicate',async()=>{state.verified=true;const {enqueue,intakeStatus}=await import('./intake');const {processCloudIntake,cloudIntakeStatus}=await import('./cloud-intake');const r=enqueue(input);processCloudIntake();const receipt=intakeStatus(r.id).receipt;expect(receipt.status).toBe('imported');expect(receipt.message).toContain('Cloud receiver');expect(receipt.paths).toHaveLength(2);expect(fs.readFileSync(path.join(root,'vault',receipt.paths[0]),'utf8')).toContain('[[Company]]');expect(fs.readFileSync(path.join(root,'vault/Company.md'),'utf8')).toBe('original');processCloudIntake();expect(enqueue(input).id).toBe(r.id);expect(cloudIntakeStatus().computerRequired).toBe(false);});
it('blocks absent targets and traversal without creating a package directory',async()=>{const {enqueue,intakeStatus}=await import('./intake');const {processCloudIntake}=await import('./cloud-intake');for(const link of ['Missing.md','../escape.md']){const r=enqueue({...input,notes:[{...input.notes[0],relatedNotes:[link]}]});processCloudIntake();expect(intakeStatus(r.id).status).toBe('blocked');}expect(fs.readdirSync(path.join(root,'vault/00_Inbox/ChatGPT'))).toHaveLength(1);});

it('leaves pending submissions queued without acknowledgement while edit-paused or in Git mode',async()=>{
 const {enqueue,intakeStatus}=await import('./intake');const {processCloudIntake}=await import('./cloud-intake');
 const item=enqueue({...input,sourceChat:'SYNTHETIC PAUSED QUEUE'});state.verified=true;state.paused=true;
 processCloudIntake();expect(intakeStatus(item.id)).toMatchObject({status:'queued',receipt:null});
 state.paused=false;state.kind='git';processCloudIntake();expect(intakeStatus(item.id)).toMatchObject({status:'queued',receipt:null});
 state.kind='obsidian';processCloudIntake();expect(intakeStatus(item.id).status).toBe('imported');
});
