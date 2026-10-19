/**
 * Index-wide migration READINESS inventory for old Investment_OS knowledge.
 *
 * This counts declared YAML metadata, not semantic linkage, completeness of
 * external sources, or permission to rewrite anything. Missing relation
 * fields signal possible human-review opportunities, NOT broken notes.
 */
import type {SchemaInspection} from "./investment-knowledge-schema";

export type ReadinessRole=SchemaInspection["role"];
export interface ReadinessNote {
  path:string;
  role:ReadinessRole;
  metadata:Record<string,unknown>;
}
type Counter={
  notes:number;
  editableNavigationSources:number;
  explicitEntity:number;
  relatedPathsDeclared:number;
  relatedClaimIdsDeclared:number;
  anyReferenceDeclared:number;
  noReferenceDeclared:number;
  historicalWithoutEntity:number;
  malformedReferenceFields:number;
  eventDateDeclared:number;
  publicationDateDeclared:number;
  importedAtDeclared:number;
  legacyDateWithoutEventDate:number;
};
export interface MetadataReadiness {
  status:"indexed_metadata_readiness_not_verified"|"incomplete_index_hold";
  scanned:number;
  eligibleNavigationSources:number;
  notesWithAnyReference:number;
  notesWithoutReference:number;
  historicalNotesWithoutEntity:number;
  malformedReferenceFields:number;
  byRole:Record<string,Counter>;
  byFolder:Record<string,Counter>;
  examples:{
    historicalWithoutEntity:string[];
    withoutNavigationReferences:string[];
    malformedReferenceFields:string[];
  };
  sampleTruncated:boolean;
  warnings:string[];
  requiresHumanReview:true;
  canAutoWrite:false;
  canAutoUpdateThesis:false;
}
const SAMPLE_LIMIT=8,FOLDER_LIMIT=20,SCAN_LIMIT=10_000;
const SOURCE_ROLES=new Set<ReadinessRole>([
  "historical_analysis","review","industry","company",
]);
const protectedSource=(path:string)=>
  /^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i.test(path);
const scalar=(x:unknown)=>
  typeof x==="string"&&x.trim().length>0;
const fieldState=(v:unknown):"absent"|"declared"|"malformed"=>{
  if(v===undefined||v===null)return "absent";
  if(!Array.isArray(v)||v.length>40||v.some(s=>!scalar(s)))return "malformed";
  return v.length?"declared":"absent";
};
const empty=():Counter=>({
  notes:0,editableNavigationSources:0,explicitEntity:0,
  relatedPathsDeclared:0,relatedClaimIdsDeclared:0,anyReferenceDeclared:0,
  noReferenceDeclared:0,historicalWithoutEntity:0,malformedReferenceFields:0,
  eventDateDeclared:0,publicationDateDeclared:0,importedAtDeclared:0,
  legacyDateWithoutEventDate:0,
});
const sample=(arr:string[],path:string)=>{
  if(arr.length<SAMPLE_LIMIT)arr.push(path);
};
export function inventoryVaultMetadataReadiness(
  notes:readonly ReadinessNote[],
  indexComplete:boolean,
):MetadataReadiness {
  const report:MetadataReadiness={
    status:indexComplete&&notes.length<=SCAN_LIMIT?
      "indexed_metadata_readiness_not_verified":"incomplete_index_hold",
    scanned:notes.length,eligibleNavigationSources:0,notesWithAnyReference:0,
    notesWithoutReference:0,historicalNotesWithoutEntity:0,malformedReferenceFields:0,
    byRole:{},byFolder:{},
    examples:{historicalWithoutEntity:[],withoutNavigationReferences:[],malformedReferenceFields:[]},
    sampleTruncated:false,
    warnings:[
      "Only indexed note-declared frontmatter is counted; body, semantics and primary-source bytes have NOT been independently verified.",
      "A missing related_paths or related_claim_ids field is not proof of a broken/missing link, nor a mandate to edit the note.",
      "Historical notes without a declared entity need manual classification; never guess a ticker from title or co-mentions.",
      "The coverage sample is bounded and cannot authorize automatic bulk migration, edits to protected files or thesis changes.",
    ],
    requiresHumanReview:true,canAutoWrite:false,canAutoUpdateThesis:false,
  };
  if(report.status!=="indexed_metadata_readiness_not_verified")return report;
  const byFolder=new Map<string,Counter>();
  const ordered=notes.slice().sort((a,b)=>a.path.localeCompare(b.path));
  for(const n of ordered){
    const role=report.byRole[n.role]??(report.byRole[n.role]=empty());
    const folder=n.path.split("/")[0]||"(root)";
    const group=byFolder.get(folder)??empty();
    byFolder.set(folder,group);
    role.notes++;group.notes++;
    const meta=n.metadata;
    const declaredEntity=scalar(meta.entity);
    const paths=fieldState(meta.related_paths);
    const claims=fieldState(meta.related_claim_ids);
    const eligible=SOURCE_ROLES.has(n.role)&&!protectedSource(n.path);
    const historicalMissing=n.role==="historical_analysis"&&eligible&&!declaredEntity;
    const malformed=eligible&&(paths==="malformed"||claims==="malformed");
    const any=paths==="declared"||claims==="declared";
    const event=scalar(meta.event_date),published=scalar(meta.published_at),imported=scalar(meta.imported_at);
    const legacy=scalar(meta.date)&&!event;
    for(const group of [role,byFolder.get(folder)!]){
      if(declaredEntity)group.explicitEntity++;
      if(event)group.eventDateDeclared++;
      if(published)group.publicationDateDeclared++;
      if(imported)group.importedAtDeclared++;
      if(legacy)group.legacyDateWithoutEventDate++;
      if(!eligible)continue;
      group.editableNavigationSources++;
      if(paths==="declared")group.relatedPathsDeclared++;
      if(claims==="declared")group.relatedClaimIdsDeclared++;
      if(any)group.anyReferenceDeclared++;
      else group.noReferenceDeclared++;
      if(historicalMissing)group.historicalWithoutEntity++;
      if(malformed)group.malformedReferenceFields++;
    }
    if(!eligible)continue;
    report.eligibleNavigationSources++;
    if(any)report.notesWithAnyReference++;else report.notesWithoutReference++;
    if(historicalMissing){
      report.historicalNotesWithoutEntity++;
      sample(report.examples.historicalWithoutEntity,n.path);
    }
    if(!any)sample(report.examples.withoutNavigationReferences,n.path);
    if(malformed){
      report.malformedReferenceFields++;
      sample(report.examples.malformedReferenceFields,n.path);
    }
  }
  report.sampleTruncated=report.historicalNotesWithoutEntity>SAMPLE_LIMIT||
    report.notesWithoutReference>SAMPLE_LIMIT||report.malformedReferenceFields>SAMPLE_LIMIT;
  report.byFolder=Object.fromEntries([...byFolder].sort(
    (a,b)=>b[1].notes-a[1].notes||a[0].localeCompare(b[0]),
  ).slice(0,FOLDER_LIMIT));
  return report;
}
