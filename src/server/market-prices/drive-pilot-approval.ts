import crypto from "node:crypto";
import { z } from "zod";
import { DRIVE_SCOPE, driveKey } from "./drive-auth.ts";
import { PriceError } from "./model.ts";

export const gateId = z.string().regex(/^[A-Za-z0-9_-]{3,200}$/).refine(s => !["UNSET", "root"].includes(s));
export const gateHash = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.string().min(12).max(250).refine(s => !/^(UNSET|HOLD)$/.test(s));
export const gateBindingSchema = z.object({ pilotId: gateId, journalId: gateId,
  candidateTree: z.string().regex(/^[a-f0-9]{40}$/), principalId: gateId,
  clientId: z.string().regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),
  redirectUri: z.url().refine(s => { const u = new URL(s); return (u.protocol === "https:" || u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/api/market-prices-drive/callback"; }),
  scope: z.literal(DRIVE_SCOPE), signingKeyProof: gateHash, signingCustodyRef: reference,
}).strict();
export type GateBinding = z.infer<typeof gateBindingSchema>;
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalJSON((value as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(value);
}
export const gateDigest = (v: unknown) => crypto.createHash("sha256").update(canonicalJSON(v)).digest("hex");
export const signingKeyProof = () => crypto.createHash("sha256").update(driveKey("pilot-signing-custody-v1")).digest("hex");
export const UPLOAD_GATE_LIMITS = { files: 2, requests: 24, uploadedWireBytes: 1048576, downloadReservationBytes: 2097152, durationMs: 120000, archiveBytes: 262144, catalogueBytes: 65536 } as const;
const common = { version: z.literal(1), permitId: gateId, binding: gateBindingSchema,
  notBefore: z.string().datetime(), expiresAt: z.string().datetime(), ownerEvidenceRef: reference,
  quotaEvidenceRef: reference, expectedCostUSD: z.literal(0), chargeCeilingUSD: z.literal(0) };
const object = z.object({ id: gateId, sha256: gateHash, bytes: z.number().int().positive() }).strict();
export const permitSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("bootstrap"), folderName: z.literal("InvestmentOS-Prices-Pilot-ONLY"), parent: z.literal("root"),
    maxFolders: z.literal(1), maxDriveRequests: z.literal(8), maxOAuthTokenCalls: z.literal(2) }).strict(),
  z.object({ ...common, phase: z.literal("upload"), bootstrapPermitDigest: gateHash, folderId: gateId, folderEvidenceSha256: gateHash,
    instrumentId: z.literal("US:AAPL"), syntheticBars: z.literal(2), archive: object, catalogue: object,
    limits: z.object({ files: z.literal(2), requests: z.literal(24), uploadedWireBytes: z.literal(1048576), downloadReservationBytes: z.literal(2097152),
      durationMs: z.literal(120000), archiveBytes: z.literal(262144), catalogueBytes: z.literal(65536) }).strict() }).strict(),
]);
export type GatePermit = z.infer<typeof permitSchema>;
export type SignedGatePermit = { permit: GatePermit; signature: string };
/** Provisioned independently of proposal/journal/operator arguments. No default key or signing API. */
export interface OwnerAuthority { publicKeyPem: string; pinnedSpkiSha256: string; enrollmentEvidenceRef: string; }
export function verifyGatePermit(envelope: unknown, authority: OwnerAuthority, binding: GateBinding, phase: GatePermit["phase"], now = Date.now()): SignedGatePermit {
  try {
    const e = z.object({ permit: permitSchema, signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict().parse(envelope);
    const key = crypto.createPublicKey(authority.publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || !gateHash.safeParse(authority.pinnedSpkiSha256).success ||
      !reference.safeParse(authority.enrollmentEvidenceRef).success || crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex") !== authority.pinnedSpkiSha256 ||
      !crypto.verify(null, Buffer.from(canonicalJSON(e.permit)), key, Buffer.from(e.signature, "base64url"))) throw Error();
    const p = e.permit, start = Date.parse(p.notBefore), end = Date.parse(p.expiresAt);
    if (p.phase !== phase || canonicalJSON(p.binding) !== canonicalJSON(gateBindingSchema.parse(binding)) || p.binding.signingKeyProof !== signingKeyProof() ||
      now < start || now >= end || end <= start || end - start > (phase === "upload" ? 120000 : 900000)) throw Error();
    if (p.phase === "upload" && (p.archive.bytes > UPLOAD_GATE_LIMITS.archiveBytes || p.catalogue.bytes > UPLOAD_GATE_LIMITS.catalogueBytes ||
      new Set([p.folderId, p.archive.id, p.catalogue.id]).size !== 3)) throw Error();
    return e;
  } catch { throw new PriceError("pilot_independent_approval_missing_invalid_expired_or_mismatched"); }
}
