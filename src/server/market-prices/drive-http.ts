import { PriceError } from "./model.ts";
import { priceRequestSignal } from "./request-budget.ts";

/** Fixed Google origins, bounded bodies, no redirects and no provider error text/secrets in logs. */
export async function googleBytes(url: string, init: RequestInit = {}, maxBytes = 65536): Promise<Buffer> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !["www.googleapis.com", "oauth2.googleapis.com"].includes(target.hostname) ||
    target.username || target.password || target.port) throw new PriceError("drive_origin_refused");
  try {
    const budget = priceRequestSignal();
    const response = await fetch(target, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, budget]) : budget });
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
  }
}

export async function googleJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const bytes = await googleBytes(url, init);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new PriceError("drive_invalid_json"); }
}
