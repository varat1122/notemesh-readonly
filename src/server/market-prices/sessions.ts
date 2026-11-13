import { localDate, type Market } from "./model.ts";
import { z } from "zod";
import { isoDate, PriceError } from "./model.ts";

const closureSchema = z.object({ US: z.array(isoDate).max(400).optional(), TH: z.array(isoDate).max(400).optional(),
  HK: z.array(isoDate).max(400).optional(), JP: z.array(isoDate).max(400).optional() }).strict();
/** Explicit reviewed closures, not an automatically discovered official calendar. */
export function configuredPriceClosures(market: Market): string[] {
  try {
    const calendar = closureSchema.parse(JSON.parse(process.env.MARKET_PRICES_SESSION_CLOSURES ?? "{}"));
    return calendar[market] ?? [];
  } catch { throw new PriceError("invalid_price_session_closures"); }
}

// Conservative normal close + 60-minute publication lag. Not an official holiday/early-close calendar.
const READY_MINUTE: Record<Market, number> = { US: 17 * 60, TH: 17 * 60 + 40, HK: 17 * 60 + 10, JP: 16 * 60 + 30 };
const weekday = (date: string) => ![0, 6].includes(new Date(date + "T12:00:00Z").getUTCDay());
function previous(date: string) { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
export function expectedClosedSession(market: Market, timeZone: string, now: Date, knownClosures: string[] = configuredPriceClosures(market)): string {
  let date = localDate(now.getTime(), timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const minute = Number(parts.find(p => p.type === "hour")!.value) * 60 + Number(parts.find(p => p.type === "minute")!.value);
  if (minute < READY_MINUTE[market]) date = previous(date);
  while (!weekday(date) || knownClosures.includes(date)) date = previous(date);
  return date;
}
export function sessionIsComplete(date: string, market: Market, timeZone: string, now: Date): boolean {
  return completedPriceSessionPredicate(market, timeZone, now)(date);
}
/** Compute timezone/calendar boundaries once per provider response, not once per historical bar. */
export function completedPriceSessionPredicate(market: Market, timeZone: string, now: Date) {
  const closures = configuredPriceClosures(market), last = expectedClosedSession(market, timeZone, now, closures);
  const closed = new Set(closures);
  return (date: string) => weekday(date) && !closed.has(date) && date <= last;
}
