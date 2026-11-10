import {it,expect} from "vitest";
it.runIf(Boolean(process.env.C1_PILOT_COLD_PATHS))("C1 fresh-process Source/Draft receipt/index/link/trust readback",async()=>{
 const paths=JSON.parse(process.env.C1_PILOT_COLD_PATHS!) as string[];
 const {readNoteRange,readNote}=await import("../vault/notes"),{createReceipt}=await import("../vault/investment-research-context"),{db}=await import("../db");
 const {searchVault}=await import("../vault/queries");
 for(const [i,p] of paths.entries()){
  const text=readNote(p).content,id=createReceipt(i===0?"source_intake":"canonical_review",p,text);
  expect(id).toMatch(/^ICW-/);expect(searchVault("TESTA").hits.some(h=>h.path===p)).toBe(true);
  if(i){
   expect(readNoteRange(p).researchTrust).toMatchObject({research_status:"draft",usage_tier:"historical_analysis_only",comparator_eligible:false,independent_evidence_increment:0,primary_authority:false});
   expect(text).toContain("[["+paths[0].slice(0,-3));
   const event=db().prepare("SELECT detail FROM safe_edit_events WHERE operation_id=? AND event='c1_pilot_write_admitted'").get(id) as {detail:string};
   expect(JSON.parse(event.detail)).toMatchObject({humanPresence:"not_verified",criticIndependence:"not_verified"});
  }
 }
 db().close();
});
