import {createHash} from "node:crypto";
import {db} from "../db";
import {readNote} from "./notes";
import type {SourceArchiveProvenance} from "./source-archive-provenance-p0";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const anchor="\n- Original publication/source authentication: not verified by this workflow\n";
const prefixes=[
  ["- Archive provenance v2:","- Archive snapshot:","- Archive URL binding:","- Archive capture:",
    "- Archive chronology:","- Archive integrity scope:","- Archive limitation:"],
  ["- Original-byte archive:","- Archive URL:","- Archive sequence revision:","- Publisher revision hints (unverified):",
    "- Archive chronology:","- Archive association:","- Archive limitation:"]
];
function parts(content:string){
  const start=content.indexOf(anchor);
  if(start<0||content.indexOf(anchor,start+1)>=0)return null;
  const from=start+anchor.length;
  const lines=content.slice(from).split("\n");
  const length=lines[0].startsWith("- Event date:")?0:
    prefixes.some(p=>p.every((prefix,i)=>lines[i]?.startsWith(prefix))&&lines[7]?.startsWith("- Event date:"))?7:-1;
  if(length<0)return null;
  const archive=lines.slice(0,length).join("\n");
  return {archive,body:content.slice(0,from)+lines.slice(length).join("\n")};
}

/** Classify only archive differences in an independently receipted historical
 * canonical create. Never bless edited bytes, changed analysis, incomplete
 * receipts or unknown renderings as drift. No store initialization or writes. */
export function revalidateHistoricalArchive(path:string,proposed:string,
  current:SourceArchiveProvenance|null,archiveHold:boolean):{
    state:"verified_existing"|"hold_archive_drift";content:string;receiptKey:string
  }|null {
  try{
    const content=readNote(path).content,hash=sha(content);
    const old=parts(content),next=parts(proposed);
    if(!old||!next||old.body!==next.body)return null;
    const id="ICW-"+sha(["canonical_review",path,hash].join("\n")).slice(0,32);
    const row=db().prepare("SELECT payload,after_text,after_hash,before_hash,receipt FROM safe_edit_operations WHERE id=? AND status='written'")
      .get(id) as {payload:string;after_text:string;after_hash:string;before_hash:string;receipt:string|null}|undefined;
    if(!row?.receipt||row.after_text!==content||row.after_hash!==hash||row.before_hash!==sha(""))return null;
    const p=JSON.parse(row.payload) as {path?:unknown;operationId?:unknown;change?:{kind?:unknown;content?:unknown}};
    const r=JSON.parse(row.receipt) as Record<string,unknown>;
    if(p.path!==path||p.operationId!==id||p.change?.kind!=="create"||p.change.content!==content||
      r.operationId!==id||r.path!==path||r.afterHash!==hash||r.beforeHash!==row.before_hash||
      r.write!=="written"||r.readback!=="verified"||r.reindex!=="verified")return null;
    const equivalent=!archiveHold&&(old.archive===next.archive||
      !!current&&sha(old.archive)===current.legacyBlockSha256);
    return {state:equivalent?"verified_existing":"hold_archive_drift",content,receiptKey:id};
  }catch{return null;}
}
