import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const intake=(id:string)=>`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
const review="10_Knowledge/Industry and Concepts/Investment Review - Solidigm - IN-4AF8FD0215D3A798.md";
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"m56-discovery-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function seed(p:string,frontmatter:string,body:string){
  const full=path.join(vault,p);fs.mkdirSync(path.dirname(full),{recursive:true});
  fs.writeFileSync(full,`---\n${frontmatter}\n---\n\n${body}\n`);
  const {reindexPath}=await import("./indexer");reindexPath(p);
}
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
async function source(id:string,body:string,lang:string,url:string,date="2026-10-23"){
  await seed(intake(id),[
    "type: investment_source_intake",`intake_id: "${id}"`,`source_text_sha256: "${sha(body)}"`,
    `source_language: "${lang}"`,`source_url: "${url}"`,`event_date: "${date}"`,`published_at: "${date}"`
  ].join("\n"),`## User-supplied original language text\n\n\`\`\`text\n${body}\n\`\`\``);
}
it("finds Solidigm cross-language same-date family as candidate, never verified duplicate",async()=>{
  await source("IN-4AF8FD0215D3A798","SK hynix ยกเลิก IPO Solidigm","th","https://th.investing.com/news/a");
  await source("IN-B637DC6926EBA011","SK hynix scraps Solidigm IPO","en","https://www.investing.com/news/b");
  const {discoverNearDuplicateSourcesM56}=await import("./review-discovery-m56");
  const result=discoverNearDuplicateSourcesM56({sourcePath:intake("IN-4AF8FD0215D3A798"),eventAnchor:"sk-hynix-solidigm-ipo-cancellation"});
  expect(result.candidates).toMatchObject([{path:intake("IN-B637DC6926EBA011"),candidateClass:"same_date_publisher_family_candidate"}]);
  expect(result.candidates[0].signals).toContain("different_source_languages");
  expect(result.semanticDuplicateVerified).toBe(false);
  expect(result.writePerformed).toBe(false);
});
it("does not merge same-publisher different dated event; and exact text is only a candidate",async()=>{
  await source("IN-4AF8FD0215D3A798","event one","en","https://www.investing.com/a");
  await source("IN-B637DC6926EBA011","event two","en","https://www.investing.com/b","2026-10-24");
  await source("IN-A000000000000001","event one","en","https://elsewhere.com/c","2026-10-22");
  const {discoverNearDuplicateSourcesM56}=await import("./review-discovery-m56");
  const result=discoverNearDuplicateSourcesM56({sourcePath:intake("IN-4AF8FD0215D3A798"),eventAnchor:"distinct-event-test"});
  expect(result.candidates.map(x=>x.intakeId)).toEqual(["IN-A000000000000001"]);
  expect(result.candidates[0].candidateClass).toBe("exact_text_candidate");
  expect(result.semanticDuplicateVerified).toBe(false);
});
it("proposes unapproved Review Version/Supersession with Evidence Change Log and no mutations",async()=>{
  await source("IN-4AF8FD0215D3A798","Original source data","th","https://th.investing.com/news/a");
  await seed(review,["type: investment_research_review",'intake_id: "IN-4AF8FD0215D3A798"',
    `original_source_path: "${intake("IN-4AF8FD0215D3A798")}"`].join("\n"),
  `# Review\n\n[[${intake("IN-4AF8FD0215D3A798").slice(0,-3)}]]\n\n## Source provenance\n`);
  const before=fs.readFileSync(path.join(vault,review),"utf8");
  const {planReviewRevisionM56}=await import("./review-discovery-m56");
  const result=planReviewRevisionM56({reviewPath:review,eventAnchor:"sk-hynix-solidigm-ipo-cancellation",
    changeType:"supersession",comparisonBasis:"A revised primary report changes the claimed event outcome; needs issuer confirmation.",
    proposedChange:"Proposed revision only: explicitly mark old statement as disputed until the issuer filing is checked.",
    sourcePaths:[intake("IN-4AF8FD0215D3A798")],proposalDate:"2026-10-26"});
  expect(result).toMatchObject({status:"owner_approval_required",safeEditRequest:null,writePerformed:false,
    protectedNotesTouched:false,evidenceChangeLogProposal:{changeType:"supersession",evidenceStatus:"proposal_unverified"}});
  expect(result.existingReviewVersionSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(fs.readFileSync(path.join(vault,review),"utf8")).toBe(before);
});
