/**
 * DR snapshot coordination primitive (not wired to production).
 *
 * A write freeze only works after EVERY writer is registered through withWrite:
 * Vault edits, attachments, originals, SQLite writers, market prices and Sync.
 * Until that integration is audited, neither this primitive nor an Obsidian
 * child pause can be used to claim a consistent production backup.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Labels identify an admission in THIS Node process, not an independently
 * attested writer class. In particular they cannot describe the continuous
 * Obsidian daemon or any unregistered process/device.
 */
export type WriterAdmissionClass =
  | "unclassified"
  | "vault_atomic_edits"
  | "protected_safe_edits"
  | "user_attachments"
  | "original_source_archive"
  | "app_sqlite_wal"
  | "indexer_rebuild"
  | "better_auth_adapter"
  | "market_price_sqlite"
  | "market_price_drive"
  | "git_sync"
  | "obsidian_cli"
  | "background_price_collector";

export class SnapshotWriterFence {
  private activeWriters=0;
  // Nested write helpers may run AFTER freeze begins, but only when their
  // ancestor was admitted BEFORE the freeze and is still in flight.
  private readonly admissionContext=new AsyncLocalStorage<{active:boolean}>();
  private frozen=false;
  private waiting: Set<() => void>=new Set();
  private activeClasses=new Map<WriterAdmissionClass,number>();

  /**
   * Read-only admission OBSERVATION. This is deliberately not a snapshot
   * eligibility signal: it cannot count raw db() mutations, writers outside
   * this process, child daemons, other replicas or Obsidian devices.
   * A nested named operation can share its parent's ticket, so class counts
   * are observations, NOT additive to activeWriters.
   */
  getAdmissionEvidence() {
    return {
      scope:"this_node_process_only" as const,
      frozen:this.frozen,
      activeWriters:this.activeWriters,
      activeByClass:Object.fromEntries([...this.activeClasses.entries()]
        .sort(([a],[b])=>a.localeCompare(b))) as Partial<Record<WriterAdmissionClass,number>>,
      completeRuntimeWriterCoverageVerified:false as const,
      externalWriterQuiescenceVerified:false as const,
      productionSnapshotReady:false as const,
    };
  }

  private startClass(kind:WriterAdmissionClass) {
    this.activeClasses.set(kind,(this.activeClasses.get(kind)??0)+1);
  }

  private finishClass(kind:WriterAdmissionClass) {
    const count=this.activeClasses.get(kind);
    if(!count || count<1)throw Error("backup_writer_class_underflow");
    if(count===1)this.activeClasses.delete(kind);
    else this.activeClasses.set(kind,count-1);
  }

  get status() {
    return {frozen:this.frozen, activeWriters:this.activeWriters};
  }

  private releaseWrite(kind:WriterAdmissionClass) {
    this.finishClass(kind);
    this.activeWriters--;
    if(this.activeWriters===0){
      for(const wake of this.waiting)wake();
      this.waiting.clear();
    }
  }

  /**
   * Admit a disk-backed resource whose writable lifetime extends beyond a
   * single method call (e.g. an open SQLite connection). The owner MUST call
   * the returned release exactly once on close, including error paths.
   * An unclosed resource intentionally makes the backup drain time out.
   */
  acquireWriteTicket(kind:WriterAdmissionClass="unclassified"):()=>void {
    if(this.frozen && !this.admissionContext.getStore()?.active)
      throw Error("backup_writer_freeze_active");
    this.activeWriters++;
    this.startClass(kind);
    let released=false;
    return ()=>{
      if(released)throw Error("backup_writer_ticket_already_released");
      released=true;
      this.releaseWrite(kind);
    };
  }

  /** Gate an entirely synchronous mutator; release its ticket before return. */
  withWriteSync<T>(perform:()=>T,kind:WriterAdmissionClass="unclassified"):T {
    if(this.admissionContext.getStore()?.active) {
      this.startClass(kind);
      try{return perform();}
      finally{this.finishClass(kind);}
    }
    const release=this.acquireWriteTicket(kind), scope={active:true};
    try{return this.admissionContext.run(scope,perform);}
    finally {scope.active=false;release();}
  }

  /**
   * Every async mutator must enter BEFORE its first write and retain the
   * ticket through asynchronous I/O. Reject if a freeze is already active.
   */
  async withWrite<T>(perform:()=>T|Promise<T>,kind:WriterAdmissionClass="unclassified"):Promise<T> {
    if(this.admissionContext.getStore()?.active) {
      this.startClass(kind);
      try{return await perform();}
      finally{this.finishClass(kind);}
    }
    const release=this.acquireWriteTicket(kind), scope={active:true};
    try{return await this.admissionContext.run(scope,perform);}
    finally {scope.active=false;release();}
  }

  /**
   * Freeze new admissions immediately, drain in-flight writes, run one
   * (possibly async) snapshot, and release on success/throw/timeout.
   * Caller must independently stop & await Obsidian Sync and prove that
   * ALL remaining writers participate in this fence.
   */
  async withFrozenWriters<T>(perform:()=>T|Promise<T>,opts:{drainTimeoutMs?:number}={}):Promise<T>{
    if(this.frozen)throw Error("backup_already_in_progress");
    if(this.admissionContext.getStore()?.active)
      throw Error("backup_freeze_cannot_run_within_writer");
    const timeoutMs=opts.drainTimeoutMs??10_000;
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300_000)
      throw Error("invalid_backup_drain_timeout");
    this.frozen=true;
    try{
      if(this.activeWriters!==0){
        let timer:ReturnType<typeof setTimeout>|undefined;
        let wake:()=>void=()=>{};
        try{
          await Promise.race([
            new Promise<void>(resolve=>{
              wake=()=>resolve();
              this.waiting.add(wake);
              if(this.activeWriters===0)wake();
            }),
            new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("backup_writer_drain_timeout")),timeoutMs);})
          ]);
        }finally{
          if(timer)clearTimeout(timer);
          this.waiting.delete(wake);
        }
      }
      if(this.activeWriters!==0)throw Error("backup_writer_drain_incomplete");
      // Snapshot callbacks never inherit a write-admission privilege.
      return await this.admissionContext.run({active:false},perform);
    }finally{this.frozen=false;}
  }
}

/** One shared process-local admission gate. NOT proof of external writer quiescence. */
export const inProcessDrWriterFence=new SnapshotWriterFence();
