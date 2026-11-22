/** IOS-ORCH-RI-001 WP2 — shared canonical authority kernel.
 *
 * Every canonical write route (OFF, C1 and the revision pilot) records a
 * server-origin Canonical Plan and exactly one witness per preview row, and
 * consumes that witness once at apply. A witness proves only that THIS server
 * recipe authorized THESE bytes for THIS actor under the current authority
 * epoch and mode. It does not prove issuer/economic truth, human presence or
 * primary evidence. Generic noncanonical editing is not routed through here.
 *
 * Plans can only be opened through a capability claimed once per scope by the
 * canonical route modules; preview helpers refuse anything without a live
 * handle minted here. Readers use SELECT-only helpers (no schema creation). */
import {createHash,randomBytes} from "node:crypto";
import {db,assertResearchEntry} from "../db";
import {c1Pilot,revisionPilotRequired} from "../c1-pilot";
import {canonicalNamespaceKind,normalizeVaultPath} from "./protected-records";

export const AUTHORITY_POLICY_VERSION="IOS-WP2-AUTHORITY-1";
export const WITNESS_VERSION="CRW-1";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
export type CanonicalKind="source_intake"|"canonical_review"|"structured_claim"|"review_revision";
export type AuthorityMode="off"|"c1"|"revision_pilot";
export type BaseTier=null|"legacy_origin_unverified";
export type ProvenanceTier="server_witnessed"|"server_witnessed_revision_on_legacy_base"|"legacy_origin_unverified"|"unwitnessed_post_epoch";
type Snapshot=Record<string,number>;
interface Member{kind:CanonicalKind;operationId:string;normPath:string;changeDigest:string;baseTier:BaseTier;baseSha256:string|null}
interface LivePlan{planId:string;scope:string;actor:string;intakeId:string|null;mode:AuthorityMode;recipeVersion:string;digest:string;members:Member[]}
export interface WitnessRow{witness_id:string;plan_id:string;preview_operation_id:string;kind:CanonicalKind;norm_path:string;
  before_sha256:string;after_sha256:string;actor:string;mode:AuthorityMode;policy_version:string;recipe_version:string;
  epoch_snapshot:string;intake_id:string|null;base_tier:BaseTier;base_sha256:string|null;recorded_at:string}

export function stableJson(v:unknown):string{
  if(Array.isArray(v))return "["+v.map(stableJson).join(",")+"]";
  if(v&&typeof v==="object")return "{"+Object.keys(v).sort().filter(k=>(v as Record<string,unknown>)[k]!==undefined)
    .map(k=>JSON.stringify(k)+":"+stableJson((v as Record<string,unknown>)[k])).join(",")+"}";
  return JSON.stringify(v);
}
function tableExists(name:string):boolean{
  return Boolean(db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function store(){
  assertResearchEntry();
  const d=db();
  d.exec(`CREATE TABLE IF NOT EXISTS canonical_plan(plan_id TEXT PRIMARY KEY, scope TEXT NOT NULL, intake_id TEXT,
      actor TEXT NOT NULL, mode TEXT NOT NULL, policy_version TEXT NOT NULL, recipe_version TEXT NOT NULL,
      members TEXT NOT NULL, plan_digest TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS canonical_witness(witness_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL,
      preview_operation_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, norm_path TEXT NOT NULL, before_sha256 TEXT NOT NULL,
      after_sha256 TEXT NOT NULL, actor TEXT NOT NULL, mode TEXT NOT NULL, policy_version TEXT NOT NULL,
      recipe_version TEXT NOT NULL, epoch_snapshot TEXT NOT NULL, intake_id TEXT, base_tier TEXT, base_sha256 TEXT,
      recorded_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS witness_consumption(witness_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
      consumed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS authority_epoch(scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, value INTEGER NOT NULL,
      PRIMARY KEY(scope_kind,scope_id));
    CREATE TABLE IF NOT EXISTS migration_epoch(epoch_id TEXT PRIMARY KEY, established_at TEXT NOT NULL,
      policy_version TEXT NOT NULL, actor TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS emig_inventory(epoch_id TEXT NOT NULL, kind TEXT NOT NULL, tier TEXT NOT NULL,
      n INTEGER NOT NULL, PRIMARY KEY(epoch_id,kind,tier));`);
  return d;
}

export function currentAuthorityMode():AuthorityMode{
  return c1Pilot()?"c1":revisionPilotRequired()?"revision_pilot":"off";
}
export function migrationEpoch():{epoch_id:string;established_at:string}|null{
  if(!tableExists("migration_epoch"))return null;
  return (db().prepare("SELECT epoch_id,established_at FROM migration_epoch ORDER BY established_at LIMIT 1").get() as
    {epoch_id:string;established_at:string}|undefined)??null;
}
/** OD-05 only: pending pre-WP2 authority that has no witness stays usable via the
 * dedicated kernel routes until the authorized migration epoch (never in the
 * revision pilot). Generic canonical refusal (OD-04+OD-06) does NOT depend on
 * this predicate: it applies in every mode. */
export function authorityRegimeActive():boolean{return revisionPilotRequired()||migrationEpoch()!==null;}
export const RESERVED_OPERATION_PREFIX=/^(?:icw|icr|ipb|irj|ipl)-/i;
export function isReservedOperationId(id:string):boolean{return RESERVED_OPERATION_PREFIX.test(id);}

export function epochValue(kind:"global"|"intake",id:string):number{
  if(!tableExists("authority_epoch"))return 0;
  return (db().prepare("SELECT value FROM authority_epoch WHERE scope_kind=? AND scope_id=?").get(kind,id) as {value:number}|undefined)?.value??0;
}
/** Restrictive events (HOLD/FAIL/withdrawal/migration) advance an epoch; any
 * witness snapshotting an older value can no longer be approved or consumed.
 * Source witnesses do not snapshot the intake scope: a Review HOLD never
 * invalidates a valid Source preservation. */
export function bumpAuthorityEpoch(kind:"global"|"intake",id:string){
  store().prepare("INSERT INTO authority_epoch(scope_kind,scope_id,value) VALUES(?,?,1) ON CONFLICT(scope_kind,scope_id) DO UPDATE SET value=value+1").run(kind,id);
}
function snapshot(kind:CanonicalKind,intakeId:string|null):Snapshot{
  const s:Snapshot={global:epochValue("global","policy")};
  if(kind!=="source_intake"&&intakeId)s.intake=epochValue("intake",intakeId);
  return s;
}

const claimed=new Set<string>();
const live=new WeakMap<object,LivePlan>();
export type PlanHandle=Readonly<{planId:string}>;
export interface PlanRequestMember{kind:CanonicalKind;operationId:string;path:string;change:unknown;
  base?:{tier:"legacy_origin_unverified";sha256:string}|null}
export interface PlanRequest{intakeId:string|null;actor:string;recipeVersion:string;members:PlanRequestMember[]}
/** Claimable once per scope per module instance: only the canonical route
 * module that owns the scope can mint plan handles. */
export function claimCanonicalPlanCapability(scope:"writeback"|"revision"){
  if(claimed.has(scope))throw Error("canonical_plan_capability_already_claimed");
  claimed.add(scope);
  return (req:PlanRequest):PlanHandle=>openPlan(scope,req);
}
const ICW=/^ICW-[a-f0-9]{32}$/,ICR=/^ICR-[a-f0-9]{32}$/;
function openPlan(scope:"writeback"|"revision",req:PlanRequest):PlanHandle{
  if(!req.members.length)throw Error("canonical_plan_empty");
  const members=req.members.map(m=>{
    const ns=canonicalNamespaceKind(m.path),change=m.change as {kind?:unknown;content?:unknown};
    if(scope==="revision"){
      if(m.kind!=="review_revision"||ns!=="canonical_review"||!ICR.test(m.operationId)||change?.kind!=="append")
        throw Error("canonical_plan_member_scope_hold");
    }else{
      if(m.kind==="review_revision"||ns!==m.kind||!ICW.test(m.operationId)||change?.kind!=="create"||typeof change.content!=="string"||m.base)
        throw Error("canonical_plan_member_scope_hold");
      // Deterministic recipe identity binds the ID to these exact bytes.
      if(m.operationId!=="ICW-"+sha([m.kind,m.path,sha(change.content)].join("\n")).slice(0,32))
        throw Error("canonical_plan_recipe_identity_hold");
    }
    return {kind:m.kind,operationId:m.operationId,normPath:normalizeVaultPath(m.path),changeDigest:sha(stableJson(m.change)),
      baseTier:m.base?.tier??null,baseSha256:m.base?.sha256??null};
  });
  const mode=currentAuthorityMode();
  const digest=sha(stableJson({scope,intakeId:req.intakeId,actor:req.actor,members,recipe:req.recipeVersion,policy:AUTHORITY_POLICY_VERSION,mode}));
  // Lifecycle (ORPHAN): the plan ID is content-addressed and the row is only
  // persisted together with its first witness (same transaction as the preview
  // row). A refused/failed preview leaves no plan row; retries reuse one row.
  const planId="IPL-"+digest.slice(0,32);
  const handle=Object.freeze({planId});
  live.set(handle,{planId,scope,actor:req.actor,intakeId:req.intakeId,mode,recipeVersion:req.recipeVersion,digest,members});
  return handle;
}

/** Witness writer: callable only with a live handle; the engine calls it in the
 * same transaction that inserts (or token-rotates) the preview row. */
export function bindPreviewWitness(handle:unknown,p:{kind:CanonicalKind;operationId:string;path:string;change:unknown;beforeHash:string;afterHash:string;actor:string}){
  const plan=handle&&typeof handle==="object"?live.get(handle):undefined;
  if(!plan)throw Error("canonical_plan_handle_required");
  if(plan.actor!==p.actor)throw Error("canonical_plan_actor_hold");
  if(plan.mode!==currentAuthorityMode())throw Error("authority_mode_changed");
  const m=plan.members.find(x=>x.operationId===p.operationId);
  // The calling preview helper is bound to the member kind (a Source helper can
  // never mint a Review/Claim witness and vice versa).
  if(!m||m.kind!==p.kind||m.normPath!==normalizeVaultPath(p.path)||m.changeDigest!==sha(stableJson(p.change)))throw Error("canonical_plan_member_mismatch");
  const d=store(),now=new Date().toISOString(),snap=JSON.stringify(snapshot(m.kind,plan.intakeId));
  const existing=d.prepare("SELECT * FROM canonical_witness WHERE preview_operation_id=?").get(p.operationId) as WitnessRow|undefined;
  if(existing){
    if(existing.kind!==m.kind||existing.norm_path!==m.normPath||existing.before_sha256!==p.beforeHash||
       existing.after_sha256!==p.afterHash||existing.actor!==p.actor)throw Error("canonical_witness_conflict");
    // A consumed witness is history: never re-bound, never re-armed.
    if(witnessConsumed(existing.witness_id))return existing;
  }
  d.prepare("INSERT OR IGNORE INTO canonical_plan VALUES(?,?,?,?,?,?,?,?,?,?)").run(plan.planId,plan.scope,plan.intakeId,plan.actor,plan.mode,
    AUTHORITY_POLICY_VERSION,plan.recipeVersion,JSON.stringify(plan.members),plan.digest,now);
  if(existing){
    // Token rotation under fresh authority re-binds the SAME preview to the
    // current plan/epoch; a superseded plan left without witnesses is removed.
    d.prepare("UPDATE canonical_witness SET plan_id=?,mode=?,epoch_snapshot=?,intake_id=?,base_tier=?,base_sha256=?,recipe_version=?,recorded_at=? WHERE witness_id=?")
      .run(plan.planId,plan.mode,snap,plan.intakeId,m.baseTier,m.baseSha256,plan.recipeVersion,now,existing.witness_id);
    if(existing.plan_id!==plan.planId)
      d.prepare("DELETE FROM canonical_plan WHERE plan_id=? AND NOT EXISTS(SELECT 1 FROM canonical_witness WHERE plan_id=?)").run(existing.plan_id,existing.plan_id);
    return witnessFor(p.operationId)!;
  }
  const witnessId="IWT-"+sha(plan.planId+"\0"+p.operationId).slice(0,32);
  d.prepare("INSERT INTO canonical_witness VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(witnessId,plan.planId,p.operationId,m.kind,m.normPath,
    p.beforeHash,p.afterHash,p.actor,plan.mode,AUTHORITY_POLICY_VERSION,plan.recipeVersion,snap,plan.intakeId,m.baseTier,m.baseSha256,now);
  return witnessFor(p.operationId)!;
}
export function witnessFor(operationId:string):WitnessRow|null{
  if(!tableExists("canonical_witness"))return null;
  return (db().prepare("SELECT * FROM canonical_witness WHERE preview_operation_id=?").get(operationId) as WitnessRow|undefined)??null;
}
export function witnessConsumed(witnessId:string):boolean{
  if(!tableExists("witness_consumption"))return false;
  return Boolean(db().prepare("SELECT 1 FROM witness_consumption WHERE witness_id=?").get(witnessId));
}
/** Approval and apply both require the witness to be current: same actor,
 * same mode, same policy and no restrictive epoch advance since binding. */
export function assertWitnessCurrent(w:WitnessRow,actor:string){
  if(w.actor!==actor)throw Error("canonical_witness_actor_hold");
  if(w.mode!==currentAuthorityMode())throw Error("authority_mode_changed");
  if(w.policy_version!==AUTHORITY_POLICY_VERSION)throw Error("authority_policy_changed");
  const s=JSON.parse(w.epoch_snapshot) as Snapshot;
  if(s.global!==epochValue("global","policy")||(s.intake!==undefined&&(!w.intake_id||s.intake!==epochValue("intake",w.intake_id))))
    throw Error("authority_epoch_changed");
}
/** Single consume at the write critical section (T-04). */
export function consumeCanonicalWitness(operationId:string,actor:string){
  const w=witnessFor(operationId);
  if(!w)throw Error("canonical_witness_required");
  assertWitnessCurrent(w,actor);
  try{store().prepare("INSERT INTO witness_consumption VALUES(?,?,?)").run(w.witness_id,operationId,new Date().toISOString());}
  catch{throw Error("canonical_witness_already_consumed");}
  return w;
}
function firstPreviewAt(operationId:string):string|null{
  if(!tableExists("safe_edit_events"))return null;
  return (db().prepare("SELECT at FROM safe_edit_events WHERE operation_id=? AND event='preview' ORDER BY rowid LIMIT 1").get(operationId) as {at:string}|undefined)?.at??null;
}
/** True when a canonical-looking operation predates the migration epoch. */
export function predatesMigrationEpoch(operationId:string):boolean{
  const e=migrationEpoch(),at=firstPreviewAt(operationId);
  return Boolean(e&&at&&at<e.established_at);
}
/** SELECT-only provenance tier of one written journal row (not of a chain). */
export function operationProvenanceTier(operationId:string):ProvenanceTier{
  const w=witnessFor(operationId);
  if(w)return witnessConsumed(w.witness_id)?(w.base_tier?"server_witnessed_revision_on_legacy_base":"server_witnessed"):"unwitnessed_post_epoch";
  if(revisionPilotRequired())return "unwitnessed_post_epoch";
  if(!migrationEpoch())return "legacy_origin_unverified";
  return predatesMigrationEpoch(operationId)?"legacy_origin_unverified":"unwitnessed_post_epoch";
}

/** Administrative cutover (WP2: synthetic fixtures only; no MCP/HTTP/RPC route).
 * Inventories canonical journal rows by tier, then advances the global epoch so
 * every pending pre-epoch authority must be prepared again (OD-05). Completed
 * history, bytes and receipts are never rewritten or backfilled. */
export function establishMigrationEpoch(actor:string){
  const d=store();
  return d.transaction(()=>{
    const existing=migrationEpoch();
    if(existing)return {...existing,inventory:migrationInventory(existing.epoch_id),created:false};
    const at=new Date().toISOString(),epochId="IME-"+sha(at+"\0"+randomBytes(16).toString("hex")).slice(0,32);
    const counts=new Map<string,number>();
    if(tableExists("safe_edit_operations")){
      for(const r of d.prepare("SELECT id,payload FROM safe_edit_operations WHERE status='written'").all() as {id:string;payload:string}[]){
        const kind=canonicalNamespaceKind(String(JSON.parse(r.payload).path??""));
        if(!kind)continue;
        const w=witnessFor(r.id),tier=w&&witnessConsumed(w.witness_id)?(w.base_tier?"server_witnessed_revision_on_legacy_base":"server_witnessed"):"legacy_origin_unverified";
        const key=kind+"\0"+tier;counts.set(key,(counts.get(key)??0)+1);
      }
    }
    for(const [key,n] of counts){const [kind,tier]=key.split("\0");d.prepare("INSERT INTO emig_inventory VALUES(?,?,?,?)").run(epochId,kind,tier,n);}
    d.prepare("INSERT INTO migration_epoch VALUES(?,?,?,?)").run(epochId,at,AUTHORITY_POLICY_VERSION,actor);
    bumpAuthorityEpoch("global","policy");
    return {epoch_id:epochId,established_at:at,inventory:migrationInventory(epochId),created:true};
  }).immediate();
}
export function migrationInventory(epochId:string):{kind:string;tier:string;n:number}[]{
  if(!tableExists("emig_inventory"))return [];
  return db().prepare("SELECT kind,tier,n FROM emig_inventory WHERE epoch_id=? ORDER BY kind,tier").all(epochId) as {kind:string;tier:string;n:number}[];
}
