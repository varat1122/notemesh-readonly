import type {PreviewInput} from "./schema";

const primary=(value:unknown)=>value==="verified_against_primary"||value==="verified_primary";
const refusal=()=>Error("Primary verification requires a server-validated primary receipt; generic Safe Edit cannot grant primary authority");

/** Generic Safe Edit has no scoped primary-receipt admission contract. A URL,
 * timestamp, admin diff approval or caller-supplied receipt ID cannot supply it.
 * The canonical research gate validates PEV receipts separately; its notes stay
 * attributed/not_reverified, including when a scoped assessment is approved. */
export function assertDeclaredEvidenceAuthority(evidence:PreviewInput["evidence"]){
  if(primary(evidence?.verification))throw refusal();
}

/** Preserve historical declarations as data, without minting or retargeting
 * them. Covers create, frontmatter, rollback, nested claim metadata and old
 * previews at apply. A body-only edit does not re-certify historical metadata. */
export function assertPrimaryMetadataAuthority(before:Record<string,unknown>,after:Record<string,unknown>){
  // Cyclic/oversized YAML aliases cannot become an unbounded traversal.
  const old=JSON.parse(JSON.stringify(before)) as unknown;
  const next=JSON.parse(JSON.stringify(after)) as unknown;
  function visit(previous:unknown,current:unknown){
    if(!current||typeof current!=="object")return;
    const record=current as Record<string,unknown>;
    if(primary(record.verification)&&JSON.stringify(previous)!==JSON.stringify(current))throw refusal();
    for(const [key,value] of Object.entries(record))visit(
      previous&&typeof previous==="object"?(previous as Record<string,unknown>)[key]:undefined,value);
  }
  visit(old,next);
}
