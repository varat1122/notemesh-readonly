/** Literal observation anchoring, NOT financial meaning or primary authority.
 * A match may not clip a signed number, decimal, grouped number or exponent.
 * Currency/percent annotations may surround a complete numeric value (the
 * claim's unit remains caller-declared). No rounding, scaling, sign stripping,
 * separator conversion or semantic unit equivalence is performed. */
type Span={start:number;end:number};
const space=String.raw`[ \t\u00a0\u2007-\u200a\u202f]*`;
const sign=String.raw`[+\u2212\u2010-\u2015\uFE63\uFF0D-]`;
const currency=String.raw`(?:[A-Z]{1,3}\p{Sc}|\p{Sc}|[A-Z]{3})`;
// Unicode decimal digits remain literal: no transliteration or separator
// conversion. These spaces join groups of exactly three decimal digits.
const number=String.raw`(?:\p{Nd}+(?:[.,]\p{Nd}+|[ '\u2019\u00a0\u2007-\u200a\u202f]\p{Nd}{3}(?!\p{Nd}))*|\.\p{Nd}+)(?:[eE]${sign}?\p{Nd}+)?`;
function numericSpans(source:string):Span[]{
  // Parentheses around a number are potentially accounting-negative. Require
  // literal preservation, never infer equivalence to either + or - notation.
  const prefix=String.raw`(?:${sign}${space}${currency}?${space})?`;
  const signed=prefix+number;
  const pattern=new RegExp(String.raw`${prefix}\(${space}${currency}?${space}${signed}${space}%?${space}\)|${signed}`,"gu");
  return [...source.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length}));
}
function clipped(numbers:Span[],start:number,end:number){
  return numbers.some(n=>n.start<end&&n.end>start&&(n.start<start||n.end>end));
}
function occurrences(source:string,text:string):number[]{
  const found:number[]=[];
  if(text)for(let start=source.indexOf(text);start!==-1;start=source.indexOf(text,start+1))found.push(start);
  return found;
}
function wordBoundary(source:string,start:number,end:number,numbers:Span[]){
  const before=source.slice(0,start),after=source.slice(end);
  // Thai prose need not put spaces beside numbers. Permit only Thai letters/
  // marks directly beside a FULL numeric-token edge in the preserved Source.
  // Never exempt adjacent digits, Latin unit/identifier suffixes or arbitrary
  // Thai word substrings. This establishes no unit or semantic equivalence.
  const left=!/[\p{L}\p{M}\p{N}_]$/u.test(before)||
    /(?=\p{Script_Extensions=Thai})[\p{L}\p{M}]$/u.test(before)&&numbers.some(n=>n.start===start);
  const right=!/^[\p{L}\p{M}\p{N}_]/u.test(after)||
    /^(?=\p{Script_Extensions=Thai})[\p{L}\p{M}]/u.test(after)&&numbers.some(n=>n.end===end);
  return left&&right;
}
export function claimValueAppearsInAnchor(anchor:string,value:string):boolean{
  const numbers=numericSpans(anchor);
  return occurrences(anchor,value).some(start=>wordBoundary(anchor,start,start+value.length,numbers)&&!clipped(numbers,start,start+value.length));
}
/** Validate offsets against the PRESERVED full source, never a caller-trimmed
 * numeric context. Every possible excerpt occurrence must be boundary-safe:
 * the free-text locator cannot disambiguate a safe vs clipped occurrence.
 * No byte normalization; no sign, currency or accounting equivalence. */
export function claimSourceAnchorIssues(source:string,excerpt:string,value:string,qualification?:string):string[]{
  if(source.length>12001||excerpt.length>3000||!excerpt||!value)return ["claim_literal_source_anchor_missing"];
  const starts=occurrences(source,excerpt),numbers=numericSpans(source);
  if(!starts.length)return ["claim_literal_source_anchor_missing"];
  if(starts.some(start=>clipped(numbers,start,start+excerpt.length)))return ["claim_excerpt_numeric_boundary_invalid"];
  if(!starts.every(offset=>occurrences(excerpt,value).some(start=>
    wordBoundary(source,offset+start,offset+start+value.length,numbers)&&!clipped(numbers,offset+start,offset+start+value.length))))
    return ["claim_literal_source_anchor_missing"];
  if(qualification){
    const positions=occurrences(excerpt,qualification);
    if(!positions.length||(/\p{Nd}/u.test(qualification)&&!starts.every(offset=>positions.some(start=>
      wordBoundary(source,offset+start,offset+start+qualification.length,numbers)&&!clipped(numbers,offset+start,offset+start+qualification.length)))))
      return ["claim_qualification_source_anchor_invalid"];
  }
  return [];
}
