import crypto from "node:crypto";

/**
 * Session-bound, short-lived form proof for the authenticated DR OAuth start.
 * Used when mobile browsers or privacy tools suppress the Origin header.
 * The proof is not an OAuth credential and cannot be forged cross-site.
 */
const MAX_AGE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const PURPOSE = "notemesh-dr-consent-form/v1";

export function issueDrConsentFormProof(sessionId: string, key: Buffer, now = Date.now()): string {
  const stamp = Math.floor(now).toString(36);
  const mac = crypto.createHmac("sha256", key)
    .update(PURPOSE + ":" + sessionId + ":" + stamp, "utf8")
    .digest("base64url");
  return stamp + "." + mac;
}

export function validDrConsentFormProof(
  token: string | null,
  sessionId: string,
  key: Buffer,
  now = Date.now(),
): boolean {
  if (!token || token.length > 96 || !/^[0-9a-z]{8,12}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [stamp, mac] = token.split(".");
  const issued = Number.parseInt(stamp, 36);
  if (!Number.isSafeInteger(issued) || issued > now + CLOCK_SKEW_MS ||
      now - issued > MAX_AGE_MS) return false;
  const expected = issueDrConsentFormProof(sessionId, key, issued).split(".")[1];
  return crypto.timingSafeEqual(Buffer.from(mac, "ascii"), Buffer.from(expected, "ascii"));
}

/**
 * Reject explicit cross-origin signals. A missing/opaque Origin is not proof
 * of same-origin, so callers MUST also validate the session-bound form proof.
 */
export function drConsentRequestOriginAllowed(headers: Headers, baseUrl: string): boolean {
  const expected = new URL(baseUrl).origin;
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    try { if (new URL(origin).origin !== expected) return false; }
    catch { return false; }
  }
  const referer = headers.get("referer");
  if (referer) {
    try { if (new URL(referer).origin !== expected) return false; }
    catch { return false; }
  }
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return true;
}
