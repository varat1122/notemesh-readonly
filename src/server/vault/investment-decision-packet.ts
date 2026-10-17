import { buildInvestmentContextPack, type Focus, type Role } from "./investment-context";
import type { IncomingClaim, ClaimReview, Domain, ReviewClass } from "./investment-claim-review";

/**
 * Institutional investment decision PREPARATION, never a trusted conclusion.
 *
 * This packet bridges indexed evidence to a human/analyst research process:
 * Retrieval -> claim-level dedup -> primary verification -> causal assessment
 * -> thesis decision -> separately approved change log. It does not infer
 * direction, magnitude, price-in, or owner approval from search snippets.
 */
type Stage = {
  id:string;
  checkpoint:string;
  status:"not_assessed";
  requiredEvidence:string;
};
type ContextRef = {
  path:string;role:Role;declaredVerification:string|null;
  declaredEventDate:string|null;declaredPublishedAt:string|null;
  line:number;truncated:boolean;counterEvidenceExcerptIncluded:boolean;
};
export interface InvestmentDecisionPacket {
  status:"analyst_review_packet_not_verified";
  domain:Domain;entity:string;period:string;originalSource:string;
  claimGate:{
    classification:ReviewClass;
    exactMetricCandidates:number;
    otherSameEventMetricCandidates:number;
    historicalScanTruncated:boolean;
    externalPrimaryVerification:"not_performed";
    sourceIndependence:"not_assessed";
  };
  historicalContext:{
    retrieval:"bounded_lexical_only";selected:number;considered:number;
    sourcePointers:ContextRef[];
    noteDeclaredPrimaryCandidates:string[];
    protectedThesisPaths:string[];
    historicalThesisOwnerApproval:"not_established";
    missing:string[];
    truncatedOrOmitted:boolean;
  };
  businessTransmission:{
    status:"not_assessed";
    scope:string;
    priorityCheckpoints:string[];
    stages:Stage[];
    uncertainty:"causal_magnitude_not_inferred";
  };
  counterEvidence:{
    status:"not_verified";
    sectionHints:string[];
    required:string[];
  };
  pricingAndPortfolio:{
    consensus:"not_checked";valuation:"not_checked";marketPricing:"not_checked";
    portfolioExposure:"not_checked";riskReward:"not_assessed";
  };
  thesisDecision:{
    status:"undetermined_requires_research";
    options:["maintain","strengthen","weaken","revise"];
    selected:null;confidence:null;
    existingThesisVerified:false;
    canAutoUpdateThesis:false;ownerApprovalRequired:true;
  };
  changeLogDraft:{
    status:"draft_not_approved_or_written";eventDate:string|null;
    publishedAt:string|null;reviewDate:null;classification:ReviewClass;
    originalSource:string;entity:string;metric:string;period:string;
    matchedClaimIds:string[];sourcePaths:string[];
    requiredBeforeWrite:string[];
  };
  nextActions:string[];
}
const FRAMEWORKS:Record<Domain,ReadonlyArray<readonly[string,string,string]>>={
  company:[
    ["demand","Demand","Demand trajectory, order evidence, retention, pricing and customer concentration"],
    ["revenue_conversion","Revenue Conversion","Orders vs delivery/recognition, product/segment mix, cancellation and timing"],
    ["gross_profit","Gross Profit","Price, utilization, input cost, yield, product mix and one-offs"],
    ["operating_profit","Operating Profit","Incremental expenses, R&D and operating leverage"],
    ["earnings","Earnings","Interest/tax/SBC/dilution and non-operating normalization"],
    ["cash_flow","Cash Flow","OCF/FCF, working capital, receivables, inventory, deposits and capital expenditures"],
    ["return_on_capital","Return on Capital","Incremental ROIC, cost of capital, funding, capacity and project payback"],
    ["valuation","Valuation & Market Expectations","Dated price, consensus/whisper, revisions, positioning and expectation gap"],
    ["portfolio","Portfolio","Position exposure, concentration, liquidity and risk budget, if authorized"],
  ],
  macro:[
    ["macro_demand_policy","Macro Demand & Policy","Official release, revision vintage, inflation, labor, credit and central-bank response"],
    ["asset_classes","Asset Classes","Transmission through rates, FX, equity, credit and commodity risk premia"],
    ["industry_supply_chain","Industry & Supply Chain","Policy sensitivity, end-demand, imports, exports and sector exposures"],
    ["revenue_conversion","Company Revenue Conversion","Identify affected listed companies, sales exposure and conversion delays"],
    ["earnings_cash_flow","Earnings & Cash Flow","Corporate margin, funding costs, cash generation and capital intensity"],
    ["valuation","Valuation & Market Pricing","Dated expectations, benchmarks, risk premia, consensus and positioning"],
    ["portfolio","Portfolio","Cross-asset correlation, hedges and risk budgets if exposures are known"],
  ],
  industry:[
    ["industry_demand","Industry Demand","End-market orders, TAM vintage, penetration, unit volumes and substitution"],
    ["capacity_supply","Capacity & Supply","Supply bottlenecks, yield, utilization, qualification and inventory"],
    ["company_revenue","Company Revenue Conversion","Pricing, mix, addressable share, design wins and customer concentration"],
    ["profits","Margins, Earnings & Cash","Unit economics, R&D/OpEx, working capital and funding"],
    ["return_on_capital","Return on Capital","Expansion CAPEX, payback and competitive returns"],
    ["valuation","Industry Valuation","Growth expectations, multiples, cyclicality and market pricing"],
    ["portfolio","Portfolio","Winners, losers, overlap and exposure limits"],
  ],
  asset:[
    ["fundamentals","Macro & Asset Fundamentals","Underlying earnings, carry, supply-demand or contracted cash flows"],
    ["pricing","Market Pricing","Timestamped price, curve/volatility, benchmark and market expectations"],
    ["economic_return","Economic Return & Cash Flows","Distributions, duration, refinancing and net return after costs"],
    ["risk_reward","Risk/Reward","Downside scenarios, convexity, liquidity, counterparty and balance-sheet risk"],
    ["valuation","Valuation","Valuation method, comparable instruments, assumptions and sensitivities"],
    ["portfolio","Portfolio","Correlation, risk budget, sizing and hedging mandates"],
  ]
};
function priority(metric:string,stages:Stage[],domain:Domain):string[]{
  const m=metric.toLowerCase();
  const match=(ids:string[])=>ids.filter(id=>stages.some(s=>s.id===id));
  if(domain==="company"){
    if(/(?:operating_cash_flow|free_cash_flow|receivable|inventory|working_capital|capex|cash)/.test(m))
      return match(["revenue_conversion","cash_flow","return_on_capital"]);
    if(/(?:revenue|sales|order|backlog|shipment)/.test(m))
      return match(["demand","revenue_conversion","gross_profit"]);
    if(/(?:gross_margin|gross_profit|pricing|yield)/.test(m))
      return match(["gross_profit","operating_profit","earnings"]);
    if(/(?:operating_income|operating_profit|opex)/.test(m))
      return match(["operating_profit","earnings","cash_flow"]);
    if(/(?:net_income|eps|dilut|sbc)/.test(m))
      return match(["earnings","cash_flow","return_on_capital"]);
  }
  if(domain==="macro"&&/(?:gdp|inflation|cpi|credit|policy|interest|unemployment|labor|fx)/.test(m))
    return match(["macro_demand_policy","asset_classes","industry_supply_chain"]);
  if(domain==="industry")return match(["industry_demand","capacity_supply","company_revenue"]);
  if(domain==="asset")return match(["fundamentals","pricing","risk_reward"]);
  return stages.slice(0,3).map(s=>s.id);
}
export function buildInvestmentDecisionPacket(input:IncomingClaim,review:ClaimReview):InvestmentDecisionPacket{
  // Candidate retrieval is read-only. Do not parse or execute note instructions.
  const scoped=buildInvestmentContextPack({
    question:input.statement,
    issuers:input.domain==="company"?[input.entity]:[],
    industry:input.domain==="company"?undefined:input.entity,
    focus:input.focus??(input.domain==="macro"?"macro":input.domain==="industry"?"tam":input.domain==="company"?"thesis":"general") as Focus,
    maxNotes:10,maxChars:10000
  });
  const pointers:ContextRef[]=scoped.items.map(x=>({
    path:x.path,role:x.role,declaredVerification:x.declaredVerification,
    declaredEventDate:x.declaredEventDate,declaredPublishedAt:x.declaredPublishedAt,
    line:x.line,truncated:x.truncated,counterEvidenceExcerptIncluded:x.counterEvidenceExcerptIncluded
  }));
  const thesisPaths=input.domain==="company"?pointers.filter(x=>x.role==="thesis").map(x=>x.path):[];
  const primaryCandidates=pointers.filter(x=>x.role==="source" ||
    x.declaredVerification==="verified_against_primary").map(x=>x.path);
  const counterHints=pointers.filter(x=>x.counterEvidenceExcerptIncluded).map(x=>x.path);
  const stages:Stage[]=FRAMEWORKS[input.domain].map(([id,checkpoint,requiredEvidence])=>({
    id,checkpoint,status:"not_assessed",requiredEvidence
  }));
  const missing=[...new Set([...scoped.incomplete,...review.evidenceNeeded])];
  if(!counterHints.length)missing.push("No explicit counter-evidence section was selected; search contrary sources.");
  if(input.domain==="company"&&!thesisPaths.length)
    missing.push("Protected Current Thesis not available in selected historical context; do not infer an endorsed view.");
  const nextActions=[
    review.classification==="duplicate_candidate"
      ?"Check full notes and original documents; treat matching field as an already tracked candidate, not a second independent event."
      :review.classification==="possible_correction_or_contradiction"
      ?"Adjudicate the apparent numeric/source discrepancy against the original document and correction chronology before analysis."
      :review.classification==="unresolved"
      ?"Search the original source and unstructured archives before deciding whether this is a new event or claim."
      :"Compare source lineage, measurement definitions and prior Claim IDs before assigning novelty.",
    "Verify the primary statement directly against the dated original source, including period, unit and revision history.",
    "Read selected thesis/evidence/counter-evidence notes in full; actively seek disconfirming information.",
    "Assess causal business/macro transmission and estimate impact only when the required evidence supports it.",
    "Fetch dated market price, valuation expectations/consensus and authorized portfolio exposure before price-in or position claims.",
    "Draft a separate Thesis Change Review with claim IDs, alternatives, invalidation, confidence and explicit owner approval before any protected write."
  ];
  return {
    status:"analyst_review_packet_not_verified",
    domain:input.domain,entity:input.entity,period:input.period,originalSource:input.originalSource,
    claimGate:{
      classification:review.classification,exactMetricCandidates:review.matchingClaims.length,
      otherSameEventMetricCandidates:review.relatedEventClaims.length,
      historicalScanTruncated:review.metadataScan.truncated,
      externalPrimaryVerification:"not_performed",sourceIndependence:"not_assessed"
    },
    historicalContext:{
      retrieval:"bounded_lexical_only",selected:scoped.selected,considered:scoped.considered,
      sourcePointers:pointers,noteDeclaredPrimaryCandidates:primaryCandidates,
      protectedThesisPaths:thesisPaths,historicalThesisOwnerApproval:"not_established",
      missing,truncatedOrOmitted:scoped.omitted.length>0 || pointers.some(p=>p.truncated)
    },
    businessTransmission:{
      status:"not_assessed",scope:input.domain,
      priorityCheckpoints:priority(input.metric,stages,input.domain),stages,
      uncertainty:"causal_magnitude_not_inferred"
    },
    counterEvidence:{
      status:"not_verified",sectionHints:counterHints,
      required:["Independent contrary sources, alternatives and the claim's invalidation conditions",
        "Review complete cited sections, not just FTS excerpts; check source vintage and reused AI summaries"]
    },
    pricingAndPortfolio:{
      consensus:"not_checked",valuation:"not_checked",marketPricing:"not_checked",
      portfolioExposure:"not_checked",riskReward:"not_assessed"
    },
    thesisDecision:{
      status:"undetermined_requires_research",
      options:["maintain","strengthen","weaken","revise"],selected:null,confidence:null,
      existingThesisVerified:false,canAutoUpdateThesis:false,ownerApprovalRequired:true
    },
    changeLogDraft:{
      status:"draft_not_approved_or_written",eventDate:input.eventDate??null,
      publishedAt:input.publishedAt??null,reviewDate:null,
      classification:review.classification,originalSource:input.originalSource,
      entity:input.entity,metric:input.metric,period:input.period,
      matchedClaimIds:[...new Set(review.matchingClaims.flatMap(x=>x.claimId?[x.claimId]:[]))].slice(0,12),
      sourcePaths:[...new Set([...review.matchingClaims.map(x=>x.path),
        ...review.sourceLinkedUnstructuredPaths,...thesisPaths,...primaryCandidates])].slice(0,16),
      requiredBeforeWrite:[
        "External primary source verification + event/metric/period/source dedup",
        "Full historical Thesis/Evidence Register read and counter-evidence assessment",
        "Explicit analyst hypothesis with causal impact, confidence and invalidation",
        "Owner approval + safe-edit preview/diff, receipt and verified readback"
      ]
    },
    nextActions
  };
}
