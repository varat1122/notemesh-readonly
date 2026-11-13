import { instrument, type InstrumentInput } from "./model.ts";
import { priceRights } from "./rights.ts";
import { expectedClosedSession } from "./sessions.ts";
import { reviewedPriceProfile, listingLocalPriceProfile } from "./universe.ts";
import type { listingSessionQuality } from "./listing-quality.ts";
import type { RequestedPriceSnapshot } from "./yahoo.ts";

export function rightsHolds(watchlist: InstrumentInput[], now: Date) {
  return watchlist.map(input => ({ instrumentId: instrument(input).id, ...priceRights(input, now) }));
}
export function allRightsHeld(watchlist: InstrumentInput[], now: Date) {
  const rows = rightsHolds(watchlist, now);
  return rows.every(r => r.status !== "OPERATOR_ATTESTED") ? {
    status: "rights_hold", results: rows.map(r => ({ instrumentId: r.instrumentId, status: "failed", errorCode: r.status === "UNSUPPORTED" ? "unsupported_price_instrument" : "price_rights_hold" })),
    listingReceipts: rows.map(r => ({ instrumentId: r.instrumentId, status: r.status, reason: r.reason, latestSessionDate: null, rowCount: 0, correctionCount: 0,
      calendar: "not_evaluated_rights_hold" })),
    providerRequests: 0, writesPerformed: false,
  } : null;
}
export function stalePriceSession(input: InstrumentInput, latest: string | null, now: Date) {
  const i = instrument(input);
  return (reviewedPriceProfile() || listingLocalPriceProfile()) && (!latest || latest < expectedClosedSession(i.market, i.timeZone, now));
}
export interface PriceListingResult {
  instrumentId: string; status: string; inserted?: number; revised?: number; unchanged?: number;
  rowCount?: number; errorCode?: string; latestSessionDate?: string | null;
  quality?: ReturnType<typeof listingSessionQuality>;
  providerIdentity?: RequestedPriceSnapshot["providerIdentity"];
}
export function priceRunReceipts(watchlist: InstrumentInput[], results: PriceListingResult[]) {
  return watchlist.map(input => {
    const id = instrument(input).id;
    const rows = results.filter(r => r.instrumentId === id);
    const r = [...rows].reverse().find(r => r.status !== "not_due") ?? rows.at(-1);
    const status = !r ? "FAILED" : r.errorCode === "price_rights_hold" ? "RIGHTS_HOLD" :
      r.errorCode === "unsupported_price_instrument" ? "UNSUPPORTED" : r.errorCode === "stale_source_session" ? "STALE_SOURCE" :
      r.status === "failed" ? "FAILED" : r.status === "not_due" || (!r.inserted && !r.revised) ? "ALREADY_CURRENT" : "UPDATED";
    return { instrumentId: id, status, latestSessionDate: r?.latestSessionDate ?? null,
      rowCount: r?.rowCount ?? null, correctionCount: r?.revised ?? 0,
      ...(r?.quality ? { quality: r.quality } : {}),
      ...(r?.providerIdentity ? { providerIdentity: r.providerIdentity } : {}),
      reason: r?.errorCode ?? (!r ? "not_attempted_or_interrupted" : r.status),
      calendar: process.env.MARKET_PRICES_SESSION_CLOSURES ? "explicit_closures_not_an_official_calendar" :
        "weekday_only_unverified_holidays; stale may require holiday adjudication" };
  });
}
