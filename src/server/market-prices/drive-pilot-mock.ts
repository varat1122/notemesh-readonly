import { PILOT_LIMITS, type PilotConfig, type PilotGrant } from "./drive-pilot.ts";
import { DRIVE_SCOPE } from "./drive-auth.ts";
import { PriceError } from "./model.ts";

// Explicitly invented fixture identifiers, never discovered/generated real Drive IDs or credentials.
export const MOCK_PILOT: PilotConfig = { folderId: "MOCK_PILOT_FOLDER", pilotId: "MOCK_PILOT_RUN",
  principalId: "MOCK_OWNER", clientId: "mock-pilot.apps.googleusercontent.com", scope: DRIVE_SCOPE,
  approvalRef: "MOCK_ONLY_NOT_OWNER_APPROVAL" };
export const mockPilotGrant = async (): Promise<PilotGrant> => ({ clientId: MOCK_PILOT.clientId,
  principalId: MOCK_PILOT.principalId, scope: DRIVE_SCOPE, accessToken: "MOCK_PLACEHOLDER_NOT_A_REAL_TOKEN" });
export interface MockPilotFile { id: string; name: string; parents: string[]; mimeType: string; appProperties: Record<string, string>; bytes: Buffer; }
export class MockPilotHttp {
  files: MockPilotFile[] = [];
  requests: { method: string; path: string; parent: string; bytes: number; role: string | null }[] = [];
  failure: "none" | "unknown_after_store" | "403" | "429" | "tamper" | "catalogue_403" = "none";
  observedPrincipal = MOCK_PILOT.principalId;
  folderShared = false;
  wrongParent = false;
  private metadata(f?: MockPilotFile) {
    return { id: f?.id ?? MOCK_PILOT.folderId, name: f?.name ?? "InvestmentOS-Prices-Pilot-ONLY",
      mimeType: f?.mimeType ?? "application/vnd.google-apps.folder", parents: f ? this.wrongParent ? ["MOCK_OUTSIDE_FOLDER"] : f.parents : [],
      trashed: false, shared: this.folderShared, ownedByMe: true, owners: [{ permissionId: MOCK_PILOT.principalId }],
      permissions: [{ id: MOCK_PILOT.principalId, type: "user", role: "owner" }], capabilities: { canAddChildren: !f },
      appProperties: f?.appProperties ?? { investmentOsPilot: MOCK_PILOT.pilotId } };
  }
  fetch: typeof fetch = async (input, init) => {
    const u = new URL(String(input)), method = init?.method ?? "GET";
    if (u.origin !== "https://www.googleapis.com") throw new PriceError("mock_unexpected_network_target");
    this.requests.push({ method, path: u.pathname, parent: u.searchParams.get("q") ?? "", bytes: init?.body ? Buffer.byteLength(init.body as Buffer) : 0, role: null });
    if (this.requests.length > PILOT_LIMITS.requests) throw new PriceError("mock_request_limit_exceeded");
    if (u.pathname === "/drive/v3/about") return Response.json({ user: { permissionId: this.observedPrincipal } });
    if (u.pathname === "/upload/drive/v3/files" && method === "POST") {
      const bytes = Buffer.from(init!.body as Buffer), ct = (init!.headers as Record<string, string>)["Content-Type"], boundary = ct.split("boundary=")[1];
      const begin = bytes.indexOf("\r\n\r\n") + 4, end = bytes.indexOf(`\r\n--${boundary}`, begin);
      const meta = JSON.parse(bytes.subarray(begin, end).toString()), payloadBegin = bytes.indexOf("\r\n\r\n", end + 2) + 4;
      const payloadEnd = bytes.lastIndexOf(`\r\n--${boundary}--`), body = bytes.subarray(payloadBegin, payloadEnd);
      if (meta.parents.length !== 1 || meta.parents[0] !== MOCK_PILOT.folderId || meta.mimeType !== "application/octet-stream") throw new PriceError("mock_parent_or_mime_refused");
      const role = meta.appProperties.priceArchive ? "priceArchive" : "priceCatalogue";
      Object.assign(this.requests.at(-1)!, { parent: meta.parents[0], role });
      if (this.failure === "403" || this.failure === "429" || (this.failure === "catalogue_403" && role === "priceCatalogue")) return new Response("mock rejected", { status: this.failure === "429" ? 429 : 403 });
      if (meta.id && this.files.some(f => f.id === meta.id)) return new Response("mock duplicate ID", { status: 409 });
      const f: MockPilotFile = { ...meta, id: meta.id ?? `MOCK_FILE_${this.files.length + 1}`, bytes: Buffer.from(body) };
      this.files.push(f);
      if (this.failure === "unknown_after_store") { this.failure = "none"; throw Error("mock upload response lost; not a real service error"); }
      return Response.json({ id: f.id });
    }
    if (u.pathname === "/drive/v3/files") {
      const q = u.searchParams.get("q") ?? "";
      if (!q.includes(`'${MOCK_PILOT.folderId}' in parents`) || !q.includes("trashed=false")) throw new PriceError("mock_unscoped_listing_refused");
      const role = q.includes("key='priceArchive'") ? "priceArchive" : q.includes("key='priceCatalogue'") ? "priceCatalogue" : null;
      const sha = q.match(/key='pilotSha256' and value='([a-f0-9]{64})'/)?.[1];
      return Response.json({ files: this.files.filter(f => (!role || !!f.appProperties[role]) && (!sha || f.appProperties.pilotSha256 === sha)).map(f => ({ id: f.id })) });
    }
    const fileId = u.pathname.split("/").at(-1);
    if (fileId === MOCK_PILOT.folderId) return Response.json(this.metadata());
    const f = this.files.find(f => f.id === fileId);
    if (!f) return new Response("mock missing", { status: 404 });
    if (u.searchParams.get("alt") === "media") {
      const b = Buffer.from(f.bytes); if (this.failure === "tamper") b[b.length - 1] ^= 1;
      return new Response(new Uint8Array(b));
    }
    return Response.json(this.metadata(f));
  };
}
