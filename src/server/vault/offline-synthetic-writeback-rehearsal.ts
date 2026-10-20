/**
 * PR #99 — EPHEMERAL / SYNTHETIC ONLY two-note Safe Writeback rehearsal.
 *
 * Uses PR #98's physically checked canonical routing, then copies a declared
 * synthetic offline snapshot into a PRIVATE temporary worktree. The source
 * snapshot is never written. No API, MCP writer, real Vault or approved
 * Thesis/Portfolio write. Each call removes the worktree (success or failure).
 *
 * Two files, one SQLite/FTS index transaction, exact-path reciprocal link
 * verification, post-write snapshot reconciliation and simulated failpoints.
 * This is NOT an atomic multi-file production transaction or owner consent.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {planOfflineCanonicalInvestmentAutolinks,
  type OfflineCanonicalAutolinkInput}
  from "./offline-canonical-autolink-writeback-plan";
import {verifyOfflineSnapshotCoverage}
  from "./snapshot-coverage-acceptance";
import {extractStructure,splitFrontmatter} from "./markdown";
import {countWords} from "./text";

type FailurePoint="after_analysis_note"|"after_timeline_append"|
  "after_sqlite_index";
export type OfflineSyntheticWritebackInput=OfflineCanonicalAutolinkInput&{
  rehearsal?:{injectFailureAt?:FailurePoint};
};
const hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const ref=(p:string)=>"[["+p.slice(0,-3)+"]]";
type IndexRow={rowid:number;path:string};
type LinkRow={target:string;resolved_path:string|null};
function updateIndexedNote(d:Database.Database,root:string,p:string){
  const file=path.join(root,"vault",...p.split("/"));
  const bytes=fs.readFileSync(file);
  if(bytes.includes(0)||bytes.length>800_000)
    throw Error("writeback_rehearsal_invalid_markdown_bytes_hold");
  const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  const parsed=splitFrontmatter(raw);
  if(parsed.invalid||parsed.fmOffset<1)
    throw Error("writeback_rehearsal_invalid_frontmatter_hold");
  const parsedBody=extractStructure(parsed.body);
  const stat=fs.statSync(file);
  const title=path.basename(p,".md").normalize("NFC");
  const row=d.prepare(`
    INSERT INTO notes (path,title,mtime,size,frontmatter,word_count,
      modified,created)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(path) DO UPDATE SET title=excluded.title,
      mtime=excluded.mtime,size=excluded.size,
      frontmatter=excluded.frontmatter,word_count=excluded.word_count,
      modified=excluded.modified
    RETURNING rowid
  `).get(p,title,Math.round(stat.mtimeMs),stat.size,
    JSON.stringify(parsed.data),countWords(parsed.body),
    Math.round(stat.mtimeMs),Math.round(stat.birthtimeMs)) as {rowid:number};
  d.prepare("DELETE FROM notes_fts WHERE rowid=?").run(row.rowid);
  d.prepare(`INSERT INTO notes_fts
    (rowid,path,title,headings,body) VALUES (?,?,?,?,?)`).run(
      row.rowid,p,title,parsedBody.headings.map(h=>h.text).join("\n"),
      parsed.body);
  d.prepare("DELETE FROM links WHERE source_path=?").run(p);
  for(const target of parsedBody.links)
    d.prepare(`INSERT OR IGNORE INTO links
      (source_path,target,resolved_path) VALUES (?,?,NULL)`).run(p,target);
  d.prepare("DELETE FROM tags WHERE path=?").run(p);
  for(const tag of parsedBody.tags)
    d.prepare("INSERT OR IGNORE INTO tags(path,tag) VALUES (?,?)")
      .run(p,tag);
  d.prepare("DELETE FROM tasks WHERE path=?").run(p);
  for(const task of parsedBody.tasks)
    d.prepare(`INSERT OR REPLACE INTO tasks(path,line,text,done)
      VALUES (?,?,?,?)`).run(p,task.line+parsed.fmOffset,task.text,
        task.done?1:0);
}
export function rehearseOfflineSyntheticInvestmentWriteback(
  input:OfflineSyntheticWritebackInput,
){
  const issuer=input?.claims?.[0]?.candidate?.source?.review?.evidence
    ?.incoming?.entity;
  // Strong rehearsal boundary: this function deliberately cannot be
  // reused as a generic real-issuer writer. Production needs a distinct,
  // permission-checked implementation and rollback/locking design.
  if(issuer!=="SYNTH"||process.env.RAILWAY_PROJECT_ID||
    process.env.RAILWAY_ENVIRONMENT_ID||process.env.RAILWAY_SERVICE_ID)
    throw Error("writeback_rehearsal_synthetic_issuer_only_hold");
  const root=fs.realpathSync(
    input.claims[0].candidate.source.review.evidence.snapshotRoot);
  if(root!==fs.realpathSync(os.tmpdir())&&
    !root.startsWith(fs.realpathSync(os.tmpdir())+path.sep))
    throw Error("writeback_rehearsal_requires_os_temp_snapshot_hold");
  const failpoint=input.rehearsal?.injectFailureAt;
  if(input.rehearsal&&(
    Object.keys(input.rehearsal).some(k=>k!=="injectFailureAt")||
    (failpoint!==undefined&&
      !["after_analysis_note","after_timeline_append",
        "after_sqlite_index"].includes(failpoint))))
    throw Error("writeback_rehearsal_unknown_failpoint_hold");

  const preview=planOfflineCanonicalInvestmentAutolinks(input);
  const targets=input.routing.targets;
  const analysis=input.routing.proposedAnalysisNotePath;
  const timeline=targets.find(t=>t.role==="company_evolution");
  if(!timeline)throw Error("writeback_rehearsal_no_canonical_timeline_hold");
  const incoming=input.claims[0].candidate.source.review.evidence.incoming;
  const op=input.routing.operationId;
  const operationMarker="<!-- investment-os-operation:"+op+" -->";
  const eventMarker="<!-- investment-os-event:"+incoming.eventKey+" -->";
  const allTargetLinks=targets.map(t=>ref(t.path));
  const analysisLink=ref(analysis);
  const scaffold=[
    "---",
    "type: investment_review",
    "entity: "+issuer,
    "event_key: "+incoming.eventKey,
    "verification: unverified",
    "status: draft",
    "source_type: user_supplied",
    "operation_id: "+op,
    "---",
    "# Synthetic Investment Review",
    operationMarker,eventMarker,
    "This is an unverified synthetic review index, NOT issuer facts.",
    "No free-form model claims, protected Thesis excerpts or decisions.",
    "## Canonical references",
    ...allTargetLinks,
    "## Investment interpretation",
    "Causal hypotheses and Thesis impact require analyst and owner review.",
    "",
  ].join("\n");
  // Every link in the note must be a previously checked candidate
  // destination. Prompt/model text is deliberately NOT interpolated.
  const structured=extractStructure(splitFrontmatter(scaffold).body);
  if(structured.links.length!==targets.length||
    structured.links.some((t,i)=>t!==targets[i].path.slice(0,-3)))
    throw Error("writeback_rehearsal_link_scaffold_mismatch_hold");
  const workspace=fs.mkdtempSync(
    path.join(os.tmpdir(),"nm-synthetic-writeback-"));
  const workVault=path.join(workspace,"vault");
  const workspaceDb=path.join(workspace,"app.sqlite");
  try{
    fs.cpSync(path.join(root,"vault"),workVault,
      {recursive:true,preserveTimestamps:true,errorOnExist:true});
    fs.copyFileSync(path.join(root,"app.sqlite"),workspaceDb);
    const originalTimeline=fs.readFileSync(
      path.join(workVault,timeline.path),"utf8");
    if(hash(originalTimeline)!==timeline.expectedSha256||
      originalTimeline.includes(operationMarker)||
      originalTimeline.includes(eventMarker))
      throw Error("writeback_rehearsal_timeline_version_or_replay_hold");

    const analysisFile=path.join(workVault,analysis);
    // Keep the existing canonical parent directory unchanged.
    if(!fs.statSync(path.dirname(analysisFile)).isDirectory()||
      fs.existsSync(analysisFile))
      throw Error("writeback_rehearsal_analysis_target_collision_hold");
    fs.writeFileSync(analysisFile,scaffold,{flag:"wx",mode:0o600});
    if(failpoint==="after_analysis_note")
      throw Error("writeback_rehearsal_injected_after_analysis_note");

    const tail=[
      "",
      operationMarker,eventMarker,
      "- "+analysisLink+" — synthetic, unverified; review required.",
      "",
    ].join("\n");
    const timelineFile=path.join(workVault,timeline.path);
    // No rewrite of previous events: append only, on a disposable copy.
    fs.appendFileSync(timelineFile,tail,{encoding:"utf8"});
    if(failpoint==="after_timeline_append")
      throw Error("writeback_rehearsal_injected_after_timeline_append");

    const d=new Database(workspaceDb,{fileMustExist:true});
    try{
      d.transaction(()=>{
        updateIndexedNote(d,workspace,analysis);
        updateIndexedNote(d,workspace,timeline.path);
        const paths=d.prepare("SELECT path FROM notes").all() as IndexRow[];
        const full=new Map(paths.map(x=>
          [x.path.normalize("NFC").toLowerCase(),x.path]));
        for(const source of [analysis,timeline.path]){
          const rows=d.prepare(`SELECT target FROM links
            WHERE source_path=?`).all(source) as {target:string}[];
          for(const row of rows){
            const resolved=full.get((row.target+".md")
              .normalize("NFC").toLowerCase())??null;
            // New link destinations are exact path matches. Any prior
            // unrelated unresolved links remain unresolved.
            d.prepare(`UPDATE links SET resolved_path=?
              WHERE source_path=? AND target=?`).run(
                resolved,source,row.target);
          }
        }
      })();
      if(failpoint==="after_sqlite_index")
        throw Error("writeback_rehearsal_injected_after_sqlite_index");

      const outgoing=d.prepare(`SELECT target,resolved_path FROM links
        WHERE source_path=?`).all(analysis) as LinkRow[];
      for(const t of targets){
        const link=t.path.slice(0,-3);
        if(!outgoing.some(x=>x.target===link&&
          x.resolved_path===t.path))
          throw Error("writeback_rehearsal_outgoing_link_unresolved_hold");
      }
      const back=d.prepare(`SELECT target,resolved_path FROM links
        WHERE source_path=?`).all(timeline.path) as LinkRow[];
      if(!back.some(x=>x.target===analysis.slice(0,-3)&&
        x.resolved_path===analysis))
        throw Error("writeback_rehearsal_timeline_backlink_missing_hold");
      const analysisStat=d.prepare(
        "SELECT rowid,path FROM notes WHERE path=?").get(analysis) as
        IndexRow|undefined;
      const fts=analysisStat&&d.prepare(
        "SELECT body FROM notes_fts WHERE rowid=?")
        .get(analysisStat.rowid) as {body:string}|undefined;
      if(!fts||!fts.body.includes(operationMarker))
        throw Error("writeback_rehearsal_fts_not_reindexed_hold");
    }finally{d.close();}

    const check=verifyOfflineSnapshotCoverage(workspace);
    if(check.status!==
      "snapshot_markdown_index_reconciled_not_originals_verified")
      throw Error("writeback_rehearsal_index_readback_hold");
    const original=verifyOfflineSnapshotCoverage(root);
    if(original.markdownContentManifestSha256!==
      preview.sourceSnapshotSha256)
      throw Error("writeback_rehearsal_input_snapshot_mutated_hold");

    const recorded=fs.readFileSync(analysisFile,"utf8");
    const timelineNow=fs.readFileSync(timelineFile,"utf8");
    if(hash(recorded)!==hash(scaffold)||
      timelineNow!==originalTimeline+tail||
      timelineNow.split(operationMarker).length!==2||
      timelineNow.split(eventMarker).length!==2)
      throw Error("writeback_rehearsal_exact_readback_hold");
    return {
      status:"ephemeral_synthetic_writeback_rehearsal_verified" as const,
      operationIdSha256:preview.operationIdSha256,
      eventKeySha256:preview.eventKeySha256,
      sourceManifestUnchanged:true as const,
      sandboxNotesWrittenAndReadbackVerified:2 as const,
      sandboxOutgoingLinksResolved:targets.length,
      sandboxCompanyTimelineBacklinkResolved:true as const,
      sandboxMarkdownSqliteFtsReconciled:true as const,
      sandboxReadbackVerified:true as const,
      sandboxFilesDiscardedOnFunctionReturn:true as const,
      syntheticIssuerOnly:true as const,
      protectedThesisEvidenceRegisterAndPortfolioNotWritten:true as const,
      originalPublisherSourceNotAuthenticated:true as const,
      economicInterpretationNotVerified:true as const,
      actualOwnerWriteAuthorizationVerified:false as const,
      productionVaultWritten:false as const,
      productionSaveReceipt:null,
      crossDeviceSyncVerified:false as const,
      productionTransactionAtomicityEstablished:false as const,
      canAutoWriteToProduction:false as const,
      canAutoUpdateThesis:false as const,
    };
  }finally{
    fs.rmSync(workspace,{recursive:true,force:true});
  }
}
