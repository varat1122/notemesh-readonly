import {describe,it,expect} from "vitest";
import {parseInstrumentIdentityRegistry,resolveLegacyPriceListing,resolveUnderlyingMapping} from "./identity.ts";

const evidence={verification:"verified_against_primary" as const,sourceUrl:"https://issuer.example.test/listing",observedAt:"2026-11-02"};
const registry={
  schemaVersion:"instrument-identity-v1" as const,
  listings:[
    {listingId:"LST-XYZCOMMON",securityId:"SEC-XYZCOMMON",issuerId:"ENT-XYZCORP1",venue:"XTAI",ticker:"1234",
      shareClass:"Common",currency:"TWD",listingType:"common_stock" as const,validFrom:"2000-01-01",validTo:null,
      identityEvidence:evidence,marketPriceRef:null,providerAliases:[{provider:"yahoo",symbol:"1234.TW",validFrom:"2000-01-01",validTo:null}],underlyingMappings:[]},
    {listingId:"LST-XYZADR001",securityId:"SEC-XYZADR001",issuerId:"ENT-XYZCORP1",venue:"XNYS",ticker:"XYZ",
      shareClass:"ADS",currency:"USD",listingType:"adr" as const,validFrom:"2000-01-01",validTo:null,
      identityEvidence:evidence,marketPriceRef:{market:"US" as const,symbol:"XYZ"},
      providerAliases:[{provider:"yahoo",symbol:"XYZ",validFrom:"2000-01-01",validTo:null}],
      underlyingMappings:[{relation:"adr_underlying" as const,underlyingListingId:"LST-XYZCOMMON",
        listingUnits:"1",underlyingUnits:"5",effectiveFrom:"2000-01-01",effectiveTo:null,
        verification:"verified_against_primary" as const,sourceUrl:"https://issuer.example.test/adr-ratio",observedAt:"2026-11-02"}]},
    {listingId:"LST-XYZDR0001",securityId:"SEC-XYZDR0001",issuerId:"ENT-XYZCORP1",venue:"XBKK",ticker:"XYZ80",
      shareClass:"DR",currency:"THB",listingType:"dr" as const,validFrom:"2025-01-01",validTo:null,
      identityEvidence:{verification:"not_reverified" as const,sourceUrl:"https://set.example.test/dr",observedAt:"2026-11-02"},
      marketPriceRef:{market:"TH" as const,symbol:"XYZ80"},providerAliases:[],
      underlyingMappings:[{relation:"dr_underlying" as const,underlyingListingId:"LST-XYZADR001",
        listingUnits:"1",underlyingUnits:"0.01",effectiveFrom:"2025-01-01",effectiveTo:null,
        verification:"not_reverified" as const,sourceUrl:"https://set.example.test/dr",observedAt:"2026-11-02"}]}
  ]
};

describe("provider-neutral instrument identity",()=>{
  it("keeps common, ADR and DR as distinct listings for one issuer",()=>{
    const parsed=parseInstrumentIdentityRegistry(registry);
    expect(new Set(parsed.listings.map(x=>x.listingId)).size).toBe(3);
    expect(new Set(parsed.listings.map(x=>x.currency))).toEqual(new Set(["TWD","USD","THB"]));
  });
  it("resolves the legacy price cache only through an explicit listing adapter",()=>{
    const adr=resolveLegacyPriceListing(registry,{market:"US",symbol:"XYZ"},"2026-11-02");
    expect(adr.status).toBe("mapped_verified");
    expect(adr.listing?.listingType).toBe("adr");
    expect(adr.crossListingConversionAllowed).toBe(false);
    const missing=resolveLegacyPriceListing(registry,{market:"US",symbol:"NVDA"},"2026-11-02");
    expect(missing.status).toBe("unmapped");
  });
  it("allows unit conversion only when listing identity and dated mapping are primary-verified",()=>{
    const adr=resolveUnderlyingMapping(registry,"LST-XYZADR001","2026-11-02");
    expect(adr.status).toBe("verified_mapping");
    expect(adr.usableForConversion).toBe(true);
    expect(adr.mapping).toMatchObject({listingUnits:"1",underlyingUnits:"5",underlyingListingId:"LST-XYZCOMMON"});
    const dr=resolveUnderlyingMapping(registry,"LST-XYZDR0001","2026-11-02");
    expect(dr.status).toBe("unverified_mapping");
    expect(dr.usableForConversion).toBe(false);
  });
  it("rejects a provider alias that points to two live listings at once",()=>{
    const bad=structuredClone(registry) as any;
    bad.listings.push({...bad.listings[1],listingId:"LST-XYZADR002",securityId:"SEC-XYZADR002"});
    expect(()=>parseInstrumentIdentityRegistry(bad)).toThrow("provider_alias_maps_multiple_listings");
  });
  it("rejects overlapping receipt mappings instead of choosing a ratio silently",()=>{
    const bad=structuredClone(registry) as any;
    bad.listings[1].underlyingMappings.push({...bad.listings[1].underlyingMappings[0],listingUnits:"1",underlyingUnits:"10",effectiveFrom:"2026-01-01"});
    expect(()=>parseInstrumentIdentityRegistry(bad)).toThrow("overlapping_underlying_mapping");
  });
  it.each(["unverified","not_reverified","disputed","superseded"])("requires primary-verified underlying identity, not %s",verification=>{
    const changed=structuredClone(registry) as any;
    changed.listings[0].identityEvidence={...changed.listings[0].identityEvidence,verification};
    expect(changed.listings[1].identityEvidence.verification).toBe("verified_against_primary");
    expect(changed.listings[1].underlyingMappings[0].verification).toBe("verified_against_primary");
    const result=resolveUnderlyingMapping(changed,"LST-XYZADR001","2026-11-02");
    expect(result.usableForConversion).toBe(false);
    expect(result.status).not.toBe("verified_mapping");
  });
  it.each(["unverified","not_reverified","disputed","superseded"])("also requires verified receipt and mapping, not %s",verification=>{
    for(const target of ["receipt","mapping"]){
      const changed=structuredClone(registry) as any;
      if(target==="receipt")changed.listings[1].identityEvidence={...changed.listings[1].identityEvidence,verification};
      else changed.listings[1].underlyingMappings[0].verification=verification;
      expect(changed.listings[0].identityEvidence.verification).toBe("verified_against_primary");
      expect(resolveUnderlyingMapping(changed,"LST-XYZADR001","2026-11-02").usableForConversion).toBe(false);
    }
  });
  it.each([0,1])("requires listing %i to be active at the requested date",index=>{
    for(const bound of ["before","after"]){
      const changed=structuredClone(registry) as any;
      if(bound==="before")changed.listings[index].validFrom="2026-11-03";
      else changed.listings[index].validTo="2026-11-01";
      expect(resolveUnderlyingMapping(changed,"LST-XYZADR001","2026-11-02").usableForConversion).toBe(false);
    }
  });
  it("returns unusable for a missing underlying while registry ingestion still rejects the broken reference",()=>{
    const changed=structuredClone(registry);changed.listings.splice(0,1);
    expect(()=>parseInstrumentIdentityRegistry(changed)).toThrow("underlying_listing_not_registered");
    expect(resolveUnderlyingMapping(changed,"LST-XYZADR001","2026-11-02").usableForConversion).toBe(false);
  });
  it.each([["2026-11-01",false],["2026-11-02",true],["2026-11-03",true],["2026-11-04",false]] as const)("respects inclusive mapping date boundaries at %s",(asOf,usable)=>{
    const changed=parseInstrumentIdentityRegistry(structuredClone(registry));
    changed.listings[1].underlyingMappings[0].effectiveFrom="2026-11-02";
    changed.listings[1].underlyingMappings[0].effectiveTo="2026-11-03";
    expect(resolveUnderlyingMapping(changed,"LST-XYZADR001",asOf).usableForConversion).toBe(usable);
  });
});
