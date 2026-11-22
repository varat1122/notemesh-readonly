/** WP2 (IOS-ORCH-RI-001) synthetic oracles: shared Canonical Plan/Witness kernel.
 * OFF mode, isolated DATA_DIR. Apply uses a sync double: SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
 * (authority path only; real OFF/C1 persistence is proven in wp2-protected-boundary). */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import type {WritebackInput} from "../vault/investment-writeback-router";
vi.mock("./sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()})); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
const actor="oauth:wp2-kernel-fixture";
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const input:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic TESTA ordinary manual",inputFormat:"text",
 sourceKind:"news_media",sourceLanguage:"en",sourceChannel:"synthetic",contentTypes:["other"],
 sourceChat:"WP2 kernel synthetic fixture",sourceUrl:"https://example.org/testa/manual",eventDate:"2026-10-01",publicationDate:"2026-10-01",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC: TESTA issued an ordinary product manual on October 1.",
 researchReview:{headlineTh:"TESTA อัปเดตคู่มือที่ยังต้องตรวจต้นฉบับ",translationTh:"TESTA ออกคำชี้แจงเกี่ยวกับคู่มือสำหรับการใช้งานระบบสมมติ",
  whatChangedTh:"เป็นการกล่าวอ้างด้านเอกสารคู่มือ ไม่ใช่รายได้หรือกำไรที่เกิดขึ้นจริง",mechanismTh:"ยังไม่มีหลักฐานแสดงว่ารายละเอียดคู่มือมีผลต่อคำสั่งซื้อหรือการรับรู้รายได้",
  thesisImplicationTh:"คงมุมมองเดิม ไม่เปลี่ยน Thesis หรือ Portfolio จากรายละเอียดเอกสาร",counterEvidenceTh:"ข้อความส่งต่ออาจอ้างถึงรายละเอียดที่มีในเอกสารเดิม ต้องตรวจต้นฉบับ",
  requiredEvidenceTh:"ตรวจเอกสารที่ออกโดยผู้ผลิตและวันที่เผยแพร่ก่อนยกระดับข้อกล่าวอ้าง"}};
beforeEach(async()=>{vi.resetModules();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-kernel-")));vault=path.join(root,"vault");
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,31).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"# TESTA\n");fs.writeFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"# protected fixture\n");
 const ix=await import("../vault/indexer");ix.reindexPath("01_Companies/TESTA.md");ix.reindexPath("05_Thesis/TESTA - Current Thesis.md");
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"utf8")).toBe("# protected fixture\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
function files(dir=vault,base=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),base+e.name+"/"):[base+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
/** Side-effect ledger: raw files, SQLite rows, plan, witness, consumption, epoch, receipt, index, protected. */
async function ledger(){
 const d=(await import("../db")).db(),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const n=(t:string,w="")=>has(t)?(d.prepare(`SELECT count(*) n FROM ${t} ${w}`).get() as {n:number}).n:0;
 return {raw_file:files(),ops:n("safe_edit_operations"),events:n("safe_edit_events"),plan:n("canonical_plan"),witness:n("canonical_witness"),
  consumption:n("witness_consumption"),epoch:has("authority_epoch")?d.prepare("SELECT * FROM authority_epoch ORDER BY scope_kind,scope_id").all():[],
  receipt:n("safe_edit_operations","WHERE status='written'"),index:n("notes"),protected:sha(fs.readFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md")))};
}
async function plannedSteps(){
 const {planInvestmentWriteback}=await import("../vault/investment-writeback-router");
 return planInvestmentWriteback(input).safeEditWorkflow!.steps.filter(s=>s.safeEditRequest);
}
async function save(data:WritebackInput=input){
 const c=await import("../mcp/canonical-writeback"),p=c.prepareCanonicalWriteback(data,actor);
 return {prepared:p,applied:await c.applyCanonicalWriteback({input:data,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor)};
}

it("P02/P04 positive: server-planned create mints one plan + 1:1 witnesses, consumes each at apply; retry is idempotent",async()=>{
 const admission=await import("./admission");admission.establishMigrationEpoch("wp2-fixture-admin");
 const {prepared,applied}=await save();
 expect(applied.status).toBe("saved_verified");
 const l=await ledger();
 expect(l).toMatchObject({plan:1,witness:prepared.previews.length,consumption:prepared.previews.length,receipt:prepared.previews.length});
 for(const p of prepared.previews){
  const w=admission.witnessFor(p.operationId)!;
  expect(w).toMatchObject({preview_operation_id:p.operationId,actor,mode:"off",policy_version:"IOS-WP2-AUTHORITY-1",base_tier:null});
  expect(admission.witnessConsumed(w.witness_id)).toBe(true);
  expect(admission.operationProvenanceTier(p.operationId)).toBe("server_witnessed");
 }
 // Retry of the same authorizations: written receipts, no second consumption or write.
 const c=await import("../mcp/canonical-writeback");
 const again=await c.applyCanonicalWriteback({input,planId:prepared.planId,authorizations:[]},actor).catch(e=>String(e));
 expect(await ledger()).toEqual(l);
 expect(JSON.stringify(again)).not.toMatch(/canonical_witness_already_consumed/);
 const engine=await import("./engine");
 for(const p of prepared.previews)expect(engine.applyCanonicalStep({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor).status).toBe("written");
 expect(await ledger()).toEqual(l);
});

it("N13 forged PlanHandle / caller-chosen route fields: zero plan, witness, receipt, files",async()=>{
 (await import("./admission")).establishMigrationEpoch("wp2-fixture-admin");
 const engine=await import("./engine"),steps=await plannedSteps(),before=await ledger();
 const forged=Object.freeze({planId:"IPL-"+"0".repeat(32)});
 for(const s of steps){
  const req={...s.safeEditRequest!,reason:"forged handle probe"};
  const fn=s.kind==="source_intake"?engine.previewCanonicalSource:s.kind==="canonical_review"?engine.previewCanonicalReview:engine.previewCanonicalClaim;
  expect(()=>fn(forged,req,actor)).toThrow(/canonical_plan_handle_required/);
  expect(()=>fn(undefined as never,req,actor)).toThrow(/canonical_plan_handle_required/);
  expect(()=>engine.previewCanonicalAssessedClaim(forged,req,actor)).toThrow(/canonical_plan_handle_required/);
  // Same server-computed recipe through the generic route: refused post-epoch.
  expect(()=>engine.preview(req,actor)).toThrow(/canonical_operation_namespace_reserved/);
 }
 const c=await import("../mcp/canonical-writeback");
 for(const extra of [{operationId:steps[0].safeEditRequest!.operationId},{path:steps[0].path},{planHandle:{planId:"IPL-"+"1".repeat(32)}}])
  expect(()=>c.prepareCanonicalWriteback({...input,...extra},actor)).toThrow();
 expect(await ledger()).toEqual(before);
});

it("N13 adjacent: a live handle cannot carry a caller-chosen member, ID, path alias or changed bytes",async()=>{
 const admission=await import("./admission"),engine=await import("./engine"),steps=await plannedSteps();
 const open=admission.claimCanonicalPlanCapability("writeback");
 expect(()=>admission.claimCanonicalPlanCapability("writeback")).toThrow(/canonical_plan_capability_already_claimed/);
 const src=steps.find(s=>s.kind==="source_intake")!.safeEditRequest!;
 const content=(src.change as {content:string}).content;
 type Member=import("./admission").PlanRequestMember;
 const member=(m:Partial<Member>):Member=>({kind:"source_intake",operationId:src.operationId,path:src.path,change:src.change,...m});
 expect(()=>open({intakeId:null,actor,recipeVersion:"x",members:[member({operationId:"ICW-"+"a".repeat(32)})]})).toThrow(/canonical_plan_recipe_identity_hold/);
 expect(()=>open({intakeId:null,actor,recipeVersion:"x",members:[member({operationId:"ordinary-op-1"})]})).toThrow(/canonical_plan_member_scope_hold/);
 expect(()=>open({intakeId:null,actor,recipeVersion:"x",members:[member({path:"01_Companies/TESTA.md"})]})).toThrow(/canonical_plan_member_scope_hold/);
 expect(()=>open({intakeId:null,actor,recipeVersion:"x",members:[member({change:{kind:"create",content:content+"x"}})]})).toThrow(/canonical_plan_recipe_identity_hold/);
 expect(()=>open({intakeId:null,actor,recipeVersion:"x",members:[member({kind:"canonical_review"})]})).toThrow(/canonical_plan_member_scope_hold/);
 // Kind binding: a Source member cannot be minted by a Claim/Review preview helper.
 const before=await ledger();
 const h=open({intakeId:null,actor,recipeVersion:"x",members:[member({})]});
 expect(()=>engine.previewCanonicalClaim(h,{...src,reason:"helper/kind probe"},actor)).toThrow(/canonical_plan_member_mismatch/);
 expect(()=>engine.previewCanonicalReview(h,{...src,reason:"helper/kind probe"},actor)).toThrow(/canonical_plan_member_mismatch/);
 // Wrong actor, alias path and different bytes for the bound member never mint a witness.
 expect(()=>engine.previewCanonicalSource(h,{...src,reason:"probe"},"oauth:other-client")).toThrow(/canonical_plan_actor_hold/);
 expect(()=>engine.previewCanonicalSource(h,{...src,operationId:"ICW-"+"b".repeat(32),reason:"probe"},actor)).toThrow(/canonical_plan_member_mismatch/);
 expect(()=>engine.previewCanonicalSource(h,{...src,change:{kind:"create",content:content+"\nextra"},reason:"probe"},actor)).toThrow(/canonical_plan_member_mismatch/);
 const after=await ledger();
 // ORPHAN: opening a plan persists nothing; refused previews leave zero plan rows.
 expect(after).toEqual(before);expect(after.plan).toBe(0);expect(after.witness).toBe(0);
 // Adjacent positive: the exact member under the same live handle is admitted.
 const p=engine.previewCanonicalSource(h,{...src,reason:"exact member"},actor);
 expect(admission.witnessFor(p.operationId)).toMatchObject({plan_id:h.planId,kind:"source_intake"});
 expect((await ledger()).plan).toBe(1);
});

it("N14 replayed/consumed witness cannot authorize a second write; actor mismatch holds (E04)",async()=>{
 const admission=await import("./admission");admission.establishMigrationEpoch("wp2-fixture-admin");
 const {prepared}=await save({...input,captureOnly:true,researchReview:undefined});
 const id=prepared.previews[0].operationId,before=await ledger();
 expect(()=>admission.consumeCanonicalWitness(id,actor)).toThrow(/canonical_witness_already_consumed/);
 expect(()=>admission.consumeCanonicalWitness(id,"oauth:other-client")).toThrow(/canonical_witness_actor_hold/);
 expect(()=>admission.consumeCanonicalWitness("ICW-"+"c".repeat(32),actor)).toThrow(/canonical_witness_required/);
 const engine=await import("./engine");
 const auth={operationId:id,previewToken:prepared.previews[0].previewToken,expectedHash:prepared.previews[0].beforeHash};
 expect(()=>engine.apply(auth,actor)).toThrow(/canonical_route_required/);
 expect(()=>engine.applyCanonicalStep(auth,"oauth:other-client")).toThrow(/another/);
 expect(await ledger()).toEqual(before);
});

it("E13 static: plan/witness/consumption writers are module-private to admission.ts; only the two canonical route modules claim the capability",()=>{
 const src=path.resolve(__dirname,"..","..");
 const all=(d:string):string[]=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?all(path.join(d,e.name)):/\.(ts|tsx|js|cjs|mjs)$/.test(e.name)&&!/\.test\./.test(e.name)?[path.join(d,e.name)]:[]);
 const prod=all(src).concat(all(path.resolve(src,"..","scripts")));
 const rel=(f:string)=>path.relative(path.resolve(src,".."),f);
 const hits=(re:RegExp)=>prod.filter(f=>re.test(fs.readFileSync(f,"utf8"))).map(rel).sort();
 expect(hits(/(INSERT|UPDATE|DELETE|REPLACE)[^;"'`]*\b(canonical_witness|witness_consumption|canonical_plan|authority_epoch|migration_epoch|emig_inventory)\b/i)).toEqual(["src/server/safe-edit/admission.ts"]);
 expect(hits(/claimCanonicalPlanCapability\(/)).toEqual(["src/server/mcp/canonical-review-revision.ts","src/server/mcp/canonical-writeback.ts","src/server/safe-edit/admission.ts"]);
 expect(hits(/bindPreviewWitness\(/)).toEqual(["src/server/safe-edit/admission.ts","src/server/safe-edit/engine.ts"]);
 expect(hits(/consumeCanonicalWitness\(/)).toEqual(["src/server/safe-edit/admission.ts","src/server/safe-edit/engine.ts"]);
 // No MCP/HTTP/RPC entrypoint for the administrative migration epoch.
 expect(hits(/establishMigrationEpoch\(/)).toEqual(["src/server/safe-edit/admission.ts"]);
});

it("S01: candidate diff stays inside the Scope v1.0.1 allowlist (no forbidden path, <=19 production files)",()=>{
 const repo=path.resolve(__dirname,"..","..","..");const base="9167f54a2b2918d5a7480e514d3b7cea70e2e21a";
 const git=(...a:string[])=>execFileSync("git",a,{cwd:repo,encoding:"utf8",env:{PATH:process.env.PATH??"",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"}});
 try{git("cat-file","-e",base+"^{commit}");}catch{return;} // Base absent (shallow checkout): oracle not applicable.
 const changed=[...git("diff","--name-only",base,"--").split("\n"),...git("ls-files","--others","--exclude-standard").split("\n")].filter(f=>f&&f!=="node_modules");
 const prodAllow=["src/server/safe-edit/admission.ts","src/server/safe-edit/engine.ts","src/server/safe-edit/protected-records.ts","src/server/safe-edit/source-event-admission.ts",
  "src/server/safe-edit/canonical-review-revision-pilot.ts","src/server/mcp/canonical-review-revision.ts","src/server/mcp/canonical-writeback.ts","src/server/vault/canonical-writeback-workflow.ts",
  "src/server/vault/investment-research-context.ts","src/server/mcp/safe-edit-server.ts","src/server/vault/notes.ts","src/server/vault/disk.ts","src/server/vault/folders.ts",
  "src/server/safe-edit/schema.ts","src/routes/api/safe-edit-approval.ts","src/server/c1-pilot.ts","src/server/safe-edit/c1-pilot-review.ts","src/server/safe-edit/research-judge-gate.ts","src/server/safe-edit/emig-inventory.ts"];
 // Scope v1.0.1 §G.1 (34 existing) + §G.2 (9 new exact names) + §G.3 fixtures.
 // + Scope Amendment A1 §1: exactly these five test files (frozen proposal patch a7d0e459…).
 const amendmentTests=["src/server/mcp/c1-pilot-hardening-upgrade.test.ts","src/server/mcp/risk-draft-admission.test.ts","src/server/mcp/risk-draft-upgrade.test.ts","src/server/mcp/thai-research-persistence.test.ts","src/server/vault/source-archive-provenance-p0.test.ts"];
 const testAllowList=new Set(amendmentTests.concat(["src/server/safe-edit/engine.test.ts", "src/server/safe-edit/primary-authority.test.ts", "src/server/safe-edit/protected-aliases.test.ts", "src/server/mcp/source-event-admission.test.ts", "src/server/mcp/canonical-review-revision.test.ts", "src/server/mcp/canonical-review-revision-cold.test.ts", "src/server/mcp/canonical-claims.test.ts", "src/server/mcp/safe-edit-server.test.ts", "src/server/mcp/ri011-canonical-closed-loop.test.ts", "src/server/mcp/received-claims.test.ts", "src/server/mcp/received-claims-scope-integrity.test.ts", "src/server/mcp/claim-integrity-consumers.test.ts", "src/server/mcp/c1-pilot-admission.test.ts", "src/server/mcp/c1-pilot-cold.test.ts", "src/server/mcp/m53-canonical-integration.test.ts", "src/server/mcp/m54-canonical-integration.test.ts", "src/server/mcp/source-review-reuse.test.ts", "src/server/mcp/standalone-source-history.test.ts", "src/server/mcp/research-judge.test.ts", "src/server/vault/canonical-writeback-workflow.test.ts", "src/server/vault/investment-research-context.test.ts", "src/server/vault/investment-context-adversarial.test.ts", "src/server/vault/investment-research-local-closedloop.test.ts", "src/server/vault/primary-evidence-receipt-m551.test.ts", "src/server/user-attachment-vault.test.ts", "src/server/c1-pilot.test.ts", "src/routes/api/safe-edit-approval.test.ts", "src/routes/api/safe-edit-route.test.ts", "tests/http/c1-pilot.test.ts", "tests/http/claim-race.test.ts", "tests/source-event-fixture.ts", "src/server/mcp/general-persistence.test.ts", "src/server/mcp/legacy-judge-admission.test.ts", "src/server/mcp/received-claims-remediation.test.ts", "src/server/safe-edit/wp2-admission-authority.test.ts", "src/server/safe-edit/wp2-mode-epoch.test.ts", "src/server/safe-edit/wp2-protected-boundary.test.ts", "src/server/mcp/wp2-direct-helper-guards.test.ts", "src/server/mcp/wp2-review-revision-legacy.test.ts", "src/server/vault/wp2-legacy-readers.test.ts", "src/server/vault/wp2-attachment-boundary.test.ts", "src/routes/api/wp2-authority-approval.test.ts", "tests/http/wp2-authority-boundary.test.ts"]));
 const testAllow={test:(f:string)=>testAllowList.has(f)||/^tests\/fixtures\/wp2\/[^/]+\.(json|jsonl|md|txt|csv)$/.test(f)};
 // Scope Amendment A1 (Owner, 2026-11-14): +2 exact M56 paths; mcp/server.ts only as the exact
 // proposed descriptor hunk (blob 0b9c8c57…) and only after a path-specific shared-owner ACK.
 prodAllow.push("src/server/vault/event-review-relation-m56.ts");
 if(changed.includes("src/server/mcp/server.ts")){
  expect(git("hash-object","src/server/mcp/server.ts").trim()).toBe("6446c4cd8c6cf63f155aa85c751d955486533fb6");
  changed.splice(changed.indexOf("src/server/mcp/server.ts"),1);
 }
 const forbidden=/^(src\/server\/(db|auth|intake|user-attachment-vault)\.ts|src\/server\/mcp\/(auth|server)\.ts|src\/server\/safe-edit\/sync\.ts|src\/server\/(ob|sync|market-prices)\/|src\/routes\/api\/(market-prices-drive|intake-worker)|scripts\/|package\.json|pnpm-|\.github\/|Dockerfile)/;
 expect(changed.filter(f=>forbidden.test(f))).toEqual([]);
 expect(changed.filter(f=>!prodAllow.includes(f)&&!testAllow.test(f))).toEqual([]);
 // 19 original §C identities + 2 exact M56 paths (A1); this candidate's actual touched count is asserted separately.
 expect(changed.filter(f=>prodAllow.includes(f)).length).toBeLessThanOrEqual(21);
});

it("ORPHAN: retries reuse one content-addressed plan; a superseded plan left without witnesses is removed",async()=>{
 const c=await import("../mcp/canonical-writeback"),d=(await import("../db")).db();
 const cap={...input,captureOnly:true as const,researchReview:undefined};
 for(let i=0;i<5;i++)c.prepareCanonicalWriteback(cap,actor);
 expect(await ledger()).toMatchObject({plan:1,witness:1,consumption:0});
 const full=c.prepareCanonicalWriteback(input,actor);
 for(let i=0;i<3;i++)c.prepareCanonicalWriteback(input,actor);
 const plans=d.prepare("SELECT plan_id FROM canonical_plan").pluck().all() as string[];
 const referenced=new Set(d.prepare("SELECT plan_id FROM canonical_witness").pluck().all() as string[]);
 expect(plans.every(p=>referenced.has(p))).toBe(true); // no plan row without a witness
 expect((await ledger()).witness).toBe(new Set([...full.previews.map(p=>p.operationId),c.prepareCanonicalWriteback(cap,actor).previews[0]?.operationId].filter(Boolean)).size);
 // Token rotation of the SAME preview under a different plan re-binds the witness and drops the superseded plan.
 vi.resetModules();
 const admission=await import("./admission"),engine=await import("./engine"),steps=await plannedSteps();
 const open=admission.claimCanonicalPlanCapability("writeback"),src=steps.find(s=>s.kind==="source_intake")!.safeEditRequest!;
 const other=steps.find(s=>s.kind==="canonical_review")!.safeEditRequest!;
 const m=(r:typeof src,kind:"source_intake"|"canonical_review")=>({kind,operationId:r.operationId,path:r.path,change:r.change});
 const a=open({intakeId:"IN-AAAAAAAAAAAAAAAA",actor,recipeVersion:"orphan-a",members:[m(src,"source_intake")]});
 const b=open({intakeId:"IN-AAAAAAAAAAAAAAAA",actor,recipeVersion:"orphan-b",members:[m(src,"source_intake"),m(other,"canonical_review")]});
 const d2=(await import("../db")).db();
 // The pending Source preview already exists (same bytes); reuse its exact stored request.
 const stored=JSON.parse(d2.prepare("SELECT payload FROM safe_edit_operations WHERE id=?").pluck().get(src.operationId) as string);
 engine.previewCanonicalSource(a,stored,actor);
 expect((admission.witnessFor(src.operationId))!.plan_id).toBe(a.planId);
 engine.previewCanonicalSource(b,stored,actor);
 expect((admission.witnessFor(src.operationId))!.plan_id).toBe(b.planId);
 expect(d2.prepare("SELECT count(*) FROM canonical_plan WHERE plan_id=?").pluck().get(a.planId)).toBe(0);
 expect(d2.prepare("SELECT count(*) FROM canonical_plan WHERE plan_id=?").pluck().get(b.planId)).toBe(1);
});

it("R-1 fault before the journal transition: witness stays unconsumed and the preview remains retryable",async()=>{
 const c=await import("../mcp/canonical-writeback"),engine=await import("./engine"),admission=await import("./admission");
 const p=c.prepareCanonicalWriteback({...input,captureOnly:true,researchReview:undefined},actor).previews[0];
 const bad=path.join(root,"safe-edit-backups",p.operationId+".md");
 fs.mkdirSync(path.dirname(bad),{recursive:true});fs.writeFileSync(bad,"injected mismatching backup");
 const auth={operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash};
 expect(()=>engine.applyCanonicalStep(auth,actor)).toThrow(/Existing backup checksum mismatch/);
 const w=admission.witnessFor(p.operationId)!;
 expect(admission.witnessConsumed(w.witness_id)).toBe(false);expect(engine.status(p.operationId,actor).status).toBe("preview");
 expect(fs.existsSync(path.join(vault,p.path))).toBe(false);
 fs.rmSync(bad);
 expect(engine.applyCanonicalStep(auth,actor).status).toBe("written");
 expect(admission.witnessConsumed(w.witness_id)).toBe(true);expect((await ledger()).consumption).toBe(1);
});

it("R-1 fault after the journal transition: consumption and 'writing' commit together; no replay, no receipt, recovery stays administrative",async()=>{
 const c=await import("../mcp/canonical-writeback"),engine=await import("./engine"),admission=await import("./admission");
 const reader=await import("../vault/investment-research-context");
 const p=c.prepareCanonicalWriteback({...input,captureOnly:true,researchReview:undefined},actor).previews[0];
 const auth={operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash};
 const fault=vi.spyOn(fs,"linkSync").mockImplementationOnce(()=>{throw Error("injected publication failure");});
 try{expect(()=>engine.applyCanonicalStep(auth,actor)).toThrow(/injected publication failure/);}finally{fault.mockRestore();}
 const w=admission.witnessFor(p.operationId)!,before=await ledger();
 expect(engine.status(p.operationId,actor).status).toBe("writing");
 expect(admission.witnessConsumed(w.witness_id)).toBe(true);expect(before.consumption).toBe(1);
 expect(fs.existsSync(path.join(vault,p.path))).toBe(false);
 expect(()=>engine.applyCanonicalStep(auth,actor)).toThrow(/Interrupted write/);
 expect(()=>engine.apply(auth,actor)).toThrow(/canonical_route_required/);
 expect(()=>c.prepareCanonicalWriteback({...input,captureOnly:true,researchReview:undefined},actor)).toThrow(/interrupted operation/);
 expect(()=>reader.createReceipt("source_intake",p.path,"")).toThrow();
 expect(await ledger()).toEqual(before);
});
