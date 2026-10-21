/** Cumulative, local-only evaluation accounting. Never a production writer. */
import fs from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import Database from "better-sqlite3";

export const CAMPAIGN = "investment-os-openai-evaluation-20261021";
// Integer nano-USD. No binary floating-point dollar arithmetic.
export const TOTAL_BUDGET = 10_000_000_000;
export const AUTOMATIC_CUTOFF = 8_500_000_000;
export const LIVE_LEDGER = "/workspace/.investment-os-evaluation/campaign.sqlite";
export type EvaluationTransport = (url: string, init: RequestInit) => Promise<Response>;
export type EvaluationPricing = {
  model: string;
  contextTokens: number;
  maxOutputTokens: number;
  // Reviewed UPPER rates, including any long-context price tier. Cached input
  // is deliberately charged at the full input rate. Reasoning is in output.
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  evidenceSha256: string;
};
type Event = {kind: "init"; campaign: string; identity: string;
  totalNanoUsd:number; cutoffNanoUsd:number} | {
  kind: "reserve"; id: string; requestKey: string; bodySha256: string;
  pricing: EvaluationPricing; outputLimit: number; maximum: number;
} | {kind: "settle"; id: string; charged: number; responseId: string;
  inputTokens: number; outputTokens: number; reasoningTokens: number;
  cachedTokens: number;
} | {kind: "uncertain"; id: string; reason:string; providerResponseId:string|null};
type AuditRow = {seq: number; body: string; previous: string; digest: string};
type Reservation = Extract<Event, {kind: "reserve"}>;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const hold = (code: string): never => {throw Error("openai_budget_" + code + "_hold");};
const integer = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
function rate(s: string) {
  // USD / million * 1e9 = nano-USD / token. Round UP fractional nano-USD.
  if (typeof s !== "string" || !/^\d{1,5}(\.\d{1,9})?$/.test(s))
    return hold("invalid_rate");
  const [whole, fraction = ""] = s.split(".");
  const billionths = BigInt(whole) * 1_000_000_000n +
    BigInt(fraction.padEnd(9, "0"));
  return (billionths + 999_999n) / 1_000_000n;
}
export function tokenCost(pricing: EvaluationPricing, input: number, output: number) {
  if (!integer(input) || !integer(output)) return hold("invalid_tokens");
  const n = BigInt(input) * rate(pricing.inputUsdPerMillion) +
    BigInt(output) * rate(pricing.outputUsdPerMillion);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return hold("unbounded_cost");
  return Number(n);
}
export function maximumRequestCost(pricing: EvaluationPricing, outputLimit: number) {
  if (!/^gpt-[a-z0-9.-]+-\d{4}-\d{2}-\d{2}$/.test(pricing.model) ||
      !/^[a-f0-9]{64}$/.test(pricing.evidenceSha256) ||
      !integer(pricing.contextTokens) || !pricing.contextTokens ||
      !integer(pricing.maxOutputTokens) || !pricing.maxOutputTokens ||
      !integer(outputLimit) || !outputLimit || outputLimit > pricing.maxOutputTokens ||
      rate(pricing.inputUsdPerMillion) === 0n || rate(pricing.outputUsdPerMillion) === 0n)
    return hold("unverified_model_or_limits");
  // Full context window, NOT a chars/4 estimate: includes hidden protocol,
  // schema and tokenizer overhead; deliberately over-reserves input.
  return tokenCost(pricing, pricing.contextTokens, outputLimit);
}
function privateFile(file: string) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o077))
    hold("ledger_permissions_or_link");
}
function privateDirectory(dir: string) {
  if (fs.realpathSync(dir) !== path.resolve(dir)) hold("ledger_directory_link");
  const s = fs.lstatSync(dir);
  if (!s.isDirectory() || (s.mode & 0o077)) hold("ledger_directory_permissions");
}
function durablePrivateFile(file: string, text: string) {
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL |
    fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try {fs.writeSync(fd, text); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
function syncDirectory(dir: string) {
  const fd = fs.openSync(dir, "r");
  try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}

export class OpenAIEvaluationBudget {
  private db: Database.Database;
  private identity: string;
  /** Explicit OFFLINE bootstrap only. Never called by the paid entrypoint.
   * No reset/reinitialize/release option. Missing DB OR sentinel later holds.
   */
  static initialize(file: string) {
    const dir = path.dirname(file);
    if (!path.isAbsolute(file)) hold("absolute_ledger_required");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {mode: 0o700});
    privateDirectory(dir);
    const sentinel = file + ".identity";
    if (fs.existsSync(file) || fs.existsSync(sentinel)) hold("already_initialized");
    const identity = randomUUID();
    durablePrivateFile(sentinel, JSON.stringify({campaign: CAMPAIGN, identity}));
    // A crash here leaves a sentinel, not a silently reusable empty campaign.
    durablePrivateFile(file, "");
    const db = new Database(file);
    try {
      db.pragma("synchronous = FULL");
      db.exec("CREATE TABLE audit (seq INTEGER PRIMARY KEY, body TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL)");
      const body = JSON.stringify({at: new Date().toISOString(), event: {
        kind: "init", campaign: CAMPAIGN, identity,
        totalNanoUsd:TOTAL_BUDGET,cutoffNanoUsd:AUTOMATIC_CUTOFF,
      }});
      db.prepare("INSERT INTO audit VALUES (1, ?, '', ?)").run(body, hash("\n" + body));
    } finally {db.close();}
    syncDirectory(dir);
  }
  constructor(file: string) {
    privateDirectory(path.dirname(file));
    privateFile(file); privateFile(file + ".identity");
    const sentinel = JSON.parse(fs.readFileSync(file + ".identity", "utf8"));
    if (sentinel.campaign !== CAMPAIGN || typeof sentinel.identity !== "string")
      hold("campaign_identity");
    this.identity = sentinel.identity;
    this.db = new Database(file, {fileMustExist: true, timeout: 0});
    this.db.pragma("journal_mode = DELETE");
    this.db.pragma("synchronous = FULL");
    try {this.state();} catch (error) {this.db.close(); throw error;}
  }
  close() {this.db.close();}
  private read() {
    const rows = this.db.prepare("SELECT * FROM audit ORDER BY seq").all() as AuditRow[];
    let previous = "";
    return rows.map((row, i) => {
      if (row.seq !== i + 1 || row.previous !== previous ||
          row.digest !== hash(previous + "\n" + row.body)) hold("audit_corrupt");
      previous = row.digest;
      return (JSON.parse(row.body) as {event: Event}).event;
    });
  }
  private state() {
    const events = this.read();
    const init = events[0];
    if (init?.kind !== "init" || init.campaign !== CAMPAIGN ||
        init.identity !== this.identity || init.totalNanoUsd!==TOTAL_BUDGET ||
        init.cutoffNanoUsd!==AUTOMATIC_CUTOFF) return hold("campaign_identity");
    let charged = 0, frozen = false;
    const active = new Map<string, Reservation>();
    const keys = new Set<string>(), responses = new Set<string>();
    for (const e of events.slice(1)) {
      if (e.kind === "reserve") {
        if (active.size || frozen || keys.has(e.requestKey) ||
            e.maximum !== maximumRequestCost(e.pricing, e.outputLimit) ||
            charged + e.maximum > AUTOMATIC_CUTOFF) hold("audit_invalid_reservation");
        keys.add(e.requestKey); active.set(e.id, e);
      } else if (e.kind === "settle") {
        const r = active.get(e.id);
        if (!r || !integer(e.charged) || responses.has(e.responseId) ||
            e.charged !== tokenCost(r.pricing, e.inputTokens, e.outputTokens) ||
            !integer(e.reasoningTokens) || e.reasoningTokens > e.outputTokens ||
            !integer(e.cachedTokens) || e.cachedTokens > e.inputTokens)
          return hold("audit_invalid_settlement");
        charged += e.charged;
        // Record real liability even if provider violates its stated bounds.
        if (e.charged > r.maximum || e.inputTokens > r.pricing.contextTokens ||
            e.outputTokens > r.outputLimit) frozen = true;
        active.delete(e.id); responses.add(e.responseId);
      } else if (e.kind === "uncertain" && active.has(e.id)) {
        frozen = true;
      } else hold("audit_invalid_event");
    }
    const reserved = [...active.values()].reduce((n, r) => n + r.maximum, 0);
    return {charged, reserved, frozen, active, keys, responses};
  }
  private append(event: Event) {
    const last = this.db.prepare("SELECT seq, digest FROM audit ORDER BY seq DESC LIMIT 1")
      .get() as {seq: number; digest: string};
    const body = JSON.stringify({at: new Date().toISOString(), event});
    this.db.prepare("INSERT INTO audit VALUES (?, ?, ?, ?)")
      .run(last.seq + 1, body, last.digest, hash(last.digest + "\n" + body));
  }
  status() {
    const s = this.state();
    return {campaign: CAMPAIGN, totalNanoUsd: TOTAL_BUDGET,
      cutoffNanoUsd: AUTOMATIC_CUTOFF, safetyBufferNanoUsd: TOTAL_BUDGET - AUTOMATIC_CUTOFF,
      chargedNanoUsd: s.charged, reservedNanoUsd: s.reserved,
      remainingNanoUsd: Math.max(0, AUTOMATIC_CUTOFF - s.charged - s.reserved),
      blocked: s.frozen || !!s.active.size, requests: s.keys.size};
  }
  reserve(requestKey: string, body: string, pricing: EvaluationPricing, outputLimit: number) {
    const maximum = maximumRequestCost(pricing, outputLimit);
    return this.db.transaction(() => {
      const s = this.state();
      if (s.frozen || s.active.size) return hold("unresolved_request_no_retry");
      if (!/^[a-zA-Z0-9:_.-]{1,240}$/.test(requestKey) || s.keys.has(requestKey))
        return hold("duplicate_or_invalid_request_key");
      if (s.charged + maximum > AUTOMATIC_CUTOFF) return hold("cutoff_exceeded");
      const r: Reservation = {kind: "reserve", id: randomUUID(), requestKey,
        bodySha256: hash(body), pricing, outputLimit, maximum};
      this.append(r);
      return r;
    }).immediate();
  }
  uncertain(id: string) {
    this.db.transaction(() => {
      const s = this.state();
      if (!s.active.has(id)) return hold("unknown_reservation");
      this.append({kind: "uncertain", id,reason:"transport_or_read_failure",providerResponseId:null});
    }).immediate();
  }
  reconcile(id: string, response: unknown) {
    this.db.transaction(() => {
      const s = this.state(), r = s.active.get(id);
      if (!r || s.frozen) return hold("unknown_or_uncertain_reservation");
      const p = response as Record<string, unknown> | null;
      const u = p?.usage as Record<string, unknown> | undefined;
      const inputDetails = u?.input_tokens_details as Record<string, unknown> | undefined;
      const outputDetails = u?.output_tokens_details as Record<string, unknown> | undefined;
      if (!p || !["completed", "incomplete"].includes(String(p.status)) ||
          p.model !== r.pricing.model || p.service_tier!=="default" || p.background===true ||
          !Array.isArray(p.output) || p.output.some(item=>!item||
            !["message","reasoning"].includes(String((item as {type?:unknown}).type))) ||
          typeof p.id !== "string" ||
          !/^resp_[a-zA-Z0-9_-]+$/.test(p.id) || s.responses.has(p.id) || !u ||
          Object.keys(u).some(k => !["input_tokens", "output_tokens", "total_tokens",
            "input_tokens_details", "output_tokens_details"].includes(k)) ||
          !integer(u.input_tokens) || !integer(u.output_tokens) ||
          u.total_tokens !== u.input_tokens + u.output_tokens ||
          !inputDetails || Object.keys(inputDetails).some(k => k !== "cached_tokens") ||
          !integer(inputDetails.cached_tokens) || inputDetails.cached_tokens > u.input_tokens ||
          !outputDetails || Object.keys(outputDetails).some(k => k !== "reasoning_tokens") ||
          !integer(outputDetails.reasoning_tokens) || outputDetails.reasoning_tokens > u.output_tokens) {
        this.append({kind: "uncertain", id,reason:"provider_usage_or_billing_contract_uncertain",
          providerResponseId:typeof p?.id==="string"&&/^resp_[a-zA-Z0-9_-]+$/.test(p.id)?p.id:null});
        return false;
      }
      const charged = tokenCost(r.pricing, u.input_tokens, u.output_tokens);
      this.append({kind: "settle", id, charged, responseId: p.id,
        inputTokens: u.input_tokens, outputTokens: u.output_tokens,
        reasoningTokens: outputDetails.reasoning_tokens, cachedTokens: inputDetails.cached_tokens});
      return true;
    }).immediate();
    const s = this.status();
    if (s.blocked) hold("usage_uncertain_or_provider_bounds_violated");
  }
}

/** One dispatch, no SDK retry, no redirect, tools, streaming, background work,
 * recursion, concurrent calls or automatic model changes. Use a new explicit
 * round identifier for an intentional repeat; same round/body never retries.
 */
export function budgetedEvaluationTransport(budget: OpenAIEvaluationBudget,
  pricing: EvaluationPricing, round: string, transport: EvaluationTransport) {
  let busy = false;
  return async (url: string, init: RequestInit) => {
    if (busy) return hold("parallel_or_recursive_call");
    const body = typeof init.body === "string" ? init.body : "";
    const p = JSON.parse(body) as Record<string, unknown>;
    const allowed = ["model", "store", "max_output_tokens", "input", "text", "reasoning", "service_tier"];
    const messages = p.input as Array<Record<string, unknown>> | undefined;
    const reasoning = p.reasoning as Record<string, unknown> | undefined;
    if (url !== "https://api.openai.com/v1/responses" || init.method !== "POST" ||
        init.redirect !== "error" || p.model !== pricing.model || p.store !== false ||
        p.service_tier !== "default" || Object.keys(p).some(k => !allowed.includes(k)) ||
        !Array.isArray(messages) || !messages.length || messages.some(m => !m ||
          !["system", "user"].includes(String(m.role)) || typeof m.content !== "string" ||
          Object.keys(m).some(k => !["role", "content"].includes(k))) ||
        !reasoning || Object.keys(reasoning).some(k => k !== "effort") ||
        !["low", "medium", "high"].includes(String(reasoning.effort)))
      return hold("unpriced_request_shape");
    const r = budget.reserve(round + ":" + hash(body), body, pricing, p.max_output_tokens as number);
    busy = true;
    try {
      const response = await transport(url, init);
      if (!response.ok) return hold("http_or_missing_usage");
      // Read under the original request's abort signal before releasing funds.
      const text = await response.text();
      if (text.length > 2_000_000) return hold("oversized_usage_response");
      budget.reconcile(r.id, JSON.parse(text));
      return new Response(text, {status: response.status, headers: {"content-type": "application/json"}});
    } catch {
      // If settlement already committed, do not invent an outstanding request.
      if (budget.status().reservedNanoUsd) budget.uncertain(r.id);
      return hold("request_failed_or_uncertain_no_retry");
    } finally {busy = false;}
  };
}
