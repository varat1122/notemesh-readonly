import {afterEach,describe,expect,it,vi} from "vitest";
import {assertM4Window} from "./m4-window";
const start="2026-10-25T10:00:00Z",end="2026-10-25T10:25:00Z";
const t=(s:string)=>Date.parse(s);
function setWindow(a?:string,b?:string){
  if(a===undefined)delete process.env.GIT_RESEARCH_M4_WINDOW_START;else vi.stubEnv("GIT_RESEARCH_M4_WINDOW_START",a);
  if(b===undefined)delete process.env.GIT_RESEARCH_M4_WINDOW_END;else vi.stubEnv("GIT_RESEARCH_M4_WINDOW_END",b);
}
afterEach(()=>{vi.unstubAllEnvs();delete process.env.GIT_RESEARCH_M4_WINDOW_START;delete process.env.GIT_RESEARCH_M4_WINDOW_END;});
describe("M4 short-lived server-side writer window",()=>{
 it("fails closed with missing variables",()=>{
   setWindow();
   expect(()=>assertM4Window("preflight",t("2026-10-25T10:01:00Z"))).toThrow();
   expect(()=>assertM4Window("write",t("2026-10-25T10:01:00Z"))).toThrow();
 });
 it("allows in-window operations but never after expiry or before start",()=>{
   setWindow(start,end);
   expect(()=>assertM4Window("preflight",t(start))).not.toThrow();
   expect(()=>assertM4Window("write",t("2026-10-25T10:02:00Z"))).not.toThrow();
   for(const s of ["2026-10-25T09:59:59Z",end,"2026-10-25T11:00:00Z"])
     expect(()=>assertM4Window("preflight",t(s))).toThrow();
 });
 it("requires two-minute safety reserve before multi-note Apply",()=>{
   setWindow(start,end);
   expect(()=>assertM4Window("preflight",t("2026-10-25T10:24:59Z"))).not.toThrow();
   expect(()=>assertM4Window("write",t("2026-10-25T10:23:01Z"))).toThrow();
   expect(()=>assertM4Window("write",t("2026-10-25T10:23:00Z"))).not.toThrow();
 });
 it("refuses overlong, reversed, malformed and non-UTC intervals",()=>{
   for(const [a,b] of [[start,"2026-10-25T10:35:01Z"],[end,start],["2026-02-30T10:00:00Z",end],["2026-10-25T10:00:00+00:00",end],[start,"invalid"]]){
     setWindow(a,b);
     expect(()=>assertM4Window("preflight",t("2026-10-25T10:05:00Z"))).toThrow();
   }
 });
});
