/**
 * M5.2: evidence-safe canonical routing suggestions. This module queries only
 * indexed, existing hubs; it never creates notes or infers a verified claim.
 * Labels, entity roles and broker revisions are caller-declared hypotheses.
 */
import { db } from "../db";

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
const curatedAliases:Record<string,string>={
  "samsung electronics":"Samsung", "micron":"MU", "micron technology":"MU",
  "sk hynix":"SK hynix", "sk hynix inc":"SK hynix"
};
function rows(prefix:string):{path:string;frontmatter:string|null}[]{
  return db().prepare("SELECT path,frontmatter FROM notes WHERE substr(path,1,?)=? ORDER BY path LIMIT 3000")
    .all(prefix.length,prefix) as {path:string;frontmatter:string|null}[];
}
function stems(prefix:string){
  return rows(prefix).filter(x=>x.path.endsWith(".md")&&!x.path.slice(prefix.length).includes("/"))
    .map(x=>({...x,title:x.path.slice(prefix.length,-3)}));
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
function findHub(label:string, indexed:ReturnType<typeof stems>, allowCurated:boolean){
  const wanted=key(label);
  const exact=indexed.filter(x=>key(x.title)===wanted);
  if(exact.length===1)return {path:exact[0].path,resolution:"exact_existing_title" as const};
  if(exact.length>1)return null;
  const alias=indexed.filter(x=>indexedAliases(x.frontmatter).some(a=>key(a)===wanted));
  if(alias.length===1)return {path:alias[0].path,resolution:"indexed_alias" as const};
  if(alias.length>1)return null;
  const canonical=allowCurated?curatedAliases[wanted]:undefined;
  if(!canonical)return null;
  const curated=indexed.filter(x=>key(x.title)===key(canonical));
  return curated.length===1?{path:curated[0].path,resolution:"curated_alias" as const}:null;
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
  const companyIndex=stems("01_Companies/");
  const industryIndex=stems("02_Industries_Themes/");
  const tags=input.entityRoles??[];
  const companyHubs:HubLink[]=[],industryHubs:HubLink[]=[];
  const unresolvedEntities:string[]=[],unresolvedThemes:string[]=[];
  const companyCandidates=input.domain==="company"?input.entities:[...new Set(tags.map(x=>x.entity))];
  for(const label of companyCandidates){
    const declared=tags.find(x=>key(x.entity)===key(label));
    const hub=findHub(label,companyIndex,true);
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
    const hub=findHub(label,industryIndex,false);
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
