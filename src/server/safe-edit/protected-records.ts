import {splitFrontmatter} from "../vault/markdown";

/** No accepted generic Safe Edit authorization exists for curated timelines or
 * Decision Ledger records. OAuth edit scope, a preview token or the existing
 * Thesis approval page cannot create that missing authority. Read views remain
 * available; historical receipts are not rewritten or deleted. */
export function assertProtectedRecord(path:string,...metadata:Record<string,unknown>[]){
  const file=path.split("/").at(-1)??"";
  const types=metadata.flatMap(typesOf);
  const timeline=/^(?:Company Evolution - .+|Company Evolution Timeline(?: - .+)?|00_Investment_Evolution_Master(?: - .+)?|.+ - Company Evolution Timeline)\.md$/i.test(file);
  const decision=/^(?:(?:Investment )?Decision Ledger(?: - .+)?|.+ - Decision Ledger)\.md$/i.test(file);
  const typed=types.some(type=>type!==null&&["company_evolution_timeline","investment_evolution_master","decision_ledger"].includes(type));
  if(timeline||decision||typed)throw Error("protected_record_separate_authorization_required");
  // The accepted exact-diff + structured-evidence Thesis workflow is scoped to
  // 05_Thesis. A renamed protected artifact elsewhere must not shed that guard.
  if(!path.startsWith("05_Thesis/")&&(
    /^(?:(?:.+ - )?(?:Current Thesis|Evidence Register))\.md$/i.test(file)||
    types.some(type=>type!==null&&["current_thesis","thesis","evidence_register"].includes(type))))
    throw Error("protected_record_outside_authorized_thesis_scope");
}

/** PD-11 (WP2): one normalized namespace predicate for every route. Unicode
 * NFC, format characters, case, `./` segments and trailing dots/spaces are
 * folded so an alias of a canonical or protected path keeps its class.
 * A frontmatter `type` can restrict but never grants canonical authority. */
export function normalizeVaultPath(p:string):string{
  const folded=p.normalize("NFC").replace(/\p{Cf}/gu,"").replace(/\\/g,"/");
  return folded.split("/").filter(s=>s!==""&&s!==".").map(s=>s.replace(/[. ]+$/,"")).join("/").toLowerCase();
}
export type CanonicalNamespaceKind="source_intake"|"canonical_review"|"structured_claim";
const research="10_knowledge/(?:company research|industry and concepts|macro and markets)";
const SOURCE=/^00_inbox\/chatgpt\/investment intake - in-[a-f0-9]{16}\.md$/;
const CLAIM=new RegExp("^"+research+"/investment claim - icl-[a-f0-9]{32}\\.md$");
const REVIEW=new RegExp("^"+research+"/investment review - [^/]+\\.md$");
export function canonicalNamespaceKind(p:string):CanonicalNamespaceKind|null{
  const n=normalizeVaultPath(p);
  return SOURCE.test(n)?"source_intake":CLAIM.test(n)?"structured_claim":REVIEW.test(n)?"canonical_review":null;
}
/** Protected roots that no generic/raw route may write (05_Thesis keeps its
 * own exact-diff approval workflow inside Safe Edit, never raw writers). */
export function isProtectedPrefix(p:string):boolean{
  return /^(?:05_thesis|06_portfolio|07_sources)(?:\/|$)/.test(normalizeVaultPath(p));
}
const CANONICAL_OR_PROTECTED_ROOTS=["00_inbox/chatgpt","10_knowledge/company research","10_knowledge/industry and concepts","10_knowledge/macro and markets","05_thesis","06_portfolio","07_sources"];
/** Folder-level form for moves/deletes: true when the folder is, contains or
 * lies inside a canonical or protected root. */
export function touchesCanonicalOrProtectedFolder(folder:string):boolean{
  const n=normalizeVaultPath(folder);
  return n===""||CANONICAL_OR_PROTECTED_ROOTS.some(r=>r===n||r.startsWith(n+"/")||n.startsWith(r+"/"));
}
/** File-level form: true when the note lies inside a canonical or protected root. */
export function isInsideCanonicalOrProtectedRoot(p:string):boolean{
  const n=normalizeVaultPath(p);
  return CANONICAL_OR_PROTECTED_ROOTS.some(r=>n.startsWith(r+"/"));
}
/** Raw (non-Safe-Edit) writers, in every mode: canonical and protected records
 * are refused outright, including protected filenames anywhere (assertProtectedRecord). */
export function assertRawWriteAllowed(p:string,...metadata:Record<string,unknown>[]){
  if(canonicalNamespaceKind(p)||isProtectedPrefix(p))throw Error("canonical_or_protected_raw_write_refused");
  assertProtectedRecord(p,...metadata);
}
/** OD-10 F-1: a `type` value folded once — NFC, format characters, case,
 * surrounding quotes/space, and space/hyphen runs as `_` — and a list-valued
 * `type` read element by element, so spelling cannot shed protection. */
function foldType(v:string):string{
  return v.normalize("NFC").replace(/\p{Cf}/gu,"").trim().replace(/^["']+|["']+$/g,"").trim().toLowerCase().replace(/[\s-]+/g,"_");
}
function typesOf(fm:Record<string,unknown>):string[]{
  return (Array.isArray(fm.type)?fm.type:[fm.type]).filter((t):t is string=>typeof t==="string").map(foldType);
}
/** OD-10 F-1: every metadata reading of a note's raw bytes — the server's own
 * frontmatter parse, plus a fail-closed scan of each `type:` key (and the
 * list/continuation lines under it) in the leading block — so malformed YAML,
 * duplicate keys, tags or flow lists cannot hide a protected `type`. */
export function rawRecordMetadata(content:string|null):Record<string,unknown>[]{
  if(content===null)return [];
  const out:Record<string,unknown>[]=[splitFrontmatter(content).data];
  const lines=content.replace(/^[\p{Cf}\s]+/u,"").split(/\r?\n/);
  if(!/^---[ \t]*$/.test(lines[0]??""))return out;
  const close=lines.findIndex((l,i)=>i>0&&/^(?:---|\.\.\.)[ \t]*$/.test(l));
  if(close<0)return out;
  const block=lines.slice(1,close);
  const anchors=new Map([...block.join("\n").matchAll(/&([^\s,[\]{}]+)[ \t]+([^\n#,[\]{}]+)/g)].map(m=>[m[1],m[2]]));
  block.forEach((line,i)=>{
    const key=/^([ \t]*)["']?type["']?[ \t]*:(.*)$/i.exec(line);
    if(!key)return;
    const values=[key[2]];
    for(const next of block.slice(i+1)){
      const indent=/^[ \t]*/.exec(next)![0].length;
      if(indent>key[1].length||/^[ \t]*-/.test(next))values.push(next.replace(/^[ \t]*-?/,""));else break;
    }
    for(const v of values)for(const raw of v.replace(/[ \t]+#.*$/,"").replace(/[[\]{}]/g,",").split(",")){
      const t=raw.trim().replace(/^[!&]\S*[ \t]+/,"");
      out.push({type:t.startsWith("*")?anchors.get(t.slice(1))??t:t});
    }
  });
  return out;
}
/** OD-10 F-1 (PD-11, all modes): raw writers check the path AND both the
 * on-disk (before) and the proposed (after) bytes, so adding, keeping,
 * renaming or removing a protected `type` is refused alike. */
export function assertRawContentAllowed(p:string,before:string|null,after:string|null){
  assertRawWriteAllowed(p,...rawRecordMetadata(before),...rawRecordMetadata(after));
}
