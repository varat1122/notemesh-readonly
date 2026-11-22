/** Accepted Source identity contract. Query spaces (%20 and +) normalize via
 * URLSearchParams; path escapes/case and literal path + remain distinct.
 * Ineligible locators still have an identity; eligibility is a separate gate. */
function normalizeUrl(text:string,fragmentFirst:boolean):string|null {
  try{
    // Remove only a literal fragment delimiter; encoded %23 stays URL data.
    const source=fragmentFirst?text.split("#",1)[0]:text;
    let u:URL;
    try{u=new URL(source.replace(/[),.;]+$/g,""));}
    catch{
      if(!fragmentFirst)return null;
      // Trimming must not manufacture an invalid empty authority. Keep the
      // parsed URL in that case; unsupported schemes/credentials still fail below.
      u=new URL(source);
    }
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return null;
    u.hash="";
    for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  }catch{return null;}
}
export function canonicalSourceUrl(value:string|null|undefined):string|null {
  if(!value?.trim())return null;
  const text=value.trim();
  let current=text;
  for(;;){
    const next=normalizeUrl(current,true);
    if(next===null)return text;
    if(next===current)return next;
    // After the first serialization, another change consumes newly exposed
    // terminal punctuation (or its parsed dot segment). No normalization cycle.
    // Tracking removal/query sorting must not leave a noncanonical result.
    current=next;
  }
}
/** Comparison only for historical identity reconciliation. Never create new
 * Source IDs or archive keys with the pre-N1c, single-pass contract. */
export function legacyCanonicalSourceUrlN1c(value:string|null|undefined):string|null {
  const text=value?.trim();
  return text?normalizeUrl(text,false)??text:null;
}
export function canonicalHttpSourceUrl(value:string|null|undefined):string|null {
  const canonical=canonicalSourceUrl(value);
  if(!canonical)return null;
  try{
    const u=new URL(canonical);
    return ["http:","https:"].includes(u.protocol)&&u.hostname&&!u.username&&!u.password?canonical:null;
  }catch{return null;}
}
export function archiveEligibleUrl(value:string|null|undefined):string|null {
  const canonical=canonicalHttpSourceUrl(value);
  if(!canonical)return null;
  const u=new URL(canonical);
  return u.protocol==="https:"&&!u.port?canonical:null;
}
