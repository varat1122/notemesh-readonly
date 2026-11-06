import {it,expect} from "vitest";
import {claimValueAppearsInAnchor as matches} from "./claim-value-anchor";

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
