/**
 * PR #84 — deterministic, evidence-limited historical change classification.
 *
 * This is NOT semantic LLM matching and cannot infer an event from similar
 * prose. Exact structured identifiers are necessary for positive duplicate
 * findings. No automatic thesis, valuation, investment fact or Vault writes.
 */
const FIELDS=["entity","metric","period","unit","value","eventKey"] as const;
export type ClaimEvidence={
  notePath:string;
  entity:string|null;metric:string|null;period:string|null;
  unit:string|null;value:string|null;eventKey:string|null;
  claimId:string|null;originalSourceSha256:string|null;
  sourceType:string|null;sourceUrl:string|null;
  eventDate:string|null;publishedAt:string|null;importedAt:string|null;
  verification:string|null;
  independence:"not_assessed"|"not_independent_archived_ai"|
    "not_independent_derivative_summary";
};
export type HistoricalClassification=
  "duplicate_exact_metadata_same_source"|
  "same_value_new_source_not_corroborated"|
  "possible_correction_or_contradiction"|
  "added_detail_same_event"|
  "historical_archived_ai_mention_only"|
  "related_claim_different_or_missing_event_key"|
  "not_found_in_scanned_snapshot"|
  "unresolved_missing_structured_fields";
export type Comparison={
  classification:HistoricalClassification;
  reviewQueue:"no_change_suggested"|"manual_evidence_review"|
    "priority_conflict_review";
  noveltyProven:false;claimFactsVerified:false;
  thesisChangeEstablished:false;canAutoWrite:false;
  canAutoUpdateThesis:false;
  reasonCodes:string[];
  matches:Array<{path:string;relationship:string;sourceSha256:string|null;
    eventDate:string|null;publishedAt:string|null;importedAt:string|null;
    independence:string}>;
  scannedNotes:number;
  matchingEvidenceCount:number;
  warning:string;
};
function normal(value:string|null){
  return typeof value==="string"?value.trim().normalize("NFC").toLocaleLowerCase("en"):null;
}
const filled=(s:unknown):s is string=>typeof s==="string"&&
  s.trim().length>0&&s.length<=300&&!/[\0\r\n]/.test(s);
function validClaim(c:ClaimEvidence){
  return !!c&&FIELDS.every(k=>filled(c[k]))&&
    filled(c.notePath)&&c.notePath.endsWith(".md")&&
    (c.originalSourceSha256===null||/^[a-f0-9]{64}$/.test(c.originalSourceSha256));
}
function matchKey(a:ClaimEvidence,b:ClaimEvidence){
  return (["entity","metric","period","unit"] as const).every(k=>
    normal(a[k])===normal(b[k]));
}
function sameEvent(a:ClaimEvidence,b:ClaimEvidence){
  return filled(a.eventKey)&&filled(b.eventKey)&&
    normal(a.eventKey)===normal(b.eventKey);
}
function similarity(a:ClaimEvidence,b:ClaimEvidence){
  return normal(a.entity)===normal(b.entity)&&(
    normal(a.metric)===normal(b.metric)||
    (filled(a.eventKey)&&normal(a.eventKey)===normal(b.eventKey)));
}
function noIndependence(c:ClaimEvidence){
  return c.independence!=="not_assessed"||
    /^(archived_ai|chatgpt_export|chatgpt_history|chatgpt_analysis)$/i
      .test(c.sourceType??"");
}
const limit=12;
export function classifyHistoricalClaim(
  incoming:ClaimEvidence,prior:ClaimEvidence[],
  scope:{scannedNotes:number;completeIndexScan:boolean},
):Comparison{
  if(!Array.isArray(prior)||prior.length>10000||!scope||
    !Number.isSafeInteger(scope.scannedNotes)||scope.scannedNotes<0||
    !scope.completeIndexScan)throw Error("historical_comparison_incomplete_index_scope_hold");
  let classification:HistoricalClassification=
    "not_found_in_scanned_snapshot";
  let reviewQueue:Comparison["reviewQueue"]="manual_evidence_review";
  const codes:string[]=[];
  if(!validClaim(incoming)){
    classification="unresolved_missing_structured_fields";
    codes.push("incoming_structured_identity_incomplete_or_yaml_coerced");
  }else{
    const matches=prior.filter(p=>similarity(incoming,p));
    const independent=matches.filter(p=>!noIndependence(p)&&validClaim(p));
    const sameEventItems=independent.filter(p=>sameEvent(incoming,p));
    const sameDimensions=sameEventItems.filter(p=>matchKey(incoming,p));
    const sameValue=sameDimensions.filter(p=>normal(p.value)===normal(incoming.value));
    const exact=sameValue.filter(p=>
      !!incoming.originalSourceSha256&&
      p.originalSourceSha256===incoming.originalSourceSha256&&
      normal(p.sourceUrl)===normal(incoming.sourceUrl));
    const changed=sameDimensions.filter(p=>normal(p.value)!==normal(incoming.value));
    const onlyArchived=matches.length>0&&independent.length===0;
    if(noIndependence(incoming)){
      classification="unresolved_missing_structured_fields";
      codes.push("incoming_derivative_or_archived_ai_not_independent");
    }else if(changed.length){
      classification="possible_correction_or_contradiction";
      reviewQueue="priority_conflict_review";
      codes.push("same_event_entity_metric_period_unit_different_literal_value");
      codes.push("cannot_choose_correction_vs_conflict_without_originals");
    }else if(exact.length){
      classification="duplicate_exact_metadata_same_source";
      reviewQueue="no_change_suggested";
      codes.push("exact_structured_claim_event_and_source_sha_matched");
      codes.push("duplicate_note_import_not_independent_confirmation");
    }else if(sameValue.length){
      classification="same_value_new_source_not_corroborated";
      codes.push("same_event_dimensions_value_different_source_or_version");
      codes.push("publisher_and_independence_not_authenticated");
    }else if(sameEventItems.length){
      classification="added_detail_same_event";
      codes.push("same_declared_event_different_metric_or_dimension");
      codes.push("incremental_thesis_impact_not_established");
    }else if(onlyArchived){
      classification="historical_archived_ai_mention_only";
      codes.push("only_archived_ai_or_derivative_history_seen");
    }else if(independent.length){
      classification="related_claim_different_or_missing_event_key";
      codes.push("entity_metric_related_but_event_identity_differs_or_missing");
    }else{
      codes.push("no_matching_structured_evidence_in_scanned_scope");
      codes.push("absence_from_snapshot_is_not_proof_of_new_event");
    }
  }
  // Evidence refs are navigation hints. Do not treat multiple notes as
  // independent corroboration or infer publication date from import date.
  const likely=prior.filter(p=>validClaim(incoming)&&similarity(incoming,p));
  const ordered=[...likely].sort((a,b)=>a.notePath.localeCompare(b.notePath));
  if(ordered.length>limit)codes.push("candidate_sample_truncated");
  if(!incoming.eventDate)codes.push("event_date_unknown");
  if(!incoming.publishedAt)codes.push("publication_date_unknown");
  if(!incoming.importedAt)codes.push("import_date_unknown");
  return {
    classification,reviewQueue,noveltyProven:false,
    claimFactsVerified:false,thesisChangeEstablished:false,
    canAutoWrite:false,canAutoUpdateThesis:false,
    reasonCodes:[...new Set(codes)],
    matches:ordered.slice(0,limit).map(p=>({
      path:p.notePath,
      relationship:noIndependence(p)?"archived_ai_context_not_evidence":
        sameEvent(incoming,p)?
          matchKey(incoming,p)?
            normal(incoming.value)===normal(p.value)?
              "same_event_claim_literal":"same_event_conflicting_literal":
            "same_event_other_dimension":"entity_or_metric_related_only",
      sourceSha256:p.originalSourceSha256,eventDate:p.eventDate,
      publishedAt:p.publishedAt,importedAt:p.importedAt,
      independence:p.independence,
    })),
    scannedNotes:scope.scannedNotes,
    matchingEvidenceCount:likely.length,
    warning:"Read-only metadata comparison, not a complete semantic Vault search or verified primary-source investment fact. AI must review original evidence, counterevidence and thesis before proposing a change.",
  };
}
