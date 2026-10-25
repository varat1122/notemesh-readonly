import {describe,it,expect} from "vitest";
import {
 evaluateRailwayProductionReadiness,RAILWAY_PRODUCTION_GATES,
 type ProductionReadinessEvidence, type ProductionGateId,
} from "./railway-production-readiness";

const clock="2026-10-25T06:00:00Z";
const evidence=():ProductionReadinessEvidence=>({
 productionProjectId:"88f3c614-6222-4ad3-b80f-a0890a3ef587",
 productionEnvironment:"production",
 scheduledAt:"2026-10-25T04:00:00Z",
 latestBackupAt:"2026-10-25T05:00:00Z",
 latestBackupKind:"scheduled",
 gates:Object.fromEntries(RAILWAY_PRODUCTION_GATES.map(id=>[id,{
  status:"verified",evidenceRef:"human-reviewed-immutable-receipt/"+id,
  reviewedAt:"2026-10-25T05:30:00Z",
 }])) as ProductionReadinessEvidence["gates"],
});
function fail(result:ReturnType<typeof evaluateRailwayProductionReadiness>,gate:ProductionGateId){
 expect(result.approvalStatus).toBe("NO_GO");
 expect(result.gaps.some(g=>g.id===gate)).toBe(true);
 expect(result.releaseAutomaticallyAuthorized).toBe(false);
 expect(result.providerRestoreAuthorized).toBe(false);
}
describe("offline-only Railway production gates must fail closed",()=>{
 it("requires all independently reviewed gates even with owner-reported scheduled backups",()=>{
  const input=evidence();
  input.gates.scheduled_backup_provider_confirmed={status:"owner_reported",evidenceRef:"owner-message-20261025",reviewedAt:"2026-10-25T05:30:00Z"};
  input.gates.independent_nondisruptive_restore={status:"unknown"};
  fail(evaluateRailwayProductionReadiness(input,clock),"scheduled_backup_provider_confirmed");
  fail(evaluateRailwayProductionReadiness(input,clock),"independent_nondisruptive_restore");
 });
 it("rejects prior resize backup and manual backup even if newest",()=>{
  for(const kind of ["resize","manual","unknown"] as const){
   const input=evidence();input.latestBackupKind=kind;
   fail(evaluateRailwayProductionReadiness(input,clock),"fresh_post_schedule_production_backup");
  }
 });
 it("rejects Staging or wrong Production project, including same environment label",()=>{
  const input=evidence();input.productionProjectId="8ac4a414-9f0b-4a90-bcce-4995e5736d9d";
  fail(evaluateRailwayProductionReadiness(input,clock),"correct_production_identity");
 });
 it("rejects backup from before schedule, future timestamp or stale data",()=>{
  const input=evidence();input.latestBackupAt="2026-10-25T03:00:00Z";
  fail(evaluateRailwayProductionReadiness(input,clock),"fresh_post_schedule_production_backup");
  input.latestBackupAt="2026-10-26T08:00:00Z";
  fail(evaluateRailwayProductionReadiness(input,clock),"fresh_post_schedule_production_backup");
  input.latestBackupAt="2026-10-23T00:00:00Z";
  fail(evaluateRailwayProductionReadiness(input,clock),"fresh_post_schedule_production_backup");
 });
 it("missing refs and stale reviewed evidence cannot be promoted",()=>{
  const input=evidence();input.gates.production_owner_permissions_and_flags={status:"verified",reviewedAt:clock};
  fail(evaluateRailwayProductionReadiness(input,clock),"production_owner_permissions_and_flags");
  input.gates.production_owner_permissions_and_flags={status:"verified",reviewedAt:"2026-10-20T00:00:00Z",evidenceRef:"signed-reviewed-receipt"};
  fail(evaluateRailwayProductionReadiness(input,clock),"production_owner_permissions_and_flags");
 });
 it("even fully populated synthetic fixture cannot authorize deployment or Restore",()=>{
  const report=evaluateRailwayProductionReadiness(evidence(),clock);
  expect(report.approvalStatus).toBe("READY_FOR_SEPARATE_OWNER_REVIEW");
  expect(report.verifiedGateCount).toBe(report.gateCount);
  expect(report.productionChangesExecuted).toBe(false);
  expect(report.releaseAutomaticallyAuthorized).toBe(false);
  expect(report.providerRestoreAuthorized).toBe(false);
  expect(report.actualBillingMeasuredByThisFunction).toBe(false);
 });
});
