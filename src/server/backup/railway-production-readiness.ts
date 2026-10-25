/**
 * Offline-only, pure Production readiness evidence gate. NOT a deployment,
 * backup scheduler, restore API, permission check or operator authorization.
 * Recorded assertions require separate independent human/source verification.
 * This function NEVER changes any state and cannot authorize a rollout.
 */
export const RAILWAY_PRODUCTION_GATES=[
  "correct_production_identity",
  "scheduled_backup_provider_confirmed",
  "fresh_post_schedule_production_backup",
  "vault_sqlite_wal_consistency",
  "independent_nondisruptive_restore",
  "production_owner_permissions_and_flags",
  "immutable_offsite_audit_and_recovery",
  "production_release_sha_reconciled",
  "ci_exact_proposed_release_artifact",
  "railway_billing_within_owner_limit",
  "owner_explicit_production_release_approval",
] as const;

export type ProductionGateId=typeof RAILWAY_PRODUCTION_GATES[number];
export type VerificationStatus="verified"|"owner_reported"|"unknown"|"failed";
export type ProductionGateEvidence={
  status:VerificationStatus;
  /** Human-review pointer, not cryptographic proof or permission. */
  evidenceRef?:string;
  reviewedAt?:string;
};
export type ProductionReadinessEvidence={
  productionProjectId:string;
  productionEnvironment:"production";
  /** The exact provider inventory capture/backup operation if known. */
  scheduledAt?:string;
  latestBackupAt?:string;
  latestBackupKind?:"manual"|"scheduled"|"resize"|"unknown";
  gates:Partial<Record<ProductionGateId,ProductionGateEvidence>>;
};
type Reason="missing"|"unverified"|"failed"|"missing_evidence_reference"|
  "invalid_evidence_timestamp"|"stale_evidence"|"wrong_project_scope"|
  "no_recent_scheduled_backup"|"no_backup_after_schedule";
const PRODUCTION_PROJECT_ID="88f3c614-6222-4ad3-b80f-a0890a3ef587";
const HOURS_36=36*3600*1000;
function validTime(s:string|undefined):number|null {
  if(!s||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s))return null;
  const ms=Date.parse(s);
  return Number.isFinite(ms)?ms:null;
}
export function evaluateRailwayProductionReadiness(input:ProductionReadinessEvidence,nowISO:string){
  const now=validTime(nowISO);
  if(now===null)throw Error("invalid_review_clock");
  const gaps:{id:ProductionGateId;reason:Reason}[]=[];
  const wrongProject=input.productionProjectId!==PRODUCTION_PROJECT_ID||
    input.productionEnvironment!=="production";
  for(const id of RAILWAY_PRODUCTION_GATES){
    const item=input.gates[id];
    let reason:Reason|undefined;
    if(!item)reason="missing";
    else if(item.status==="failed")reason="failed";
    else if(item.status!=="verified")reason="unverified";
    else if(!item.evidenceRef||item.evidenceRef.trim().length<8)reason="missing_evidence_reference";
    else {
      const at=validTime(item.reviewedAt);
      if(at===null||at>now)reason="invalid_evidence_timestamp";
      else if(now-at>HOURS_36)reason="stale_evidence";
    }
    if(id==="correct_production_identity"&&wrongProject)reason="wrong_project_scope";
    if(id==="fresh_post_schedule_production_backup"&&!reason){
      const captured=validTime(input.latestBackupAt);
      const scheduled=validTime(input.scheduledAt);
      if(input.latestBackupKind!=="scheduled"||captured===null||captured>now||now-captured>HOURS_36){
        reason="no_recent_scheduled_backup";
      }else if(scheduled===null||captured<=scheduled){reason="no_backup_after_schedule";}
    }
    if(reason)gaps.push({id,reason});
  }
  return {
    format:"investment-os-railway-production-readiness/1" as const,
    scope:"offline_evidence_review_only" as const,
    approvalStatus:gaps.length?"NO_GO" as const:"READY_FOR_SEPARATE_OWNER_REVIEW" as const,
    productionChangesExecuted:false as const,
    releaseAutomaticallyAuthorized:false as const,
    providerRestoreAuthorized:false as const,
    actualBillingMeasuredByThisFunction:false as const,
    gaps,
    verifiedGateCount:RAILWAY_PRODUCTION_GATES.length-gaps.length,
    gateCount:RAILWAY_PRODUCTION_GATES.length,
  };
}
