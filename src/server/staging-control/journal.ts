import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { hash, Hold, TARGET, VERSION, type ControlRequest } from "./contract";

// Separate control DB, NEVER app.sqlite. The process writes only INSERTs;
// triggers make accidental updates/deletes fail. Hash-chain anchors can be
// exported by operators; this is auditable, not tamper-proof against volume root.
export class Journal {
  private db: DatabaseSync;
  constructor(file: string, readonly implementation: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS admissions(nonce TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, execution_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, body TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS admissions_no_update BEFORE UPDATE ON admissions BEGIN SELECT RAISE(ABORT,'append only'); END;
      CREATE TRIGGER IF NOT EXISTS admissions_no_delete BEFORE DELETE ON admissions BEGIN SELECT RAISE(ABORT,'append only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append only'); END;`);
    let previous = "0".repeat(64);
    for (const row of this.db.prepare("SELECT body,previous,digest FROM events ORDER BY seq").iterate()) {
      if (row.previous !== previous || row.digest !== hash(previous + String(row.body))) throw new Hold("AUDIT_CHAIN_INVALID");
      previous = String(row.digest);
    }
    // On restart, preserve nonce consumption and close interrupted admissions as
    // UNKNOWN/HOLD. This never claims that an interrupted operation did not run.
    const interrupted = this.db.prepare(`SELECT e.body FROM events e
      WHERE json_extract(e.body,'$.terminal')='RUNNING' AND NOT EXISTS (
        SELECT 1 FROM events t WHERE json_extract(t.body,'$.execution_id')=json_extract(e.body,'$.execution_id')
        AND json_extract(t.body,'$.terminal') IN ('SUCCEEDED','HOLD')) LIMIT 1001`).all();
    if (interrupted.length > 1000) throw new Hold("AUDIT_RECOVERY_BOUND_EXCEEDED");
    for (const row of interrupted) {
      const admitted = JSON.parse(String(row.body));
      const result = null, error = "PROCESS_INTERRUPTED_OUTCOME_UNKNOWN_HOLD";
      this.append({ ...admitted, terminal: "HOLD", finished_at: new Date().toISOString(), result, error,
        result_digest: hash(JSON.stringify({ result, error })), recovered_by: implementation });
    }
  }
  append(event: Record<string, unknown>) {
    const own = !this.db.isTransaction;
    if (own) this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = String(this.db.prepare("SELECT digest FROM events ORDER BY seq DESC LIMIT 1").get()?.digest ?? "0".repeat(64));
      const body = JSON.stringify({ ...event, implementation: this.implementation, version: VERSION });
      const digest = hash(previous + body);
      const inserted = this.db.prepare("INSERT INTO events(body,previous,digest) VALUES(?,?,?)").run(body, previous, digest);
      if (own) this.db.exec("COMMIT");
      return { seq: Number(inserted.lastInsertRowid), previous, digest, body_sha256: hash(body) };
    } catch (error) { if (own && this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  summary() {
    // Bounded projection: no stored results, raw targets, auth rows or payloads.
    const recent = this.db.prepare(`SELECT seq,previous,digest,
      json_extract(body,'$.execution_id') AS execution_id, json_extract(body,'$.request_id') AS request_id,
      json_extract(body,'$.operation') AS operation, json_extract(body,'$.terminal') AS terminal,
      json_extract(body,'$.started_at') AS started_at, json_extract(body,'$.finished_at') AS finished_at,
      json_extract(body,'$.result_digest') AS result_digest, json_extract(body,'$.error') AS error
      FROM events ORDER BY seq DESC LIMIT 16`).all();
    return { head: recent[0] ? { seq: recent[0].seq, digest: recent[0].digest } : null,
      recent, scope: "last 16 control events; terminal anchors, not a full journal export" };
  }
  admit(r: ControlRequest, actor: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT 1 FROM admissions WHERE nonce=? OR request_id=?").get(hash(r.nonce), r.request_id)) throw new Hold("NO_REEXECUTION");
      const run = { execution_id: randomUUID(), request_id: r.request_id, nonce: r.nonce, operation: r.operation,
        actor, target: TARGET, started_at: new Date().toISOString() };
      this.db.prepare("INSERT INTO admissions VALUES(?,?,?)").run(hash(r.nonce), r.request_id, run.execution_id);
      this.append({ ...run, admission: "ADMITTED", terminal: "RUNNING", finished_at: null });
      this.db.exec("COMMIT");
      return run;
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}
