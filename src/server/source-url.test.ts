import {describe,it,expect} from "vitest";
import {canonicalSourceUrl as canonical,canonicalHttpSourceUrl,archiveEligibleUrl,legacyCanonicalSourceUrlN1c as legacy} from "./source-url";

const punctuation=[")",",",".",";"];
describe("N1c shared canonical URL fixed point",()=>{
  it.each(["https://example.org/doc",...punctuation.map(c=>"https://example.org/doc"+c),
    "https://www.sec.gov/Archives/report_(Q3)",...punctuation.map(c=>"https://example.org/doc?q=value"+c)])(
    "treats plain and fragment forms of %s as the same source",url=>{
      expect(canonical(url+"#section")).toBe(canonical(url));
      expect(canonical(canonical(url+"#section"))).toBe(canonical(url+"#section"));
    });
  it("is idempotent across generated host/path/query/fragment/space combinations",()=>{
    const origins=["https://example.org","HTTP://EXAMPLE.ORG:80","https://[::1]:443"];
    const paths=["/doc","/report_(Q3)","/doc,","/doc.","/doc;","/a+b","/a%20b","/A%2Eb","/%2e)"];
    const queries=["","?","?q=value)","?q=value%29","?q=value.","?q=value%2E",
      "?a=tail.&z=x","?z=tail.&a=x","?utm_source=x","?a=tail.&utm_source=x",
      "?gclid=1&fbclid=2&utm_medium=x","?z=2&a=hello%20world","?a=hello+world&z=2","?q=a%2Bb"];
    for(const origin of origins)for(const path of paths)for(const query of queries)
      for(const fragment of ["","#section","#fragment),.;"]){
        const plain=origin+path+query,url="  "+plain+fragment+"  ",key=canonical(url);
        expect(canonical(key),url).toBe(key);
        expect(key,url).toBe(canonical(plain));
        expect(canonicalHttpSourceUrl(url),url).toBe(key);
        const previous=legacy(plain);
        if(legacy(previous)===previous)expect(key,url).toBe(previous);
      }
  });
  it("does not turn a parseable all-punctuation authority into an invalid URL",()=>{
    for(const url of ["https://.","https://)","https://example.org."]){
      expect(canonical(url+"#sec")).toBe(canonical(url));
      expect(canonical(canonical(url))).toBe(canonical(url));
      expect(()=>new URL(canonical(url)!)).not.toThrow();
    }
  });
  it("preserves host, tracking, query sorting, space/plus and path-case semantics",()=>{
    expect(canonical(" https://EXAMPLE.org:443/Doc+a?z=2&utm_source=x&fbclid=1&gclid=2&a=hello%20world#sec "))
      .toBe("https://example.org/Doc+a?a=hello+world&z=2");
    expect(canonical("https://example.org/doc?q=a%2Bb")).not.toBe(canonical("https://example.org/doc?q=a+b"));
    expect(canonical("https://example.org/a+b")).not.toBe(canonical("https://example.org/a%20b"));
    expect(canonical("https://example.org/Doc")).not.toBe(canonical("https://example.org/doc"));
    expect(canonical("https://example.org/doc%29")).toBe("https://example.org/doc%29");
    expect(canonical("https://example.org/doc?q=value%29")).toBe("https://example.org/doc?q=value%29");
  });
  it("closes punctuation newly exposed by tracking removal, query sorting or serialization",()=>{
    for(const url of ["https://example.org/doc)?utm_source=x","https://example.org/doc;?",
      "https://example.org/doc?a=tail.&Z=x","https://example.org/doc?q=tail%2E"])
      expect(canonical(canonical(url))).toBe(canonical(url));
  });
  it("retains the frozen pre-N1c outputs only for historical reconciliation checks",()=>{
    for(const [raw,prior] of [
      ["https://example.org/doc)#sec","https://example.org/doc)"],
      ["https://example.org/doc?q=value)#sec","https://example.org/doc?q=value%29"],
      ["https://example.org/doc)?utm_source=x","https://example.org/doc)"],
      ["https://example.org/doc?a=tail.&Z=x","https://example.org/doc?Z=x&a=tail."]
    ])expect(legacy(raw)).toBe(prior);
  });
  it("keeps unsupported identities and archive eligibility separate",()=>{
    for(const url of [" free text ","ftp://example.org/doc)#sec","https://user:pass@example.org/doc)#sec"]){
      expect(canonical(url)).toBe(url.trim());expect(archiveEligibleUrl(url)).toBeNull();
    }
    expect(archiveEligibleUrl("http://example.org/doc)#sec")).toBeNull();
    expect(archiveEligibleUrl("https://example.org:8443/doc)#sec")).toBeNull();
    expect(archiveEligibleUrl("https://EXAMPLE.org:443/doc)#sec")).toBe("https://example.org/doc");
    expect(canonical(null)).toBeNull();expect(canonical(" ")).toBeNull();
  });
});
