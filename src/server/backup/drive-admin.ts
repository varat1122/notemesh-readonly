import crypto from "node:crypto";
export const drDriveHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store", "Pragma": "no-cache",
  "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
export const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const handoff = new Map<string, { userId: string; sealed: string; until: number }>();
export function prepareDrCredential(userId: string, sealed: string): string {
  for (const [id, row] of handoff) if (row.until <= Date.now()) handoff.delete(id);
  if (handoff.size >= 20) throw Error("dr_handoff_busy");
  const id = crypto.randomBytes(32).toString("hex");
  handoff.set(id, { userId, sealed, until: Date.now() + 10 * 60_000 });
  return id;
}
export function claimDrCredential(userId: string, id: string): string {
  const row = handoff.get(id);
  if (!row || row.userId !== userId || row.until <= Date.now()) throw Error("dr_handoff_invalid");
  handoff.delete(id);
  return row.sealed;
}
