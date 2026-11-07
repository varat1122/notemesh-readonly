import { PriceError } from "./model.ts";
import { assertWritePermitted, beginWork, endWork } from "../maintenance.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Fixed Google origins, bounded bodies, no redirects and no provider error text/secrets in logs.
 *
 * The single choke point for remote Drive mutations (folder creation, upload):
 * registered as in-flight work, then checked against maintenance and durable
 * openness synchronously, immediately before the request is initiated — no
 * await lies between the check and fetch(). Work admitted earlier, however
 * long its awaits, is re-checked here. A request already sent cannot be
 * recalled: a drain waits for it (pendingRemote; in another process, the
 * price writer's lock) and the 25 s timeout bounds it below the drain deadline.
 */
export async function googleBytes(url: string, init: RequestInit = {}, maxBytes = 65536): Promise<Buffer> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !["www.googleapis.com", "oauth2.googleapis.com"].includes(target.hostname) ||
    target.username || target.password || target.port) throw new PriceError("drive_origin_refused");
  const mutation = target.hostname === "www.googleapis.com" && MUTATING.has((init.method ?? "GET").toUpperCase());
  const work = mutation ? beginWork("remote") : null;
  try {
    if (mutation) {
      try {
        assertWritePermitted("drive mutation");
      } catch {
        throw new PriceError("maintenance_active");
      }
    }
    const response = await fetch(target, { ...init, redirect: "error", signal: AbortSignal.timeout(25000) });
    if (!response.ok) { await response.body?.cancel(); throw new PriceError(`drive_http_${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new PriceError("drive_empty_response");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) throw new PriceError("drive_response_too_large");
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(chunks);
  } catch (error) {
    throw error instanceof PriceError ? error : new PriceError("drive_request_failed");
  } finally {
    if (work !== null) endWork(work);
  }
}

export async function googleJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const bytes = await googleBytes(url, init);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new PriceError("drive_invalid_json"); }
}
