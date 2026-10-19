/**
 * OFFLINE FIXTURE orchestration proof, not a live backup entry point.
 *
 * Process-local fencing does not stop another replica, user device, CLI,
 * external Sync daemon or an unregistered database writer. The production
 * gate must remain CLOSED until each writer class and deployment scope has
 * independently verifiable coverage.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { SnapshotWriterFence } from "./writer-fence";
import { withFixtureInterprocessExclusion } from "../../../scripts/backup/nm-interprocess-fixture-gate.mjs";

type SyncPauser = {
  withPausedForEdit<T>(run: () => T | Promise<T>): Promise<T>;
};
type FixtureCutOptions<T> = {
  fence: SnapshotWriterFence;
  sync: SyncPauser;
  assertNoExternalWriters: () => Promise<boolean> | boolean;
  capture: () => Promise<T> | T;
  drainTimeoutMs?: number;
};

/** Never callable from Railway or a deployed DATA_DIR, including Staging. */
export function assertOfflineFixtureOnly(): void {
  if (process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_PROJECT_NAME || process.env.RAILWAY_SERVICE_NAME)
    throw Error("dr_offline_fixture_only_no_railway");
  const raw = process.env.DATA_DIR;
  if (!raw) throw Error("dr_offline_fixture_only_requires_data_dir");
  const configured = path.resolve(raw);
  if (configured === "/data" || configured === "/app/data")
    throw Error("dr_offline_fixture_only_deployed_data_dir");
  // A filename check alone is not isolation: /tmp/fixture might be a symlink
  // to the live Vault or a different mounted volume. Resolve both filesystem
  // and configured pathname and require a real scratch directory with a
  // deliberately unique fixture prefix. No automatic directory creation.
  const scratch = fs.realpathSync(os.tmpdir());
  let real: string;
  try { real = fs.realpathSync(configured); }
  catch { throw Error("dr_offline_fixture_only_missing_root"); }
  if (path.dirname(real) !== scratch ||
      !path.basename(real).startsWith("nm-dr-snapshot-fixture-"))
    throw Error("dr_offline_fixture_only_not_isolated_scratch");
  if (real !== configured || fs.lstatSync(configured).isSymbolicLink() ||
      !fs.lstatSync(configured).isDirectory())
    throw Error("dr_offline_fixture_only_symlink_or_unsafe_root");
}

/** A bounded, read-only synthetic-tree fingerprint. NOT a tamper-proof
 * filesystem snapshot: a noncooperating writer can change-and-revert bytes,
 * and we cannot atomically inspect another process's filesystem. */
const MAX_FIXTURE_FILES=4096;
const MAX_FIXTURE_BYTES=256*1024*1024;
function syntheticTreeFingerprint():string {
  assertOfflineFixtureOnly();
  const root=process.env.DATA_DIR!;
  const digest=createHash("sha256");
  let files=0,total=0;
  const update=(value:string)=>{
    const bytes=Buffer.from(value,"utf8"),len=Buffer.allocUnsafe(4);
    len.writeUInt32BE(bytes.length);digest.update(len);digest.update(bytes);
  };
  const walk=(dir:string,relative:string):void=>{
    const entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"));
    for(const entry of entries){
      const full=path.join(dir,entry.name);
      const rel=relative?relative+"/"+entry.name:entry.name;
      const st=fs.lstatSync(full);
      if(st.isSymbolicLink() || (!st.isDirectory()&&!st.isFile()))
        throw Error("dr_fixture_source_unsafe_entry");
      if(st.isDirectory()){
        update("dir");update(rel);update(String(st.mode));update(String(st.ino));
        walk(full,rel);
      }else{
        if(++files>MAX_FIXTURE_FILES || (total+=st.size)>MAX_FIXTURE_BYTES)
          throw Error("dr_fixture_source_fingerprint_limit");
        // Never follow symlinks, and verify the same inode still exists when
        // hashing completes. Hardlinks can point outside this fixture root.
        if(st.nlink!==1)throw Error("dr_fixture_source_unsafe_entry");
        const fd=fs.openSync(full,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
        try{
          const initial=fs.fstatSync(fd);
          if(!initial.isFile()||initial.dev!==st.dev||initial.ino!==st.ino||
             initial.size!==st.size||initial.nlink!==1)
            throw Error("dr_fixture_source_changed_during_fingerprint");
          update("file");update(rel);update(String(st.mode));update(String(st.dev));
          update(String(st.ino));update(String(st.size));update(String(st.mtimeMs));
          update(String(st.ctimeMs));
          const contentHash=createHash("sha256");
          const buf=Buffer.allocUnsafe(64*1024);
          let consumed=0;
          while(true){
            const n=fs.readSync(fd,buf,0,buf.length,null);
            if(!n)break;
            consumed+=n;
            if(consumed>st.size)throw Error("dr_fixture_source_changed_during_fingerprint");
            contentHash.update(buf.subarray(0,n));
          }
          const done=fs.fstatSync(fd);
          const pathNow=fs.lstatSync(full);
          if(consumed!==st.size||done.dev!==st.dev||done.ino!==st.ino||
             done.size!==st.size||done.mtimeMs!==st.mtimeMs||
             done.ctimeMs!==st.ctimeMs||
             pathNow.dev!==st.dev||pathNow.ino!==st.ino)
            throw Error("dr_fixture_source_changed_during_fingerprint");
          update(contentHash.digest("hex"));
        }finally{fs.closeSync(fd);}
      }
    }
  };
  walk(root,"");
  return digest.digest("hex");
}

/**
 * Freeze admissions first; wait for in-flight tickets; pause + await Sync
 * termination next; verify externally imposed fixture-only writer halt; only
 * then capture. The Sync pause and the freeze remain active across async work.
 * Reverse on success/failure. This is a lifecycle TEST helper, not a scheduler.
 */
async function captureUnchangedFixture<T>(capture:()=>Promise<T>|T):Promise<T> {
  const before=syntheticTreeFingerprint();
  const result=await capture();
  const after=syntheticTreeFingerprint();
  if(before!==after)throw Error("dr_fixture_source_changed_during_cut");
  return result;
}

export async function withOfflineFixtureCut<T>(opts: FixtureCutOptions<T>): Promise<T> {
  assertOfflineFixtureOnly();
  return opts.fence.withFrozenWriters(async () => {
    return opts.sync.withPausedForEdit(async () => {
      const halted = await opts.assertNoExternalWriters();
      if (halted !== true) throw Error("dr_fixture_external_writer_not_halted");
      return captureUnchangedFixture(opts.capture);
    });
  }, {drainTimeoutMs: opts.drainTimeoutMs ?? 10000});
}

/**
 * OFFLINE FIXTURE ONLY: Compose the existing in-process Writer Fence,
 * awaited Sync pause, AND an actual crash-sticky interprocess exclusion gate.
 *
 * The lock root is a deliberate sibling of the snapshot source:
 * /tmp/nm-dr-snapshot-fixture-<suffix> -> /tmp/nm-dr-ipc-fixture-<suffix>.
 * It MUST have been explicitly created by the test/operator; the coordinator
 * never creates it or accepts an arbitrary gate path. This prevents snapshots
 * from capturing their own live lock files, and catches missing setup CLOSED.
 *
 * assertNoExternalWriters remains required for additional independently
 * checked fixture assumptions; a TRUE boolean alone is NOT sufficient.
 * ONLY writers that voluntarily use the exact same lock root are excluded.
 * No runtime/device/production consistency attestation is provided.
 */
export async function withCoordinatedOfflineFixtureCut<T>(opts:FixtureCutOptions<T>):Promise<T> {
  assertOfflineFixtureOnly();
  const snapshotRoot=process.env.DATA_DIR!;
  const prefix="nm-dr-snapshot-fixture-";
  const name=path.basename(snapshotRoot);
  if(!name.startsWith(prefix))throw Error("dr_fixture_gate_invalid_snapshot_prefix");
  const suffix=name.slice(prefix.length);
  if(!/^[a-zA-Z0-9_-]{6,80}$/.test(suffix))
    throw Error("dr_fixture_gate_invalid_snapshot_suffix");
  const lockRoot=path.join(fs.realpathSync(os.tmpdir()),"nm-dr-ipc-fixture-"+suffix);
  return opts.fence.withFrozenWriters(async()=>{
    return opts.sync.withPausedForEdit(async()=>{
      return withFixtureInterprocessExclusion(lockRoot,"snapshot",async()=>{
        const halted=await opts.assertNoExternalWriters();
        if(halted!==true)throw Error("dr_fixture_external_writer_not_halted");
        return captureUnchangedFixture(opts.capture);
      });
    });
  }, {drainTimeoutMs:opts.drainTimeoutMs??10000});
}
