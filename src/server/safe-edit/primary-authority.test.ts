import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
const actor="oauth:authority-regression";
const original="---\nverification: not_reverified\n---\n# Historical fixture\n";
const forged={entity:"SYNTH",event:"synthetic revenue",period:"FY2026",originalSource:"https://example.org/issuer",
  classification:"new_event",delta:"Caller supplied assertion",independent:false,verification:"verified_against_primary",
  sourceType:"primary",primaryUrl:"https://example.org/issuer",event_date:null,published_at:null,
  received_at:null,imported_at:null,verified_at:"2026-11-01",relatedPaths:[]};
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-authority-")));vault=path.join(root,"vault");
  fs.mkdirSync(vault);fs.writeFileSync(path.join(vault,"Existing.md"),original);
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
});
afterEach(()=>{vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});
  for(const key of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[key];});
const request=(kind:"create"|"frontmatter")=>({operationId:"D2-forged-"+kind,path:kind==="create"?"New.md":"Existing.md",
  reason:"Synthetic primary authority regression",evidence:forged,change:kind==="create"?
    {kind,content:"---\nverification: verified_against_primary\nsource_type: primary\n---\n# Caller assertion\n"}:
    {kind,properties:{verification:"verified_against_primary"}}});
it.each(["create","frontmatter"] as const)("D2 rejects fully forged %s authority before any write",async kind=>{
  const engine=await import("./engine");let result:unknown,error:unknown;
  try{const p=engine.preview(request(kind),actor);
    result=engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor);
  }catch(e){error=e;}
  // Before the fix this assertion exposes an actual written/readback/indexed
  // receipt from the real engine, only inside this disposable test Vault.
  expect(result).toBeUndefined();expect(String(error)).toMatch(/primary/i);
  expect(fs.readFileSync(path.join(vault,"Existing.md"),"utf8")).toBe(original);
  expect(fs.existsSync(path.join(vault,"New.md"))).toBe(false);
});
it.each(["verified_against_primary","verified_primary"])("rejects nested claim self-certification (%s) without evidence",async verification=>{
  const engine=await import("./engine");
  expect(()=>engine.preview({...request("create"),evidence:undefined,change:{kind:"create",
    content:`---\nverification: unverified\nclaims:\n  - verification: ${verification}\n    value: '13.5'\n---\n# Nested declaration\n`}},actor)).toThrow(/Primary verification/);
  expect(fs.existsSync(path.join(vault,"New.md"))).toBe(false);
});
it.each(["create","frontmatter"] as const)("rechecks an old %s preview at renewal and apply, even after admin approval",async kind=>{
  const engine=await import("./engine"),authority=await import("./primary-authority");
  // Emulate the old admission policy only. Preview/journal/token/receipt code
  // stays real; no rows or receipts are manufactured with direct SQL.
  const e=vi.spyOn(authority,"assertDeclaredEvidenceAuthority").mockImplementation(()=>{});
  const m=vi.spyOn(authority,"assertPrimaryMetadataAuthority").mockImplementation(()=>{});
  const p=engine.preview(request(kind),actor);e.mockRestore();m.mockRestore();
  engine.approve(p.operationId,"synthetic-owner",p.afterHash);
  expect(()=>engine.preview(request(kind),actor)).toThrow(/primary/);
  expect(()=>engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor)).toThrow(/primary/);
  expect(engine.status(p.operationId,actor)).toMatchObject({status:"preview",receipt:null});
  expect(fs.readFileSync(path.join(vault,"Existing.md"),"utf8")).toBe(original);
  expect(fs.existsSync(path.join(vault,"New.md"))).toBe(false);
  expect(fs.existsSync(path.join(root,"safe-edit.lock"))).toBe(false);
});
it("apply independently rejects old metadata-only promotion previews",async()=>{
  const engine=await import("./engine"),authority=await import("./primary-authority");
  const m=vi.spyOn(authority,"assertPrimaryMetadataAuthority").mockImplementation(()=>{});
  const p=engine.preview({...request("create"),evidence:undefined},actor);m.mockRestore();
  expect(()=>engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor)).toThrow(/primary/);
  expect(engine.status(p.operationId,actor)).toMatchObject({status:"preview",receipt:null});
  expect(fs.existsSync(path.join(vault,"New.md"))).toBe(false);
});
it("preserves legacy bytes/receipts and body edits as declarations, but refuses retargeting and rollback promotion",async()=>{
  const engine=await import("./engine"),authority=await import("./primary-authority");
  const e=vi.spyOn(authority,"assertDeclaredEvidenceAuthority").mockImplementation(()=>{});
  const m=vi.spyOn(authority,"assertPrimaryMetadataAuthority").mockImplementation(()=>{});
  const p=engine.preview(request("create"),actor),args={operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash};
  const historical=engine.apply(args,actor);e.mockRestore();m.mockRestore();
  const old=fs.readFileSync(path.join(vault,"New.md"));
  expect(engine.apply(args,actor)).toEqual(historical);expect(fs.readFileSync(path.join(vault,"New.md"))).toEqual(old);
  const edit=engine.preview({operationId:"legacy-body",path:"New.md",reason:"Historical declaration is not certified",
    change:{kind:"replace",oldText:"# Caller assertion",newText:"# Legacy assertion"}},actor);
  engine.apply({operationId:edit.operationId,previewToken:edit.previewToken,expectedHash:edit.beforeHash},actor);
  expect(()=>engine.preview({operationId:"retarget",path:"New.md",reason:"Cannot relabel primary metadata",
    change:{kind:"frontmatter",properties:{verified_at:"2026-11-06"}}},actor)).toThrow(/primary/);
  const down=engine.preview({operationId:"legacy-downgrade",path:"New.md",reason:"Keep history; remove declaration",
    change:{kind:"frontmatter",properties:{verification:"not_reverified"}}},actor);
  engine.apply({operationId:down.operationId,previewToken:down.previewToken,expectedHash:down.beforeHash},actor);
  expect(()=>engine.preview({operationId:"rollback-primary",path:"New.md",reason:"Cannot restore authority via rollback",
    change:{kind:"rollback",operationId:down.operationId}},actor)).toThrow(/primary/);
  expect(engine.status(p.operationId,actor)).toEqual(historical);
});
it("forged authority cannot change protected records or create an evidence-only verified journal entry",async()=>{
  const engine=await import("./engine");
  for(const rel of ["05_Thesis/Evidence Register.md","05_Thesis/Current Thesis.md","06_Portfolio/Trades.md","07_Sources/Primary.md"]){
    fs.mkdirSync(path.dirname(path.join(vault,rel)),{recursive:true});fs.writeFileSync(path.join(vault,rel),original);
    expect(()=>engine.preview({...request("frontmatter"),path:rel},actor)).toThrow();
    expect(fs.readFileSync(path.join(vault,rel),"utf8")).toBe(original);
  }
  expect(()=>engine.preview({...request("frontmatter"),change:{kind:"replace",oldText:"Historical fixture",newText:"Changed"}},actor)).toThrow(/primary/);
});
