/** WORK pre-staging gate. Explicit read-only Vault/snapshot path; no app/db/env
 * imports, migration, network, index update, receipt issuance or repair. Run:
 * node scripts/check-claim-anchor-compatibility.ts --vault /authorized/snapshot
 * Output is anchor compatibility only, NOT full receipt/index/primary validity.
 */
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {parseDocument} from "yaml";
import {claimSourceAnchorIssues} from "../src/server/vault/claim-value-anchor.ts";

const folder="10_Knowledge/Company Research";
const pattern=/^Investment Claim - ICL-[A-F0-9]{32}\.md$/;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function readBounded(root:string,rel:string){
  let current=root;
  for(const part of rel.split("/")){
    current=path.join(current,part);
    if(fs.lstatSync(current).isSymbolicLink())throw Error("file_unreadable_or_unsafe");
  }
  const fd=fs.openSync(current,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||before.size>100_000)throw Error("file_unreadable_or_unsafe");
    const buffer=Buffer.alloc(100_001),n=fs.readSync(fd,buffer,0,buffer.length,0),after=fs.fstatSync(fd);
    if(n>100_000||before.size!==n||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error("file_changed_during_scan");
    return new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,n));
  }finally{fs.closeSync(fd);}
}
function frontmatter(raw:string):{data:Record<string,unknown>;body:string}{
  const header=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if(!header)throw Error("claim_metadata_invalid");
  const doc=parseDocument(header[1],{schema:"core",uniqueKeys:true});
  if(doc.errors.length)throw Error("claim_metadata_invalid");
  const data:unknown=doc.toJS({maxAliasCount:20});
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("claim_metadata_invalid");
  return {data:data as Record<string,unknown>,body:raw.slice(header[0].length)};
}
export function scanClaimAnchors(vault:string){
  if(!path.isAbsolute(vault))throw Error("explicit_absolute_vault_path_required");
  const root=fs.realpathSync(vault),names:string[]=[];let complete=true,enumerated=0;
  // Require a stable, authorized snapshot/read window. Symlink ancestors and
  // nonregular claim/source files HOLD; no paths from note metadata are opened.
  let dirPath=root;
  for(const part of folder.split("/")){dirPath=path.join(dirPath,part);if(!fs.lstatSync(dirPath).isDirectory()||fs.lstatSync(dirPath).isSymbolicLink())throw Error("claim_scope_unavailable");}
  const directoryBefore=fs.statSync(dirPath),dir=fs.opendirSync(dirPath);
  try{let entry;while((entry=dir.readSync())){
    if(++enumerated>5000){complete=false;break;}
    if(pattern.test(entry.name)){names.push(entry.name);if(names.length>1000){complete=false;break;}}
  }}finally{dir.closeSync();}
  const rows=names.sort().slice(0,1000).map(name=>{
    const rel=`${folder}/${name}`;let reasons:string[]=[];
    try{
      const raw=readBounded(root,rel),fm=frontmatter(raw).data,id=fm.intake_id;
      if(!["RI001-1","RI001-2"].includes(String(fm.claim_persistence_version))||fm.type!=="investment_structured_claim_register"||
        typeof id!=="string"||!/^IN-[A-F0-9]{16}$/.test(id)||!Array.isArray(fm.claims)||fm.claims.length!==1)throw Error("claim_metadata_invalid");
      const c=fm.claims[0];
      if(!c||typeof c!=="object"||typeof c.value!=="string"||!c.value||typeof c.source_excerpt!=="string"||
        c.qualification!=null&&typeof c.qualification!=="string")throw Error("claim_metadata_invalid");
      const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
      if(fm.original_source_path!==sourcePath||c.source_path!==sourcePath)throw Error("claim_source_binding_invalid");
      const source=readBounded(root,sourcePath),parsed=frontmatter(source),sf=parsed.data;
      const block=/^(`{3,})text\n([^]*?)\n\1(?:\n|$)/m.exec(parsed.body);
      const original=block&&[block[2],block[2]+"\n"].find(s=>sha(s)===fm.source_text_sha256);
      if(!original||sf.type!=="investment_source_intake"||sf.intake_id!==id||sf.source_text_sha256!==fm.source_text_sha256)throw Error("claim_source_binding_invalid");
      reasons=claimSourceAnchorIssues(original,c.source_excerpt,c.value,c.qualification??undefined);
      if(readBounded(root,rel)!==raw||readBounded(root,sourcePath)!==source)throw Error("file_changed_during_scan");
    }catch(e){
      const known=["claim_metadata_invalid","claim_source_binding_invalid","file_unreadable_or_unsafe","file_changed_during_scan"];
      reasons=[e instanceof Error&&known.includes(e.message)?e.message:"unreadable_or_invalid_note"];
    }
    return {path:rel,status:reasons.length?"HOLD":"ANCHOR_COMPATIBLE",reasons,
      proposedResolution:reasons.length?"Preserve bytes/receipts; review full Source and exact locator/sign/unit in a separately authorized correction workflow. No automatic repair.":null};
  });
  const directoryAfter=fs.statSync(dirPath);
  complete=complete&&directoryBefore.ino===directoryAfter.ino&&directoryBefore.mtimeMs===directoryAfter.mtimeMs&&directoryBefore.ctimeMs===directoryAfter.ctimeMs;
  return {scope:"RI001-1/RI001-2 canonical claim anchor compatibility only (not dimension/receipt verification)",status:!complete?"SCAN_INCOMPLETE":rows.some(r=>r.status==="HOLD")?"HOLD":"ANCHOR_COMPATIBLE",
    scanComplete:complete,scanned:rows.length,held:rows.filter(r=>r.status==="HOLD").length,
    bound:{directoryEntries:5000,claims:1000,noteBytes:100000},writesPerformed:false,receiptIndexPrimaryValidity:"not_assessed",rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==4||process.argv[2]!=="--vault")throw Error("usage");
    const result=scanClaimAnchors(process.argv[3]);console.log(JSON.stringify(result));
    if(result.status!=="ANCHOR_COMPATIBLE")process.exitCode=2;
  }catch{console.error("Compatibility scan unavailable; require explicit authorized --vault path and a stable read-only snapshot/window. No repair performed.");process.exitCode=2;}
}
