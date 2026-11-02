import { z } from "zod";
import { instrument, instrumentSchema, isoDate, type InstrumentInput } from "./model.ts";

const stableId = (prefix:string) => z.string().trim().toUpperCase()
  .regex(new RegExp("^"+prefix+"-[A-Z0-9][A-Z0-9_-]{7,63}$"));
export const listingIdSchema=stableId("LST");
export const securityIdSchema=stableId("SEC");
export const issuerIdSchema=stableId("ENT");
const currencySchema=z.string().regex(/^[A-Z]{3}$/);
const venueSchema=z.string().regex(/^[A-Z0-9]{4}$/);
const positiveDecimal=z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine(v=>/[1-9]/.test(v.replace(".","")),"Must be positive");

export const listingTypeSchema=z.enum([
  "common_stock","preferred_stock","adr","dr","etf","index","fund","future","spot","other"
]);
export const verificationSchema=z.enum(["unverified","not_reverified","verified_against_primary","disputed","superseded"]);

const evidenceSchema=z.object({
  verification:verificationSchema,
  sourceUrl:z.string().url().nullable(),
  observedAt:isoDate.nullable(),
}).strict().superRefine((v,ctx)=>{
  if(v.verification==="verified_against_primary"){
    if(!v.sourceUrl?.startsWith("https://"))ctx.addIssue({code:"custom",message:"Verified identity requires an HTTPS primary source URL"});
    if(!v.observedAt)ctx.addIssue({code:"custom",message:"Verified identity requires observedAt"});
  }
});

const providerAliasSchema=z.object({
  provider:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{1,39}$/),
  symbol:z.string().trim().min(1).max(80),
  validFrom:isoDate,
  validTo:isoDate.nullable(),
}).strict().superRefine((v,ctx)=>{
  if(v.validTo&&v.validTo<v.validFrom)ctx.addIssue({code:"custom",message:"Provider alias validTo precedes validFrom"});
});

const underlyingMappingSchema=z.object({
  relation:z.enum(["adr_underlying","dr_underlying"]),
  underlyingListingId:listingIdSchema,
  listingUnits:positiveDecimal.describe("Exact decimal units of this listing receipt"),
  underlyingUnits:positiveDecimal.describe("Exact decimal units of the underlying listing/security represented by listingUnits"),
  effectiveFrom:isoDate,
  effectiveTo:isoDate.nullable(),
  verification:verificationSchema,
  sourceUrl:z.string().url().nullable(),
  observedAt:isoDate.nullable(),
}).strict().superRefine((v,ctx)=>{
  if(v.effectiveTo&&v.effectiveTo<v.effectiveFrom)ctx.addIssue({code:"custom",message:"Underlying mapping effectiveTo precedes effectiveFrom"});
  if(v.verification==="verified_against_primary"){
    if(!v.sourceUrl?.startsWith("https://"))ctx.addIssue({code:"custom",message:"Verified conversion mapping requires an HTTPS primary source URL"});
    if(!v.observedAt)ctx.addIssue({code:"custom",message:"Verified conversion mapping requires observedAt"});
  }
});

export const listingIdentitySchema=z.object({
  listingId:listingIdSchema,
  securityId:securityIdSchema.nullable(),
  issuerId:issuerIdSchema.nullable(),
  venue:venueSchema.describe("ISO 10383 MIC or documented four-character venue code"),
  ticker:z.string().trim().min(1).max(40),
  shareClass:z.string().trim().max(80).nullable(),
  currency:currencySchema,
  listingType:listingTypeSchema,
  validFrom:isoDate,
  validTo:isoDate.nullable(),
  identityEvidence:evidenceSchema,
  marketPriceRef:instrumentSchema.nullable().default(null)
    .describe("Compatibility link to the current market:symbol price cache. It is not the stable listing identity."),
  providerAliases:z.array(providerAliasSchema).max(20).default([]),
  underlyingMappings:z.array(underlyingMappingSchema).max(40).default([]),
}).strict().superRefine((v,ctx)=>{
  if(v.validTo&&v.validTo<v.validFrom)ctx.addIssue({code:"custom",message:"Listing validTo precedes validFrom"});
  if(v.marketPriceRef&&instrument(v.marketPriceRef).currency!==v.currency)
    ctx.addIssue({code:"custom",message:"Legacy market-price currency conflicts with listing currency"});
  if(["adr","dr"].includes(v.listingType)&&v.underlyingMappings.length===0)
    ctx.addIssue({code:"custom",message:"ADR/DR listing requires an explicit underlying mapping or an intentionally unverified mapping record"});
  if(!["adr","dr"].includes(v.listingType)&&v.underlyingMappings.length>0)
    ctx.addIssue({code:"custom",message:"Only ADR/DR listings may declare receipt-to-underlying mappings"});
  for(const m of v.underlyingMappings){
    if(v.listingType==="adr"&&m.relation!=="adr_underlying")
      ctx.addIssue({code:"custom",message:"ADR listing must use adr_underlying relation"});
    if(v.listingType==="dr"&&m.relation!=="dr_underlying")
      ctx.addIssue({code:"custom",message:"DR listing must use dr_underlying relation"});
  }
});

export const instrumentIdentityRegistrySchema=z.object({
  schemaVersion:z.literal("instrument-identity-v1"),
  listings:z.array(listingIdentitySchema).max(5000),
}).strict();

export type ListingIdentity=z.infer<typeof listingIdentitySchema>;
export type InstrumentIdentityRegistry=z.infer<typeof instrumentIdentityRegistrySchema>;

const active=(from:string,to:string|null,asOf:string)=>from<=asOf&&(!to||to>=asOf);
const overlaps=(aFrom:string,aTo:string|null,bFrom:string,bTo:string|null)=>
  aFrom<=(bTo??"9999-12-31")&&bFrom<=(aTo??"9999-12-31");

export function parseInstrumentIdentityRegistry(raw:unknown):InstrumentIdentityRegistry{
  const registry=instrumentIdentityRegistrySchema.parse(raw);
  const ids=new Map<string,ListingIdentity>();
  for(const listing of registry.listings){
    if(ids.has(listing.listingId))throw new Error("duplicate_listing_id");
    ids.set(listing.listingId,listing);
  }
  for(const listing of registry.listings){
    for(const mapping of listing.underlyingMappings){
      if(mapping.underlyingListingId===listing.listingId)throw new Error("self_underlying_mapping");
      if(!ids.has(mapping.underlyingListingId))throw new Error("underlying_listing_not_registered");
    }
    for(let i=0;i<listing.underlyingMappings.length;i++)for(let j=i+1;j<listing.underlyingMappings.length;j++){
      const a=listing.underlyingMappings[i],b=listing.underlyingMappings[j];
      if(a.relation===b.relation&&overlaps(a.effectiveFrom,a.effectiveTo,b.effectiveFrom,b.effectiveTo))
        throw new Error("overlapping_underlying_mapping");
    }
  }
  const aliases=new Map<string,{listingId:string;from:string;to:string|null}[]>();
  for(const listing of registry.listings){
    const all=[...listing.providerAliases];
    if(listing.marketPriceRef){
      const p=instrument(listing.marketPriceRef);
      all.push({provider:"ios-market-price",symbol:p.id,validFrom:listing.validFrom,validTo:listing.validTo});
    }
    for(const alias of all){
      const key=alias.provider+"\0"+alias.symbol.toUpperCase();
      const prior=aliases.get(key)??[];
      if(prior.some(x=>x.listingId!==listing.listingId&&overlaps(x.from,x.to,alias.validFrom,alias.validTo)))
        throw new Error("provider_alias_maps_multiple_listings");
      prior.push({listingId:listing.listingId,from:alias.validFrom,to:alias.validTo});
      aliases.set(key,prior);
    }
  }
  return registry;
}

export function resolveLegacyPriceListing(registry:InstrumentIdentityRegistry,input:InstrumentInput,asOf:string){
  isoDate.parse(asOf);
  const parsed=parseInstrumentIdentityRegistry(registry);
  const ref=instrument(input);
  const candidates=parsed.listings.filter(x=>x.marketPriceRef&&instrument(x.marketPriceRef).id===ref.id&&active(x.validFrom,x.validTo,asOf));
  if(candidates.length===0)return {status:"unmapped" as const,legacyPriceId:ref.id,listing:null,
    crossListingConversionAllowed:false,warnings:["Ticker/market cache identity is not a stable security identity. Do not infer issuer, ADR/DR or underlying mapping."]};
  if(candidates.length>1)throw new Error("ambiguous_legacy_price_listing");
  const listing=candidates[0];
  return {status:listing.identityEvidence.verification==="verified_against_primary"?"mapped_verified" as const:"mapped_unverified" as const,
    legacyPriceId:ref.id,listing,crossListingConversionAllowed:false,
    warnings:["Price remains specific to this listing. A verified underlying mapping is required before any cross-listing conversion."]};
}

export function resolveUnderlyingMapping(registry:InstrumentIdentityRegistry,listingId:string,asOf:string){
  isoDate.parse(asOf);
  let parsed:InstrumentIdentityRegistry;
  try{parsed=parseInstrumentIdentityRegistry(registry);}
  catch(error){
    if(error instanceof Error&&error.message==="underlying_listing_not_registered")
      return {status:"underlying_listing_not_registered" as const,mapping:null,underlying:null,usableForConversion:false};
    throw error;
  }
  const listing=parsed.listings.find(x=>x.listingId===listingId);
  if(!listing)return {status:"listing_not_found" as const,mapping:null,underlying:null,usableForConversion:false};
  if(!active(listing.validFrom,listing.validTo,asOf))
    return {status:"inactive_listing" as const,mapping:null,underlying:null,usableForConversion:false};
  const mappings=listing.underlyingMappings.filter(x=>active(x.effectiveFrom,x.effectiveTo,asOf));
  if(!mappings.length)return {status:"no_active_mapping" as const,mapping:null,underlying:null,usableForConversion:false};
  if(mappings.length>1)throw new Error("ambiguous_underlying_mapping");
  const mapping=mappings[0],underlying=parsed.listings.find(x=>x.listingId===mapping.underlyingListingId)!;
  if(!active(underlying.validFrom,underlying.validTo,asOf))
    return {status:"inactive_underlying_listing" as const,mapping,underlying,usableForConversion:false};
  const usable=mapping.verification==="verified_against_primary"&&listing.identityEvidence.verification==="verified_against_primary"&&
    underlying.identityEvidence.verification==="verified_against_primary";
  return {status:usable?"verified_mapping" as const:"unverified_mapping" as const,mapping,underlying,
    usableForConversion:usable,
    warning:"This mapping relates security units only. It never substitutes the underlying traded price for the ADR/DR listing price."};
}
