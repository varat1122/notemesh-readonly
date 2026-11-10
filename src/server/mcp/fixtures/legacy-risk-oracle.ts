/** TEST-ONLY compatibility oracle for pre-RISK-1 authority/lifecycle fixtures.
 * These suites intentionally simulate the old semantic eligibility decision so
 * financial fixtures can still exercise seals, withdrawals, CAS and receipts.
 * They do NOT establish current risk-tier eligibility. The unmocked policy and
 * public admission are tested end-to-end in risk-draft-admission.test.ts.
 * No receipts, journal state, freshness checks or write guards are mocked here.
 */
import type {judgeDraftRisk} from "../../vault/research-draft-risk";
export const legacyRiskOracle:typeof judgeDraftRisk=(_body,result)=>{
 const criticRequired=result.materialRisk||["added_detail","correction","contradiction","unresolved"].includes(result.event.classification);
 return {policy:"RI001-DRAFT-RISK-1",decision:criticRequired?"HOLD":"PASS",reasons:criticRequired?["independent_critic_provenance_unavailable"]:[],criticRequired,authority:"analyst_attested_only"};
};
