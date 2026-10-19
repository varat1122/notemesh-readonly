/**
 * Development-only, READ-ONLY P0 writer coverage register.
 *
 * A witness is a string observed in source code. It is not proof that the
 * corresponding operation is fenced, nor an attestation of runtime quiescence.
 * A disappearing witness is audit drift, NOT evidence the risk went away.
 *
 * This module is deliberately separate from any backup create or activation
 * pathway; it must never be used to authorize Production snapshots.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inventoryWriterSurfaces } from "./nm-writer-source-inventory.mjs";

/** Every release blocker requires independent runtime evidence, not grep. */
export const MANDATORY_WRITER_CLASSES = Object.freeze([
  {
    id: "vault_atomic_edits",
    witnesses: [["src/server/vault/disk.ts", "fs.renameSync(temp, abs)"]],
    requiredEvidence: "all Vault write entry points fenced across processes; in-flight writes drained",
  },
  {
    id: "protected_safe_edits",
    witnesses: [["src/server/safe-edit/engine.ts", "fs.mkdirSync(lock,{mode:0o700})"]],
    requiredEvidence: "protected edits and backup directory writes quiesced without bypassing approval gates",
  },
  {
    id: "user_attachments",
    witnesses: [["src/server/user-attachment-vault.ts", "fs.linkSync(tmp,abs)"]],
    requiredEvidence: "attachment byte writes and durable file handles drained",
  },
  {
    id: "original_source_archive",
    witnesses: [["src/server/research-source-archive.ts", "fs.linkSync(tmp,target)"]],
    requiredEvidence: "original-source bytes and snapshot index mutations halted as one lifecycle",
  },
  {
    id: "app_sqlite_wal",
    witnesses: [
      ["src/server/db.ts", "new Database(env.dbPath)"],
      ["src/server/db.ts", 'opened.pragma("journal_mode = WAL")'],
    ],
    requiredEvidence: "all app.sqlite handles and WAL/checkpoint writers drained with SQLite-consistent snapshot policy",
  },
  {
    id: "better_auth_adapter",
    witnesses: [
      ["src/server/auth.ts", "database: db()"],
      ["src/server/auth.ts", "await getMigrations(auth.options)"],
    ],
    requiredEvidence: "Better Auth API, session, OAuth and schema migration writes fenced end-to-end",
  },
  {
    id: "market_price_sqlite",
    witnesses: [["src/server/market-prices/store.ts", "new Database(filename"]],
    requiredEvidence: "writable PriceStore connection lifetime and external price DB writers drained",
  },
  {
    id: "market_price_drive",
    witnesses: [["src/server/market-prices/drive-backend.ts", "async refresh(options: RefreshOptions = {})"]],
    requiredEvidence: "all direct and indirect remote Drive cache writers coordinated across workers",
  },
  {
    id: "git_sync",
    witnesses: [
      ["src/server/sync/git.ts", 'await runGit(["fetch"'],
      ["src/server/sync/git.ts", 'await runGit(["add", "-A"])'],
    ],
    requiredEvidence: "all Git child processes exited or drained; every inbound merge/checkout halted",
  },
  {
    id: "obsidian_sync",
    witnesses: [["src/server/ob/supervisor.ts", '["sync", "--continuous"']],
    requiredEvidence: "Obsidian child confirmed stopped; inbound device changes held for entire snapshot",
  },
  {
    id: "background_price_collector",
    witnesses: [["src/server/market-prices/collector.ts", "setInterval(() => { void tick(); }"]],
    requiredEvidence: "scheduled and independently started background tasks drained before snapshot",
  },
  {
    id: "other_processes_and_replicas",
    witnesses: [],
    requiredEvidence: "global writer registration plus independently proved quiescence across replicas, CLIs and subprocesses",
  },
  {
    id: "external_devices",
    witnesses: [],
    requiredEvidence: "external Obsidian device edits reconciled or isolated under a documented consistency boundary",
  },
]);

function inspectWitness(root, file, literal) {
  // Paths come only from the immutable built-in audit register.
  const filename = path.join(root, file);
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    if (!fs.realpathSync(filename).startsWith(root + path.sep)) return false;
    return fs.readFileSync(filename, "utf8").includes(literal);
  } catch {
    return false;
  }
}

export function inspectWriterCoverageRegister(repoRoot) {
  const root = fs.realpathSync(repoRoot);
  const inventory = inventoryWriterSurfaces(root);
  const mappedFiles = new Set();
  const classes = MANDATORY_WRITER_CLASSES.map(item => {
    const witnesses = item.witnesses.map(([file, literal]) => {
      mappedFiles.add(file);
      return {file, present: inspectWitness(root, file, literal)};
    });
    // 'source_witness_present' means the token remains in the tree ONLY.
    // It is never writer admission, SQLite safety or device sync evidence.
    return {
      id: item.id,
      witnesses,
      sourceWitnessStatus: witnesses.every(w => w.present)
        ? (witnesses.length ? "source_witness_present" : "runtime_only")
        : "source_witness_drift",
      runtimeCoverage: "not_verified",
      requiredEvidence: item.requiredEvidence,
    };
  });
  const witnessDrift = classes.flatMap(item =>
    item.witnesses.filter(w => !w.present).map(w => ({classId:item.id,file:w.file})));
  const unclassifiedCandidates = inventory.candidates.filter(x => !mappedFiles.has(x.file));
  return {
    format: "notemesh-writer-coverage-register/1",
    productionSnapshotReady: false,
    approvalStatus: "NO_GO",
    // Static source matches are *not* independent checks or authorization.
    classCount: classes.length,
    runtimeVerifiedClasses: 0,
    candidateCount: inventory.candidateCount,
    unclassifiedCandidateCount: unclassifiedCandidates.length,
    unclassifiedCandidateFiles: [...new Set(unclassifiedCandidates.map(x => x.file))].sort(),
    witnessDrift,
    classes,
    externalWriterQuiescenceVerified: false,
    independentRestoreVerified: false,
  };
}

/** CI guard: fail on drift in known risk surfaces, never promote readiness. */
export function assertSourceWitnessRegisterStable(repoRoot) {
  const report = inspectWriterCoverageRegister(repoRoot);
  if (report.witnessDrift.length)
    throw Error("dr_writer_source_witness_drift_fail_closed");
  if (report.classCount !== MANDATORY_WRITER_CLASSES.length)
    throw Error("dr_writer_class_register_incomplete");
  return report;
}

function main() {
  const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(JSON.stringify(inspectWriterCoverageRegister(root), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main();
