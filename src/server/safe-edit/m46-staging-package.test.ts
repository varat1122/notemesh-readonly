import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {M46_FILES,M46_MANIFEST,M46_MANIFEST_SHA256,M46_SOURCE} from "./m46-staging-package";
describe("M4.6 isolated real-news shadow package, no write capability",()=>{
 it("pins exactly four new staging-only notes with immutable manifest hashes",()=>{
   expect(M46_FILES.map(f=>f.role)).toEqual(["source","company","timeline","analysis"]);
   expect(new Set(M46_FILES.map(f=>f.path)).size).toBe(4);
   for(const [i,f] of M46_FILES.entries()){
     expect(f.path).toMatch(/^(10_Knowledge|01_Companies|08_Daily_Weekly\/Research Indexes)\/.+\.md$/);
     expect(f.path).not.toMatch(/\/\.\.|05_Thesis|06_Portfolio|M4TEST/);
     expect(M46_MANIFEST[i].sha256).toBe(createHash("sha256").update(f.content).digest("hex"));
     expect(f.content).toContain("synthetic_environment: true");
     expect(f.content).not.toContain("user_endorsed: true");
   }
   expect(M46_MANIFEST_SHA256).toMatch(/^[a-f0-9]{64}$/);
 });
 it("honestly retains primary vs AI provenance and forward targets",()=>{
   expect(M46_FILES[0].content).toContain("verification: verified_against_primary");
   expect(M46_FILES[0].content).toContain("original_source_sha256: null");
   expect(M46_FILES[3].content).toContain("source_type: archived_ai");
   expect(M46_FILES[3].content).toContain("verification: not_reverified");
   expect(M46_FILES[3].content).toContain("independent_evidence: false");
   expect(M46_FILES[3].content).toContain("No Current Thesis, Evidence Register or holdings update");
   expect(M46_SOURCE).toMatch(/^https:\/\/nvidianews\.nvidia\.com\/news\//);
 });
});
