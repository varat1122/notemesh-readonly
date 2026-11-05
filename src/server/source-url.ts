/** Accepted Source identity contract. Query spaces (%20 and +) normalize via
 * URLSearchParams; path escapes/case and literal path + remain distinct.
 * Ineligible locators still have an identity; eligibility is a separate gate. */
export function canonicalSourceUrl(value:string|null|undefined):string|null {
  if(!value?.trim())return null;
  const text=value.trim();
  try{
    const u=new URL(text.replace(/[),.;]+$/g,""));
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return text;
    u.hash="";
    for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  }catch{return text;}
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
