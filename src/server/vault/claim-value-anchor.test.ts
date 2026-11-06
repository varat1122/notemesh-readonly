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

it.each([
  ["๙๖.๒","๖.๒"],["-๑๓.๕","๑๓.๕"],["๙๖.๒","๙๖"],
  ["９６.２","６.２"],["-１３.５","１３.５"],["９６.２","９６"],
  ["๑,๕๐๐","๕๐๐"],["１,５００","５００"],["๑.๕e-๒","๑.๕"]
])("N1 rejects Unicode number clipping in preserved source %s",(full,clipped)=>{
  expect(matches(full,clipped)).toBe(false);
  expect(issues(full,clipped,clipped)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
  expect(issues(full,full,full)).toEqual([]);
});
it("N1 applies Unicode boundaries to qualifications and never transliterates digits",()=>{
  const full="Revenue ๙๖.๒, up ๑๐๖%";
  expect(issues(full,full,"๙๖.๒","up ๑๐")).toEqual(["claim_qualification_source_anchor_invalid"]);
  expect(issues(full,full,"๙๖.๒","up ๑๐๖%")).toEqual([]);
  for(const source of ["๙๖.๒","９６.２"])expect(issues(source,source,"96.2")).toEqual(["claim_literal_source_anchor_missing"]);
});
it.each(["\u2007","\u2008","\u2009","\u200a","\u202f"])("N2 grouping separator %j preserves the entire number",separator=>{
  for(const [a,b] of [["13","500"],["๑๓","๕๐๐"],["１３","５００"]]){
    const full=a+separator+b;
    expect(matches(full,b)).toBe(false);
    expect(issues(full,b,b)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
    expect(issues(full,a,a)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
    expect(issues(full,full,full)).toEqual([]);
    expect(issues(`-${separator}${full}`,full,full)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
  }
});
it.each(["S$","A$","C$","R$","NZ$","HK$","US$"])("N3 preserves signs/accounting with currency prefix %s",prefix=>{
  for(const value of ["13.5","๑๓.๕","１３.５"]){
    for(const full of [`-${prefix}${value}`,`(${prefix}${value})`,`−${prefix}${value}`,`${prefix}-${value}`]){
      expect(matches(full,value)).toBe(false);
      expect(issues(full,value,value)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
      expect(issues(full,full,value)).toEqual(["claim_literal_source_anchor_missing"]);
      expect(issues(full,full,full)).toEqual([]);
    }
    expect(issues(`-${prefix}${value}`,`${prefix}${value}`,`${prefix}${value}`)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
  }
});
it.each([
  ["รายได้13.5ล้านบาท","13.5"],["เพิ่มขึ้นร้อยละ13.5","13.5"],
  ["ลดลง-13.5ล้านบาท","-13.5"],["กำไร๙๖.๒ล้านบาท","๙๖.๒"],
  ["รายได้９６.２ล้านบาท","９６.２"],["มูลค่า13\u2009500บาท","13\u2009500"]
])("RC5 Thai prose adjacent to a complete literal number: %s",(full,value)=>{
  expect(matches(full,value)).toBe(true);
  expect(issues(full,full,value)).toEqual([]);
  expect(issues(full,value,value)).toEqual([]);
});
it.each([
  ["รายได้113.5ล้านบาท","13.5"],["ลดลง-13.5ล้านบาท","13.5"],
  ["รายได้๙๖.๒ล้านบาท","๖.๒"],["ลดลง-๑๓.๕ล้านบาท","๑๓.๕"],
  ["รายได้13\u2009500บาท","500"],["กำไร(S$13.5)ล้านบาท","13.5"]
])("RC5 Thai adjacency never permits numeric/sign clipping: %s",(full,value)=>{
  expect(matches(full,value)).toBe(false);
  expect(issues(full,value,value)).toEqual(["claim_excerpt_numeric_boundary_invalid"]);
});
it("RC5 Thai adjacency is numeric-only, not word/identifier or semantic unit validation",()=>{
  for(const [full,value] of [["ภาษาไทย","ภาษา"],["ไทย13.5USD","13.5"],["A13.5ล้าน","13.5"],["ไทย13.5_","13.5"]])
    expect(issues(full,full,value)).toEqual(["claim_literal_source_anchor_missing"]);
  const full="รายได้96.2ล้านบาท เพิ่มขึ้นร้อยละ106";
  expect(issues(full,full,"96.2","เพิ่มขึ้นร้อยละ10")).toEqual(["claim_qualification_source_anchor_invalid"]);
  expect(issues(full,full,"96.2","เพิ่มขึ้นร้อยละ106")).toEqual([]);
});
