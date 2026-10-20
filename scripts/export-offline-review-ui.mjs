/**
 * ONE-WAY offline snapshot -> private local HTML review handoff.
 *
 * The snapshot is never written. Only the operator's pre-existing private,
 * standalone, non-Vault export directory receives one 0600 HTML file.
 * No network, login, Owner Approval, Safe Edit, cloud, or Production.
 *
 * Usage:
 *   printf '%s' "$REVIEW_JSON" | node --experimental-strip-types \
 *     scripts/export-offline-review-ui.mjs /ABS/SNAPSHOT /ABS/PRIVATE_EXPORT_DIR
 * Avoid putting note content on process command line.
 */
import fs from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {registerHooks} from "node:module";
import {renderOfflineSnapshotReviewHtml} from "./offline-review-page-renderer.mjs";

registerHooks({
  resolve(specifier,context,nextResolve){
    if((specifier.startsWith("./")||specifier.startsWith("../"))&&
      !/\.(?:[cm]?[jt]s|json|node)$/i.test(specifier)){
      try{return nextResolve(specifier,context);}
      catch(error){
        if(error?.code!=="ERR_MODULE_NOT_FOUND")throw error;
        return nextResolve(specifier+".ts",context);
      }
    }
    return nextResolve(specifier,context);
  },
});
const isInside=(file,root)=>file===root||file.startsWith(root+path.sep);
function directoryGuard(dir,snapshot){
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("offline_review_export_refused_on_railway");
  if(!process.env.DATA_DIR)
    throw Error("offline_review_export_requires_known_live_data_root");
  if(!path.isAbsolute(dir)||dir.length>900||
    !/^nm-offline-review-export-[\w-]+$/.test(path.basename(dir)))
    throw Error("offline_review_export_requires_explicit_private_directory");
  const resolved=fs.realpathSync(dir);
  if(resolved!==path.normalize(dir))
    throw Error("offline_review_export_symlink_path_hold");
  const live=fs.realpathSync(process.env.DATA_DIR);
  const source=fs.realpathSync(snapshot);
  const repo=fs.realpathSync(process.cwd());
  if([live,source,repo].some(ex=>isInside(resolved,ex)||isInside(ex,resolved)))
    throw Error("offline_review_export_location_overlaps_live_snapshot_or_repo");
  const info=fs.statSync(resolved);
  if(!info.isDirectory()||(info.mode&0o077)!==0||
    (typeof process.getuid==="function"&&info.uid!==process.getuid()))
    throw Error("offline_review_export_directory_not_private");
  return resolved;
}
function writeExclusive(dir,html){
  if(Buffer.byteLength(html,"utf8")>100_000)
    throw Error("offline_review_export_too_large");
  const filename="review-"+randomBytes(12).toString("hex")+".html";
  const target=path.join(dir,filename);
  const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
    const buf=Buffer.from(html,"utf8");
    let offset=0;
    while(offset<buf.length){
      const wrote=fs.writeSync(fd,buf,offset,buf.length-offset);
      if(wrote<=0)throw Error("offline_review_export_short_write_hold");
      offset+=wrote;
    }
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  const dirfd=fs.openSync(dir,fs.constants.O_RDONLY);
  try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
  return target;
}
async function main(){
  if(process.argv.length!==4)throw Error("usage: export-offline-review-ui.mjs ABS_SNAPSHOT ABS_PRIVATE_EXPORT_DIR");
  const snapshot=process.argv[2],outputDir=process.argv[3];
  if(!path.isAbsolute(snapshot))throw Error("offline_review_snapshot_must_be_absolute");
  const directory=directoryGuard(outputDir,snapshot);
  const stdin=fs.readFileSync(0);
  if(stdin.byteLength>16_384||stdin.byteLength===0)
    throw Error("offline_review_request_json_invalid_size");
  const req=JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(stdin));
  if(!req||typeof req!=="object"||Array.isArray(req)||
    Object.hasOwn(req,"snapshotRoot"))
    throw Error("offline_review_snapshot_must_come_from_cli_only");
  const allowed=["notePath","expectedNoteSha256","action","relationship",
    "reviewRationale","oldLine","newLine"];
  if(Object.keys(req).some(k=>!allowed.includes(k))||
    allowed.some(k=>typeof req[k]!=="string"))
    throw Error("offline_review_request_unrecognized_or_missing_fields");
  // IMPORTANT: PR #78/#79 checks actual isolated Markdown, indexed data,
  // exact source registry bytes and revision before any HTML output exists.
  const {prepareOfflineBoundSignatureSubject}=await import(
    "../src/server/vault/offline-review-signature-bridge.ts");
  const bound=prepareOfflineBoundSignatureSubject({
    ...req,snapshotRoot:snapshot,
  });
  if(bound.status!=="detached_subject_unapproved"||!bound.subject||
    bound.canAutoWrite!==false||bound.ownerApprovalGranted!==false)
    throw Error("offline_review_evidence_readback_not_eligible");
  const template=fs.readFileSync(new URL(
    "../examples/offline-review-ui/index.html",import.meta.url),"utf8");
  const html=renderOfflineSnapshotReviewHtml(template,bound,req);
  const file=writeExclusive(directory,html);
  process.stdout.write(JSON.stringify({
    status:"local_html_exported_for_human_review_only",
    file,subjectSha256:bound.subjectSha256,
    noteVersionSha256:bound.subject.noteSha256,
    sourceRevision:bound.subject.sourceRevision,
    offlineSnapshotEvidenceRechecked:true,
    issuerAuthenticityVerified:false,
    claimFactsVerified:false,
    ownerIdentityAuthenticated:false,ownerApprovalGranted:false,
    canAutoWrite:false,canAutoUpdateThesis:false,
    productionVaultModified:false,
  })+"\n");
}
try{await main();}
catch(e){
  // Avoid printing the note, source URL or human-authored text.
  process.stderr.write("offline_review_export_hold: "+
    (e instanceof Error?e.message:"unknown")+"\n");
  process.exitCode=1;
}
