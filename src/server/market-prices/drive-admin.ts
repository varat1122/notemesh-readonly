import crypto from "node:crypto";
import { PriceError } from "./model.ts";

export const driveAdminHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
  "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'" };
export const htmlEscape = (value: string) => value.replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const prepared = new Map<string, { userId: string; credential: string; expires: number }>();
export function prepareDriveCredential(userId: string, credential: string): string {
  for (const [id, item] of prepared) if (item.expires <= Date.now()) prepared.delete(id);
  if (prepared.size >= 20) throw new PriceError("drive_consent_busy");
  const id = crypto.randomBytes(32).toString("hex");
  prepared.set(id, { userId, credential, expires: Date.now() + 10 * 60 * 1000 }); return id;
}
export function claimDriveCredential(userId: string, id: string): string {
  const item = prepared.get(id);
  if (!item || item.userId !== userId || item.expires <= Date.now()) throw new PriceError("drive_prepared_credential_expired");
  prepared.delete(id); return item.credential;
}
