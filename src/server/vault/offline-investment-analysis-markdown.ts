/**
 * PR #102: Turn an externally supplied, evidence-indexed reasoning DRAFT into
 * human-reviewable, linked Obsidian Markdown (synthetic/offline only).
 *
 * AI semantic conclusions are NOT inferred here. Caller must first run PR
 * #97 reasoning + PR #98 canonical path checks; there is no save/API call.
 * Private content is returned only to the caller-side preview, never in the
 * redacted operation/retrieval receipts.
 */
import {extractStructure,splitFrontmatter} from "./markdown";
import type {OfflineCanonicalAutolinkInput}
  from "./offline-canonical-autolink-writeback-plan";

const link=(p:string)=>"[["+p.slice(0,-3)+"]]";
const CHANNEL=new Set([
  "demand","revenue_conversion","gross_profit","operating_profit",
  "earnings","cash_flow","return_on_capital","valuation",
]);
/** Encodes model prose as labelled literal prose, never YAML or wiki targets. */
const quote=(value:string)=>value
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")
  .replace(/\[/g,"&#91;")
  .replace(/\]/g,"&#93;")
  .split("\n").map(l=>"> "+l).join("\n");
const refs=(a:number[])=>a.map(n=>"Case "+(n+1)).join(", ")||"none";
const section=(name:string,text:string)=>"### "+name+"\n"+quote(text);
export function composeOfflineSyntheticInvestmentReviewMarkdown(
  input:OfflineCanonicalAutolinkInput,
):string{
  if(input?.fixtureKind!=="synthetic_offline_test_only"||
    input.claims?.[0]?.candidate?.source?.review?.evidence
      ?.incoming?.entity!=="SYNTH"||
    !Array.isArray(input.routing?.targets)||input.routing.targets.length<3||
    !input.draft||!Array.isArray(input.draft.causalChain)||
    !input.routing.operationId||
    !/^[a-z][a-z0-9-]{7,95}$/.test(input.routing.operationId))
    throw Error("analysis_markdown_synthetic_review_only_hold");
  const e=input.claims[0].candidate.source.review.evidence.incoming;
  const d=input.draft;
  // The complete structure and citation indices are checked upstream by
  // reviewOfflineInvestmentReasoningContract + canonical link planner.
  // This renderer rejects malformed additional paths or message spans.
  const links=input.routing.targets.map(t=>t.path);
  if(links.some(p=>typeof p!=="string"||
    !/^[\p{L}\p{N} _./()-]+\.md$/u.test(p)||p.includes("..")||
    p.startsWith("/")||p.includes("//"))||
    new Set(links).size!==links.length||
    d.causalChain.some(c=>!CHANNEL.has(c.from)||!CHANNEL.has(c.to)))
    throw Error("analysis_markdown_uncanonical_source_links_hold");
  const op=input.routing.operationId;
  const sections=[
    "---",
    "type: investment_review",
    "entity: SYNTH",
    "event_key: "+e.eventKey,
    "verification: not_reverified",
    "status: draft",
    "source_type: archived_ai",
    "analysis_origin: synthetic_ai_draft",
    "independent_evidence: false",
    "operation_id: "+op,
    "---",
    "# Synthetic Investment Review",
    "<!-- investment-os-operation:"+op+" -->",
    "<!-- investment-os-event:"+e.eventKey+" -->",
    "",
    "> [!warning] Historical AI-style draft; source verification pending.",
    "> Economic reasoning below is a PROPOSAL, not an independently verified issuer statement.",
    "",
    "## Canonical references",
    ...links.map((p,i)=>"- "+input.routing.targets[i].role+
      ": "+link(p)+" ("+input.routing.targets[i].justification+")"),
    "",
    "## Claim references (not authenticated issuer facts)",
    ...input.claims.map((c,i)=>"- Case "+(i+1)+": "+
      c.candidate.source.review.evidence.incoming.metric+
      " / "+c.candidate.source.review.evidence.incoming.period+
      " — unverified claim, not primary confirmation"),
    "",
    "## Causal pathways — unverified hypotheses",
    ...d.causalChain.flatMap((c,i)=>[
      "### Hypothesis "+(i+1)+": "+c.from+" → "+c.to,
      "Evidence candidates: "+refs(c.evidenceCaseIndices)+
        "; bridge: "+c.bridge+
        "; epistemic status: "+c.epistemicStatus,
      quote(c.hypothesis),"",
    ]),
    "## Primary bottleneck — candidate only",
    "Bottleneck type: "+d.bottleneck.kind+
      "; cited cases: "+refs(d.bottleneck.evidenceCaseIndices)+
      "; confidence: "+d.bottleneck.confidence,
    quote(d.bottleneck.rationale),"",
    "## Risks — not established",
    ...d.risks.flatMap(r=>[
      "### "+r.kind+" ("+refs(r.evidenceCaseIndices)+")",
      quote(r.rationale),"",
    ]),
    "## Counter-evidence and competing explanations",
    "Counter-evidence search: "+d.counterEvidence.status+
      "; contrary case candidates: "+
      refs(d.counterEvidence.contraryCaseIndices),
    ...d.counterEvidence.alternativeHypotheses
      .map((v,i)=>section("Alternative "+(i+1),v)),
    "",
    "## Evidence still required",
    ...d.counterEvidence.evidenceStillNeeded
      .map((v,i)=>section("Requirement "+(i+1),v)),
    "",
    "## Proposed Thesis impact — owner has not approved",
    "Relation: "+d.thesis.relation+
      "; direction: "+d.thesis.direction+
      "; cases: "+refs(d.thesis.evidenceCaseIndices)+
      "; confidence: "+d.thesis.confidence+
      "; magnitude: "+d.thesis.impactMagnitude,
    quote(d.thesis.explanation),"",
    "## Market pricing",
    "Price-in not determined: no verified current market/consensus evidence.",
    "",
  ];
  const text=sections.join("\n");
  const parsed=splitFrontmatter(text);
  if(parsed.invalid||parsed.data.source_type!=="archived_ai"||
    parsed.data.independent_evidence!==false)
    throw Error("analysis_markdown_provenance_not_parsed_hold");
  const actual=extractStructure(parsed.body).links;
  const expected=links.map(p=>p.slice(0,-3));
  if(actual.length!==expected.length||
    actual.some((p,i)=>p!==expected[i]))
    throw Error("analysis_markdown_extra_or_missing_wikilinks_hold");
  if(Buffer.byteLength(text,"utf8")>90_000)
    throw Error("analysis_markdown_oversize_hold");
  return text;
}
