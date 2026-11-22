import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {M2_POLICY} from "./research-decision-v2";

interface PolicyManifest {
  policyId:string;
  policyVersion:string;
  status:string;
  policyFile:string;
  policySha256:string;
  appliesTo:string[];
  decisionSchemaTarget:string;
  minimumOutcomeEnums:string[];
  minimumEventEnums:string[];
  primaryEvidenceAuthority:string;
  productionActivated:boolean;
}

const dir=new URL("../../../docs/investment-os/llm-policy/v1.0.0/",import.meta.url);
const manifest=JSON.parse(readFileSync(new URL("policy-manifest.json",dir),"utf8")) as PolicyManifest;

describe("M1 version-pinned canonical research policy candidate",()=>{
  it("binds the manifest to exact UTF-8 policy bytes, not an AI-supplied version label",()=>{
    expect(manifest.policyFile).toBe("research-decision-policy.md");
    expect(manifest.policySha256).toMatch(/^[a-f0-9]{64}$/);
    const bytes=readFileSync(new URL(manifest.policyFile,dir));
    const digest=createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(manifest.policySha256);
    expect(M2_POLICY.sha256).toBe(manifest.policySha256);
    expect(M2_POLICY.version).toBe(manifest.policyVersion);
    expect(bytes.toString("utf8")).toContain("Policy status:** CANDIDATE / SHADOW ONLY");
  });

  it("defines one non-live policy and event contract for all three rooms",()=>{
    expect(manifest.policyId).toBe("investment-os-canonical-research-decision");
    expect(manifest.policyVersion).toBe("1.0.0");
    expect(manifest.status).toBe("candidate_shadow_only");
    expect(manifest.productionActivated).toBe(false);
    expect(manifest.appliesTo).toEqual(["micro","macro","pdf"]);
    expect(manifest.decisionSchemaTarget).toBe("M2-proposed-not-implemented");
    expect(manifest.minimumEventEnums).toEqual([
      "new_event","added_detail","confirmation","duplicate","correction","contradiction","unresolved"]);
    expect(manifest.minimumOutcomeEnums).toEqual(["no_change","conditional","confirmed"]);
    expect(manifest.primaryEvidenceAuthority).toBe(
      "independently_server_validated_exact_claim_receipt_only");
  });
});
