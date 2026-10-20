import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const sha=(x:Buffer|string)=>createHash("sha256").update(x).digest("hex");
const script=fileURLToPath(new URL("../../../scripts/export-offline-review-ui.mjs",
  import.meta.url));
const original=Buffer.from("<html>Fictional issuer bytes, not authenticated</html>");
const sourceUrl="https://example.org/fictional/notice";
const notePath="10_Knowledge/Company Research/SYNTH - Offline Review.md";
let live:string,snapshot:string,out:string,vault:string;
const sentence="Fictional historic note number: 10.";
const note=(oldLine=sentence)=>[
  "---","type: research_note","source_type: primary",
  "verification: not_reverified",
  "original_source: "+sourceUrl,
  "original_source_sha256: '"+sha(original)+"'",
  "event_key: SYNTH-2026Q3",
  "event_date: '2026-09-25'",
  "published_at: '2026-09-26T09:00:00Z'",
  "imported_at: '2026-09-27T09:00:00Z'",
  "verified_at: '2026-09-28T09:00:00Z'",
  "---","# Fictional historic review",oldLine,"",
].join("\n");
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-export-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-export-snapshot-")));
  out=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-offline-review-export-")));
  vault=path.join(live,"vault");
  fs.mkdirSync(path.join(vault,...notePath.split("/").slice(0,-1)),
    {recursive:true});
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,9).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  for(const folder of [live,snapshot,out])
    fs.rmSync(folder,{force:true,recursive:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function createFixture(oldLine=sentence){
  fs.writeFileSync(path.join(vault,notePath),note(oldLine));
  const {captureOriginalDocumentBytes}=await import("../research-source-archive");
  captureOriginalDocumentBytes({
    originalSource:sourceUrl,bytes:original,contentType:"text/html",
    capturedAt:"2026-10-20T01:00:00Z",
    captureMethod:"authorized_external_download",
    retrievedFrom:sourceUrl,reviewerOrOperator:"fictional-offline-only",
  });
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),
    {recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  fs.cpSync(path.join(live,"source-archive"),
    path.join(snapshot,"source-archive"),
    {recursive:true,preserveTimestamps:true});
}
function request(oldLine=sentence,newLine="Fictional historic note number: 12."){
  return {
    notePath,expectedNoteSha256:sha(fs.readFileSync(
      path.join(snapshot,"vault",notePath))),
    action:"metadata_correction_candidate",
    relationship:"added_detail",
    reviewRationale:"Fictional number requires issuer verification",
    oldLine,newLine,
  };
}
function run(req:Record<string,unknown>,folder=out,
  env:Record<string,string>={}){
  return spawnSync(process.execPath,[
    "--experimental-strip-types",script,snapshot,folder,
  ],{
    input:JSON.stringify(req),encoding:"utf8",timeout:45_000,
    env:{...process.env,DATA_DIR:live,
      ENCRYPTION_KEY:process.env.ENCRYPTION_KEY!,...env},
  });
}
describe("PR #83 offline verified snapshot to local Thai browser review",()=>{
  it("generates ONE 0600 offline HTML only after exact source+note readback",async()=>{
    await createFixture();
    const before=fs.readFileSync(path.join(snapshot,"vault",notePath));
    const sourceFile=path.join(snapshot,"source-archive","blobs",
      sha(original).slice(0,2),sha(original)+".bin");
    const stored=fs.readFileSync(sourceFile);
    const result=run(request());
    expect(result.status,result.stderr).toBe(0);
    const packet=JSON.parse(result.stdout);
    expect(packet).toMatchObject({
      status:"local_html_exported_for_human_review_only",
      noteVersionSha256:sha(before),sourceRevision:1,
      offlineSnapshotEvidenceRechecked:true,
      issuerAuthenticityVerified:false,claimFactsVerified:false,
      ownerIdentityAuthenticated:false,ownerApprovalGranted:false,
      canAutoWrite:false,canAutoUpdateThesis:false,
      productionVaultModified:false,
    });
    expect(packet.subjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(path.dirname(packet.file)).toBe(out);
    expect(fs.statSync(packet.file).mode&0o777).toBe(0o600);
    const html=fs.readFileSync(packet.file,"utf8");
    expect(html).toContain("Fictional historic note number: 10.");
    expect(html).toContain("Fictional historic note number: 12.");
    expect(html).toContain("ไม่ได้ตรวจผู้เผยแพร่ต้นฉบับ");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("Synthetic snapshot #01");
    expect(fs.readFileSync(path.join(snapshot,"vault",notePath))).toEqual(before);
    expect(fs.readFileSync(sourceFile)).toEqual(stored);
    expect(fs.readdirSync(out)).toHaveLength(1);
  });
  it("holds stale exact note hash or changed stored original, writes no HTML",async()=>{
    await createFixture();
    const stale=run({...request(),expectedNoteSha256:"0".repeat(64)});
    expect(stale.status).not.toBe(0);
    expect(fs.readdirSync(out)).toEqual([]);
    const file=path.join(snapshot,"source-archive","blobs",
      sha(original).slice(0,2),sha(original)+".bin");
    fs.writeFileSync(file,Buffer.alloc(original.length,0x63));
    const changed=run(request());
    expect(changed.status).not.toBe(0);
    expect(fs.readdirSync(out)).toEqual([]);
  });
  it("escapes both old note text and proposed text so they cannot execute",async()=>{
    const malicious="Fictional note text <img src=x onerror=alert(1)>";
    await createFixture(malicious);
    const r=run(request(malicious,"<script>alert('XSS')</script>"));
    expect(r.status,r.stderr).toBe(0);
    const p=JSON.parse(r.stdout);
    const html=fs.readFileSync(p.file,"utf8");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;XSS&#39;)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<script>alert");
  });
  it("rejects HTML-block note anchors instead of rewriting note structure",async()=>{
    const htmlBlock="<img src=x onerror=alert(1)>";
    await createFixture(htmlBlock);
    const bad=run(request(htmlBlock,"Suggested fictional replacement"));
    expect(bad.status).not.toBe(0);
    expect(fs.readdirSync(out)).toEqual([]);
  });
  it("never accepts an output directory in Vault, snapshot or repo",async()=>{
    await createFixture();
    const inLive=path.join(live,"nm-offline-review-export-forbidden");
    fs.mkdirSync(inLive,{mode:0o700});
    expect(run(request(),inLive).status).not.toBe(0);
    const inSnapshot=path.join(snapshot,"nm-offline-review-export-forbidden");
    fs.mkdirSync(inSnapshot,{mode:0o700});
    expect(run(request(),inSnapshot).status).not.toBe(0);
    expect(fs.readdirSync(out)).toEqual([]);
  });
  it("rejects Railway runtime, extra input fields and missing private directory",async()=>{
    await createFixture();
    expect(run(request(),out,{RAILWAY_PROJECT_ID:"test-only"}).status).not.toBe(0);
    expect(run({...request(),snapshotRoot:live}).status).not.toBe(0);
    fs.chmodSync(out,0o755);
    expect(run(request()).status).not.toBe(0);
    expect(fs.readdirSync(out)).toEqual([]);
  });
});
