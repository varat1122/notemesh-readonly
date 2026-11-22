import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** RI-011C controlled out-of-sample fixtures, NOT independent blinded evaluation. */
let root: string, vault: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ri011c-replay-")));
  vault = path.join(root, "vault");
  fs.mkdirSync(vault, {recursive:true});
  process.env.DATA_DIR = root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32,4).toString("base64");
  vi.resetModules();
});
afterEach(() => {fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(file:string,body:string) {
  const dest=path.join(vault,file);fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,body,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(file);
}
type Row={entity:string;metric:string;period:string;source:string;value:string;unit:string};
function note(r:Row) {
  return ["---",`entity: ${r.entity}`,`metric: ${r.metric}`,`period: ${r.period}`,
    `original_source: ${r.source}`,`value: "${r.value}"`,`unit: ${r.unit}`,
    "verification: not_reverified","---",`# ${r.entity} ${r.period}`,
    "Synthetic indexed test row; not primary-source authentication."].join("\n");
}
const AMZN="https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-Second-Quarter-Results/default.aspx?mode=light";
const MSFT="https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast";
const TSMC="https://investor.tsmc.com/english/quarterly-results/2026/q3";
const E="https://www.tipranks.com/news/the-fly/apple-price-target-raised-to-380-from-365-at-evercore-isi-thefly-news";
const J="https://stockanalysis.com/stocks/aapl/forecast/";
const params=(r:Row)=>({domain:"company" as const,entity:r.entity,metric:r.metric,period:r.period,
  originalSource:r.source,statement:"Synthetic replay for bounded read-only claim reconciliation.",value:r.value,unit:r.unit});
const amzn:Row={entity:"AMZN",metric:"net_sales",period:"Q2_2026_ended_2026-06-30",source:AMZN,value:"200.6",unit:"USD billions"};
const msft:Row={entity:"MSFT",metric:"commercial_rpo",period:"FY26Q4_ended_2026-06-30",source:MSFT,value:"678",unit:"USD billions"};
const tsmc:Row={entity:"TSMC",metric:"net_revenue_actual",period:"2026Q3_ended_2026-09-30",source:TSMC,value:"46.72",unit:"USD billions"};

describe("RI-011C fresh-source-scope controlled replay",()=>{
  it("AMZN exact same-source actual is a candidate only",async()=>{
    await add("10_Knowledge/Company Research/AMZN Revenue.md",note(amzn));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const x=hybridClaimPreview(params(amzn));
    expect(x.classification).toBe("DUPLICATE_CANDIDATE");
    expect(x.gates.claimVerifiedAgainstOriginal).toBe(false);
    expect(x.gates.canAutoWrite).toBe(false);
  });
  it("AMZN segment AWS is not total company net sales",async()=>{
    await add("10_Knowledge/Company Research/AMZN Revenue.md",note(amzn));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const x=hybridClaimPreview(params({...amzn,metric:"aws_segment_revenue",value:"42.2"}));
    expect(x.classification).not.toBe("DUPLICATE_CANDIDATE");
  });
  it("AMZN TTM free cash flow is not quarterly free cash flow",async()=>{
    const row:Row={...amzn,metric:"free_cash_flow",period:"TTM_ended_2026-06-30",value:"-7.6"};
    await add("10_Knowledge/Company Research/AMZN FCF.md",note(row));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    expect(hybridClaimPreview(params({...row,period:"Q2_2026_ended_2026-06-30"})).classification).not.toBe("DUPLICATE_CANDIDATE");
  });
  it("AMZN non-operating gain is not recurring operating earnings",async()=>{
    const row:Row={...amzn,metric:"non_operating_pretax_other_income",value:"53.4"};
    await add("10_Knowledge/Company Research/AMZN Gains.md",note(row));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    expect(hybridClaimPreview(params({...row,metric:"operating_income"})).classification).not.toBe("DUPLICATE_CANDIDATE");
  });
  it("MSFT RPO is not realized revenue even with same number",async()=>{
    await add("10_Knowledge/Company Research/MSFT RPO.md",note(msft));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    expect(hybridClaimPreview(params(msft)).classification).toBe("DUPLICATE_CANDIDATE");
    expect(hybridClaimPreview(params({...msft,metric:"recognized_revenue"})).classification).not.toBe("DUPLICATE_CANDIDATE");
  });
  it("MSFT different quarter cannot be promoted to duplicate",async()=>{
    await add("10_Knowledge/Company Research/MSFT RPO.md",note(msft));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    expect(hybridClaimPreview(params({...msft,period:"FY26Q3"})).classification).not.toBe("DUPLICATE_CANDIDATE");
  });
  it("TSMC actual quarter differs from Q4 forward guidance",async()=>{
    await add("10_Knowledge/Company Research/TSMC Actual.md",note(tsmc));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    expect(hybridClaimPreview(params({...tsmc,metric:"revenue_guidance_midpoint",period:"2026Q4",value:"53.3"})).classification).not.toBe("DUPLICATE_CANDIDATE");
  });
  it("TSMC same metric and period contradictory amount must hold",async()=>{
    await add("10_Knowledge/Company Research/TSMC Actual.md",note(tsmc));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const x=hybridClaimPreview(params({...tsmc,value:"46.20"}));
    expect(x.classification).toBe("HOLD_CONFLICTING_CANDIDATES");
    expect(x.gates.canAutoWrite).toBe(false);
  });
  it("Evercore and JPM cannot be one broker price target event",async()=>{
    const row:Row={entity:"AAPL",metric:"broker_price_target",period:"2026-09-18",source:E,value:"380",unit:"USD per share"};
    await add("10_Knowledge/Company Research/AAPL Evercore.md",note(row));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const x=hybridClaimPreview(params({...row,source:J,value:"360",period:"2026-10-12"}));
    expect(x.classification).not.toBe("DUPLICATE_CANDIDATE");
    expect(x.gates.sourceAuthenticated).toBe(false);
  });
  it("archived CRWD broker repeat is only historical candidate",async()=>{
    await add("07_Sources/ChatGPT/Entries/CRWD Bernstein archived.md",
      "# CRWD Bernstein 2026-09-20\nArchived repeated broker commentary, no original PDF.");
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const x=hybridClaimPreview({domain:"company",entity:"CRWD",metric:"broker_rating",period:"2026-09-20",
      originalSource:"https://example.org/unverified-broker-comment",
      statement:"Archived commentary without original brokerage document.",searchQueries:["CRWD Bernstein"]});
    expect(x.classification).toBe("HISTORICAL_NOTE_CANDIDATE");
    expect(x.gates.independentEvidenceEstablished).toBe(false);
  });
  it("German factory orders composition differs from headline orders",async()=>{
    const row:Row={entity:"Germany",metric:"factory_orders_headline_mom",period:"2026-10-06",
      source:"https://www.destatis.de/EN/Home/_node.html",value:"-10.6",unit:"percent"};
    await add("10_Knowledge/Macro and Markets/Germany orders.md",note(row));
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const x=hybridClaimPreview({...params({...row,metric:"factory_orders_ex_large_mom",value:"-0.1"}),domain:"macro"});
    expect(x.classification).not.toBe("DUPLICATE_CANDIDATE");
    expect(x.gates.canEditPortfolio).toBe(false);
  });
  it("Vietnam cash balance does not prove investor transferred cash into bank",async()=>{
    await add("10_Knowledge/Macro and Markets/Vietnam 2026 liquidity.md",
      "# Vietnam FiinTrade brokerage cash 2026\nClient balances changed; cash destination unknown.");
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const x=hybridClaimPreview({domain:"macro",entity:"Vietnam",metric:"broker_cash_change_yoy",period:"2026Q3",
      value:"-67.5",unit:"VND trillions",
      originalSource:"https://nguoiquansat.vn/67-500-ty-dong-tien-gui-cua-nha-dau-tu-roi-cac-cong-ty-chung-khoan-sau-mot-nam-324419.html",
      statement:"News attributes balance to FiinTrade, but original numbers have not been separately validated.",
      searchQueries:["Vietnam FiinTrade brokerage cash"]});
    expect(x.classification).toBe("HISTORICAL_NOTE_CANDIDATE");
    expect(x.gates.canAutoWrite).toBe(false);
  });
});