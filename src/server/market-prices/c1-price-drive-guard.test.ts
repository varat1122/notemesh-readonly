/** C1 is a whole-instance pilot: price/Drive writers and Drive/OAuth egress
 * are refused by code, not only by an absent MARKET_PRICES_ENABLED. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const globals = ["notemesh.c1-pilot.identity.v1", "notemesh.maintenance.registry.v1", "notemesh.d1.native-interlock.v1", "notemesh.d1.database-owners.v1"];
const resetGlobals = () => { for (const name of globals) delete (globalThis as Record<symbol, unknown>)[Symbol.for(name)]; };
let root: string;
const saved = { ...process.env };

function instance(pilot: boolean) {
  const base = fs.realpathSync(os.tmpdir());
  root = fs.mkdtempSync(path.join(base, pilot ? "ios-c1-pilot-prices-" : "prices-normal-"));
  fs.mkdirSync(path.join(root, "vault"));
  process.env.DATA_DIR = root;
  process.env.TMPDIR = base;
  process.env.MARKET_PRICES_ENABLED = "1";
  process.env.MARKET_PRICES_STORAGE = "google-drive";
  if (pilot) process.env.C1_RESEARCH_PILOT = "disposable"; else delete process.env.C1_RESEARCH_PILOT;
}

beforeEach(() => { resetGlobals(); vi.resetModules(); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  fs.rmSync(root, { recursive: true, force: true });
  resetGlobals();
});

it("C1 refuses the price writer, the collector timer and every Drive request before any fetch or store", async () => {
  instance(true);
  const fetch = vi.spyOn(globalThis, "fetch");
  const { refreshPrices, ensurePriceCollectorStarted } = await import("./collector.ts");
  const { googleBytes, googleJson } = await import("./drive-http.ts");
  const { worker } = await import("../maintenance.ts");
  await expect(refreshPrices({ fetcher: async () => { throw Error("must not fetch"); } })).rejects.toMatchObject({ code: "c1_pilot_price_writer_denied" });
  ensurePriceCollectorStarted();
  expect(worker("priceCollector").timer).toBeUndefined();
  await expect(googleBytes("https://www.googleapis.com/drive/v3/files", { method: "POST" })).rejects.toMatchObject({ code: "c1_pilot_external_drive_denied" });
  await expect(googleJson("https://oauth2.googleapis.com/token")).rejects.toMatchObject({ code: "c1_pilot_external_drive_denied" });
  expect(fetch).not.toHaveBeenCalled();
  // Constructor-level defense in depth: no on-disk writable store opens at all.
  const { PriceStore } = await import("./store.ts");
  expect(() => new PriceStore(path.join(root, "prices.sqlite"), true)).toThrow("c1_pilot_price_writer_denied");
  expect(fs.readdirSync(root).filter(name => /price|maintenance-writers/.test(name))).toEqual([]);
});

it("an unflagged process on a pilot directory holds instead of writing prices", async () => {
  instance(true);
  delete process.env.C1_RESEARCH_PILOT;
  const { refreshPrices } = await import("./collector.ts");
  await expect(refreshPrices({ fetcher: async () => { throw Error("must not fetch"); } })).rejects.toThrow("c1_pilot_mode_required_hold");
});

it("a normal instance still opens a writable store and reaches Drive through the same choke point", async () => {
  instance(false);
  const { PriceStore } = await import("./store.ts");
  new PriceStore(path.join(root, "prices.sqlite"), true).close();
  expect(fs.existsSync(path.join(root, "prices.sqlite"))).toBe(true);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  const { googleJson } = await import("./drive-http.ts");
  await expect(googleJson("https://oauth2.googleapis.com/token")).resolves.toEqual({});
  expect(fetch).toHaveBeenCalledTimes(1);
});
