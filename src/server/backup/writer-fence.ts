/**
 * DR snapshot coordination primitive (not wired to production).
 *
 * A write freeze only works after EVERY writer is registered through withWrite:
 * Vault edits, attachments, originals, SQLite writers, market prices and Sync.
 * Until that integration is audited, neither this primitive nor an Obsidian
 * child pause can be used to claim a consistent production backup.
 */
export class SnapshotWriterFence {
  private activeWriters=0;
  private frozen=false;
  private waiting: Set<() => void>=new Set();

  get status() {
    return {frozen:this.frozen, activeWriters:this.activeWriters};
  }

  private releaseWrite() {
    this.activeWriters--;
    if(this.activeWriters===0){
      for(const wake of this.waiting)wake();
      this.waiting.clear();
    }
  }

  /** Gate an entirely synchronous mutator; release its ticket before return. */
  withWriteSync<T>(perform:()=>T):T {
    if(this.frozen)throw Error("backup_writer_freeze_active");
    this.activeWriters++;
    try{return perform();}
    finally {this.releaseWrite();}
  }

  /**
   * Every async mutator must enter BEFORE its first write and retain the
   * ticket through asynchronous I/O. Reject if a freeze is already active.
   */
  async withWrite<T>(perform:()=>T|Promise<T>):Promise<T> {
    if(this.frozen)throw Error("backup_writer_freeze_active");
    this.activeWriters++;
    try{return await perform();}
    finally {this.releaseWrite();}
  }

  /**
   * Freeze new admissions immediately, drain in-flight writes, run one
   * (possibly async) snapshot, and release on success/throw/timeout.
   * Caller must independently stop & await Obsidian Sync and prove that
   * ALL remaining writers participate in this fence.
   */
  async withFrozenWriters<T>(perform:()=>T|Promise<T>,opts:{drainTimeoutMs?:number}={}):Promise<T>{
    if(this.frozen)throw Error("backup_already_in_progress");
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
      return await perform();
    }finally{this.frozen=false;}
  }
}

/** One shared process-local admission gate. NOT proof of external writer quiescence. */
export const inProcessDrWriterFence=new SnapshotWriterFence();
