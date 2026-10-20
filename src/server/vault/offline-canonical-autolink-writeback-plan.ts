/**
 * PR #98 — Canonical Obsidian auto-link / safe writeback PLANNER.
 *
 * Offline-only, synthetic, read-only. The entry point reruns PR #97's
 * physically reconciled PR #95 evidence/citation check before considering
 * externally suggested destinations. A link is NOT an assertion of causal
 * truth and never grants owner access or a protected Thesis mutation.
 *
 * This intentionally returns a REDACTED staging receipt, NOT Markdown that
 * could leak protected quotes, source data or arbitrary model instructions.
 * It does not invoke an MCP writer, model, API, Git sync or file mutation.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {reviewOfflineInvestmentReasoningContract,
  type OfflineReasoningContractInput}
  from "./offline-investment-reasoning-contract";
import {verifyOfflineSnapshotCoverage}
  from "./snapshot-coverage-acceptance";
import {extractStructure,splitFrontmatter} from "./markdown";

type Role="source_evidence"|"company_hub"|"company_evolution"|
  "industry_theme"|"thesis_reference"|"evidence_register_reference";
type Selected={
  role:Role;path:string;expectedSha256:string;
  justification:"same_issuer"|"original_event_evidence"|
    "industry_exposure_candidate"|"industry_causal_hypothesis"|
    "existing_draft_thesis_reference";
};
export type OfflineCanonicalAutolinkInput=OfflineReasoningContractInput&{
  routing:{
    operationId:string;
    /** Untrusted candidate path. No existing content may be overwritten. */
    proposedAnalysisNotePath:string;
    targets:Selected[];
  };
};
const SHA=/^[a-f0-9]{64}$/;
const OP=/^[a-z][a-z0-9-]{7,95}$/;
const CLEAN=/^[\p{L}\p{N} _./()\-]+\.md$/u;
const hash=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
const normalized=(s:string)=>s.normalize("NFC").toLowerCase();
function safePath(s:unknown){
  if(typeof s!=="string"||s.length<4||s.length>200||
    !CLEAN.test(s)||s.includes("\\")||s.startsWith("/")||
    s.includes("//")||s.includes("/./")||s.endsWith("/.")||
    s.split("/").some(x=>x===".."||x==="."||x.trim()!==x||
      !x.trim()))
    throw Error("autolink_invalid_or_unsafe_relative_path_hold");
  return s;
}
function isAllowedRoleLocation(r:Role,p:string):boolean{
  if(r==="company_hub")return p.startsWith("01_Companies/");
  if(r==="industry_theme")return p.startsWith("02_Industries_Themes/");
  if(r==="company_evolution")return p.startsWith(
    "08_Daily_Weekly/Research Indexes/Company Evolution - ");
  if(r==="thesis_reference"||r==="evidence_register_reference")
    return p.startsWith("05_Thesis/");
  if(r==="source_evidence")return !p.startsWith("05_Thesis/")&&
    !p.startsWith("09_Templates/");
  return false;
}
const readBytes=(root:string,p:string)=>{
  const safe=safePath(p);
  const vault=path.join(root,"vault");
  const file=path.join(vault,...safe.split("/"));
  const canonicalVault=fs.realpathSync(vault);
  if(!file.startsWith(canonicalVault+path.sep))
    throw Error("autolink_path_outside_snapshot_hold");
  // No directory or final symlink accepted. Full realpath must equal
  // canonical path; preserve immutable physical-version check.
  if(fs.realpathSync(file)!==file)
    throw Error("autolink_symlinked_destination_hold");
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||
      before.size<1||before.size>800_000)
      throw Error("autolink_destination_file_not_safe_hold");
    const data=fs.readFileSync(fd);
    const after=fs.fstatSync(fd);
    if(after.ctimeMs!==before.ctimeMs||
      after.mtimeMs!==before.mtimeMs||
      before.size!==data.length||data.includes(0))
      throw Error("autolink_destination_changed_during_read_hold");
    return new TextDecoder("utf-8",{fatal:true}).decode(data);
  }finally{fs.closeSync(fd);}
};
const roles=["source_evidence","company_hub","company_evolution",
  "industry_theme","thesis_reference","evidence_register_reference"] as const;
const justificationFor=(r:Role,why:Selected["justification"])=>
  r==="source_evidence"?why==="original_event_evidence":
    r==="company_hub"||r==="company_evolution"?
      why==="same_issuer":
      r==="industry_theme"?
        why==="industry_exposure_candidate"||
        why==="industry_causal_hypothesis":
        why==="existing_draft_thesis_reference";
type IndexedNote={path:string;frontmatter:string|null};
function parseMeta(text:string):Record<string,unknown>{
  const data=splitFrontmatter(text);
  if(data.invalid||data.fmOffset<1||
    !data.data||typeof data.data!=="object"||
    Array.isArray(data.data))
    throw Error("autolink_routing_frontmatter_unreadable_hold");
  return data.data as Record<string,unknown>;
}
function matchedIdentity(meta:Record<string,unknown>,keys:string[],id:string){
  return keys.some(key=>typeof meta[key]==="string"&&
    normalized(meta[key] as string)===normalized(id));
}
export function planOfflineCanonicalInvestmentAutolinks(
  input:OfflineCanonicalAutolinkInput,
){
  if(!input||input.fixtureKind!=="synthetic_offline_test_only"||
    !input.routing||!OP.test(input.routing.operationId)||
    !Array.isArray(input.routing.targets)||
    input.routing.targets.length<3||input.routing.targets.length>9)
    throw Error("autolink_bounded_synthetic_routing_required");
  const targetPath=safePath(input.routing.proposedAnalysisNotePath);
  if(!targetPath.startsWith("08_Daily_Weekly/Research Indexes/")||
    !path.basename(targetPath).startsWith("Investment Review - "))
    throw Error("autolink_noncanonical_analysis_destination_hold");
  // A syntactically valid path can still be a wrong semantic identity.
  // Never assume full-path/shortest-basename lookup implies right company.
  const issuer=input.claims[0]?.candidate?.source?.review?.evidence?.incoming?.entity;
  const eventKey=input.claims[0]?.candidate?.source?.review?.evidence?.incoming?.eventKey;
  if(typeof issuer!=="string"||typeof eventKey!=="string"||
    issuer.length<1||issuer.length>100||
    eventKey.length<1||eventKey.length>150||
    !/^[\p{L}\p{N}_ .\-]+$/u.test(issuer)||
    !/^[\p{L}\p{N}_ .\-]+$/u.test(eventKey))
    throw Error("autolink_unbounded_canonical_identity_hold");

  const selected=input.routing.targets;
  const roleCounts=new Map<Role,number>();
  const unique=new Set<string>();
  for(const t of selected){
    if(!t||!roles.includes(t.role)||
      !SHA.test(t.expectedSha256)||
      !justificationFor(t.role,t.justification))
      throw Error("autolink_unsupported_role_or_relation_hold");
    const p=safePath(t.path),name=normalized(p);
    if(unique.has(name)||name===normalized(targetPath)||
      !isAllowedRoleLocation(t.role,p))
      throw Error("autolink_duplicate_or_out_of_role_target_hold");
    unique.add(name);
    roleCounts.set(t.role,(roleCounts.get(t.role)??0)+1);
  }
  for(const r of ["source_evidence","company_hub",
    "company_evolution"] as const){
    if(roleCounts.get(r)!==1)
      throw Error("autolink_required_canonical_anchor_missing_hold");
  }
  for(const r of ["thesis_reference","evidence_register_reference"] as const){
    if((roleCounts.get(r)??0)>1)
      throw Error("autolink_ambiguous_protected_reference_hold");
  }
  if((roleCounts.get("industry_theme")??0)>3)
    throw Error("autolink_excessive_industry_links_hold");
  if(selected.some(t=>
    (t.role==="company_hub"&&
      normalized(path.basename(t.path))!==normalized(issuer+".md"))||
    (t.role==="company_evolution"&&
      normalized(path.basename(t.path))!==
        normalized("Company Evolution - "+issuer+".md"))||
    (t.role==="thesis_reference"&&
      normalized(path.basename(t.path))!==
        normalized(issuer+" - Current Thesis.md"))||
    (t.role==="evidence_register_reference"&&
      normalized(path.basename(t.path))!==
        normalized(issuer+" - Evidence Register.md"))))
    throw Error("autolink_cross_issuer_anchor_requires_review_hold");

  // The model/analyst proposal MUST be validated against physical
  // historical+Thesis evidence before any proposed link is accepted.
  const reasoning=reviewOfflineInvestmentReasoningContract(input);
  if(reasoning.review.sourceClaimsRetained!==input.claims.length||
    reasoning.canAutoWrite!==false||reasoning.vaultModified!==false)
    throw Error("autolink_underlying_analysis_not_reconciled_hold");
  const evidence=input.claims[0].candidate.source.review.evidence;
  const coverage=verifyOfflineSnapshotCoverage(evidence.snapshotRoot);
  if(coverage.status!=="snapshot_markdown_index_reconciled_not_originals_verified"||
    coverage.markdownContentManifestSha256!==
      evidence.expectedMarkdownManifestSha256)
    throw Error("autolink_snapshot_index_mismatch_hold");
  const snapshotRoot=fs.realpathSync(evidence.snapshotRoot);
  const dbFile=path.join(snapshotRoot,"app.sqlite");
  const index=new Database(dbFile,{readonly:true,fileMustExist:true});
  let checked:{
    role:Role;path:string;checksum:string;
    justification:Selected["justification"];
  }[]=[];
  try{
    const rows=index.prepare("SELECT path,frontmatter FROM notes")
      .all() as IndexedNote[];
    if(rows.length>10_000)throw Error("autolink_unbounded_index_hold");
    const indexed=new Map(rows.map(x=>[normalized(x.path),x]));
    if(indexed.size!==rows.length)
      throw Error("autolink_index_path_case_alias_collision_hold");
    if(indexed.has(normalized(targetPath))||
      fs.existsSync(path.join(snapshotRoot,"vault",targetPath)))
      throw Error("autolink_analysis_note_already_exists_hold");
    const idMarker="<!-- investment-os-operation:"+input.routing.operationId+" -->";
    const eventMarker="<!-- investment-os-event:"+eventKey+" -->";
    checked=selected.map(s=>{
      const row=indexed.get(normalized(s.path));
      if(!row||row.path!==s.path)
        throw Error("autolink_missing_or_nonexact_indexed_target_hold");
      const text=readBytes(snapshotRoot,s.path);
      if(hash(text)!==s.expectedSha256)
        throw Error("autolink_stale_target_checksum_hold");
      const m=parseMeta(text);
      if(s.role==="source_evidence"&&
        (!matchedIdentity(m,["entity","ticker"],issuer)||
         !matchedIdentity(m,["event_key"],eventKey)))
        throw Error("autolink_source_event_identity_not_matched_hold");
      if(["company_hub","company_evolution"].includes(s.role)&&
        !matchedIdentity(m,["entity","ticker"],issuer))
        throw Error("autolink_company_frontmatter_identity_mismatch_hold");
      if((s.role==="thesis_reference"||
        s.role==="evidence_register_reference")&&
        !matchedIdentity(m,["entity","ticker"],issuer))
        throw Error("autolink_thesis_not_same_issuer_hold");
      // An already recorded event requires added-detail/correction
      // classification, not another blindly appended timeline event.
      if(s.role==="company_evolution"&&
        (text.includes(idMarker)||text.includes(eventMarker)))
        throw Error("autolink_event_or_operation_already_recorded_hold");
      return {
        role:s.role,path:s.path,checksum:s.expectedSha256,
        justification:s.justification,
      };
    });
    // If an unindexed/oversize proposed path already exists on disk,
    // never create/overwrite it even though SQLite lacks an entry.
    if(fs.existsSync(path.join(snapshotRoot,"vault",targetPath)))
      throw Error("autolink_destination_exists_unindexed_hold");

    // Full relative paths (not basenames) avoid accidental links to a
    // same-named Industry or issuer in a different Vault folder.
    const targets=checked.map(x=>x.path.slice(0,-3));
    const backlinks=checked.map(x=>"[["
      +x.path.slice(0,-3)+"]]");
    const scaffold=backlinks.join(" \n");
    const parsed=extractStructure(scaffold);
    if(parsed.links.length!==targets.length||
      parsed.links.some((link,i)=>link!==targets[i]))
      throw Error("autolink_wikilink_parse_did_not_roundtrip_hold");
  }finally{index.close();}
  const final=verifyOfflineSnapshotCoverage(snapshotRoot);
  if(final.markdownContentManifestSha256!==
    evidence.expectedMarkdownManifestSha256||
    final.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    throw Error("autolink_snapshot_changed_after_plan_hold");

  const byRole=(role:Role)=>checked.filter(t=>t.role===role).map(x=>({
    role:x.role,
    targetPathSha256:hash(x.path),
    targetContentSha256:x.checksum,
    justification:x.justification,
    linkExistsInSnapshot:true as const,
    linkPathQualified:true as const,
  }));
  return {
    status:"offline_synthetic_canonical_autolink_staging_only" as const,
    operationIdSha256:hash(input.routing.operationId),
    eventKeySha256:hash(eventKey),
    proposedAnalysisPathSha256:hash(targetPath),
    sourceSnapshotSha256:evidence.expectedMarkdownManifestSha256,
    anchors:[
      ...byRole("source_evidence"),...byRole("company_hub"),
      ...byRole("company_evolution"),...byRole("industry_theme"),
      ...byRole("thesis_reference"),
      ...byRole("evidence_register_reference"),
    ],
    proposedOperations:[
      "create_new_dated_analysis_note_if_absent" as const,
      "link_out_to_exact_existing_canonical_notes" as const,
      "append_unique_event_link_to_company_evolution_after_authorization" as const,
      "readback_reindex_and_resolve_links_after_actual_write" as const,
    ],
    protectedTargetsReferenceOnly:true as const,
    proposedBidirectionalNavigationNotYetWritten:true as const,
    industryLinkSemanticsIndependentlyVerified:false as const,
    sourceOriginalPublisherAuthenticated:false as const,
    historicalDedupSemanticallyComplete:false as const,
    stagedIdempotencyMarkersChecked:true as const,
    canonicalDestinationsExistAtExactHashes:true as const,
    exactFullPathWikilinksValidatedInMemory:true as const,
    allWritesRequireSeparateAuthorizedExecution:true as const,
    humanReviewOfProposedLinkRelevanceStillNeeded:true as const,
    privateAnalysisTextReturned:false as const,
    protectedThesisContentReturned:false as const,
    realVaultReadConsentVerified:false as const,
    actualSaveReceipt:null,
    actualReadbackVerified:false as const,
    actualDeviceSyncVerified:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    vaultModified:false as const,
    productionReleaseAllowed:false as const,
  };
}
