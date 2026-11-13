import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runDailyPriceJob, dailyPriceJobStatus } from "./daily-job";
import { priceDbPath } from "./store";
import { priceRights } from "./rights";
import { REVIEWED_PILOT } from "./universe";
import { instrument } from "./model";

const now = new Date("2026-10-16T03:23:00Z");
const review = { provider: "yahoo-chart", scope: "private_team_archive", evidenceRef: "SYNTHETIC-TEST-ONLY-NO-LICENSE",
  termsUrl: "https://terms.example.invalid/review", reviewedAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z",
  instrumentIds: REVIEWED_PILOT.map(i => instrument(i).id) };
let root: string;
const folder = () => path.join(path.dirname(priceDbPath()), "daily-jobs");
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "daily-prices-"));
  for (const [k, v] of Object.entries({ DATA_DIR: root, MARKET_PRICES_PROFILE: "reviewed-pilot-v1",
    MARKET_PRICES_ENABLED: "1", MARKET_PRICES_REFRESH_ENABLED: "1", MARKET_PRICES_SCHEDULE: "external",
    MARKET_PRICES_STORAGE: "google-drive", MARKET_PRICES_DRIVE_SINGLE_WRITER: "1", MARKET_PRICES_RIGHTS_REVIEW: JSON.stringify(review) })) vi.stubEnv(k, v);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it("does no work before schedule, with disabled refresh, or without reviewed rights", async () => {
  const run = vi.fn(async () => ({ status: "complete" }));
  expect(await runDailyPriceJob({ now: new Date("2026-10-16T03:22Z"), run })).toMatchObject({ status: "NOT_DUE", writesPerformed: false });
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", "");
  expect(await runDailyPriceJob({ now, run })).toMatchObject({ status: "RIGHTS_HOLD", writesPerformed: false, providerRequests: 0 });
  expect(fs.existsSync(folder())).toBe(false);
  vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "0");
  await expect(runDailyPriceJob({ now, run })).rejects.toThrow("price_refresh_disabled");
  expect(run).not.toHaveBeenCalled();
});
it("persists one receipt and replays after restart without another attempt", async () => {
  const run = vi.fn(async () => ({ status: "complete", providerRequests: 8, remainingDue: 0 }));
  const first = await runDailyPriceJob({ now, run });
  expect(first).toMatchObject({ status: "COMPLETE", receipt: { day: "2026-10-16", result: { providerRequests: 8 } } });
  expect(fs.existsSync(path.join(folder(), "daily.lock"))).toBe(false);
  expect(await runDailyPriceJob({ now, run })).toMatchObject({ status: "REPLAY_NO_NEW_ATTEMPT", writesPerformed: false });
  expect(run).toHaveBeenCalledTimes(1);
  expect(dailyPriceJobStatus(now)).toMatchObject({ status: "COMPLETE", activatedByThisCode: false, distributedWriterExclusionVerified: false });
  const next = await runDailyPriceJob({ now: new Date("2026-10-17T03:23Z"), run });
  expect(next.status).toBe("COMPLETE"); expect(run).toHaveBeenCalledTimes(2);
});
it("refuses overlapping attempts on a shared persistent root", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const run = vi.fn(async () => { await gate; return { status: "complete" }; });
  const first = runDailyPriceJob({ now, run });
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(await runDailyPriceJob({ now, run })).toMatchObject({ status: "BUSY_OR_CRASH_HOLD" });
  release(); await first;
  expect(run).toHaveBeenCalledTimes(1);
});
it.each(["partial_failure", "provider_cooldown"])("records terminal %s and never automatically retries that UTC day", async status => {
  const run = vi.fn(async () => ({ status, remainingDue: 2 }));
  expect((await runDailyPriceJob({ now, run })).status).toBe(status === "partial_failure" ? "PARTIAL" : "FAILED");
  expect((await runDailyPriceJob({ now, run })).status).toBe("REPLAY_NO_NEW_ATTEMPT");
  expect(run).toHaveBeenCalledTimes(1);
});
it("sanitizes unexpected failures and returns a failed receipt for every configured listing", async () => {
  const r = await runDailyPriceJob({ now, run: async () => { throw Error("secret-fixture-must-not-leak"); } });
  expect(r).toMatchObject({ status: "FAILED", receipt: { result: { status: "daily_job_failed", listingReceipts: expect.arrayContaining([expect.objectContaining({ status: "FAILED" })]) } } });
  expect(JSON.stringify(r)).not.toContain("secret-fixture");
});
it("retains uncertain lock when receipt persistence fails after ingest", async () => {
  const run = vi.fn(async () => {
    // Simulate loss of safe destination after collector completes.
    fs.mkdirSync(path.join(folder(), "2026-10-16.json"));
    return { status: "complete" };
  });
  await expect(runDailyPriceJob({ now, run })).rejects.toThrow("daily_receipt_persistence_unknown");
  expect(fs.existsSync(path.join(folder(), "daily.lock"))).toBe(true);
  expect((await runDailyPriceJob({ now, run })).status).toBe("BUSY_OR_CRASH_HOLD");
  expect(run).toHaveBeenCalledTimes(1);
});
it("holds malformed prior receipts rather than recollecting", async () => {
  fs.mkdirSync(folder(), { recursive: true });
  fs.writeFileSync(path.join(folder(), "2026-10-16.json"), "{broken");
  const run = vi.fn(async () => ({ status: "complete" }));
  await expect(runDailyPriceJob({ now, run })).rejects.toThrow("invalid_daily_receipt");
  expect(run).not.toHaveBeenCalled();
});
it("reports a missing run after 90 minutes without activating any scheduler", () => {
  expect(dailyPriceJobStatus(new Date("2026-10-16T04:54Z"))).toMatchObject({ status: "MISSING_OR_NOT_ACTIVATED", activatedByThisCode: false });
});
it.each([
  { scope: "personal" }, { expiresAt: now.toISOString() }, { reviewedAt: "2026-12-01T00:00:00Z" },
  { instrumentIds: ["US:AAPL", "US:AAPL"] }, { termsUrl: "http://terms.example.invalid" },
])("holds an invalid or expired operator attestation: %j", change => {
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", JSON.stringify({ ...review, ...change }));
  expect(priceRights(REVIEWED_PILOT[0], now).status).toBe("RIGHTS_HOLD");
});
it("a synthetic operator attestation is explicitly not independent verification", () => {
  expect(priceRights(REVIEWED_PILOT[0], now)).toMatchObject({ status: "OPERATOR_ATTESTED", reason: expect.stringContaining("not_independently_verified") });
});
