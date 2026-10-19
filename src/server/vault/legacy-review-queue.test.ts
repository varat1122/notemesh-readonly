import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
const primary="10_Knowledge/Company Research/ASML - Historic Review 00.md";
const archive="07_Sources/ChatGPT/Entries/Original historic chat.md";
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-queue-page-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;
});
function put(rel:string,content:string){
  const f=path.join(vault,rel);
  fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,content);
}
function hist(field:string){
  return ["---","type: knowledge_note","source_type: chatgpt_history",
    "verification: not_reverified",field,"---","# Old human-unverified note"].join("\n");
}
async function index(){
  const {indexer}=await import("./indexer");await indexer().rebuild();
}
describe("read-only whole-index review queue over scratch Vault",()=>{
  it("paginates every P1 issue past the first four suggestions without changing any files",async()=>{
    for(let i=0;i<17;i++){
      put(`10_Knowledge/Company Research/ASML - Historic Review ${String(i).padStart(2,"0")}.md`,
        hist("event_date: Unknown"));
    }
    put("01_Companies/ASML.md","---\ntype: company\n---\n# ASML");
    put("06_Portfolio/Review.md",hist("event_date: Unknown"));
    put("07_Sources/ChatGPT/Chat.md",hist("event_date: Unknown"));
    await index();
    const tracked=[
      primary,"10_Knowledge/Company Research/ASML - Historic Review 16.md",
      "06_Portfolio/Review.md","07_Sources/ChatGPT/Chat.md",
    ];
    const before=tracked.map(p=>fs.readFileSync(path.join(vault,p)));
    const {listLegacyReviewQueue}=await import("./legacy-review-queue");
    let cursor:string|undefined;
    const all:string[]=[];
    for(let i=0;i<5;i++){
      const result=listLegacyReviewQueue("P1_provenance_or_chronology",5,cursor);
      expect(result).toMatchObject({
        status:"bounded_read_only_indexed_review_queue",
        indexedNotesConsidered:20,eligibleHistoricalOrReviewNotes:17,
        notesWithReviewFindings:17,totalFindings:17,
        reviewerAuthenticated:false,originalSourceVerified:false,
        canAutoWrite:false,canAutoUpdateThesis:false,
      });
      all.push(...result.page.items.map(x=>x.sourcePath));
      if(!result.page.hasMore)break;
      cursor=result.page.nextCursor!;
    }
    expect(all).toHaveLength(17);
    expect(new Set(all).size).toBe(17);
    expect(all[0]).toBe(primary);
    expect(all[16]).toMatch(/Review 16.md$/);
    expect(tracked.map(p=>fs.readFileSync(path.join(vault,p)))).toEqual(before);
  });
  it("filters exact P2 attribution and P3 navigation without adding wikilinks",async()=>{
    put(primary,hist("source_records:\n  - "+archive));
    put(archive,"---\ntype: chatgpt_archive\n---\nArchived chat is not primary fact");
    put("01_Companies/ASML.md","---\ntype: company\n---\n# ASML");
    put("10_Knowledge/Company Research/ASML - Other.md",hist("company: ['ASML']"));
    await index();
    const {listLegacyReviewQueue}=await import("./legacy-review-queue");
    const p2=listLegacyReviewQueue("P2_attribution_or_scope");
    expect(p2.page.matchedNotesAcrossCompleteIndex).toBe(1);
    expect(p2.page.items[0].sourcePath).toBe(primary);
    expect(p2.page.items[0].findings[0].targetPath).toBe(archive);
    const p3=listLegacyReviewQueue("P3_navigation_only");
    expect(p3.page.items.map(x=>x.sourcePath))
      .toContain("10_Knowledge/Company Research/ASML - Other.md");
    expect(p3.page.items.some(x=>x.sourcePath===primary)).toBe(false);
    expect(p2.originalSourceVerified).toBe(false);
  });
  it("denies enumeration until complete index and rejects cursor/limit misuse",async()=>{
    put(primary,hist("event_date: Unknown"));
    const {listLegacyReviewQueue}=await import("./legacy-review-queue");
    expect(()=>listLegacyReviewQueue()).toThrow("legacy_review_queue_index_not_ready");
    await index();
    expect(()=>listLegacyReviewQueue("all",10,"../secrets.md")).toThrow();
    expect(()=>listLegacyReviewQueue("all",31)).toThrow("legacy_review_queue_invalid_request");
    expect(()=>listLegacyReviewQueue("all",4,"10_Knowledge/Absent.md"))
      .toThrow("legacy_review_queue_cursor_not_indexed");
  });
  it("holds on invalid indexed metadata rather than silently pretending full classification",async()=>{
    put(primary,hist("event_date: Unknown"));
    await index();
    const {db}=await import("../db");
    db().prepare("UPDATE notes SET frontmatter=? WHERE path=?").run("{invalid",primary);
    const {listLegacyReviewQueue}=await import("./legacy-review-queue");
    expect(()=>listLegacyReviewQueue()).toThrow(
      "legacy_review_queue_invalid_indexed_metadata_hold");
  });
});
