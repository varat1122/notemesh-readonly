import { z } from "zod";
import fs from "node:fs";
import { hash, Hold, TASK } from "./contract";
import { exactPath, locks, openApp } from "./inspect";
import { WAVE3_OWNERSHIP } from "./auth-witness";
export { WAVE3_OWNERSHIP } from "./auth-witness";
export const recoveryPacketSchema = z.object({
  task: z.literal(TASK),
  writerRemote: z.string().url().refine(v => { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; }),
  writerBranch: z.string().regex(/^[-A-Za-z0-9_/]+$/).refine(v => !["main", "master", "production"].includes(v)),
}).strict();
export function loadRecoveryPacket(env: NodeJS.ProcessEnv) {
  const raw = env.IOS_CONTROL_RECOVERY_PACKET;
  if (!raw || !env.IOS_CONTROL_RECOVERY_PACKET_SHA256 || hash(raw) !== env.IOS_CONTROL_RECOVERY_PACKET_SHA256)
    throw new Hold("ACCEPTED_WRITER_PACKET_MISSING");
  const parsed = recoveryPacketSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Hold("RECOVERY_PACKET_REJECTED");
  return parsed.data;
}
export function assertQuiescent(root: string) {
  if (Object.values(locks(root)).some(Boolean)) throw new Hold("LOCKED_HOLD");
  const db = openApp(root);
  try { if (Number(db.prepare("SELECT count(*) AS n FROM safe_edit_operations WHERE status='writing'").get()!.n)) throw new Hold("WRITING_HOLD"); }
  finally { db.close(); }
}
// Never delegates to the broad account-issuer-cleanup procedure. Fixed tables,
// accepted ID hashes + owner + client name, zero linked tokens. No SQL from packets.
export function cleanupOwnedRows(root: string, ownership: typeof WAVE3_OWNERSHIP | { name: string; clientHash: string; sessionHash: string }, stopped: () => boolean, auditBefore: (counts: { client: number; session: number; token: number }) => void) {
  if (!stopped()) throw new Hold("WRITER_NOT_PROVEN_STOPPED");
  assertQuiescent(root);
  // This operation may not checkpoint an existing live WAL.
  const wal = exactPath(root, "app.sqlite-wal");
  if (fs.existsSync(wal) && fs.statSync(wal).size) throw new Hold("WAL_NOT_QUIESCENT");
  const db = openApp(root, false);
  try {
    db.exec("BEGIN IMMEDIATE");
    if (!stopped()) throw new Hold("WRITER_NOT_PROVEN_STOPPED");
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('oauthClient','session') LIMIT 1").get()) throw new Hold("UNREVIEWED_AUTH_TRIGGER");
    const clients = db.prepare('SELECT * FROM "oauthClient" WHERE name=? LIMIT 2').all(ownership.name);
    const sessions = [];
    let scanned = 0;
    for (const row of db.prepare('SELECT * FROM "session"').iterate()) {
      if (++scanned > 10_000) throw new Hold("AUTH_BOUND_EXCEEDED");
      if (hash(String(row.id)) === ownership.sessionHash) sessions.push(row);
    }
    if (clients.length > 1 || sessions.length > 1) throw new Hold("AUTH_OWNERSHIP_MISMATCH");
    const client = clients[0], session = sessions[0];
    const tokenCount = () => {
      let n = 0;
      for (const table of ["oauthAccessToken", "oauthRefreshToken"]) {
        let scanned = 0;
        for (const row of db.prepare(`SELECT clientId,sessionId FROM "${table}"`).iterate()) {
          if (++scanned > 10_000) throw new Hold("AUTH_BOUND_EXCEEDED");
          if (hash(String(row.clientId)) === ownership.clientHash || hash(String(row.sessionId)) === ownership.sessionHash) n++;
        }
      }
      return n;
    };
    const before = { client: clients.length, session: sessions.length, token: tokenCount() };
    if (before.token) throw new Hold("AUTH_TOKEN_OWNERSHIP_HOLD");
    if (!client && !session) {
      // A client whose name changed is a mismatch, not an already-clean result.
      let n = 0;
      for (const row of db.prepare('SELECT clientId FROM "oauthClient"').iterate()) {
        if (++n > 10_000) throw new Hold("AUTH_BOUND_EXCEEDED");
        if (hash(String(row.clientId)) === ownership.clientHash) throw new Hold("AUTH_OWNERSHIP_MISMATCH");
      }
      db.exec("ROLLBACK"); return { before, after: before, state: "already_absent", mutated: false };
    }
    if (!client || !session || hash(String(client.clientId)) !== ownership.clientHash ||
        hash(String(session.id)) !== ownership.sessionHash || !client.userId || client.userId !== session.userId)
      throw new Hold("AUTH_OWNERSHIP_MISMATCH");
    const clientId = String(client.clientId), sessionId = String(session.id);
    // Verify every non-target row survives unchanged, including FK cascades.
    // Bound iteration and hash internally; never output auth rows or token data.
    const fingerprint = () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const parts: string[] = [];
      for (const table of tables) {
        const name = String(table.name);
        if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Hold("UNREVIEWED_SCHEMA");
        const rows: string[] = [];
        for (const row of db.prepare(`SELECT * FROM "${name}"`).iterate()) {
          if ((name === "oauthClient" && row.clientId === clientId) || (name === "session" && row.id === sessionId)) continue;
          if (rows.length >= 100_000) throw new Hold("AUTH_BOUND_EXCEEDED");
          rows.push(hash(JSON.stringify(row)));
        }
        parts.push(name + ":" + hash(rows.sort().join("\n")));
      }
      return hash(parts.join("\n"));
    };
    const untouched = fingerprint();
    auditBefore(before);
    db.prepare('DELETE FROM "session" WHERE id=?').run(sessionId);
    db.prepare('DELETE FROM "oauthClient" WHERE clientId=?').run(clientId);
    const after = { client: Number(db.prepare('SELECT count(*) AS n FROM "oauthClient" WHERE clientId=?').get(clientId)!.n),
      session: Number(db.prepare('SELECT count(*) AS n FROM "session" WHERE id=?').get(sessionId)!.n), token: tokenCount() };
    if (Object.values(after).some(Boolean) || untouched !== fingerprint() ||
        db.prepare("PRAGMA foreign_key_check").get() || db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok") throw new Hold("AUTH_POSTCONDITION_FAILED");
    db.exec("COMMIT");
    return { before, after, state: "cleaned", mutated: true, non_target_digest: untouched };
  } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
  finally { db.close(); }
}

export function cleanupWave3(root: string, stopped: () => boolean, auditBefore: (counts: { client: number; session: number; token: number }) => void) {
  return cleanupOwnedRows(root, WAVE3_OWNERSHIP, stopped, auditBefore);
}
