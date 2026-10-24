import {afterEach, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {verifyEvaluationReadiness} from "./openai-evaluation-readiness";
const roots: string[] = [];
const digest = createHash("sha256").update("official fixture").digest("hex");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nm-api-readiness-")); roots.push(root);
  const file = path.join(root, "readiness.json");
  const config = {campaign: "investment-os-openai-evaluation-20261021", executionAuthorized: true,
    authorizationReference: "OFFLINE TEST ONLY", reviewedAt: new Date(Date.now() - 1000).toISOString(),
    reviewedBy: "fixture operator", dedicatedProjectId: "proj_fixture", organizationId: "org-fixture",
    exclusiveProjectAndCredential: true, singlePersistentLedgerAuthority: true, ledgerDurabilityReviewed: true,
    providerControl: {kind: "alerts_only", reviewedEvidenceSha256: digest, configuredLimitUsd: null as string | null},
    model: "gpt-test-2026-10-21", contextTokens: 400_000, maxOutputTokens: 128_000,
    inputUsdPerMillion: "1.25", outputUsdPerMillion: "10",
    upperRatesIncludeAllContextTiers: true, reasoningIncludedInOutputTokens: true,
    textOnlyStandardTierNoOtherBillables: true, supportsResponsesStrictJsonAndReasoningEffort: true,
    documents: ["pricing", "model", "project_controls"].map(purpose => ({purpose,
      url: "https://developers.openai.com/" + purpose, sha256: digest})),
  };
  const save = () => fs.writeFileSync(file, JSON.stringify(config), {mode: 0o600});
  save(); return {file, config, save};
}
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
it("verifies three reviewed official documents and exact snapshot availability without inference", async () => {
  const {file, config} = fixture(); const urls: string[] = [];
  const result = await verifyEvaluationReadiness("fake-test-key", file, async (url, init) => {
    urls.push(url); expect(init.method).toBe("GET"); expect(init.redirect).toBe("error");
    if (url.startsWith("https://api.openai.com/")) {
      expect(init.headers).toMatchObject({"OpenAI-Project": "proj_fixture"});
      return Response.json({id: config.model});
    }
    expect(init.headers).toBeUndefined();
    return new Response("official fixture");
  });
  expect(urls).toHaveLength(4); expect(urls.join(" ")).not.toContain("/responses");
  expect(result.pricing.model).toBe(config.model);
  expect(result.configuration.providerControl.kind).toBe("alerts_only");
});
it.each(["unauthorized", "stale", "future", "shared-key", "undurable", "misstated-hard-cap", "untrusted-url"])(
  "fails closed for %s local evidence", async (kind) => {
    const {file, config, save} = fixture(); let calls = 0;
    if (kind === "unauthorized") config.executionAuthorized = false;
    if (kind === "stale") config.reviewedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    if (kind === "future") config.reviewedAt = new Date(Date.now() + 3600_000).toISOString();
    if (kind === "shared-key") config.exclusiveProjectAndCredential = false;
    if (kind === "undurable") config.ledgerDurabilityReviewed = false;
    if (kind === "misstated-hard-cap") config.providerControl.configuredLimitUsd = "10.00";
    if (kind === "untrusted-url") config.documents[0].url = "https://evil.example/pricing";
    save();
    await expect(verifyEvaluationReadiness("fake", file, async () => {
      calls++; return new Response("official fixture");
    })).rejects.toThrow();
    expect(calls).toBe(0);
  });
it.each(["blocked", "changed", "unavailable-model"])("never enables execution with %s remote evidence", async kind => {
  const {file} = fixture(); let inference = 0;
  await expect(verifyEvaluationReadiness("fake", file, async url => {
    if (url.endsWith("/responses")) inference++;
    if (kind === "blocked") return new Response("forbidden", {status: 403});
    if (kind === "changed") return new Response("pricing changed");
    if (url.includes("/v1/models/")) return Response.json({id: "alias-not-reviewed"});
    return new Response("official fixture");
  })).rejects.toThrow();
  expect(inference).toBe(0);
});
