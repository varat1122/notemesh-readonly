/** Staging-only M4 wall-clock expiry; independent of HTTP page state. */
const MAX_MS = 30 * 60_000;
const RESERVE_MS = 2 * 60_000;
function instant(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) throw Error("M4 time window missing or malformed");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace(".000Z","Z") !== value)
    throw Error("M4 time window invalid timestamp");
  return ms;
}
export function assertM4Window(phase: "preflight" | "write" = "preflight", nowMs = Date.now()): void {
  const start = instant(process.env.GIT_RESEARCH_M4_WINDOW_START);
  const end = instant(process.env.GIT_RESEARCH_M4_WINDOW_END);
  if (!Number.isFinite(nowMs) || end <= start || end - start > MAX_MS ||
      nowMs < start || nowMs >= end || (phase === "write" && end - nowMs <= RESERVE_MS))
    throw Error("M4 time window closed or invalid");
}

/** Display-only clock hints, never a replacement for assertM4Window at commit. */
export function m4WindowInfo(nowMs=Date.now()){
 try{
  const start=instant(process.env.GIT_RESEARCH_M4_WINDOW_START);
  const end=instant(process.env.GIT_RESEARCH_M4_WINDOW_END);
  if(end<=start||end-start>MAX_MS)return null;
  const safeUntil=end-RESERVE_MS;
  const format=(n:number)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Bangkok",
    day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",
    hourCycle:"h23"}).format(new Date(n))+" (Bangkok)";
  return {actualEnd:new Date(end).toISOString(),applyUntil:new Date(safeUntil).toISOString(),
    actualEndLocal:format(end),applyUntilLocal:format(safeUntil),
    writeOpen:nowMs>=start&&nowMs<safeUntil,
    previewOpen:nowMs>=start&&nowMs<safeUntil-5*60_000};
 }catch{return null;}
}
