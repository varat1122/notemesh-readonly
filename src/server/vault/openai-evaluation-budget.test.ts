import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {AUTOMATIC_CUTOFF, OpenAIEvaluationBudget, budgetedEvaluationTransport,
  maximumRequestCost, tokenCost, type EvaluationPricing} from "./openai-evaluation-budget";

// Deliberately fictional test pricing, NOT current OpenAI pricing.
const pricing: EvaluationPricing = {model: "gpt-test-2026-10-21",
  contextTokens: 400_000, maxOutputTokens: 128_000,
  inputUsdPerMillion: "1.25", outputUsdPerMillion: "10",
  evidenceSha256: "a".repeat(64)};
const roots: string[] = [], handles: OpenAIEvaluationBudget[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nm-api-budget-"));
  roots.push(root);
  const file = path.join(root, "campaign.sqlite");
  OpenAIEvaluationBudget.initialize(file);
  return {root, file, budget: open(file)};
}
function open(file: string) {const b = new OpenAIEvaluationBudget(file); handles.push(b); return b;}
afterEach(() => {
  for (const b of handles.splice(0)) {try {b.close();} catch { /* already closed */ }}
  for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});
});
function usage(input = 1000, output = 100, model = pricing.model, id = "resp_test") {
  return {id, model, status: "completed", service_tier:"default",output: [], usage: {
    input_tokens: input, output_tokens: output, total_tokens: input + output,
    input_tokens_details: {cached_tokens: 100}, output_tokens_details: {reasoning_tokens: 50},
  }};
}
function request(output = 16_384, model = pricing.model, marker = "test") {
  return {method: "POST", redirect: "error", body: JSON.stringify({model,
    store: false, service_tier: "default", max_output_tokens: output,
    input: [{role: "user", content: marker}], reasoning: {effort: "medium"},
    text: {format: {type: "json_schema"}},
  })} satisfies RequestInit;
}
const endpoint = "https://api.openai.com/v1/responses";
describe("one cumulative USD10 campaign / USD8.50 conservative cutoff", () => {
  it("reserves the whole context window, with exact upward-rounded money", () => {
    expect(maximumRequestCost(pricing, 16_384)).toBe(663_840_000);
    expect(tokenCost({...pricing, inputUsdPerMillion: "0.000000001"}, 1, 0)).toBe(1);
    expect(() => maximumRequestCost(pricing, 128_001)).toThrow("limits");
    expect(() => maximumRequestCost({...pricing, model: "gpt-alias"}, 10)).toThrow("limits");
  });
  it("allows exactly USD8.50 but refuses the next exposure, across models and restarts", () => {
    const {budget, file} = fixture();
    const p = {...pricing, contextTokens: 8_000_000, maxOutputTokens: 500_000,
      inputUsdPerMillion: "1", outputUsdPerMillion: "1"};
    const r = budget.reserve("round-1", "body", p, 500_000);
    expect(r.maximum).toBe(AUTOMATIC_CUTOFF);
    budget.reconcile(r.id, usage(8_000_000, 500_000));
    expect(budget.status().chargedNanoUsd).toBe(AUTOMATIC_CUTOFF);
    budget.close();
    const resumed = open(file);
    expect(resumed.status().remainingNanoUsd).toBe(0);
    expect(() => resumed.reserve("other-model", "body", {...pricing,
      model: "gpt-other-2026-10-21"}, 100)).toThrow("cutoff_exceeded");
    expect(() => OpenAIEvaluationBudget.initialize(file)).toThrow("already_initialized");
  });
  it("rejects expensive requests BEFORE dispatch, without imposing a tiny request cap", async () => {
    const {budget} = fixture();
    let dispatched = 0;
    const expensive = {...pricing, inputUsdPerMillion: "25"};
    const transport = budgetedEvaluationTransport(budget, expensive, "r", async () => {
      dispatched++; return new Response(JSON.stringify(usage()));
    });
    await expect(transport(endpoint, request())).rejects.toThrow("cutoff_exceeded");
    expect(dispatched).toBe(0);
    expect(budget.status().requests).toBe(0);
    // High output allowance is fine when it fits the remaining money.
    expect(budget.reserve("large", "body", pricing, 128_000).maximum).toBe(1_780_000_000);
  });
  it("reconciles reasoning within output once; charges cached input at full rate", () => {
    const {budget, file} = fixture();
    const r = budget.reserve("one", "body", pricing, 16_384);
    budget.reconcile(r.id, usage());
    expect(budget.status()).toMatchObject({chargedNanoUsd: 2_250_000,
      reservedNanoUsd: 0, blocked: false});
    budget.close();
    const resumed = open(file);
    const other = {...pricing, model: "gpt-other-2026-10-21", outputUsdPerMillion: "20"};
    const r2 = resumed.reserve("two", "body2", other, 32_768);
    resumed.reconcile(r2.id, usage(1000, 100, other.model, "resp_other"));
    expect(resumed.status().chargedNanoUsd).toBe(5_500_000);
  });
  it.each(["missing", "unknown-billable", "wrong-model", "invalid-reasoning", "bad-total"])(
    "retains maximum liability and freezes on %s usage", (kind) => {
      const {budget, file} = fixture();
      const r = budget.reserve("one", "body", pricing, 16_384);
      const response = usage() as Record<string, unknown>;
      if (kind === "missing") delete response.usage;
      if (kind === "unknown-billable") Object.assign(response.usage as object, {tool_fees: 20});
      if (kind === "wrong-model") response.model = "unrequested-model";
      if (kind === "invalid-reasoning") (response.usage as ReturnType<typeof usage>["usage"])
        .output_tokens_details.reasoning_tokens = 101;
      if (kind === "bad-total") (response.usage as ReturnType<typeof usage>["usage"]).total_tokens = 0;
      expect(() => budget.reconcile(r.id, response)).toThrow("usage_uncertain");
      budget.close();
      const resumed = open(file);
      expect(resumed.status()).toMatchObject({reservedNanoUsd: r.maximum, blocked: true});
      expect(() => resumed.reserve("two", "body", pricing, 100)).toThrow("no_retry");
    });
  it("records actual liability and freezes if provider exceeds its documented bounds", () => {
    const {budget} = fixture();
    const r = budget.reserve("one", "body", pricing, 100);
    expect(() => budget.reconcile(r.id, usage(400_001, 101))).toThrow("bounds_violated");
    expect(budget.status()).toMatchObject({chargedNanoUsd: 501_011_250,
      reservedNanoUsd: 0, blocked: true});
  });
  it.each(["exception", "401", "429", "missing-usage", "malformed"])(
    "dispatches once and never releases/retries uncertain %s", async (kind) => {
      const {budget} = fixture();
      let calls = 0;
      const guarded = budgetedEvaluationTransport(budget, pricing, "round", async () => {
        calls++;
        if (kind === "exception") throw Error("secret-never-echo");
        return new Response(kind === "missing-usage" ? "{}" : "not json", {
          status: kind === "401" ? 401 : kind === "429" ? 429 : 200,
        });
      });
      await expect(guarded(endpoint, request())).rejects.toThrow("uncertain_no_retry");
      await expect(guarded(endpoint, request())).rejects.toThrow("no_retry");
      expect(calls).toBe(1);
      expect(budget.status()).toMatchObject({reservedNanoUsd: 663_840_000, blocked: true});
    });
  it("prevents recursive/concurrent dispatch and same-round retries after settlement", async () => {
    const {budget, file} = fixture();
    const other = open(file);
    let calls = 0;
    const guarded = budgetedEvaluationTransport(budget, pricing, "baseline", async () => {
      calls++;
      await expect(guarded(endpoint, request())).rejects.toThrow("recursive_call");
      expect(() => other.reserve("parallel", "body", pricing, 100)).toThrow("no_retry");
      return new Response(JSON.stringify(usage()));
    });
    await guarded(endpoint, request());
    await expect(guarded(endpoint, request())).rejects.toThrow("duplicate");
    expect(calls).toBe(1);
  });
  it("stops an unlimited sequential caller at the remaining cumulative money", async () => {
    const {budget} = fixture();
    const p = {...pricing, contextTokens: 1_000_000, inputUsdPerMillion: "1", outputUsdPerMillion: "1"};
    let calls = 0;
    const guarded = budgetedEvaluationTransport(budget, p, "runaway", async () => {
      calls++; return new Response(JSON.stringify(usage(1_000_000, 100, p.model, "resp_" + calls)));
    });
    let stopped = false;
    for (let n = 0; n < 100; n++) {
      try {await guarded(endpoint, request(100, p.model, String(n)));}
      catch {stopped = true; break;}
    }
    expect(stopped).toBe(true); expect(calls).toBe(8);
    expect(budget.status().chargedNanoUsd).toBeLessThanOrEqual(AUTOMATIC_CUTOFF);
  });
  it("refuses unpriced tools, images, streaming and alternative models before dispatch", async () => {
    const {budget} = fixture();
    const guarded = budgetedEvaluationTransport(budget, pricing, "r", async () => {throw Error("must not dispatch");});
    for (const extra of [{tools: []}, {stream: true}, {model: "other"}, {background: true},
      {input: [{role: "user", content: [{type: "input_image", image_url: "https://example.org/image"}]}]}]) {
      const init = request();
      init.body = JSON.stringify({...JSON.parse(init.body), ...extra});
      await expect(guarded(endpoint, init)).rejects.toThrow("unpriced_request_shape");
    }
    expect(budget.status().requests).toBe(0);
  });
  it("detects damaged audit, missing ledger/sentinel and linked files", () => {
    const {budget, file, root} = fixture(); budget.close();
    const db = new Database(file); db.exec("UPDATE audit SET body='{}'"); db.close();
    expect(() => open(file)).toThrow("audit_corrupt");
    fs.unlinkSync(file);
    expect(() => open(file)).toThrow();
    expect(() => OpenAIEvaluationBudget.initialize(file)).toThrow("already_initialized");
    const other = fixture(); other.budget.close();
    fs.symlinkSync(other.file, path.join(root, "linked.sqlite"));
    expect(() => open(path.join(root, "linked.sqlite"))).toThrow("permissions_or_link");
    fs.unlinkSync(other.file + ".identity");
    expect(() => open(other.file)).toThrow();
  });
  it("retains a durable reservation through SIGKILL and rejects another PROCESS", async () => {
    const {budget, file} = fixture(); budget.close();
    const module = fileURLToPath(new URL("./openai-evaluation-budget.ts", import.meta.url));
    const script = `import {OpenAIEvaluationBudget} from ${JSON.stringify(module)};
      const b=new OpenAIEvaluationBudget(${JSON.stringify(file)});
      b.reserve('child','body',${JSON.stringify(pricing)},16384);
      process.stdout.write('reserved'); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script],
      {stdio: ["ignore", "pipe", "pipe"]});
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once("data", () => resolve()); child.once("error", reject);
        child.once("exit", () => reject(Error("reservation child exited")));
      });
      const contender = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
        script.replace("'child'", "'contender'")], {encoding: "utf8", timeout: 5000});
      expect(contender.status).not.toBe(0);
      expect(contender.stderr).toContain("unresolved_request_no_retry");
    } finally {
      child.kill("SIGKILL");
      await new Promise<void>(resolve => child.once("exit", () => resolve()));
    }
    const resumed = open(file);
    expect(resumed.status()).toMatchObject({reservedNanoUsd: 663_840_000, blocked: true});
    expect(() => resumed.reserve("restart", "body", pricing, 100)).toThrow("no_retry");
  });
});
