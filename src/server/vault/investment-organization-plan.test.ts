import { beforeEach,afterEach,expect,it,vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-knowledge-plan-")));
  vault=path.join(root,"vault");
  fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
  vi.resetModules();
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});
async function note(rel:string,frontmatter:string,body:string){
  const abs=path.join(vault,rel);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,frontmatter+"\n"+body,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(rel);
}
const groups=(plan:Awaited<ReturnType<typeof import("./investment-organization-plan").planVaultOrganization>>)=>
  Object.fromEntries(plan.groups.map(g=>[g.category,g]));

it("groups repeated missing-archive references under one recover-original work item, not an edit",async()=>{
  const archive="07_Sources/ChatGPT/Archive/Feed 170926.json";
  await note("07_Sources/ChatGPT/Conversations/Feed A.md",
    "---\ntype: chat_transcript_index\nsource_type: chatgpt_export\n---",
    "# Historical\n[["+archive+"]]");
  await note("07_Sources/ChatGPT/Conversations/Feed B.md",
    "---\ntype: chat_transcript_index\nsource_type: chatgpt_export\n---",
    "# Historical copy\n[["+archive+"]]");
  const {planVaultOrganization}=await import("./investment-organization-plan");
  const baseline=fs.readFileSync(path.join(vault,"07_Sources/ChatGPT/Conversations/Feed A.md"),"utf8");
  const result=planVaultOrganization();
  const source=groups(result).source_archives;
  expect(source.total).toBe(1);
  expect(source.examples[0]).toMatchObject({
    key:archive,references:2,safeEdit:"not_allowed_without_original",ownerReviewRequired:true,
  });
  expect(result.scan.legacySourceAliasesReadTimeOnly).toBe(2);
  expect(result.vaultMutationPerformed).toBe(false);
  expect(result.sourceOriginalsVerified).toBe(false);
  expect(result.protectedThesisAutoUpdateAllowed).toBe(false);
  expect(fs.existsSync(path.join(vault,archive))).toBe(false);
  expect(fs.readFileSync(path.join(vault,"07_Sources/ChatGPT/Conversations/Feed A.md"),"utf8"))
    .toBe(baseline);
});

it("separates inbox triage, manual links, and invalid metadata without rewriting legacy dates",async()=>{
  await note("00_Inbox/ChatGPT/Raw Incoming.md",
    "---\ntype: intake_receipt\nsource_type: user_supplied_chatgpt_summary\ndate: 2026-09-01\n---",
    "# User text\n[[Unknown Topic]]");
  await note("10_Knowledge/Company Research/Test.md",
    "---\ntype: research_note\nsource_type: unverified\nevent_date: Unknown\n---",
    "# Legacy field - unknown event date");
  const {planVaultOrganization}=await import("./investment-organization-plan");
  const result=planVaultOrganization({maxExamples:3});
  const x=groups(result);
  expect(x.source_archives.total).toBe(0);
  expect(x.other_links.total).toBe(1);
  expect(x.other_links.examples[0].safeEdit).toBe("review_and_preview_only");
  expect(x.inbox.total).toBe(1);
  expect(x.inbox.examples[0].safeEdit).toBe("read_and_classify_first");
  expect(x.metadata.total).toBe(1);
  expect(x.metadata.examples[0].finding).toContain("invalid_event_date");
  expect(x.metadata.examples[0].finding).toContain("source_type_misused_for_verification");
  expect(result.scan.legacySourceAliasesReadTimeOnly).toBe(1);
  expect(fs.readFileSync(path.join(vault,"10_Knowledge/Company Research/Test.md"),"utf8"))
    .toContain("event_date: Unknown");
});

it("never proposes an unapproved protected thesis metadata edit",async()=>{
  await note("05_Thesis/NVDA - Current Thesis.md",
    "---\ntype: current_thesis\nsource_type: unverified\nstatus: draft\n---",
    "# Synthetic draft");
  const {planVaultOrganization}=await import("./investment-organization-plan");
  const group=planVaultOrganization({focus:"metadata"}).groups[0];
  expect(group.total).toBe(1);
  expect(group.examples[0].safeEdit).toBe("not_allowed_without_original");
  expect(group.examples[0].nextAction).toContain("owner-approved Change Log");
});

it("bounds output and refuses invalid limits; no scan truncation is silently certified",async()=>{
  for(let i=0;i<4;i++)await note("00_Inbox/ChatGPT/Queue "+i+".md",
    "---\ntype: intake_receipt\n---","# Item");
  const {planVaultOrganization}=await import("./investment-organization-plan");
  const plan=planVaultOrganization({focus:"inbox",maxExamples:2});
  expect(plan.groups).toHaveLength(1);
  expect(plan.groups[0].total).toBe(4);
  expect(plan.groups[0].examples).toHaveLength(2);
  expect(plan.groups[0].truncated).toBe(true);
  expect(()=>planVaultOrganization({maxExamples:13})).toThrow("organization_invalid_example_limit");
  expect(()=>planVaultOrganization({focus:"invalid" as "all"})).toThrow("organization_invalid_focus");
});
