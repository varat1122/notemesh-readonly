import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { PriceStore } from "./store.ts";
import { instrument, isoDate, PriceError, type InstrumentInput } from "./model.ts";
import { listingSessionQuality } from "./listing-quality.ts";
import type { RequestedPriceSnapshot } from "./yahoo.ts";

const hash = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const MAX_DATABASE = 16 * 1024 * 1024, MAX_LISTING = 512 * 1024;
type QualityFlag = { code: string; session_date?: string };
export interface LocalPriceSnapshot {
  version: 1; as_of: string; listing_key: string; canonicalListingId: null;
  identity: { market: string; ticker: string; exchange: string | null; currency: string; timezone: string; source_symbol: string;
    status: "database_declaration_not_independently_verified" | "provider_metadata_observed_not_registry_verified";
    exchange_namespace: "configured_venue" | "yahoo_exchangeName" | "unknown";
    observation_receipt_sha256?: string; source_response_sha256?: string; source_url?: string };
  coverage: { first_available_session: string | null; latest_available_session: string | null; exported_rows: number; database_rows: number;
    scope: "cached_response_window_not_listing_inception" };
  facts: { listing: string; session_date: string; open: number | null; high: number | null; low: number | null; close: number;
    adj_close: number | null; volume: number | null; currency: string; exchange: string | null; timezone: string;
    source: string; retrieved_at: string; quality_status: "ACCEPTED" | "HOLD"; value_hash: string }[];
  quality: { flags: QualityFlag[]; calendar: ReturnType<typeof listingSessionQuality>; latest_refresh: ReturnType<PriceStore["lastAttempt"]> | null;
    source_quality_flags: unknown[]; total_source_issue_count: number; export_window_issue_count: number;
    raw_facts_are_normalized_provider_quotes: true };
  corporate_actions: { date: string; kind: string }[];
  provenance: { data_origin: unknown; rights: unknown; price_basis: string; historical_point_in_time: false };
}

/** Listing-local view of existing stored observations. No schema, registry, price or FX mutations. */
export function buildLocalPriceSnapshot(store: PriceStore, input: InstrumentInput, asOf: Date, limit = 62,
  observed?: { identity: NonNullable<RequestedPriceSnapshot["providerIdentity"]>; receiptSha256: string }): LocalPriceSnapshot {
  if (!Number.isInteger(limit) || limit < 22 || limit > 252 || !Number.isFinite(asOf.getTime())) throw new PriceError("invalid_snapshot_window");
  const target = instrument(input);
  const identity = store.db.prepare("SELECT id,market,symbol,yahoo_symbol,currency,time_zone FROM instruments WHERE id=?").get(target.id) as
    { id: string; market: string; symbol: string; yahoo_symbol: string; currency: string; time_zone: string } | undefined;
  if (!identity) throw new PriceError("price_instrument_not_cached");
  // Preserve DB declarations; a configured venue is not a provider/exchange verification receipt.
  const data = store.read(input, undefined, undefined, limit), declared = data.series.instrument as { venue?: unknown } | undefined;
  let venue = typeof declared?.venue === "string" && !declared.venue.startsWith("UNVERIFIED_") ? declared.venue : null;
  if (observed) {
    const value = observed.identity, url = new URL(value.sourceUrl ?? "https://invalid.example");
    if (value.authority !== "provider_response_claim_not_registry_verification" || value.sourceSymbol !== identity.yahoo_symbol ||
      value.currency !== identity.currency || value.timeZone !== identity.time_zone || value.observedAt !== data.latestRefresh?.attempted_at ||
      !value.exchange?.trim() || value.exchange.length > 64 || !/^[a-f0-9]{64}$/.test(value.responseSha256 ?? "") ||
      url.origin !== "https://query1.finance.yahoo.com" || url.username || url.password || url.pathname !== `/v8/finance/chart/${encodeURIComponent(identity.yahoo_symbol)}`) throw new PriceError("snapshot_observation_binding_mismatch");
    venue = value.exchange;
  }
  const flags: QualityFlag[] = [];
  if (identity.yahoo_symbol !== target.yahooSymbol || identity.currency !== target.currency || identity.time_zone !== target.timeZone) flags.push({ code: "LISTING_METADATA_MISMATCH" });
  const seen = new Set<string>();
  const facts = data.bars.map(bar => {
    // JSON must never silently turn a non-finite stored observation into null.
    if ([bar.open, bar.high, bar.low, bar.close, bar.volume, bar.adjustedClose].some(v => v !== null && !Number.isFinite(v))) throw new PriceError("snapshot_nonfinite_stored_value");
    const duplicate = seen.has(bar.date); seen.add(bar.date);
    const full = bar.open !== null && bar.high !== null && bar.low !== null;
    const closeOnly = bar.open === null && bar.high === null && bar.low === null;
    const invalid = !Number.isFinite(bar.close) || bar.close <= 0 || (!full && !closeOnly) ||
      (full && (![bar.open, bar.high, bar.low].every(Number.isFinite) || bar.low! <= 0 || bar.open! <= 0 ||
        bar.high! < Math.max(bar.open!, bar.close, bar.low!) || bar.low! > Math.min(bar.open!, bar.close))) ||
      (bar.volume !== null && (!Number.isSafeInteger(bar.volume) || bar.volume < 0)) ||
      (bar.adjustedClose !== null && (!Number.isFinite(bar.adjustedClose) || bar.adjustedClose <= 0));
    if (!Number.isFinite(Date.parse(bar.fetchedAt)) || Date.parse(bar.fetchedAt) > asOf.getTime()) throw new PriceError("snapshot_as_of_precedes_observation");
    if (duplicate || invalid) flags.push({ code: duplicate ? "DUPLICATE_SESSION" : "INVALID_STORED_BAR", session_date: bar.date });
    return { listing: identity.id, session_date: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      adj_close: bar.adjustedClose, volume: bar.volume, currency: identity.currency, exchange: venue, timezone: identity.time_zone,
      source: "yahoo-chart", retrieved_at: bar.fetchedAt, quality_status: duplicate || invalid ? "HOLD" as const : "ACCEPTED" as const, value_hash: bar.valueHash };
  });
  const calendar = listingSessionQuality(input, facts.map(b => b.session_date), asOf);
  const from = facts[0]?.session_date ?? calendar.expectedLatestSession;
  const through = [calendar.expectedLatestSession, facts.at(-1)?.session_date ?? ""].sort().at(-1)!;
  const issues = store.db.prepare(`SELECT date AS session_date,reason,values_json AS raw_values_json,last_seen_at AS last_seen_at
    FROM quality_issues WHERE instrument_id=? AND date BETWEEN ? AND ? AND resolved_at IS NULL ORDER BY date,reason LIMIT 101`)
    .all(target.id, from, through);
  const issueCount = (store.db.prepare("SELECT COUNT(*) AS n FROM quality_issues WHERE instrument_id=? AND date BETWEEN ? AND ? AND resolved_at IS NULL").get(target.id, from, through) as { n: number }).n;
  const actions = store.db.prepare("SELECT date,kind,value,denominator FROM actions WHERE instrument_id=? AND date BETWEEN ? AND ? ORDER BY date,event_key LIMIT 201")
    .all(target.id, from, through) as { date: string; kind: string }[];
  if (!facts.length) flags.push({ code: "NO_OBSERVATIONS" });
  if (calendar.latestObservedSession && calendar.latestObservedSession < calendar.expectedLatestSession) flags.push({ code: "STALE_LATEST_SESSION" });
  if (calendar.latestObservedSession && calendar.latestObservedSession > calendar.expectedLatestSession) flags.push({ code: "UNCOMPLETED_SESSION" });
  if (calendar.missingSessionCount) flags.push({ code: "POSSIBLE_MISSING_SESSIONS" });
  if (calendar.scanTruncated || issues.length > 100 || actions.length > 200) flags.push({ code: "QUALITY_SCAN_TRUNCATED" });
  if (issueCount) flags.push({ code: "QUARANTINED_OBSERVATIONS" });
  if (data.latestRefresh?.success === 0) flags.push({ code: data.latestRefresh.error_code ?? "LATEST_REFRESH_FAILED" });
  const hasPartial = !!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='partial_bars'").get();
  const coverage = store.db.prepare(`SELECT MIN(date) AS first,MAX(date) AS last FROM
    (SELECT date FROM bars WHERE instrument_id=? ${hasPartial ? "UNION ALL SELECT date FROM partial_bars WHERE instrument_id=?" : ""})`)
    .get(...(hasPartial ? [target.id, target.id] : [target.id])) as { first: string | null; last: string | null };
  return { version: 1, as_of: asOf.toISOString(), listing_key: identity.id, canonicalListingId: null,
    identity: { market: identity.market, ticker: identity.symbol, exchange: venue, currency: identity.currency, timezone: identity.time_zone,
      source_symbol: identity.yahoo_symbol, status: observed ? "provider_metadata_observed_not_registry_verified" : "database_declaration_not_independently_verified",
      exchange_namespace: observed ? "yahoo_exchangeName" : venue ? "configured_venue" : "unknown",
      ...(observed ? { observation_receipt_sha256: observed.receiptSha256, source_response_sha256: observed.identity.responseSha256, source_url: observed.identity.sourceUrl } : {}) },
    coverage: { first_available_session: coverage.first, latest_available_session: coverage.last, exported_rows: facts.length, database_rows: data.total,
      scope: "cached_response_window_not_listing_inception" },
    facts, quality: { flags, calendar, latest_refresh: data.latestRefresh, source_quality_flags: issues.slice(0, 100),
      total_source_issue_count: data.qualityIssueCount, export_window_issue_count: issueCount, raw_facts_are_normalized_provider_quotes: true },
    corporate_actions: actions.slice(0, 200),
    provenance: { data_origin: data.series.dataOrigin ?? "UNKNOWN", rights: data.series.rights ?? "UNKNOWN",
      price_basis: data.policy.priceBasis, historical_point_in_time: false } };
}

/** Explicit arithmetic over cached observations; 1M means 21 observed sessions, not a calendar-month or total return. */
export function queryLocalPriceSnapshot(snapshot: LocalPriceSnapshot, options: { start?: string; end?: string; limit?: number } = {}) {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 252) throw new PriceError("invalid_snapshot_query_limit");
  if (options.start) isoDate.parse(options.start); if (options.end) isoDate.parse(options.end);
  if (options.start && options.end && options.start > options.end) throw new PriceError("invalid_price_date_range");
  const history = snapshot.facts.filter(b => (!options.start || b.session_date >= options.start) && (!options.end || b.session_date <= options.end));
  const rows = history.slice(-limit), latest = history.at(-1);
  const hold = snapshot.quality.flags.length > 0;
  const returns = [1, 5, 21].map(sessions => {
    const base = history.at(-sessions - 1);
    const split = base && latest && snapshot.corporate_actions.some(a => a.kind === "split" && a.date > base.session_date && a.date <= latest.session_date);
    const status = hold ? "QUALITY_HOLD" : !base || !latest ? "INSUFFICIENT_OBSERVATIONS" : split ? "CORPORATE_ACTION_HOLD" : "CALCULATED";
    return { label: sessions === 21 ? "1M" : `${sessions}D`, observed_session_intervals: sessions, basis: "provider_close_price_return",
      baseline_session: base?.session_date ?? null, end_session: latest?.session_date ?? null,
      value_pct: status === "CALCULATED" ? (latest!.close / base!.close - 1) * 100 : null, status };
  });
  const extrema = !hold && rows.length ? { first_session: rows[0].session_date, last_session: rows.at(-1)!.session_date,
    max_close: Math.max(...rows.map(b => b.close)), min_close: Math.min(...rows.map(b => b.close)),
    max_high: rows.every(b => b.high !== null) ? Math.max(...rows.map(b => b.high!)) : null,
    min_low: rows.every(b => b.low !== null) ? Math.min(...rows.map(b => b.low!)) : null } : null;
  return { listing: snapshot.listing_key, canonicalListingId: null, identity: snapshot.identity, as_of: snapshot.as_of,
    latest_session: latest?.session_date ?? null, raw_facts: rows, quality_flags: snapshot.quality,
    derived_values: { returns, extrema, calculation_scope: "Returns use exported history within start/end; extrema use returned rows.",
      one_month_definition: "21 observed session intervals; not a calendar month. No dividend reinvestment, FX or listing conversion." },
    returned_rows: rows.length, available_exported_rows: history.length, truncated: history.length > rows.length,
    coverage: snapshot.coverage, provenance: snapshot.provenance };
}

const fileSchema = z.object({ name: z.string().regex(/^(prices\.sqlite|provider-receipt\.json|[A-Z]{2}_[A-Za-z0-9_%^-]+\.json)$/), bytes: z.number().int().positive().max(MAX_DATABASE), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const manifestSchema = z.object({ version: z.literal(1), kind: z.literal("listing-local-private-archive"), asOf: z.string().datetime(),
  sourceSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(fileSchema).min(2).max(22) }).strict();
type Manifest = z.infer<typeof manifestSchema>;
function regularFile(file: string, maximum: number) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum) throw new PriceError("unsafe_local_snapshot_file");
  return stat;
}
function durableFile(file: string, bytes: Buffer) {
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDirectory(dir: string) { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function loadManifest(generation: string): Manifest {
  if (!/^[a-f0-9]{64}$/.test(path.basename(generation)) || fs.realpathSync(generation) !== path.resolve(generation)) throw new PriceError("unpublished_snapshot_generation");
  regularFile(path.join(generation, "manifest.json"), 32768);
  const bytes = fs.readFileSync(path.join(generation, "manifest.json"));
  if (hash(bytes) !== path.basename(generation)) throw new PriceError("snapshot_manifest_checksum_mismatch");
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (new Set(manifest.files.map(f => f.name)).size !== manifest.files.length || manifest.files.filter(f => f.name === "prices.sqlite").length !== 1) throw new PriceError("invalid_snapshot_manifest");
  return manifest;
}
function verifiedFile(generation: string, file: Manifest["files"][number]) {
  const name = path.join(generation, file.name), stat = regularFile(name, file.name === "prices.sqlite" ? MAX_DATABASE : MAX_LISTING);
  if (stat.size !== file.bytes) throw new PriceError("snapshot_file_size_mismatch");
  const bytes = fs.readFileSync(name);
  if (hash(bytes) !== file.sha256) throw new PriceError("snapshot_file_checksum_mismatch");
  return bytes;
}
export function verifyLocalPriceExport(generation: string) {
  const manifest = loadManifest(generation);
  for (const file of manifest.files) verifiedFile(generation, file);
  return manifest;
}
export function readLocalPriceExport(generation: string, input: InstrumentInput, options: { start?: string; end?: string; limit?: number } = {}) {
  const target = instrument(input), manifest = loadManifest(generation);
  const file = manifest.files.find(f => f.name === `${target.market}_${encodeURIComponent(target.symbol)}.json`);
  if (!file) throw new PriceError("snapshot_listing_not_exported");
  const snapshot = JSON.parse(verifiedFile(generation, file).toString("utf8")) as LocalPriceSnapshot;
  if (snapshot.version !== 1 || snapshot.listing_key !== target.id || snapshot.as_of !== manifest.asOf) throw new PriceError("snapshot_listing_binding_mismatch");
  return queryLocalPriceSnapshot(snapshot, options);
}

/** Export only. SQLite remains operational authority; this never prunes it or calls Drive/OAuth. */
export function exportLocalPriceSnapshot(database: string, outputRoot: string, asOf: Date, limit = 62, providerReceipt?: string) {
  regularFile(database, MAX_DATABASE);
  const observations = new Map<string, { identity: NonNullable<RequestedPriceSnapshot["providerIdentity"]>; receiptSha256: string }>();
  let providerReceiptBytes: Buffer | null = null;
  if (providerReceipt) {
    regularFile(providerReceipt, 256 * 1024);
    const bytes = fs.readFileSync(providerReceipt), receiptSha256 = hash(bytes);
    providerReceiptBytes = bytes;
    const receipt = JSON.parse(bytes.toString("utf8")) as { results?: { instrumentId: string; providerIdentity?: NonNullable<RequestedPriceSnapshot["providerIdentity"]> }[] };
    if (!Array.isArray(receipt.results) || receipt.results.length > 100) throw new PriceError("invalid_snapshot_provider_receipt");
    for (const row of receipt.results) if (row.providerIdentity) {
      if (observations.has(row.instrumentId)) throw new PriceError("ambiguous_snapshot_provider_receipt");
      observations.set(row.instrumentId, { identity: row.providerIdentity, receiptSha256 });
    }
  }
  const source = new PriceStore(database);
  let payloads: { name: string; bytes: Buffer }[], schemaHash: string;
  try {
    if (source.db.pragma("journal_mode", { simple: true }) !== "delete") throw new PriceError("snapshot_requires_checkpointed_delete_mode_copy");
    const captured = source.db.transaction(() => {
      if (source.db.pragma("quick_check", { simple: true }) !== "ok") throw new PriceError("snapshot_database_integrity_failed");
      const listings = source.instruments();
      if (!listings.length || listings.length > 20) throw new PriceError("snapshot_requires_one_to_twenty_listings");
      const files: { name: string; bytes: Buffer }[] = listings.map(input => ({ name: `${input.market}_${encodeURIComponent(input.symbol)}.json`,
        bytes: Buffer.from(JSON.stringify(buildLocalPriceSnapshot(source, input, asOf, limit, observations.get(instrument(input).id)))) }));
      if (files.some(f => f.bytes.length > MAX_LISTING)) throw new PriceError("snapshot_listing_too_large");
      const bytes = source.db.serialize(); if (bytes.length > MAX_DATABASE) throw new PriceError("snapshot_database_too_large");
      files.unshift({ name: "prices.sqlite", bytes });
      return { files, schemaHash: hash(JSON.stringify(source.db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all())) };
    })();
    payloads = captured.files; schemaHash = captured.schemaHash;
  } finally { source.close(); }
  if (providerReceiptBytes) payloads.push({ name: "provider-receipt.json", bytes: providerReceiptBytes });
  const manifest = manifestSchema.parse({ version: 1, kind: "listing-local-private-archive", asOf: asOf.toISOString(), sourceSchemaSha256: schemaHash,
    files: payloads.map(f => ({ name: f.name, bytes: f.bytes.length, sha256: hash(f.bytes) })) });
  const manifestBytes = Buffer.from(JSON.stringify(manifest)), generationId = hash(manifestBytes);
  const day = asOf.toISOString().slice(0, 10).replaceAll("-", path.sep);
  const parent = path.resolve(outputRoot, "Market_Data", day);
  let existing = parent;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  if (fs.realpathSync(existing) !== existing) throw new PriceError("unsafe_snapshot_output_directory");
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(parent) !== parent) throw new PriceError("unsafe_snapshot_output_directory");
  const generation = path.join(parent, generationId);
  if (fs.existsSync(generation)) { verifyLocalPriceExport(generation); return { status: "REPLAY_NO_CHANGE", generation, generationId, manifest }; }
  const pending = path.join(parent, `.pending-${crypto.randomUUID()}`);
  fs.mkdirSync(pending, { mode: 0o700 });
  // Interrupted staging directories are never published/readable and are not deleted by another run.
  for (const file of payloads) durableFile(path.join(pending, file.name), file.bytes);
  durableFile(path.join(pending, "manifest.json"), manifestBytes); syncDirectory(pending);
  try { fs.renameSync(pending, generation); }
  catch (error) {
    if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    verifyLocalPriceExport(generation); fs.rmSync(pending, { recursive: true });
  }
  syncDirectory(parent); verifyLocalPriceExport(generation);
  return { status: "PUBLISHED_LOCAL_ONLY", generation, generationId, manifest };
}
