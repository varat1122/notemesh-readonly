/** Shared read-only planner / Safe Edit wire shape; no writer imports. */
import {z} from "zod";
const nonempty=z.string().min(1);
export const researchReviewSchema = z.object({
    headlineTh:nonempty.max(500),translationTh:z.string().max(30000).optional(),
    whatChangedTh:nonempty.max(6000),mechanismTh:nonempty.max(6000),
    thesisImplicationTh:nonempty.max(6000),counterEvidenceTh:nonempty.max(6000),
    requiredEvidenceTh:nonempty.max(6000),
    claimAssessments:z.array(z.object({
      entity:nonempty.max(120).optional(),
      metric:nonempty.max(140),period:nonempty.max(120),unit:nonempty.max(80),
      competingValues:z.array(nonempty.max(150)).min(1).max(8),
      resolution:z.enum(["unresolved","verified_primary"]).describe(
        "AI autonomous default: unresolved if publisher provenance, metric scope, vintage or counter-evidence is uncertain. verified_primary needs an independently server-validated claim-scope receipt; AI confidence and user-provided receipt IDs are insufficient."),
      conclusion:z.enum(["no_change","conditional","confirmed"]).describe(
        "AI decides independently: no_change or conditional are allowed for unresolved evidence if prose clearly retains uncertainty. confirmed is blocked unless verified_primary passes the server evidence gate. Neither changes Thesis/Portfolio."),
      primaryEvidenceReceipt:z.string().max(500).optional().describe(
        "Server-issued claim-scope receipt only. Do not fabricate IDs or use ordinary Source/Vault receipts as proof; omit for unresolved claims."),
      primarySourceUrl:z.string().url().max(2000).optional(),
      verifiedValue:nonempty.max(150).optional()
    }).strict()).max(24).optional().describe(
      "Autonomous AI evidence decisions. Supply when Source text contains numeric guidance OR review prose/headline asserts material financial percentages (revenue, EPS, profit, margin, orders, targets, macro figures), regardless of caller-selected contentTypes/sourceKind. Record EACH material metric/period/unit/value and conflicting sources; unresolved + conditional/no_change is normal without trusted primary proof. Prose must not assert an unresolved number as fact. Never invent a primary Receipt ID.")
  }).strict().optional().describe("Structured Thai research: Thai headline and narration in each section. For foreign news, translationTh must faithfully cover all actually read extractedText in original order, including numbers, caveats and attribution; never invent unread pages. Thai news needs no duplicate translation. Claim truth and translation fidelity require research review, not merely a language-screen PASS.");
