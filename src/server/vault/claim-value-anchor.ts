/** Literal observation anchoring, NOT financial meaning or primary authority.
 * A match may not clip a signed number, decimal, grouped number or exponent.
 * Currency/percent annotations may surround a complete numeric value (the
 * claim's unit remains caller-declared). No rounding, scaling, sign stripping,
 * separator conversion or semantic unit equivalence is performed. */
export function claimValueAppearsInAnchor(anchor:string,value:string):boolean{
  if(!value)return false;
  const numbers=[...anchor.matchAll(/(?:[+\u2212-][ \t\u00a0\u202f]*\p{Sc}?[ \t\u00a0\u202f]*)?(?:\d+(?:[.,]\d+|[ '\u2019\u00a0\u202f]\d{3}(?!\d))*|\.\d+)(?:[eE][+-]?\d+)?/gu)]
    .map(m=>({start:m.index,end:m.index+m[0].length}));
  for(let start=anchor.indexOf(value);start!==-1;start=anchor.indexOf(value,start+1)){
    const end=start+value.length;
    if(/[\p{L}\p{N}_]/u.test(anchor[start-1]??"")||/[\p{L}\p{N}_]/u.test(anchor[end]??""))continue;
    if(numbers.some(n=>n.start<end&&n.end>start&&(n.start<start||n.end>end)))continue;
    return true;
  }
  return false;
}
