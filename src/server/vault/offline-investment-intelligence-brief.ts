/**
 * PR #86 — Offline Historical-to-Thesis Intelligence Brief.
 *
 * Orchestrates PR #84 structured-history comparison + PR #85 cited narrative
 * recall + narrow readback of one explicitly selected Current Thesis version.
 *
 * Analyst INPUT only, not an AI semantic verdict: never releases protected
 * Thesis prose, changes a note, authenticates an owner, or approves anything.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {splitFrontmatter} from "./markdown";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {reviewHistoricalChangeOffline,type OfflineHistorySearchRequest}
  from "./offline-historical-change-review";
import {retrieveOfflineNarrativeEvidence,type OfflineNarrativeRequest}
  from "./offline-narrative-evidence-context";

const SHA=/^[a-f0-9]{64}$/;
type ThesisRow={path:string;mtime:number;size:number;
  frontmatter:string|null;body:string};
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
type ThesisSelection={
  path:string;
  expectedSha256:string;
};
export type OfflineIntelligenceBriefRequest={
  snapshotRoot:string;
  expectedMarkdownManifestSha256:string;
  incoming:OfflineHistorySearchRequest["incoming"];
  keywords:OfflineNarrativeRequest["keywords"];
  thesis?:ThesisSelection;
};
function explicitThesis(req:OfflineIntelligenceBriefRequest){
  if(!req.thesis)return {
    status:"not_checked_no_exact_thesis_selected" as const,
    notePath:null,noteSha256:null,
    thesisContentReadForSemanticAnalysis:false as const,
  };
  const ticker=req.incoming.entity;
  if(typeof ticker!=="string"||
    !/^[A-Z][A-Z0-9.-]{0,19}$/.test(ticker)||
    req.thesis.path!=="05_Thesis/"+ticker+" - Current Thesis.md"||
    !SHA.test(req.thesis.expectedSha256))
    throw Error("thesis_brief_requires_exact_authorized_selection_and_hash");
  const root=fs.realpathSync(req.snapshotRoot);
  const d=new Database(path.join(root,"app.sqlite"),{
    readonly:true,fileMustExist:true,
  });
  try{
    d.pragma("query_only=ON");
    const row=d.prepare(
      "SELECT n.path,n.mtime,n.size,n.frontmatter,f.body "+
      "FROM notes AS n JOIN notes_fts AS f ON f.rowid=n.rowid "+
      "WHERE n.path=?"
    ).get(req.thesis.path) as ThesisRow|undefined;
    if(!row)throw Error("thesis_brief_selected_note_not_indexed_hold");
    const file=path.join(root,"vault",...req.thesis.path.split("/"));
    if(fs.realpathSync(file)!==file)
      throw Error("thesis_brief_symlink_path_hold");
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{
      const a=fs.fstatSync(fd);
      if(!a.isFile()||a.nlink!==1||a.size<1||a.size>1_000_000||
        a.size!==row.size||Math.round(a.mtimeMs)!==row.mtime)
        throw Error("thesis_brief_file_version_hold");
      const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd);
      if(bytes.length!==a.size||b.mtimeMs!==a.mtimeMs||
        b.ctimeMs!==a.ctimeMs||b.size!==a.size||bytes.includes(0)||
        sha(bytes)!==req.thesis.expectedSha256)
        throw Error("thesis_brief_exact_thesis_bytes_changed_hold");
      const note=splitFrontmatter(new TextDecoder("utf8",{fatal:true}).decode(bytes));
      if(note.invalid||note.body!==row.body)
        throw Error("thesis_brief_fts_or_frontmatter_invalid_hold");
      const indexed=Object.keys(note.data).length?JSON.stringify(note.data):null;
      if(indexed!==row.frontmatter||
        inspectCanonicalKnowledgeMetadata(req.thesis.path,note.data).role!=="thesis")
        throw Error("thesis_brief_not_matching_thesis_role_hold");
      // No protected note body, headings, thesis claims, or links returned.
      return {
        status:"exact_thesis_version_present_requires_analyst_read" as const,
        notePath:row.path,noteSha256:sha(bytes),
        declaredStatus:typeof note.data.status==="string"?
          note.data.status:null,
        thesisContentReadForSemanticAnalysis:false as const,
        thesisVersionAuthenticatedByOwner:false as const,
      };
    }finally{fs.closeSync(fd);}
  }finally{d.close();}
}
export function prepareOfflineInvestmentIntelligenceBrief(req:OfflineIntelligenceBriefRequest){
  if(!req||typeof req!=="object"||typeof req.snapshotRoot!=="string"||
    !SHA.test(req.expectedMarkdownManifestSha256)||
    typeof req.incoming?.entity!=="string")
    throw Error("investment_brief_input_invalid");
  // Both established modules force full physical Markdown/SQLite/FTS
  // reconciliation before/after their independent readbacks.
  const structured=reviewHistoricalChangeOffline({
    snapshotRoot:req.snapshotRoot,
    expectedMarkdownManifestSha256:req.expectedMarkdownManifestSha256,
    incoming:req.incoming,
  });
  const narrative=retrieveOfflineNarrativeEvidence({
    snapshotRoot:req.snapshotRoot,
    expectedMarkdownManifestSha256:req.expectedMarkdownManifestSha256,
    entity:req.incoming.entity,keywords:req.keywords,
  });
  if(structured.scope.physicalMarkdownManifestSha256!==
    narrative.scope.physicalMarkdownManifestSha256)
    throw Error("investment_brief_snapshot_version_disagreement_hold");
  const thesis=explicitThesis(req);
  const conflict=structured.classification==="possible_correction_or_contradiction";
  const exactDuplicate=structured.classification==="duplicate_exact_metadata_same_source";
  const narrativeAmbiguous=narrative.references.length>0&&
    !exactDuplicate&&!conflict;
  const reviewPriority=conflict?"priority_conflicting_claim_needs_source_review" as const:
    structured.classification==="unresolved_missing_structured_fields"?
      "priority_missing_structured_identity" as const:
    exactDuplicate?
      "candidate_duplicate_review_before_skipping" as const:
    narrativeAmbiguous?
      "review_legacy_narrative_before_novelty_label" as const:
      "ordinary_historical_evidence_review" as const;
  return {
    status:"offline_analyst_intelligence_packet_not_semantic_verdict" as const,
    userInputClassification:"unverified_user_claim" as const,
    sourceVersionManifestSha256:structured.scope.physicalMarkdownManifestSha256,
    structuredClassification:structured.classification,
    historicalClassificationReasonCodes:structured.comparison.reasonCodes,
    oldStructuredEvidenceRefs:structured.comparison.matches,
    oldNarrativeEvidenceRefs:narrative.references,
    narrativeRecallScope:narrative.scope,
    structuredHistoryScope:structured.scope,
    selectedThesis:thesis,
    reviewPriority,
    analyticalQuestions:[
      "Is the incoming claim the same issuer, event, value, unit and period? Check primary originals, source revisions and counterevidence.",
      "Is this an old event republished, imported later or repeated by archived AI? Separate event/publication/import dates.",
      "Do historical excerpts contain the same fact, forecast, correction or conflict? FTS overlap is not semantic proof.",
      "What changes in Demand, Revenue Conversion, Margin, Earnings, Cash Flow or ROIC? What evidence supports each mechanism?",
      "Read the exact Current Thesis under appropriate authorization and review catalysts, invalidation and valuation before proposing a change.",
    ],
    materialityToThesis:"unresolved_needs_originals_and_thesis_read" as const,
    evidenceNeeded:[
      "Exact primary issuer or regulatory source and original publication version.",
      "Reconciled event identity, claim period, unit, value and corrections.",
      "Independent counterevidence; distinguish archived AI from issuer sources.",
      "Authorized Current Thesis interpretation and explicit cash flow / valuation mechanism.",
      "Current market price and consensus before judging expectations or price-in.",
    ],
    possibleDuplicateDoesNotProveNoNews:true as const,
    semanticComparisonPerformed:false as const,
    counterEvidenceIndependentlyChecked:false as const,
    currentThesisSemanticallyCompared:false as const,
    originalIssuerClaimVerified:false as const,
    fullCrossDeviceVaultCoverageVerified:false as const,
    ownerIdentityVerified:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,canAutoUpdateThesis:false as const,
    safeEditPreview:null,vaultModified:false as const,
  };
}
