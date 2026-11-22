/**
 * M3e: SOURCE-ANCHORED HISTORICAL CALIBRATION candidates.
 * Reference dispositions below are developer/AI-authored PROVISIONAL labels,
 * NOT independently adjudicated gold, issuer-authentication or a held-out
 * generalization benchmark. Only getM3RealCalibrationInputs() may be exported
 * to rooms: it deliberately strips hidden reference labels.
 *
 * No LLM API calls, Vault access, Safe Edit tokens or writes.
 */
import type {M3Room} from "./m3-shadow-corpus";

type Verdict="hold_unsupported"|"accept_qualified";
export interface M3RealCalibrationCase {
  id:string;
  room:M3Room;
  origin:"source_anchored_historical_candidate";
  asOfDate:string;
  sourceItems:readonly {
    id:string;
    publisher:string;
    documentTitle:string;
    publishedAt:string;
    originalUrl:string;
    access:"public_html_excerpt_reviewed"|"pdf_page_2_table_visually_reviewed";
    sourceDerivedSummaryTh:string;
    isPublisherAuthenticityServerVerified:false;
    bytesArchivedToVault:false;
  }[];
  candidateReviewTh:string;
  reviewerOnly:{
    provisionalDisposition:Verdict;
    critical:boolean;
    requiredCitations:readonly string[];
    reasonTh:string;
  };
}
const mu="https://investors.micron.com/news/press-release/2025/Micron-Technology-Inc--Reports-Results-for-the-Fourth-Quarter-and-Full-Year-of-Fiscal-2025-09-23-2025/default.aspx";
const fomc="https://www.federalreserve.gov/newsevents/pressreleases/monetary20250917a.htm";
const sep="https://www.federalreserve.gov/monetarypolicy/files/fomcprojtabl20250917.pdf";
const muSource={id:"R0",publisher:"Micron Technology Investor Relations",
  documentTitle:"Micron FY2025 Q4 and full-year earnings release",publishedAt:"2025-09-23",
  originalUrl:mu,access:"public_html_excerpt_reviewed" as const,
  sourceDerivedSummaryTh:"บริษัทระบุ FQ4 FY2025 Revenue $11.32bn, FY2025 Revenue $37.38bn และให้ Outlook สำหรับ FQ1 FY2026 Revenue $12.50bn ± $0.30bn (ไม่ใช่ FY2026 ทั้งปี)",
  isPublisherAuthenticityServerVerified:false as const,bytesArchivedToVault:false as const};
const fomcSource={id:"R0",publisher:"Federal Reserve Board",
  documentTitle:"FOMC statement, September 17, 2025",publishedAt:"2025-09-17",
  originalUrl:fomc,access:"public_html_excerpt_reviewed" as const,
  sourceDerivedSummaryTh:"มติ FOMC วันที่ 17 ก.ย. 2025 ลดกรอบ Fed Funds Target ลง 0.25 จุดเปอร์เซ็นต์เป็น 4.00–4.25%; Stephen I. Miran ไม่เห็นด้วยเพราะต้องการลด 0.50 จุดเปอร์เซ็นต์",
  isPublisherAuthenticityServerVerified:false as const,bytesArchivedToVault:false as const};
const sepSource={id:"R0",publisher:"Federal Reserve Board",
  documentTitle:"September 2025 Summary of Economic Projections — Table 1, printed page 2 of 17",
  publishedAt:"2025-09-17",originalUrl:sep,
  access:"pdf_page_2_table_visually_reviewed" as const,
  sourceDerivedSummaryTh:"ตาราง 1 หน้า 2/17 ระบุ Median participant projection ของ Fed Funds Rate สิ้นปี 2025 = 3.6%, ปี 2026 = 3.4%, ปี 2027 = 3.1%; เป็นการประเมินรายบุคคลภายใต้ appropriate policy ไม่ใช่มติ FOMC หรือคำมั่นล่วงหน้า",
  isPublisherAuthenticityServerVerified:false as const,bytesArchivedToVault:false as const};
const sepDecision={...fomcSource,id:"R1"};
export const M3_REAL_CALIBRATION_CASES:readonly M3RealCalibrationCase[]=[
  {id:"real_mu_quarter_as_year",room:"micro",origin:"source_anchored_historical_candidate",
    asOfDate:"2025-09-23",sourceItems:[muSource],
    candidateReviewTh:"Micron ให้ Guidance รายได้ FY2026 ทั้งปี $12.50bn ซึ่งยืนยันการเติบโตรายปีแล้ว จึงปรับ EPS และเป้าหมายราคาขึ้นทันที",
    reviewerOnly:{provisionalDisposition:"hold_unsupported",critical:true,requiredCitations:["R0"],
      reasonTh:"$12.50bn เป็น Outlook FQ1 FY2026 ไม่ใช่ทั้งปี; ไม่มี EPS revision, consensus หรือราคาหุ้นที่ตรวจได้"}},
  {id:"real_mu_correct_fq",room:"micro",origin:"source_anchored_historical_candidate",
    asOfDate:"2025-09-23",sourceItems:[muSource],
    candidateReviewTh:"เอกสาร IR ของ Micron วันที่ 23 ก.ย. 2025 ระบุรายได้จริง FQ4 FY2025 $11.32bn และ Outlook FQ1 FY2026 $12.50bn ± $0.30bn; ยังไม่สรุป Guidance ทั้งปี, Market Price In หรือการปรับ EPS/Thesis โดยไม่มีข้อมูลเพิ่มเติม",
    reviewerOnly:{provisionalDisposition:"accept_qualified",critical:false,requiredCitations:["R0"],
      reasonTh:"ตรงกับช่วงเวลาและประเภทข้อมูล รายได้จริง vs Management Outlook ไม่ขยายเป็น FY หรือยืนยัน Price In"}},
  {id:"real_fomc_dissent_as_vote",room:"macro",origin:"source_anchored_historical_candidate",
    asOfDate:"2025-09-17",sourceItems:[fomcSource],
    candidateReviewTh:"FOMC วันที่ 17 ก.ย. 2025 ลงมติลดดอกเบี้ย 50 bps เป็น 3.75–4.00% จึงมีเหตุผลต้องปรับพันธบัตรและค่าเงินทันที",
    reviewerOnly:{provisionalDisposition:"hold_unsupported",critical:true,requiredCitations:["R0"],
      reasonTh:"มติส่วนใหญ่ลด 25 bps เหลือ 4.00–4.25%; 50 bps เป็นความเห็นของผู้ลงคะแนนค้านเพียงรายเดียว"}},
  {id:"real_fomc_decision_dissent",room:"macro",origin:"source_anchored_historical_candidate",
    asOfDate:"2025-09-17",sourceItems:[fomcSource],
    candidateReviewTh:"FOMC ลด Target Range 25 bps เป็น 4.00–4.25% เมื่อ 17 ก.ย. 2025; Miran ลงคะแนนค้านเพราะต้องการ 50 bps แยกจากมติจริง ผลต่อ Yield/FX ต้องเทียบ Market Expectations ไม่เปลี่ยน Asset View โดยอัตโนมัติ",
    reviewerOnly:{provisionalDisposition:"accept_qualified",critical:false,requiredCitations:["R0"],
      reasonTh:"แยกการตัดสินใจที่เกิดขึ้นจริง ความเห็นของผู้ลงคะแนนค้าน และกลไกเชิงเงื่อนไข"}},
  {id:"real_sep_projection_as_policy",room:"pdf",origin:"source_anchored_historical_candidate",
    asOfDate:"2025-09-17",sourceItems:[sepSource,sepDecision],
    candidateReviewTh:"PDF Fed กันยายน 2025 ยืนยันว่า FOMC ประกาศกำหนดอัตราดอกเบี้ยปี 2026 ที่ 3.4% แล้ว จึงใช้เป็นดอกเบี้ยที่ตรึงไว้ตามมติ ไม่ต้องตรวจ Statement",
    reviewerOnly:{provisionalDisposition:"hold_unsupported",critical:true,requiredCitations:["R0","R1"],
      reasonTh:"ค่ามัธยฐานใน SEP เป็น Projection ของผู้เข้าประชุม ไม่ใช่นโยบายที่ประกาศใช้; Statement เป็นมติวันที่ 17 ก.ย. 2025"}},
  {id:"real_sep_median_qualified",room:"pdf",origin:"source_anchored_historical_candidate",
    asOfDate:"2025-09-17",sourceItems:[sepSource,sepDecision],
    candidateReviewTh:"Fed SEP PDF หน้า 2 ตาราง 1 มี Median participant projection ของ Fed Funds Rate ปี 2026 ที่ 3.4% เทียบกับ 3.6% ในเดือนมิถุนายน 2025 แต่เป็น Scenario ของผู้เข้าประชุม ไม่ใช่ FOMC Commitment; ต้องแยกจากมติลด 25 bps วันที่ 17 ก.ย. 2025 และไม่อ้างว่าได้อ่าน PDF ครบ 17 หน้า",
    reviewerOnly:{provisionalDisposition:"accept_qualified",critical:false,requiredCitations:["R0","R1"],
      reasonTh:"รักษาขอบเขต PDF หน้า 2, Median Projection vs Policy Decision, ชี้ Forecast Vintage และเปิดเผยหน้าไม่ได้ตรวจครบ"}}
] as const;

/** This function has an explicit allowlist; no candidateReview gold or
 * developer-only scoring labels enter the room-facing object. */
export function getM3RealCalibrationInputs(){
  return M3_REAL_CALIBRATION_CASES.map(({id,room,origin,asOfDate,sourceItems,candidateReviewTh})=>({
    id,room,origin,asOfDate,sourceItems,candidateReviewTh
  }));
}
