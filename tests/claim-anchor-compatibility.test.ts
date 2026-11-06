import {beforeEach,afterEach,it,expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {scanClaimAnchors} from "../scripts/check-claim-anchor-compatibility";

let root:string,folder:string;
const name="Investment Claim - ICL-"+"A".repeat(32)+".md";
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"anchor-scan-"));folder=path.join(root,"10_Knowledge/Company Research");fs.mkdirSync(folder,{recursive:true});});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
it("invalid legacy metadata is visible as HOLD, with no quoted content or absolute path disclosure",()=>{
  fs.writeFileSync(path.join(folder,name),"---\nclaims: [broken YAML\n---\nprivate fixture text");
  const scan=scanClaimAnchors(root);
  expect(scan).toMatchObject({status:"HOLD",scanComplete:true,held:1,writesPerformed:false});
  expect(scan.rows[0].reasons).toEqual(["claim_metadata_invalid"]);
  expect(JSON.stringify(scan)).not.toContain(root);expect(JSON.stringify(scan)).not.toContain("private fixture text");
});
it("symlinked claim is HOLD and never follows the target",()=>{
  fs.writeFileSync(path.join(root,"private.txt"),"Never read outside the claim scope");
  fs.symlinkSync(path.join(root,"private.txt"),path.join(folder,name));
  const scan=scanClaimAnchors(root);expect(scan.rows[0].reasons).toEqual(["file_unreadable_or_unsafe"]);
  expect(JSON.stringify(scan)).not.toContain("Never read");
});
it("missing Source is HOLD without creating any source, DB or receipt",()=>{
  const source="00_Inbox/ChatGPT/Investment Intake - IN-AAAAAAAAAAAAAAAA.md";
  fs.writeFileSync(path.join(folder,name),`---\ntype: investment_structured_claim_register\nclaim_persistence_version: RI001-1\nintake_id: IN-AAAAAAAAAAAAAAAA\noriginal_source_path: ${source}\nclaims:\n  - value: '13.5'\n    source_excerpt: 'Revenue 13.5'\n    source_path: ${source}\n---\n`);
  expect(scanClaimAnchors(root).rows[0].reasons).toEqual(["unreadable_or_invalid_note"]);
  expect(fs.existsSync(path.join(root,"00_Inbox"))).toBe(false);expect(fs.existsSync(path.join(root,"app.sqlite"))).toBe(false);
});
it("overflow is explicitly SCAN_INCOMPLETE; bounded returned rows cannot claim whole-Vault compatibility",()=>{
  for(let i=0;i<1001;i++)fs.writeFileSync(path.join(folder,`Investment Claim - ICL-${i.toString(16).toUpperCase().padStart(32,"0")}.md`),"# Invalid metadata fixture; no receipts");
  const scan=scanClaimAnchors(root);expect(scan).toMatchObject({status:"SCAN_INCOMPLETE",scanComplete:false,scanned:1000,held:1000,writesPerformed:false});
});
it("requires an explicit absolute scope and rejects symlinked folder ancestors",()=>{
  expect(()=>scanClaimAnchors(".")).toThrow("explicit_absolute_vault_path_required");
  fs.renameSync(folder,folder+"-real");fs.symlinkSync(folder+"-real",folder);
  expect(()=>scanClaimAnchors(root)).toThrow("claim_scope_unavailable");
});
