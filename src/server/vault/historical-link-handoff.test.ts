import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const sourcePath="10_Knowledge/Company Research/NVDA - Prior Research.md";
const targetPath="05_Thesis/NVDA - Current Thesis.md";
const anchorLine="This is a historical research note that needs review.";
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-link-handoff-")));
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
function put(rel:string,frontmatter:string,body:string) {
  const abs=path.join(vault,rel);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,frontmatter+"\n"+body);
}
const read=(rel:string)=>fs.readFileSync(path.join(vault,rel),"utf8");
const metadata=(entity="NVDA")=>[
  "---","type: knowledge_note","source_type: chatgpt_history",
  "verification: not_reverified",`entity: ${entity}`,"---",
].join("\n");
const thesisMeta=["---","type: current_thesis","entity: NVDA","status: draft","---"].join("\n");
async function indexed(body="# Prior research\n"+anchorLine+"\n",entity="NVDA"){
  put(sourcePath,metadata(entity),body);
  put(targetPath,thesisMeta,"# Working Thesis\nDraft status, not endorsed.");
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
}
const input=()=>({sourcePath,targetPath,anchorLine});

describe("one-note historical link Safe Edit handoff, fully read-only",()=>{
  it("returns a valid but unsubmitted exact-replace template with both actual file hashes",async()=>{
    await indexed();
    const before=read(sourcePath),targetBefore=read(targetPath);
    const {prepareHistoricalLinkEdit}=await import("./historical-link-handoff");
    const {previewSchema}=await import("../safe-edit/schema");
    const proposal=prepareHistoricalLinkEdit(input());
    expect(proposal).toMatchObject({
      status:"read_only_safe_edit_handoff_needs_review",
      sourcePath,targetPath,declaredEntity:"NVDA",
      requiresHumanReview:true,previewRecorded:false,vaultModified:false,
      canAutoWrite:false,canAutoUpdateThesis:false,
    });
    expect(proposal.sourceSha256).toBe(createHash("sha256").update(before).digest("hex"));
    expect(proposal.targetSha256).toBe(createHash("sha256").update(targetBefore).digest("hex"));
    expect(proposal.safeEditTemplate.change).toEqual({
      kind:"replace",oldText:anchorLine,
      newText:anchorLine+"\nRelated note (navigation only; not independent evidence): [[05_Thesis/NVDA - Current Thesis]]",
    });
    expect(previewSchema.safeParse({
      operationId:"review-link-test-20261019",
      ...proposal.safeEditTemplate,
    }).success).toBe(true);
    expect(read(sourcePath)).toBe(before);
    expect(read(targetPath)).toBe(targetBefore);
  });
  it("refuses before index is ready or a source/target not verified by the planner",async()=>{
    put(sourcePath,metadata(),"# Prior research\n"+anchorLine);
    put(targetPath,thesisMeta,"# Working Thesis");
    const {prepareHistoricalLinkEdit}=await import("./historical-link-handoff");
    expect(()=>prepareHistoricalLinkEdit(input())).toThrow("historical_link_index_not_ready");
    const {indexer}=await import("./indexer");
    await indexer().rebuild();
    expect(()=>prepareHistoricalLinkEdit({...input(),targetPath:"01_Companies/NVDA.md"}))
      .toThrow("historical_link_candidate_not_verified");
  });
  it("rejects a bad, repeated or not-exact-body anchor and does not alter originals",async()=>{
    await indexed("# Prior research\n"+anchorLine+"\n"+anchorLine+"\n");
    const before=read(sourcePath);
    const {prepareHistoricalLinkEdit}=await import("./historical-link-handoff");
    expect(()=>prepareHistoricalLinkEdit(input()))
      .toThrow("historical_link_anchor_not_unique_or_outside_body");
    expect(read(sourcePath)).toBe(before);
    expect(()=>prepareHistoricalLinkEdit({...input(),anchorLine:"This is not actually a source line."}))
      .toThrow("historical_link_anchor_not_unique_or_outside_body");
  });
  it("rejects code-fence anchors or already-indexed links",async()=>{
    await indexed("# Prior research\n```text\n"+anchorLine+"\n```\n");
    const {prepareHistoricalLinkEdit}=await import("./historical-link-handoff");
    expect(()=>prepareHistoricalLinkEdit(input()))
      .toThrow("historical_link_anchor_not_plain_prose");
    const {indexer}=await import("./indexer");
    put(sourcePath,metadata(),"# Prior research\n"+anchorLine+"\n[[05_Thesis/NVDA - Current Thesis]]\n");
    await indexer().rebuild();
    expect(()=>prepareHistoricalLinkEdit(input())).toThrow("historical_link_candidate_not_verified");
  });
  it("refuses a changed source entity until the index and semantics are independently reviewed",async()=>{
    await indexed();
    const old=read(sourcePath);
    fs.writeFileSync(path.join(vault,sourcePath),old.replace("entity: NVDA","entity: AMD"));
    const {prepareHistoricalLinkEdit}=await import("./historical-link-handoff");
    expect(()=>prepareHistoricalLinkEdit(input()))
      .toThrow("historical_link_metadata_changed_since_index");
  });
  it("refuses malformed or unknown-entity inputs without implying issuer identity",async()=>{
    await indexed(undefined,"NVDA, AMD");
    const {prepareHistoricalLinkEdit}=await import("./historical-link-handoff");
    expect(()=>prepareHistoricalLinkEdit(input())).toThrow("historical_link_candidate_not_verified");
    expect(()=>prepareHistoricalLinkEdit({...input(),anchorLine:"x"}))
      .toThrow("historical_link_invalid_selection");
  });
  it("preserves CRLF source note endings in the proposed replacement",async()=>{
    await indexed("# Prior research\r\n"+anchorLine+"\r\n");
    const {prepareHistoricalLinkEdit}=await import("./historical-link-handoff");
    const p=prepareHistoricalLinkEdit(input());
    expect(p.safeEditTemplate.change).toMatchObject({
      kind:"replace",newText:anchorLine+"\r\nRelated note (navigation only; not independent evidence): [[05_Thesis/NVDA - Current Thesis]]",
    });
  });
});
