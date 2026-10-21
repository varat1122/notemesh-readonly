/** Trusted operator configuration, never model output or Vault frontmatter.
 * Current prices are NOT baked into the source. A blocked/changed official
 * document, absent project review, or stale review prevents any paid dispatch.
 */
import fs from "node:fs";
import {createHash} from "node:crypto";
import {z} from "zod";
import {LIVE_LEDGER, type EvaluationTransport} from "./openai-evaluation-budget";

export const LIVE_READINESS = LIVE_LEDGER + ".readiness.json";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const readinessSchema = z.object({
  campaign: z.literal("investment-os-openai-evaluation-20261021"),
  executionAuthorized: z.literal(true),
  authorizationReference: z.string().min(8),
  reviewedAt: z.string().datetime(),
  reviewedBy: z.string().min(2),
  dedicatedProjectId: z.string().regex(/^proj_[a-zA-Z0-9_-]+$/),
  organizationId: z.string().regex(/^org-[a-zA-Z0-9_-]+$/),
  exclusiveProjectAndCredential: z.literal(true),
  singlePersistentLedgerAuthority: z.literal(true),
  ledgerDurabilityReviewed: z.literal(true),
  // Most project "budgets" are alerts, not enforced caps. Explicitly record
  // the observed control rather than claiming a provider hard stop.
  providerControl: z.object({
    kind: z.enum(["verified_hard_limit", "alerts_only", "not_supported"]),
    reviewedEvidenceSha256: digest,
    configuredLimitUsd: z.literal("10.00").nullable(),
  }).strict(),
  model: z.string().regex(/^gpt-[a-z0-9.-]+-\d{4}-\d{2}-\d{2}$/),
  contextTokens: z.number().int().positive().max(10_000_000),
  maxOutputTokens: z.number().int().positive().max(1_000_000),
  inputUsdPerMillion: z.string().regex(/^\d+(\.\d+)?$/),
  outputUsdPerMillion: z.string().regex(/^\d+(\.\d+)?$/),
  upperRatesIncludeAllContextTiers: z.literal(true),
  reasoningIncludedInOutputTokens: z.literal(true),
  textOnlyStandardTierNoOtherBillables: z.literal(true),
  supportsResponsesStrictJsonAndReasoningEffort: z.literal(true),
  documents: z.array(z.object({
    purpose: z.enum(["pricing", "model", "project_controls"]),
    url: z.string().url(), sha256: digest,
  }).strict()).length(3),
}).strict();

export async function verifyEvaluationReadiness(key: string,
  file = LIVE_READINESS, transport: EvaluationTransport = fetch) {
  // Purely local gates MUST pass before any outbound metadata lookup.
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077))
    throw Error("openai_evaluation_readiness_private_file_required");
  const raw = fs.readFileSync(file, "utf8");
  const c = readinessSchema.parse(JSON.parse(raw));
  const age = Date.now() - Date.parse(c.reviewedAt);
  if (age < 0 || age > 24 * 60 * 60 * 1000 ||
      Number(c.inputUsdPerMillion) <= 0 || Number(c.outputUsdPerMillion) <= 0 ||
      (c.providerControl.kind === "verified_hard_limit" ?
        c.providerControl.configuredLimitUsd !== "10.00" :
        c.providerControl.configuredLimitUsd !== null))
    throw Error("openai_evaluation_stale_or_invalid_review_hold");
  if (new Set(c.documents.map(d => d.purpose)).size !== 3)
    throw Error("openai_evaluation_missing_official_evidence_hold");
  for (const d of c.documents) {
    const url = new URL(d.url);
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !["openai.com", "developers.openai.com", "platform.openai.com", "help.openai.com"].includes(url.hostname))
      throw Error("openai_evaluation_untrusted_evidence_url_hold");
    const response = await transport(d.url, {method: "GET", redirect: "error",
      cache: "no-store", signal: AbortSignal.timeout(30_000)});
    if (!response.ok) throw Error("openai_evaluation_official_evidence_unavailable_hold");
    const text = await response.text();
    if (text.length > 4_000_000 || createHash("sha256").update(text).digest("hex") !== d.sha256)
      throw Error("openai_evaluation_official_evidence_changed_hold");
  }
  // Availability lookup is not inference. No organization admin credential
  // or invented project-budget API. Dashboard controls require human review.
  const headers = {Authorization: "Bearer " + key,
    "OpenAI-Project": c.dedicatedProjectId, "OpenAI-Organization": c.organizationId};
  const response = await transport("https://api.openai.com/v1/models/" + c.model,
    {method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000)});
  if (!response.ok || (await response.json() as {id?: string}).id !== c.model)
    throw Error("openai_evaluation_model_not_available_hold");
  return {configuration: c, headers, pricing: {
    model: c.model, contextTokens: c.contextTokens, maxOutputTokens: c.maxOutputTokens,
    inputUsdPerMillion: c.inputUsdPerMillion, outputUsdPerMillion: c.outputUsdPerMillion,
    evidenceSha256: createHash("sha256").update(raw).digest("hex"),
  }};
}
