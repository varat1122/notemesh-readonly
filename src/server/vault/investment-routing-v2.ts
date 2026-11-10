/**
 * M5.2: evidence-safe canonical routing suggestions. This module queries only
 * indexed, existing hubs; it never creates notes or infers a verified claim.
 * Labels, entity roles and broker revisions are caller-declared hypotheses.
 */
import { db } from "../db";
import { readNote } from "./notes";
import { splitFrontmatter } from "./markdown";

export type ContentType =
  | "reported_fact" | "earnings" | "guidance" | "industry_data" | "macro_data"
  | "policy" | "broker_rating" | "broker_price_target" | "broker_estimate"
  | "analyst_opinion" | "market_commentary" | "portfolio_snapshot" | "other";
export type EntityRole = "primary_subject" | "covered_company" | "supplier" |
  "customer" | "competitor" | "mentioned";
export interface EntityTag { entity:string;role:EntityRole }
export interface BrokerUpdate {
  bank:string;
  reportDate?:string;
  priorBank?:string;
  priorReportDate?:string;
  rating?:string;
  priorRating?:string;
  targetPrice?:string;
  priorTargetPrice?:string;
  currency?:string;
  priorCurrency?:string;
  targetHorizon?:string;
  priorTargetHorizon?:string;
  estimateChanges?:{metric:string;period:string;oldValue:string;newValue:string;unit:string}[];
}
export interface RoutingV2Input {
  domain:"company"|"industry"|"macro"|"asset";
  entities:string[];
  topic:string;
  contentTypes?:ContentType[];
  entityRoles?:EntityTag[];
  themes?:string[];
  brokerUpdate?:BrokerUpdate;
}
type HubLink={label:string;path:string;resolution:"exact_existing_title"|"indexed_alias"|"curated_alias";role?:EntityRole};
export interface RoutingV2 {
  version:"M5.2-read-only";
  classification:{
    contentTypes:ContentType[];
    basis:"caller_declared_not_independently_verified";
    materiality:"unassessed";
    novelty:"unresolved_pending_original_event_review";
  };
  companyHubs:HubLink[];
  industryHubs:HubLink[];
  unresolvedEntities:string[];
  unresolvedThemes:string[];
  reviewScope:"company"|"industry"|"macro"|"asset";
  preferredReviewSubject:string;
  timelineEligibility:"primary_single_company_candidate_only"|"not_eligible_without_event_review";
  brokerRevision:{
    status:"not_supplied"|"insufficient_same_bank_vintage"|"pt_raise_candidate"|
      "pt_cut_candidate"|"pt_reiteration_candidate"|"rating_only_or_estimate_update";
    provenance:"caller_declared_not_broker_verified";
    estimateRows:{metric:string;period:string;oldValue:string;newValue:string;unit:string}[];
    reason:string;
  };
  neverAutoWriteProtected:true;
};

const key=(v:string)=>v.trim().normalize("NFC").replace(/\s+/g," ").toLocaleLowerCase("en");
/** Shared label boundary for routing and historical issuer resolution. */
export function validHubIdentityLabel(label:string):boolean{
  const value=label.trim();
  return Boolean(value)&&value.length<=120&&!/[\\/]/.test(value)&&
    ![...value].some(c=>c.charCodeAt(0)<32)&&value!=="..";
}
const curatedAliases:Record<string,string>={
  "samsung electronics":"Samsung", "micron":"MU", "micron technology":"MU",
  "sk hynix":"SK hynix", "sk hynix inc":"SK hynix"
};
// Only top-level Markdown Hubs consume the bound. The extra row is a
// completeness sentinel, never permission to resolve from a partial index.
export function indexedTopLevelHubs(prefix:"01_Companies/"|"02_Industries_Themes/"){
  const rows=db().prepare("SELECT path,frontmatter FROM notes WHERE path>=? AND path<? AND instr(substr(path,?),'/')=0 AND substr(path,-3)='.md' ORDER BY path LIMIT 3001")
    .all(prefix,prefix.slice(0,-1)+"0",prefix.length+1) as {path:string;frontmatter:string|null}[];
  return rows.map(x=>({...x,title:x.path.slice(prefix.length,-3)}));
}
function indexedAliases(frontmatter:string|null):string[]{
  if(!frontmatter)return [];
  try{
    const fm=JSON.parse(frontmatter) as Record<string,unknown>;
    if(!fm||typeof fm!=="object"||Array.isArray(fm))return [];
    return [fm.aliases,fm.alias,fm.company_name,fm.ticker]
      .flatMap(x=>Array.isArray(x)?x:[x]).filter((x):x is string=>typeof x==="string"&&x.length>1);
  }catch{return [];}
}
/** A stale indexed alias cannot be used to link a different issuer. Verify
 * the selected Hub's current on-disk aliases before suggesting navigation.
 * This check never authenticates a security, listing or publisher identity. */
function currentHubAliases(hub:ReturnType<typeof indexedTopLevelHubs>[number]):boolean{
  try{
    const current=JSON.stringify(splitFrontmatter(readNote(hub.path).content).data);
    const labels=(fm:string|null)=>JSON.stringify([...new Set(indexedAliases(fm).map(key))].sort());
    return labels(current)===labels(hub.frontmatter);
  }catch{return false;}
}
// Reuse the existing explicit Hub vocabulary for read-only retrieval. This is
// not a security master, and does not change canonical writeback resolution.
export {key as hubIdentityKey,indexedAliases as indexedHubAliases};
function findHub(label:string, indexed:ReturnType<typeof indexedTopLevelHubs>, scope:"company"|"industry"){
  if((scope==="company"&&!validHubIdentityLabel(label))||indexed.length>3000)return null;
  const wanted=key(label);
  // A title is not unique issuer evidence when another Hub declares the same
  // label as an alias. Resolve ALL candidate paths before giving title priority,
  // matching the conservative company-context resolver.
  const candidates=indexed.filter(x=>key(x.title)===wanted||
    indexedAliases(x.frontmatter).some(a=>key(a)===wanted));
  if(candidates.length>1)return null;
  if(candidates.length===1){
    // An indexed candidate with stale/missing on-disk metadata must HOLD.
    // Never fall through to a curated alias after a failed readback.
    if(!currentHubAliases(candidates[0]))return null;
    return {path:candidates[0].path,
      resolution:key(candidates[0].title)===wanted?"exact_existing_title" as const:"indexed_alias" as const};
  }
  const canonical=scope==="company"&&Object.hasOwn(curatedAliases,wanted)?curatedAliases[wanted]:undefined;
  if(!canonical)return null;
  // Curated aliases are navigational hints, never evidence that overrides
  // a collision on the canonical target (including an alias-only collision).
  const canonicalKey=key(canonical);
  const curated=indexed.filter(x=>key(x.title)===canonicalKey||
    indexedAliases(x.frontmatter).some(a=>key(a)===canonicalKey));
  return curated.length===1&&key(curated[0].title)===canonicalKey&&currentHubAliases(curated[0])?
    {path:curated[0].path,resolution:"curated_alias" as const}:null;
}
function isDate(value:string|undefined){
  if(!value||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00Z");
  return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;
}
function brokerRevision(b:BrokerUpdate|undefined):RoutingV2["brokerRevision"]{
  const estimateRows=b?.estimateChanges??[];
  const result=(status:RoutingV2["brokerRevision"]["status"],reason:string):RoutingV2["brokerRevision"]=>({
    status,provenance:"caller_declared_not_broker_verified",estimateRows,reason
  });
  if(!b)return result("not_supplied","No broker comparison supplied; do not infer price target changes from a headline.");
  if(b.targetPrice==null||b.priorTargetPrice==null)
    return result("rating_only_or_estimate_update","No comparable old and new target prices; a reiteration is not a PT raise.");
  const before=Number(b.priorTargetPrice),after=Number(b.targetPrice);
  if(!b.bank?.trim()||!b.priorBank?.trim()||key(b.bank)!==key(b.priorBank)||
     !isDate(b.reportDate)||!isDate(b.priorReportDate)||b.priorReportDate! > b.reportDate!||
     !b.currency?.trim()||!b.priorCurrency?.trim()||key(b.currency)!==key(b.priorCurrency)||
     (b.targetHorizon||b.priorTargetHorizon)&&(!b.targetHorizon||!b.priorTargetHorizon||key(b.targetHorizon)!==key(b.priorTargetHorizon))||
     !Number.isFinite(before)||!Number.isFinite(after)||before<=0||after<=0)
    return result("insufficient_same_bank_vintage","PT comparison requires same-bank attribution, valid report/prior dates, matching old/new currency and horizon when declared, and positive old/new prices. Never compare different banks or vintages.");
  return result(after>before?"pt_raise_candidate":after<before?"pt_cut_candidate":"pt_reiteration_candidate",
    "Caller-declared old/new same-bank PT; still requires original report, identical currency/horizon and independent verification.");
}

export function planCanonicalRoutingV2(input:RoutingV2Input):RoutingV2{
  const companyIndex=indexedTopLevelHubs("01_Companies/");
  const industryIndex=indexedTopLevelHubs("02_Industries_Themes/");
  const tags=input.entityRoles??[];
  const companyHubs:HubLink[]=[],industryHubs:HubLink[]=[];
  const unresolvedEntities:string[]=[],unresolvedThemes:string[]=[];
  const companyCandidates=input.domain==="company"?input.entities:[...new Set(tags.map(x=>x.entity))];
  for(const label of companyCandidates){
    const declared=tags.find(x=>key(x.entity)===key(label));
    const hub=findHub(label,companyIndex,"company");
    if(hub){
      const role=declared?.role??(input.domain==="company"&&input.entities.length===1?"primary_subject":"mentioned");
      if(!companyHubs.some(x=>x.path===hub.path))companyHubs.push({label,...hub,role});
    }else unresolvedEntities.push(label);
  }
  // In industry coverage, named companies remain company subjects even when
  // the parent topic is an industry. Never classify covered issuers as missing
  // Industry Hubs simply because they appear in `entities`.
  const declaredCompanyKeys=new Set(tags.map(x=>key(x.entity)));
  const industryEntities=input.domain==="industry"
    ?input.entities.filter(x=>!declaredCompanyKeys.has(key(x)))
    :[];
  const themes=[...new Set([...(input.themes??[]),...industryEntities])];
  for(const label of themes){
    const hub=findHub(label,industryIndex,"industry");
    if(hub){if(!industryHubs.some(x=>x.path===hub.path))industryHubs.push({label,...hub});}
    else unresolvedThemes.push(label);
  }
  // The number of mentioned companies is NOT the number of principal
  // subjects. A single declared primary company keeps a company Review even
  // when competitors/suppliers are linked as context. If multiple declared
  // primary subjects conflict, hold the review as Cross Theme rather than
  // silently choosing the first ticker.
  const primaryHubs=companyHubs.filter(x=>x.role==="primary_subject");
  const singlePrimary=input.domain==="company"&&primaryHubs.length===1;
  const reviewScope:RoutingV2["reviewScope"]=input.domain==="macro"?"macro":
    input.domain==="asset"?"asset":input.domain==="industry"||
    (input.domain==="company"&&companyHubs.length>1&&!singlePrimary)?"industry":"company";
  const preferredReviewSubject=reviewScope==="industry"&&industryHubs.length?industryHubs[0].path.slice("02_Industries_Themes/".length,-3):
    reviewScope==="company"&&companyHubs.length?(singlePrimary?primaryHubs[0]:companyHubs[0]).path.slice("01_Companies/".length,-3):
    reviewScope==="macro"?input.entities.join(" / "):reviewScope==="asset"?"Asset / Portfolio":"Cross Theme";
  const onePrimary=companyHubs.length===1&&companyHubs[0].role==="primary_subject"&&input.domain==="company";
  return {
    version:"M5.2-read-only",
    classification:{contentTypes:[...new Set(input.contentTypes??[])],basis:"caller_declared_not_independently_verified",
      materiality:"unassessed",novelty:"unresolved_pending_original_event_review"},
    companyHubs,industryHubs,unresolvedEntities,unresolvedThemes,reviewScope,preferredReviewSubject,
    timelineEligibility:onePrimary?"primary_single_company_candidate_only":"not_eligible_without_event_review",
    brokerRevision:brokerRevision(input.brokerUpdate),neverAutoWriteProtected:true
  };
}
