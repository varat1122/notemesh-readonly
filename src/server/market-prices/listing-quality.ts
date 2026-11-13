import { instrument, isoDate, PriceError, type InstrumentInput, type CorporateAction } from "./model.ts";
import type { PriceStore } from "./store.ts";
import type { RequestedPriceSnapshot } from "./yahoo.ts";
import { configuredPriceClosures, expectedClosedSession } from "./sessions.ts";

/** Read-only admission guard; persistence/schema and canonical identity belong to Foundation. */
export function assertListingContinuity(store: PriceStore, input: InstrumentInput, snapshot: RequestedPriceSnapshot) {
  const target = instrument(input);
  if (snapshot.instrument.id !== target.id) throw new PriceError("provider_instrument_mismatch");
  const dates = [...snapshot.bars.map(b => b.date), ...snapshot.quarantinedBars.map(b => b.date)].sort();
  if (!dates.length) throw new PriceError("no_completed_bars");
  const start = isoDate.parse(snapshot.requestedRange?.start ?? dates[0]);
  const end = isoDate.parse(snapshot.requestedRange?.end ?? dates.at(-1));
  // Compare all cached rows in the actual requested range, not the consumer's 1500-row window.
  const oldDates = store.db.prepare(`SELECT date FROM bars WHERE instrument_id=? AND date BETWEEN ? AND ?
    UNION SELECT date FROM partial_bars WHERE instrument_id=? AND date BETWEEN ? AND ?`)
    .all(target.id, start, end, target.id, start, end) as { date: string }[];
  const received = new Set(dates);
  if (oldDates.some(b => !received.has(b.date))) throw new PriceError("provider_partial_response");
  const known = store.db.prepare("SELECT event_key AS key,date,kind,value,denominator FROM actions WHERE instrument_id=? AND date BETWEEN ? AND ?")
    .all(target.id, start, end) as CorporateAction[];
  const actions = new Map(snapshot.actions.map(a => [a.key, a]));
  const oldActions = new Set(known.map(a => a.key));
  const latestKnown = oldDates.map(b => b.date).sort().at(-1);
  if (actions.size !== snapshot.actions.length || known.some(a => {
    const next = actions.get(a.key);
    return !next || a.date !== next.date || a.kind !== next.kind || a.value !== next.value || a.denominator !== next.denominator;
  }) || snapshot.actions.some(a => !oldActions.has(a.key) && latestKnown && a.date <= latestKnown)) {
    // A re-fetch alone does not certify a changed adjustment basis. Keep prior data, record failure.
    throw new PriceError("unexpected_corporate_action_revision");
  }
}

/** Suspected gaps only: configured closures do not certify every exchange holiday or suspension. */
export function listingSessionQuality(input: InstrumentInput, dates: string[], now: Date) {
  const target = instrument(input), closures = configuredPriceClosures(target.market);
  const expectedLatestSession = expectedClosedSession(target.market, target.timeZone, now, closures);
  const sorted = [...new Set(dates)].sort(), present = new Set(sorted), missing: string[] = [];
  let missingSessionCount = 0, scanned = 0;
  const cursor = new Date((sorted[0] ?? expectedLatestSession) + "T12:00:00Z");
  for (; cursor.toISOString().slice(0, 10) <= expectedLatestSession && scanned < 10000; cursor.setUTCDate(cursor.getUTCDate() + 1), scanned++) {
    const date = cursor.toISOString().slice(0, 10);
    if (![0, 6].includes(cursor.getUTCDay()) && !closures.includes(date) && !present.has(date)) {
      missingSessionCount++; if (missing.length < 100) missing.push(date);
    }
  }
  return { canonicalListingId: null, scope: "listing-local" as const, expectedLatestSession,
    latestObservedSession: sorted.at(-1) ?? null, missingSessionCount, missingSessions: missing,
    missingSessionsTruncated: missingSessionCount > missing.length, scanTruncated: scanned === 10000,
    calendar: "weekday_plus_configured_closures_not_official" as const, missingSessionStatus: "suspected_requires_calendar_review" as const };
}
