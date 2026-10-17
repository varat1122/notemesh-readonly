import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {restore}=require("../../scripts/restore-original-archive.cjs") as {
  restore:(args:Record<string,unknown>)=>{status:string,sha256:string,targetPath:string,sourceIdentity:string};
};

let root:string,vault:string,original:string;
const rel="07_Sources/ChatGPT/Archive/Feed 160726.json";
const bytes=Buffer.from('{"source_chat":"Feed 160726","messages":[]}\n');
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"archive-restore-"));
  vault=path.join(root,"vault");
  fs.mkdirSync(path.join(vault,"07_Sources","ChatGPT","Archive"),{recursive:true});
  original=path.join(root,"Feed.json");fs.writeFileSync(original,bytes);
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
describe("missing original archive restoration",()=>{
  it("defaults to dry run without altering Vault",()=>{
    const x=restore({vault,sourceFile:original,targetPath:rel});
    expect(x.status).toBe("dry_run");
    expect(fs.existsSync(path.join(vault,rel))).toBe(false);
    expect(x.sourceIdentity).toBe("file_bytes_only_no_historical_identity_proof");
  });
  it("restores only actual source bytes with SHA-256, no invented JSON",()=>{
    const h=crypto.createHash("sha256").update(bytes).digest("hex");
    const x=restore({vault,sourceFile:original,targetPath:rel,expectedSha256:h,commit:true});
    expect(x.status).toBe("written_or_identical_verified");
    expect(x.sha256).toBe(h);
    expect(x.sourceIdentity).toBe("hash_matched");
    expect(fs.readFileSync(path.join(vault,rel))).toEqual(bytes);
  });
  it("is idempotent for identical original",()=>{
    restore({vault,sourceFile:original,targetPath:rel,commit:true});
    expect(restore({vault,sourceFile:original,targetPath:rel,commit:true}).status)
      .toBe("written_or_identical_verified");
  });
  it("refuses mismatched expected digest and destination conflict",()=>{
    expect(()=>restore({vault,sourceFile:original,targetPath:rel,commit:true,expectedSha256:"0".repeat(64)}))
      .toThrow(/SHA-256 mismatch/);
    const d=path.join(vault,rel);fs.writeFileSync(d,"different");
    expect(()=>restore({vault,sourceFile:original,targetPath:rel,commit:true})).toThrow(/conflicts/);
    expect(fs.readFileSync(d,"utf8")).toBe("different");
  });
  it("rejects archive traversal or changing filename extension",()=>{
    expect(()=>restore({vault,sourceFile:original,targetPath:"07_Sources/ChatGPT/Archive/../AB.json"}))
      .toThrow(/Unsafe archive/);
    expect(()=>restore({vault,sourceFile:original,targetPath:"05_Thesis/NVDA - Current Thesis.md"}))
      .toThrow(/Unsafe archive/);
  });
  it("rejects symlinks in archive path",()=>{
    const outside=path.join(root,"outside");fs.mkdirSync(outside);
    fs.symlinkSync(outside,path.join(vault,"07_Sources","ChatGPT","Archive","Trap"));
    expect(()=>restore({vault,sourceFile:original,targetPath:"07_Sources/ChatGPT/Archive/Trap/source.json",commit:true}))
      .toThrow(/Unsafe archive directory/);
  });
  it("rejects fake ZIP with mismatching magic bytes",()=>{
    const z=path.join(root,"zip.bin");fs.writeFileSync(z,"not a zip");
    expect(()=>restore({vault,sourceFile:z,targetPath:"07_Sources/ChatGPT/Archive/InvestmentFeed 2026-10-15/original-source.zip"}))
      .toThrow(/Invalid ZIP/);
  });
});
