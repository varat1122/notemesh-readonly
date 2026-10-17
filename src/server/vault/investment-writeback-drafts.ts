/**
 * Strictly read-only markdown previews for distinct Original User Input and
 * AI Interpretation notes. The only supplied analysis is analyst-authored:
 * there is no AI research synthesis or publisher verification in this module.
 * Actual writes require separate Safe Edit preview, approval, apply, receipt.
 */
export interface DraftRequest {
 planId:string; domain:string; entities:string[]; topic:string;
 inputFormat:"text"|"screenshot"|"pdf"|"mixed";
 sourceKind:string; sourceLanguage:string|null;
 extractedText:string; analysisText?:string|null;
 publisher:string|null; sourceUrl:string|null;
 eventDate:string|null; publicationDate:string|null;
 attachmentPath:string|null; attachmentVerified:boolean;
 rawRoute:{path:string|null;action:string;operationId:string;holdReasons:string[]};
 reviewRoute:{path:string|null;action:string;operationId:string;holdReasons:string[]};
}
export interface Draft {
 status:"candidate_safe_edit_preview_not_written"|"hold"|"inspect_existing";
 operationId:string;
 path:string|null;
 content:string|null;
 reasons:string[];
}
export interface DraftPacket {
 status:"read_only_separated_drafts_not_written";
 original:Draft;
 analysis:Draft;
 timeline:"not_prepared_requires_event_source_dedup_and_approval";
 exactUserInputPreserved:boolean;
 aiAnalysisIndependentlyVerified:false;
 canAutoWrite:false;
}
const y=(x:string|null|undefined)=>x===null||x===undefined?"null":JSON.stringify(x);
const list=(v:string[])=>JSON.stringify(v);
function fence(text:string):string {
 const runs=[...text.matchAll(/~+/g)].map(x=>x[0].length);
 const tag="~".repeat(Math.max(4,...runs.map(n=>n+1)));
 return tag+"text\n"+text+(text.endsWith("\n")?"":"\n")+tag;
}
export function composeWritebackDrafts(req:DraftRequest):DraftPacket {
 if(!/^IN-[A-F0-9]{16}$/.test(req.planId))throw Error("Invalid intake plan ID");
 if(!req.extractedText||req.extractedText.length>12000)throw Error("Original input is missing or too long");
 if(req.extractedText.includes("\0"))throw Error("Binary data cannot enter a Markdown note");
 if(req.analysisText&&req.analysisText.length>14000)throw Error("AI analysis exceeds note review limit");
 if(req.analysisText?.includes("\0"))throw Error("AI analysis is not valid text");
 const originalRoles=req.sourceKind==="archived_chat"?"archived_ai":"user_supplied";
 const fm=(role:string,source:string,extras:string[])=>[
  "---","type: "+role,"source_type: "+source,"verification: not_reverified",
  "intake_plan_id: "+y(req.planId),"domain: "+y(req.domain),
  "entities: "+list(req.entities),"event_date: "+y(req.eventDate),
  "published_at: "+y(req.publicationDate),
  ...extras,"---",""
 ].join("\n");
 const rawContent=fm("chatgpt_archive",originalRoles,[
  "topic: "+y(req.topic),"input_format: "+y(req.inputFormat),
  "source_kind: "+y(req.sourceKind),"source_language: "+y(req.sourceLanguage),
  "publisher_claimed: "+y(req.publisher),"source_url_claimed: "+y(req.sourceUrl),
  "attachment_path: "+y(req.attachmentVerified?req.attachmentPath:null),
  "attachment_sha_readback_verified: "+(req.attachmentVerified?"true":"false"),
 ])+"# User-supplied source capture — "+req.planId+"\n\n"+
 "This record preserves supplied input. Publisher, dates, claims and any transcription are NOT independently verified.\n\n"+
 "## Original input (verbatim as supplied)\n\n"+fence(req.extractedText)+"\n";
 const rawReasons=[...req.rawRoute.holdReasons];
 if(req.inputFormat!=="text"&&!req.attachmentVerified)
  rawReasons.push("original_image_or_pdf_bytes_not_preserved");
 const rawStatus:Draft["status"]=rawReasons.length?"hold":
   req.rawRoute.action==="candidate_create"?"candidate_safe_edit_preview_not_written":"inspect_existing";
 const original:Draft={
  status:rawStatus,operationId:req.rawRoute.operationId,path:req.rawRoute.path,
  content:rawStatus==="candidate_safe_edit_preview_not_written"?rawContent:null,
  reasons:rawReasons.length?rawReasons:rawStatus==="inspect_existing"?["compare_existing_input_identity_and_digest"]:[],
 };
 const analysisText=req.analysisText??"";
 const reviewReasons=[...req.reviewRoute.holdReasons];
 if(!analysisText.trim())reviewReasons.push("no_explicit_analyst_interpretation_supplied");
 if(rawStatus==="hold")reviewReasons.push("original_capture_gate_not_satisfied");
 const reviewStatus:Draft["status"]=reviewReasons.length?"hold":
  req.reviewRoute.action==="candidate_create"?"candidate_safe_edit_preview_not_written":"inspect_existing";
 const sourceLink=req.rawRoute.path?
  "[[ "+req.rawRoute.path.replace(/\.md$/,"")+" ]]".replace("[[ ","[[").replace(" ]]"]]"," ]]"):"none";
 const reviewContent=analysisText.trim()?fm("investment_review","archived_ai",[
   "topic: "+y(req.topic),"analysis_role: "+y("ai_interpretation_not_evidence"),
   "original_intake_path: "+y(req.rawRoute.path),
   "original_source_verified: false","owner_approved_thesis: false",
  ])+"# AI research review — "+req.planId+"\n\n"+
  "Original input: "+sourceLink+"\n\n"+
  "AI interpretation is **not** an independent original source, company guidance or an approved Thesis. "+
  "Preserve contrary evidence and uncertainty in the analyst text; all citations require actual source readback.\n\n"+
  "## Analyst interpretation (attributed, not verified)\n\n"+fence(analysisText)+"\n":null;
 const analysis:Draft={
  status:reviewStatus,operationId:req.reviewRoute.operationId,path:req.reviewRoute.path,
  content:reviewStatus==="candidate_safe_edit_preview_not_written"?reviewContent:null,
  reasons:reviewReasons.length?reviewReasons:reviewStatus==="inspect_existing"?["compare_existing_review_version_before_correction"]:[],
 };
 return {
  status:"read_only_separated_drafts_not_written",original,analysis,
  timeline:"not_prepared_requires_event_source_dedup_and_approval",
  exactUserInputPreserved:true,aiAnalysisIndependentlyVerified:false,canAutoWrite:false,
 };
}
