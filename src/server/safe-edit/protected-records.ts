/** No accepted generic Safe Edit authorization exists for curated timelines or
 * Decision Ledger records. OAuth edit scope, a preview token or the existing
 * Thesis approval page cannot create that missing authority. Read views remain
 * available; historical receipts are not rewritten or deleted. */
export function assertProtectedRecord(path:string,...metadata:Record<string,unknown>[]){
  const file=path.split("/").at(-1)??"";
  const types=metadata.map(fm=>typeof fm.type==="string"?fm.type.trim().toLowerCase():null);
  const timeline=/^(?:Company Evolution - .+|Company Evolution Timeline(?: - .+)?|00_Investment_Evolution_Master(?: - .+)?|.+ - Company Evolution Timeline)\.md$/i.test(file);
  const decision=/^(?:(?:Investment )?Decision Ledger(?: - .+)?|.+ - Decision Ledger)\.md$/i.test(file);
  const typed=types.some(type=>type!==null&&["company_evolution_timeline","investment_evolution_master","decision_ledger"].includes(type));
  if(timeline||decision||typed)throw Error("protected_record_separate_authorization_required");
  // The accepted exact-diff + structured-evidence Thesis workflow is scoped to
  // 05_Thesis. A renamed protected artifact elsewhere must not shed that guard.
  if(!path.startsWith("05_Thesis/")&&(
    /^(?:(?:.+ - )?(?:Current Thesis|Evidence Register))\.md$/i.test(file)||
    types.some(type=>type!==null&&["current_thesis","thesis","evidence_register"].includes(type))))
    throw Error("protected_record_outside_authorized_thesis_scope");
}
