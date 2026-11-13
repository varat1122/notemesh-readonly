import crypto from "node:crypto";
import { z } from "zod";
import { DRIVE_SCOPE } from "./drive-auth.ts";
import { googleBytes } from "./drive-http.ts";
import { unpackDriveArchive } from "./drive-archive.ts";
import { unpackPriceCatalogue } from "./drive-catalogue.ts";
import { PriceStore } from "./store.ts";
import { instrument, PriceError } from "./model.ts";
import { gateDigest } from "./drive-pilot-approval.ts";
import type { PilotOperation } from "./drive-pilot-operation.ts";

export type PilotRole = "priceArchive" | "priceCatalogue";
const id = z.string().regex(/^[A-Za-z0-9_-]{3,200}$/).refine(s => !["UNSET", "root"].includes(s));
const configSchema = z.object({ folderId: id, pilotId: id, principalId: id,
  clientId: z.string().regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),
  scope: z.literal(DRIVE_SCOPE), approvalRef: z.string().min(12).max(250).refine(s => s !== "UNSET"),
}).strict();
export type PilotConfig = z.infer<typeof configSchema>;
/** Runtime-only trusted binding, NOT an HTTP input, token issuer, consent flow or proof of a live grant. */
export interface PilotGrant { clientId: string; principalId: string; scope: string; accessToken: string; }
export const PILOT_LIMITS = { maxFiles: 2, archiveBytes: 256 * 1024, catalogueBytes: 64 * 1024,
  requests: 24, uploadedWireBytes: 1024 * 1024, downloadedBytes: 2 * 1024 * 1024, durationMs: 120000 } as const;
export const pilotSha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const fields = "id,name,mimeType,parents,trashed,shared,ownedByMe,owners(permissionId),permissions(id,type,role),capabilities(canAddChildren),appProperties";
const fileSchema = z.object({ id, name: z.string(), mimeType: z.string(), parents: z.array(z.string()).optional(),
  trashed: z.boolean(), shared: z.boolean(), ownedByMe: z.boolean(), owners: z.array(z.object({ permissionId: z.string() })),
  permissions: z.array(z.object({ id: z.string(), type: z.string(), role: z.string() })),
  capabilities: z.object({ canAddChildren: z.boolean().optional() }).optional(), appProperties: z.record(z.string(), z.string()),
});
type State = { bytes: Buffer; sha: string; phase: "prepared" | "uncertain" | "confirmed"; id?: string };
export interface PilotCheckpoint {
  startedAt: number; stopped: string | null;
  counters: { requests: number; uploadedWireBytes: number; downloadedBytes: number; downloadReservationBytes: number; uploadAttempts: number };
  objects: { role: PilotRole; phase: State["phase"]; id?: string; sha256: string; bytes: number }[];
}
export interface PilotPersistence {
  initial: PilotCheckpoint | null; payloads: Record<PilotRole, Buffer>; plannedIds: Record<PilotRole, string>;
  folderEvidenceSha256: string; deadlineAt: number; save: (checkpoint: PilotCheckpoint) => void; operation?: PilotOperation;
}
export function pilotFolderEvidence(raw: unknown, context: { clientId: string; principalId: string; scope: string }) {
  return gateDigest({ folder: fileSchema.parse(raw), clientId: context.clientId, principalId: context.principalId, scope: context.scope });
}

/** Guard around the existing repository/HTTP/serialization path; no default live authorization binding. */
export class DrivePilotSession {
  readonly config: PilotConfig;
  private grant?: PilotGrant;
  private ready = false;
  private stopped: string | null = null;
  private started = Date.now();
  private states = new Map<PilotRole, State>();
  private counters = { requests: 0, uploadedWireBytes: 0, downloadedBytes: 0, downloadReservationBytes: 0, uploadAttempts: 0 };
  private authorize: () => Promise<PilotGrant>;
  private persistence?: PilotPersistence;
  private pendingPost: PilotRole | null = null;
  constructor(config: unknown, authorize: () => Promise<PilotGrant>, persistence?: PilotPersistence) {
    try { this.config = configSchema.parse(config); } catch { throw new PriceError("pilot_unapproved_or_unset_context"); }
    this.authorize = authorize;
    if (persistence) {
      for (const role of ["priceArchive", "priceCatalogue"] as const) if (!id.safeParse(persistence.plannedIds[role]).success) throw new PriceError("pilot_restore_manifest_refused");
      if (!/^[a-f0-9]{64}$/.test(persistence.folderEvidenceSha256) || !Number.isFinite(persistence.deadlineAt)) throw new PriceError("pilot_restore_manifest_refused");
      const saved = persistence.initial;
      if (saved) {
        const caps = { requests: PILOT_LIMITS.requests, uploadedWireBytes: PILOT_LIMITS.uploadedWireBytes, downloadedBytes: PILOT_LIMITS.downloadedBytes,
          downloadReservationBytes: PILOT_LIMITS.downloadedBytes, uploadAttempts: PILOT_LIMITS.maxFiles };
        if (saved.stopped || !Number.isSafeInteger(saved.startedAt) || saved.startedAt > Date.now() || saved.objects.length > 2 || saved.objects.some(o => !["priceArchive", "priceCatalogue"].includes(o.role)) ||
          new Set(saved.objects.map(o => o.role)).size !== saved.objects.length || Object.entries(caps).some(([k, cap]) => !Number.isSafeInteger(saved.counters[k as keyof typeof caps]) || saved.counters[k as keyof typeof caps] < 0 || saved.counters[k as keyof typeof caps] > cap)) throw new PriceError("pilot_restore_budget_or_state_refused");
        this.started = saved.startedAt; this.counters = { ...saved.counters };
        for (const role of ["priceArchive", "priceCatalogue"] as const) {
          const o = saved.objects.find(o => o.role === role); if (!o) continue;
          const bytes = persistence.payloads[role];
          if (!["prepared", "uncertain", "confirmed"].includes(o.phase) || o.sha256 !== pilotSha256(bytes) || o.bytes !== bytes.length || o.id && o.id !== persistence.plannedIds[role] || o.phase === "confirmed" && !o.id) throw new PriceError("pilot_restore_manifest_refused");
          this.prepare(role, bytes); this.states.set(role, { bytes: Buffer.from(bytes), sha: o.sha256, phase: o.phase, ...(o.id ? { id: o.id } : {}) });
        }
      }
      this.persistence = persistence;
    }
  }
  status() { return { ...this.counters, stopped: this.stopped,
    objects: [...this.states].map(([role, s]) => ({ role, phase: s.phase, id: s.id ?? null, sha256: s.sha, bytes: s.bytes.length })) }; }
  checkpoint(): PilotCheckpoint { return { startedAt: this.started, stopped: this.stopped, counters: { ...this.counters },
    objects: [...this.states].map(([role, s]) => ({ role, phase: s.phase, ...(s.id ? { id: s.id } : {}), sha256: s.sha, bytes: s.bytes.length })) }; }
  private admit(signal?: AbortSignal | null) { this.persistence?.operation?.check(signal); }
  private persist() { this.admit(); this.persistence?.save(this.checkpoint()); }
  private fail(code: string): never { this.stopped = code; this.persist(); throw new PriceError(code); }
  plannedId(role: PilotRole) { return this.persistence?.plannedIds[role]; }
  acceptResultId(role: PilotRole, fileId: string) { this.admit(); if (this.plannedId(role) && this.plannedId(role) !== fileId) this.fail("pilot_server_id_mismatch"); }
  async headers(): Promise<Record<string, string>> {
    this.admit();
    if (this.stopped) throw new PriceError("pilot_stopped");
    if (!this.grant) {
      const g = this.persistence?.operation ? await this.persistence.operation.run(() => this.authorize()) : await this.authorize();
      this.admit();
      if (g.clientId !== this.config.clientId || g.principalId !== this.config.principalId || g.scope !== DRIVE_SCOPE || !g.accessToken) this.fail("pilot_identity_or_scope_mismatch");
      this.grant = g;
    }
    return { Authorization: `Bearer ${this.grant.accessToken}` };
  }
  async bytes(url: string, init: RequestInit = {}, maxBytes = 65536): Promise<Buffer> {
    this.admit(init.signal);
    if (this.stopped) throw new PriceError("pilot_stopped");
    const u = new URL(url), method = init.method ?? "GET";
    if (u.origin !== "https://www.googleapis.com" || !(method === "GET" && /^\/drive\/v3\/(about|files(?:\/[A-Za-z0-9_-]{3,200})?)$/.test(u.pathname) ||
      method === "POST" && u.pathname === "/upload/drive/v3/files" && u.searchParams.get("uploadType") === "multipart")) this.fail("pilot_request_refused");
    if (this.counters.requests >= PILOT_LIMITS.requests || Date.now() - this.started >= PILOT_LIMITS.durationMs || Date.now() >= (this.persistence?.deadlineAt ?? Infinity)) this.fail("pilot_request_budget_exhausted");
    const bodyBytes = init.body ? Buffer.byteLength(init.body as Buffer) : 0;
    if (this.counters.uploadedWireBytes + bodyBytes > PILOT_LIMITS.uploadedWireBytes) this.fail("pilot_byte_budget_exhausted");
    if (method === "POST") this.admitPost(init);
    else if (this.persistence) {
      const ids = [this.config.folderId, ...Object.values(this.persistence.plannedIds)];
      const queries = [`trashed=false and '${this.config.folderId}' in parents`, ...(["priceArchive", "priceCatalogue"] as const)
        .flatMap(role => [this.query(role), ...(this.states.has(role) ? [this.query(role, this.states.get(role)!.sha)] : [])])];
      if (!(u.pathname === "/drive/v3/about" || ids.some(id => u.pathname === `/drive/v3/files/${id}`) ||
        u.pathname === "/drive/v3/files" && queries.includes(u.searchParams.get("q") ?? ""))) this.fail("pilot_request_outside_permit");
    }
    // Reserve the whole bounded response even if it fails midway; failed downloads cannot reset the cap.
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || this.counters.downloadReservationBytes + maxBytes > PILOT_LIMITS.downloadedBytes) this.fail("pilot_byte_budget_exhausted");
    this.counters.downloadReservationBytes += maxBytes;
    if (init.body) {
      this.counters.uploadedWireBytes += bodyBytes;
    }
    this.counters.requests++;
    this.persist(); // Durable reservation BEFORE HTTP; crashes never refund request/byte ceilings.
    try {
      const timeout = Math.max(1, Math.min(15000, PILOT_LIMITS.durationMs - (Date.now() - this.started), (this.persistence?.deadlineAt ?? Infinity) - Date.now()));
      const b = this.persistence?.operation
        ? await this.persistence.operation.run(signal => googleBytes(url, { ...init, signal }, maxBytes), init.signal, timeout)
        : await googleBytes(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }, maxBytes);
      this.admit(init.signal);
      this.counters.downloadedBytes += b.length;
      if (this.counters.downloadedBytes > PILOT_LIMITS.downloadedBytes) this.fail("pilot_byte_budget_exhausted");
      this.persist();
      return b;
    } catch (e) {
      if (e instanceof PriceError && /^drive_http_(401|403|404|429)$/.test(e.code)) { this.stopped = e.code; this.persist(); }
      throw e;
    }
  }
  private admitPost(init: RequestInit) {
    try {
      const role = this.pendingPost, state = role && this.states.get(role);
      const boundary = /^multipart\/related; boundary=(investment-os-[a-f0-9]{32})$/.exec(new Headers(init.headers).get("Content-Type") ?? "")?.[1];
      if (!role || !state || state.phase !== "uncertain" || !boundary || !Buffer.isBuffer(init.body)) throw Error();
      const body = init.body, begin = body.indexOf("\r\n\r\n") + 4, end = body.indexOf(`\r\n--${boundary}`, begin);
      const metadata = JSON.parse(body.subarray(begin, end).toString()), payloadBegin = body.indexOf("\r\n\r\n", end + 2) + 4;
      const payload = body.subarray(payloadBegin, body.lastIndexOf(`\r\n--${boundary}--`));
      if (metadata.id !== this.plannedId(role) || metadata.mimeType !== "application/octet-stream" || typeof metadata.name !== "string" ||
        gateDigest(metadata.parents) !== gateDigest([this.config.folderId]) || !payload.equals(state.bytes) ||
        gateDigest(metadata.appProperties) !== gateDigest({ [role]: role === "priceArchive" ? "v1" : "v2", ...this.properties(role) }) ||
        Object.keys(metadata).some(k => !["id", "name", "mimeType", "parents", "appProperties"].includes(k))) throw Error();
      this.pendingPost = null; // One dispatch per already-durable attempt; recovery never reconstructs this ticket.
    } catch { this.fail("pilot_unadmitted_post"); }
  }
  async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const b = await this.bytes(url, init);
    try { return JSON.parse(b.toString("utf8")); } catch { return this.fail("pilot_invalid_json"); }
  }
  private async metadata(fileId: string) {
    if (!id.safeParse(fileId).success) this.fail("pilot_file_id_refused");
    const raw = await this.json(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${encodeURIComponent(fields)}`, { headers: await this.headers() });
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) this.fail("pilot_metadata_incomplete");
    const f = parsed.data, owner = this.config.principalId;
    if (f.id !== fileId || f.trashed || f.shared || !f.ownedByMe || f.owners.length !== 1 || f.owners[0].permissionId !== owner ||
      f.permissions.length !== 1 || f.permissions[0].id !== owner || f.permissions[0].type !== "user" || f.permissions[0].role !== "owner") this.fail("pilot_private_owner_acl_refused");
    return f;
  }
  async list(query: string) {
    if (!query.startsWith(`trashed=false and '${this.config.folderId}' in parents`)) this.fail("pilot_unscoped_listing_refused");
    const u = new URL("https://www.googleapis.com/drive/v3/files");
    u.search = new URLSearchParams({ q: query, fields: "files(id),nextPageToken", pageSize: "3", spaces: "drive" }).toString();
    const r = z.object({ files: z.array(z.object({ id })).max(3), nextPageToken: z.string().optional() }).safeParse(await this.json(u.toString(), { headers: await this.headers() }));
    if (!r.success || r.data.nextPageToken) this.fail("pilot_ambiguous_or_unbounded_listing");
    return r.data.files;
  }
  async folder(): Promise<string> {
    this.admit();
    if (this.stopped) throw new PriceError("pilot_stopped");
    if (this.ready) return this.config.folderId;
    const a = z.object({ user: z.object({ permissionId: z.string() }) }).safeParse(await this.json("https://www.googleapis.com/drive/v3/about?fields=user(permissionId)", { headers: await this.headers() }));
    if (!a.success || a.data.user.permissionId !== this.config.principalId) this.fail("pilot_observed_principal_mismatch");
    const folder = await this.metadata(this.config.folderId);
    if (folder.mimeType !== "application/vnd.google-apps.folder" || folder.name !== "InvestmentOS-Prices-Pilot-ONLY" ||
      folder.appProperties.investmentOsPilot !== this.config.pilotId || !folder.capabilities?.canAddChildren) this.fail("pilot_folder_refused");
    if (this.persistence && pilotFolderEvidence(folder, this.config) !== this.persistence.folderEvidenceSha256) this.fail("pilot_folder_evidence_changed");
    const children = await this.list(`trashed=false and '${this.config.folderId}' in parents`);
    if (children.length) {
      if (!this.persistence?.initial) this.fail("pilot_existing_files_require_operator_reconciliation");
      for (const child of children) {
        const role = (["priceArchive", "priceCatalogue"] as const).find(r => this.persistence!.plannedIds[r] === child.id);
        if (!role || !this.states.has(role) || this.states.get(role)!.phase === "prepared") this.fail("pilot_unjournaled_child_hold");
        this.checkFile(role, await this.metadata(child.id));
      }
    }
    this.admit(); this.ready = true; return this.config.folderId;
  }
  query(role: PilotRole, sha?: string) {
    return `trashed=false and '${this.config.folderId}' in parents and appProperties has { key='investmentOsPilot' and value='${this.config.pilotId}' } and appProperties has { key='${role}' and value='${role === "priceArchive" ? "v1" : "v2"}' }${sha ? ` and appProperties has { key='pilotSha256' and value='${sha}' }` : ""}`;
  }
  prepare(role: PilotRole, bytes: Buffer): string | null {
    this.admit();
    if (this.stopped) throw new PriceError("pilot_stopped");
    const limit = this.payloadLimit(role);
    if (!bytes.length || bytes.length > limit) throw new PriceError("pilot_payload_size_refused");
    const sha = pilotSha256(bytes), old = this.states.get(role);
    if (old) {
      if (old.sha !== sha) throw new PriceError("pilot_manifest_changed");
      if (old.phase === "uncertain") throw new PriceError("pilot_uncertain_reconcile_before_retry");
      if (old.phase === "confirmed") return old.id!;
      throw new PriceError("pilot_publish_busy");
    }
    if (role === "priceArchive") {
      const decoded = unpackDriveArchive(bytes), store = new PriceStore(decoded.database);
      try {
        const rows = store.instruments();
        const raw = store.db.prepare("SELECT currency,time_zone,yahoo_symbol FROM instruments WHERE id='US:AAPL'").get() as { currency: string; time_zone: string; yahoo_symbol: string } | undefined;
        if (store.db.pragma("quick_check", { simple: true }) !== "ok" || rows.length !== 1 || rows[0].id !== "US:AAPL" || rows[0].barCount !== 2 ||
          raw?.currency !== "USD" || raw.time_zone !== "America/New_York" || raw.yahoo_symbol !== "AAPL" ||
          store.read({ market: "US", symbol: "AAPL" }).series.dataOrigin !== "synthetic_fixture") throw new PriceError("pilot_synthetic_manifest_refused");
      } finally { store.close(); }
    } else {
      const c = unpackPriceCatalogue(bytes), archive = this.states.get("priceArchive");
      if (c.entries.length !== 1 || archive?.phase !== "confirmed" || c.entries[0].archiveId !== archive.id ||
        instrument(c.entries[0].instrument).id !== "US:AAPL" || c.entries[0].barCount !== 2 ||
        c.entries[0].databaseBytes !== unpackDriveArchive(archive.bytes).database.length) throw new PriceError("pilot_catalogue_manifest_refused");
      const store = new PriceStore(unpackDriveArchive(archive.bytes).database);
      try {
        const coverage = store.instruments()[0], entry = c.entries[0];
        if (entry.firstDate !== coverage.firstDate || entry.lastDate !== coverage.lastDate ||
          entry.lastFetchedAt !== coverage.lastFetchedAt || entry.lastSuccessfulRefresh !== coverage.lastSuccessfulRefresh ||
          !entry.lastAttemptSuccess || entry.lastError !== null || entry.qualityIssueCount !== 0 || c.providerRetryAfter !== null)
          throw new PriceError("pilot_catalogue_manifest_refused");
      } finally { store.close(); }
    }
    this.states.set(role, { bytes: Buffer.from(bytes), sha, phase: "prepared" });
    this.persist();
    return null;
  }
  payloadLimit(role: PilotRole) { return role === "priceArchive" ? PILOT_LIMITS.archiveBytes : PILOT_LIMITS.catalogueBytes; }
  properties(role: PilotRole) { return { investmentOsPilot: this.config.pilotId, pilotSha256: this.states.get(role)!.sha }; }
  attempt(role: PilotRole) {
    this.admit();
    const s = this.states.get(role)!;
    if (this.counters.uploadAttempts >= PILOT_LIMITS.maxFiles) this.fail("pilot_object_budget_exhausted");
    this.counters.uploadAttempts++;
    s.phase = "uncertain"; // Optional durable checkpoint commits before dispatch; never blindly repeat POST.
    this.persist();
    this.pendingPost = role;
  }
  async inspect(role: PilotRole, fileId: string) {
    await this.folder();
    this.acceptResultId(role, fileId);
    this.checkFile(role, await this.metadata(fileId));
  }
  private checkFile(role: PilotRole, f: z.infer<typeof fileSchema>) {
    const expected = this.states.get(role);
    if (!expected || f.parents?.length !== 1 || f.parents[0] !== this.config.folderId || f.mimeType !== "application/octet-stream" ||
      f.appProperties.investmentOsPilot !== this.config.pilotId || f.appProperties.pilotSha256 !== expected.sha ||
      f.appProperties[role] !== (role === "priceArchive" ? "v1" : "v2")) this.fail("pilot_file_outside_approved_manifest");
  }
  verify(role: PilotRole, fileId: string, b: Buffer) {
    this.acceptResultId(role, fileId);
    const s = this.states.get(role);
    if (!s || !b.equals(s.bytes)) this.fail("pilot_readback_mismatch");
    if (role === "priceArchive") unpackDriveArchive(b); else unpackPriceCatalogue(b);
    s.phase = "confirmed"; s.id = fileId;
    this.persist();
  }
  /** Explicit read-only reconciliation. Empty/multiple results HOLD; no automatic repost. */
  async reconcile(role: PilotRole) {
    this.admit();
    const s = this.states.get(role);
    if (!this.ready || !s || s.phase !== "uncertain") throw new PriceError("pilot_reconciliation_not_admitted");
    const found = await this.list(this.query(role, s.sha));
    if (found.length !== 1) this.fail("pilot_reconciliation_hold");
    await this.inspect(role, found[0].id);
    const b = await this.bytes(`https://www.googleapis.com/drive/v3/files/${found[0].id}?alt=media`, { headers: await this.headers() }, role === "priceArchive" ? PILOT_LIMITS.archiveBytes : PILOT_LIMITS.catalogueBytes);
    this.verify(role, found[0].id, b);
    return { status: "FOUND_VERIFIED_NO_REPOST", role, id: found[0].id, sha256: s.sha };
  }
}
