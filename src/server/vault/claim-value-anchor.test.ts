import {it,expect} from "vitest";
import {claimValueAppearsInAnchor as matches,claimSourceAnchorIssues as issues} from "./claim-value-anchor";

it.each([
  ["Revenue was 13.5.","13.5"],["Revenue was 13.5, subject to review.","13.5"],
  ["Revenue: $13.5 billion","13.5"],["Revenue: $13.5 billion","$13.5"],
  ["Margin: 13.5%.","13.5"],["Margin: 13.5%.","13.5%"],
  ["Growth: +13.5%.","+13.5%"],["Change: -13.5.","-13.5"],
  ["Change: −13.5.","−13.5"],["Revenue: USD 1,013.50.","1,013.50"],
  ["Loss: -$1,013.50.","-$1,013.50"],["Amount: 0.5.","0.5"],
  ["Amount: 13 500.","13 500"],["Amount: 13\u202f500.","13\u202f500"],
  ["Amount: 13'500.","13'500"],
  ["Ratio: .5.",".5"],["Amount: 1.35e3.","1.35e3"],
  ["Status: not reported.","not reported"],
  ["First: 113.5; second: 13.5.","13.5"]
])("accepts a complete literal value in %s (%s)",(anchor,value)=>{expect(matches(anchor,value)).toBe(true);});
it.each([
  ["113.5","13.5"],["-13.5","13.5"],["+13.5","13.5"],["−13.5","13.5"],
  ["-$13.5","13.5"],["- $13.5","$13.5"],["- 13.5","13.5"],
  ["13.50","13.5"],["13.51%","13.5"],["1,013.5","13.5"],["13,500","13"],
  ["13 500","13"],["13\u00a0500","13"],["13\u202f500","13"],["13'500","13"],
  ["13.5e2","13.5"],["13.5","3.5"],["13.5",".5"],
  ["EUR113.5","13.5"],["A13.5B","13.5"],["1,000","1000"],["1000","1,000"],
  ["-13.5","+13.5"],["13.5","-13.5"],["Revenue 12.5","13.5"],["anything",""]
])("rejects numeric clipping or nonliteral conversion in %s (%s)",(anchor,value)=>{expect(matches(anchor,value)).toBe(false);});

it.each(["\u2212",...Array.from({length:6},(_,i)=>String.fromCharCode(0x2010+i)),"\uFE63","\uFF0D"])("RC3 preserves sign identity %s, including currency/exponent contexts",sign=>{
  for(const full of [`${sign}13.5`,`$${sign}13.5`,`${sign}$13.5`,`USD ${sign}13.5`,`${sign}US$13.5`,`${sign}USD 13.5`]){
    expect(matches(full,"13.5")).toBe(false);
    expect(issues(full,"13.5","13.5")).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
  }
  expect(matches(`${sign}13.5`,`${sign}13.5`)).toBe(true);
  if(sign!=="-")expect(matches(`${sign}13.5`,"-13.5")).toBe(false);
  expect(issues(`1.35e${sign}2`,`1.35`,`1.35`)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
  expect(matches(`${sign}(13.5)`,"(13.5)")).toBe(false);
  expect(matches(`${sign}$(13.5)`,"$(13.5)")).toBe(false);
});
it.each(["(13.5)","($13.5)","(USD 13.5)","$(13.5)","(13.5%)"])("RC3 accounting form %s is not silently unsigned/signed equivalent",full=>{
  expect(matches(full,"13.5")).toBe(false);expect(matches(full,"-13.5")).toBe(false);
  expect(issues(full,"13.5","13.5")).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
  expect(matches(full,full)).toBe(true);
});
it("RC1 checks every excerpt occurrence and every boundary, without arbitrary occurrence selection",()=>{
  for(const full of ["13.5 billion; -13.5 billion", "-13.5 billion; 13.5 billion"])
    expect(issues(full,"13.5 billion","13.5")).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
  expect(issues("13.5 billion; 13.5 billion","13.5 billion","13.5")).toEqual([]);
  expect(issues("Revenue 13.5, up 106%","Revenue 13.5, up 10","13.5")).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
});
it("RC2 validates numeric qualifications while preserving ordinary textual qualifications",()=>{
  const full="Revenue 96.2 billion, up 106%, provisional and unverified.";
  expect(issues(full,full,"96.2","up 10")).toEqual(["claim_qualification_source_anchor_invalid"]);
  expect(issues(full,full,"96.2","up 106%")).toEqual([]);
  expect(issues(full,full,"96.2","provisional and unverified")).toEqual([]);
  expect(issues(full,full,"96.2","unsupported")).toEqual(["claim_qualification_source_anchor_invalid"]);
});
it.each(["13.5bn","13.5USD","13.5x","USD13.5"])("RC5 ambiguous attached unit/suffix %s stays HOLD",full=>{
  expect(issues(full,full,"13.5")).toEqual(["claim_literal_source_anchor_missing"]);
});
it.each(["Revenue 13.5.","Revenue $13.5 billion.","Margin 13.5%.","Revenue 13.5, subject to review."])("E5 full-source positive control: %s",full=>{
  expect(issues(full,full,"13.5")).toEqual([]);
});
