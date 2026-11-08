/** Operational witness for bounded retrieval, not a claim of exhaustive search.
 * Tallies count operations, not unique notes; `read` means a successful result
 * (including search results). Counts survive detail truncation. Never copy
 * filesystem/search exceptions. Bounds/quotas are intentional omissions. */
import {z} from "zod";

const count=z.number().int().nonnegative();
const tally=z.object({attempted:count,read:count,failed:count}).strict();
export const retrievalScopeSchema=z.object({question:z.string().min(3).max(1200),
  issuers:z.array(z.string().max(120)).max(6).optional(),intakeId:z.string().optional(),
  industry:z.string().max(1200).optional(),focus:z.enum(["earnings","broker","tam","macro","thesis","general"]),
  maxNotes:z.number().int().min(5).max(16),maxChars:z.number().int().min(4500).max(18000)}).strict();
type Stage="standalone_source"|"issuer_identity"|"literal_discovery"|"canonical_review"|"bound_source"|"macro_counter"|"selection"|"search";
export const retrievalCoverageSchema=z.object({version:z.literal(1),scope:retrievalScopeSchema,
  status:z.enum(["operational_complete","operational_hold"]),reads:tally,searches:tally,
  selection:tally.extend({selected:count,omitted:count}).strict(),
  failures:z.array(z.object({operation:z.enum(["read","search"]),stage:z.string().max(40),
    path:z.string().max(1000).nullable(),query:z.string().max(1200).nullable(),folder:z.string().max(1000).nullable(),
    reason:z.enum(["readback_unavailable","search_unavailable"])}).strict()).max(64),failuresTruncated:z.boolean()
}).strict();
export type RetrievalCoverage=z.infer<typeof retrievalCoverageSchema>;
export function retrievalOperationallyComplete(value:unknown):value is RetrievalCoverage {
  const parsed=retrievalCoverageSchema.safeParse(value);if(!parsed.success)return false;
  const c=parsed.data;
  return c.status==="operational_complete"&&!c.failures.length&&!c.failuresTruncated&&
    [c.reads,c.searches,c.selection].every(t=>t.failed===0&&t.attempted===t.read)&&
    c.selection.selected<=c.selection.read&&c.selection.attempted<=c.reads.attempted;
}
export class RetrievalObserver {
  readonly reads={attempted:0,read:0,failed:0};
  readonly searches={attempted:0,read:0,failed:0};
  readonly selection={attempted:0,read:0,failed:0};
  private failures:RetrievalCoverage["failures"]=[];
  read<T>(stage:Stage,path:string,run:()=>T):T{return this.observe("read",stage,path,null,null,run);}
  search<T>(stage:Stage,query:string,folder:string|undefined,run:()=>T):T{return this.observe("search",stage,null,query,folder??null,run);}
  private observe<T>(operation:"read"|"search",stage:Stage,path:string|null,query:string|null,folder:string|null,run:()=>T):T {
    const t=operation==="read"?this.reads:this.searches;t.attempted++;
    if(stage==="selection")this.selection.attempted++;
    try{const result=run();t.read++;if(stage==="selection")this.selection.read++;return result;}
    catch(e){t.failed++;if(stage==="selection")this.selection.failed++;
      if(this.failures.length<64)this.failures.push({operation,stage,path:path?.slice(0,1000)??null,
        query:query?.slice(0,1200)??null,folder:folder?.slice(0,1000)??null,
        reason:operation==="read"?"readback_unavailable":"search_unavailable"});
      throw e;
    }
  }
  snapshot(scope:RetrievalCoverage["scope"],selected:number,omitted:number):RetrievalCoverage {
    const failures=this.reads.failed+this.searches.failed;
    return {version:1,scope,status:failures?"operational_hold":"operational_complete",
      reads:{...this.reads},searches:{...this.searches},selection:{...this.selection,selected,omitted},
      failures:[...this.failures],failuresTruncated:failures>this.failures.length};
  }
}
