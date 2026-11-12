import {it,expect} from "vitest";
it.runIf(Boolean(process.env.REVISION_COLD_PATH))("fresh process verifies the create-plus-two-appends receipt chain, index and links",async()=>{
 const {indexedRead,createReceipt}=await import("../vault/investment-research-context");
 const {researchTrust}=await import("../vault/research-state");
 const {db}=await import("../db"),d=db(),p=process.env.REVISION_COLD_PATH!;
 try{
   const note=indexedRead(p);
   expect(createReceipt("canonical_review",p,note.raw)).toBe(process.env.REVISION_COLD_RECEIPT);
   expect(d.prepare("SELECT count(*) AS n FROM safe_edit_operations WHERE json_extract(payload,'$.path')=? AND status='written'").get(p)).toEqual({n:3});
   expect(d.prepare("SELECT path FROM notes_fts WHERE path=? AND notes_fts MATCH 'manual'").get(p)).toEqual({path:p});
   const sources=d.prepare("SELECT resolved_path AS path FROM links WHERE source_path=? AND resolved_path LIKE '00_Inbox/ChatGPT/Investment Intake - %'").all(p) as {path:string}[];
   expect(sources).toHaveLength(2);
   for(const s of sources)expect(createReceipt("source_intake",s.path,indexedRead(s.path).raw)).toMatch(/^ICW-/);
   expect(researchTrust(p,note.fm)).toMatchObject({research_status:"draft",comparator_eligible:false,independent_evidence_increment:0});
 }finally{d.close();}
});
