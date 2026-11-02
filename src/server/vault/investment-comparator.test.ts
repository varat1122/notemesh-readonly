import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "foundation-comparator-"));
  vi.stubEnv("DATA_DIR", root); vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 11).toString("base64"));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2031-01-01T12:00:00Z"));
  vi.resetModules();
});
afterEach(async () => {
  (await import("../db")).db().close(); vi.useRealTimers(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
async function review(issuer: string, label: string, eventDate: unknown, published: string, imported: number, analysisAsOf: unknown) {
  const rel = `10_Knowledge/Company Research/Investment Review - ${issuer} - ${label}.md`;
  const abs = path.join(root, "vault", rel); fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\ntype: investment_research_review\nverification: not_reverified\nevent_date: ${JSON.stringify(eventDate)}\nanalysis_as_of: ${JSON.stringify(analysisAsOf)}\ncomparator_eligible: true\npublished_at: ${published}\n---\n# ${issuer} earnings ${label}\nSynthetic analytical Review.\n`);
  (await import("./indexer")).reindexPath(rel);
  (await import("../db")).db().prepare("UPDATE notes SET created=?,modified=? WHERE path=?").run(imported, imported, rel);
  return rel;
}
async function pack(issuer = "AMD", asOf?: string) {
  return (await import("./investment-context")).buildInvestmentContextPack({ question: `${issuer} earnings comparator`, issuers: [issuer], asOf, maxNotes: 16 });
}
it.each(["AMD", "EXM"])("%s Q3 remains the comparator after a later Q2 backfill; both Reviews remain retrievable", async issuer => {
  const q3 = await review(issuer, "Q3-current", "2030-10-22", "2030-10-23", 1000, "2030-10-22");
  const q2 = await review(issuer, "Q2-backfill", "2030-07-22", "2030-07-23", 2000, "2030-07-22");
  const result = await pack(issuer);
  expect(result.analyticalComparators).toEqual([{issuer,status:"selected",path:q3,eventDate:"2030-10-22",analysisAsOf:"2030-10-22",reason:"latest_eligible_analysis_as_of"}]);
  expect(result.items.filter(x => x.path === q2 || x.path === q3)[0].path).toBe(q3);
  expect(result.items.map(x => x.path)).toEqual(expect.arrayContaining([q3, q2]));
});
it("as-of before Q3 excludes its identity and content while retaining Q2", async () => {
  const q2 = await review("AMD", "Q2", "2030-07-22", "2030-07-23", 2000, "2030-07-22");
  await review("AMD", "Q3_FUTURE_SECRET", "2030-10-22", "2030-10-23", 1000, "2030-10-22");
  const result = await pack("AMD", "2030-09-01T12:00:00Z");
  expect(result.items.map(x => x.path)).toContain(q2);
  expect(JSON.stringify(result)).not.toContain("Q3_FUTURE_SECRET");
});
it.each([[null], ["unknown"], ["2030-02-30"], [["2030-07-22", "2030-10-22"]]])("reports an explicit chronology HOLD for %j, never import-time fallback", async unknownDate => {
  await review("AMD", "undated", unknownDate, "2030-11-01", 5000, unknownDate);
  const result = await pack();
  expect(result.incomplete.join("\n")).toMatch(/comparator.*HOLD.*chronology/i);
  expect(result.decisions.some(x => x.reason.includes("discoveryBoost=220"))).toBe(false);
});
it("holds an ambiguous latest analytical horizon rather than breaking the tie with import time or filename", async () => {
  await review("AMD", "Q3-one", "2030-10-22", "2030-10-23", 1000, "2030-10-22");
  await review("AMD", "Q3-two", "2030-10-22", "2030-10-23", 2000, "2030-10-22");
  expect((await pack()).incomplete.join("\n")).toMatch(/comparator.*HOLD.*ambiguous/i);
});
it("does not let a batch of later historical imports hide the current comparator behind the old 24-row cap", async () => {
  const q3 = await review("AMD", "Q3", "2030-10-22", "2030-10-23", 1000, "2030-10-22");
  for (let i = 0; i < 26; i++) await review("AMD", `Q2-${i}`, "2030-07-22", "2030-07-23", 2000 + i, "2030-07-22");
  expect((await pack()).items[0].path).toBe(q3);
});

it("an incomplete eligible Review is historical context without disabling a valid analytical comparator",async()=>{
  const current=await review("AMD","Q3",null,"2030-10-23",1000,"2030-10-22");
  const old=await review("AMD","unknown","2030-07-22","2030-10-23",5000,null);
  const result=await pack();
  expect(result.analyticalComparators[0]).toMatchObject({status:"selected",path:current,eventDate:null,analysisAsOf:"2030-10-22"});
  expect(result.items.map(x=>x.path)).toContain(old);
  expect(result.manifest.limitations.join(" ")).toContain("comparator metadata incomplete");
  expect(result.incomplete.join(" ")).not.toContain("Analytical comparator HOLD");
});
it("ranks observed canonical metadata rather than stale indexed metadata",async()=>{
  const q3=await review("AMD","Q3","2030-10-22","2030-10-23",1000,"2030-10-22");
  const q2=await review("AMD","Q2","2030-07-22","2030-07-23",5000,"2030-07-22");
  (await import("../db")).db().prepare("UPDATE notes SET frontmatter=json_set(frontmatter,'$.analysis_as_of','2030-12-31') WHERE path=?").run(q2);
  expect((await pack()).analyticalComparators[0].path).toBe(q3);
});
it("reports bounded-scan HOLD instead of assigning current status from an incomplete candidate set",async()=>{
  for(let i=0;i<241;i++)await review("AMD",`bounded-${i}`,"2030-07-22","2030-07-23",i,"2030-07-22");
  const result=await pack();
  expect(result.analyticalComparators[0]).toMatchObject({status:"hold",path:null,reason:"bounded_comparator_scan_incomplete"});
  expect(result.discoveryTruncated).toBe(true);
  expect(result.selected).toBeLessThanOrEqual(16);
});
