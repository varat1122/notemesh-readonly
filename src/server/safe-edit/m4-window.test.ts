import {describe,it,expect,afterEach} from "vitest";
import {m4WindowInfo,assertM4Window} from "./m4-window";
const prev={start:process.env.GIT_RESEARCH_M4_WINDOW_START,end:process.env.GIT_RESEARCH_M4_WINDOW_END};
afterEach(()=>{
 if(prev.start===undefined)delete process.env.GIT_RESEARCH_M4_WINDOW_START;else process.env.GIT_RESEARCH_M4_WINDOW_START=prev.start;
 if(prev.end===undefined)delete process.env.GIT_RESEARCH_M4_WINDOW_END;else process.env.GIT_RESEARCH_M4_WINDOW_END=prev.end;
});
describe("M4.6 safe owner UI deadline",()=>{
 it("shows the true two-minute reserve and disables Apply even while preflight is still open",()=>{
  process.env.GIT_RESEARCH_M4_WINDOW_START="2026-10-25T03:45:00Z";
  process.env.GIT_RESEARCH_M4_WINDOW_END="2026-10-25T04:05:00Z";
  const before=Date.parse("2026-10-25T04:02:59Z");
  const late=Date.parse("2026-10-25T04:03:00Z");
  const safe=m4WindowInfo(before)!;
  expect(safe.applyUntil).toBe("2026-10-25T04:03:00.000Z");
  expect(safe.applyUntilLocal).toContain("11:03");
  expect(safe.writeOpen).toBe(true);
  expect(safe.previewOpen).toBe(false);
  expect(m4WindowInfo(late)?.writeOpen).toBe(false);
  expect(()=>assertM4Window("write",late)).toThrow(/closed/);
  expect(()=>assertM4Window("preflight",late)).not.toThrow();
 });
 it("fails closed on malformed, too-long and expired configured windows",()=>{
  process.env.GIT_RESEARCH_M4_WINDOW_START="2026-10-25T03:00:00Z";
  process.env.GIT_RESEARCH_M4_WINDOW_END="2026-10-25T04:05:00Z";
  expect(m4WindowInfo()).toBeNull();
  process.env.GIT_RESEARCH_M4_WINDOW_END="bad";
  expect(m4WindowInfo()).toBeNull();
 });
});
