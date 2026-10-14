import crypto from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import fs from "node:fs";
import { env } from "./env";

export const intakeSchema = z.object({
  sourceChat: z.string().min(1).max(120).describe("Exact chat title, e.g. Micro 121026"),
  sourceUrl: z.string().url().max(500).optional().describe("Optional original chat or source URL"),
  notes: z.array(z.object({
    title: z.string().min(1).max(160),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("Event date if known, otherwise null; do not substitute import date"),
    userInput: z.string().min(1).max(30000).describe("Relevant user-provided source material, stored separately from analysis"),
    analysis: z.string().min(1).max(30000).describe("Completed analysis in Markdown, including evidence categories, mechanisms, risks, evidence gaps and thesis impact"),
    relatedNotes: z.array(z.string().min(1).max(350)).max(30).describe("Exact existing vault-relative Markdown paths found by search, for company/theme/concept/thesis backlinks"),
  }).strict()).min(1).max(20),
}).strict();
export type Intake = z.infer<typeof intakeSchema>;
type Row = { id: string; payload: string; status: string; created: string; receipt: string | null };
function table() {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS intake_queue (id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, receipt TEXT)");
  return d;
}
export function enqueue(input: unknown) {
  const payload = JSON.stringify(intakeSchema.parse(input));
  if (Buffer.byteLength(payload) > 300000) throw Error("Package exceeds 300 KB; split into smaller batches");
  const id = crypto.createHash("sha256").update(payload).digest("hex");
  const d = table();
  return d.transaction(() => {
    const old = d.prepare("SELECT * FROM intake_queue WHERE id=?").get(id) as Row | undefined;
    if (old) return summary(old);
    const space=fs.statfsSync(env.dataDir);
    if (space.bavail*space.bsize < 50000000+Buffer.byteLength(payload)) throw Error("Disk reserve reached; submission refused");
    const usage = d.prepare("SELECT count(*) AS n, coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes FROM intake_queue").get() as {n:number; bytes:number};
    if (usage.n >= 1000 || usage.bytes + Buffer.byteLength(payload) > 20000000) throw Error("Intake archive quota reached; administrator must archive receipts before more submissions");
    d.prepare("INSERT INTO intake_queue(id,payload,status,created) VALUES(?,?,'queued',?)").run(id,payload,new Date().toISOString());
    return summary(d.prepare("SELECT * FROM intake_queue WHERE id=?").get(id) as Row);
  })();
}
function summary(r: Row) {return {id:r.id,status:r.status,created:r.created,receipt:r.receipt ? JSON.parse(r.receipt) : null,meaning:r.status === "imported" ? "Receiver confirmed files; inspect receipt for cloud/desktop location. Obsidian Sync device arrival must still be verified" : "Queued only. Receiver has not yet written the notes; check status again"};}
export function intakeStatus(id:string) {const r=table().prepare("SELECT * FROM intake_queue WHERE id=?").get(id) as Row|undefined; if(!r)throw Error("Unknown submission");return summary(r);}
export function nextIntake() {const r=table().prepare("SELECT * FROM intake_queue WHERE status='queued' ORDER BY created LIMIT 1").get() as Row|undefined; return r?{id:r.id,payload:JSON.parse(r.payload),created:r.created}:null;}
export const receiptSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(["imported","blocked"]),paths:z.array(z.string().max(500)).max(25),message:z.string().max(1000)}).strict();
export function acknowledge(input:unknown){const r=receiptSchema.parse(input);const d=table();const row=d.prepare("SELECT * FROM intake_queue WHERE id=?").get(r.id) as Row|undefined;if(!row)throw Error("Unknown submission");if(row.status!=="queued")return summary(row);d.prepare("UPDATE intake_queue SET status=?,receipt=? WHERE id=? AND status='queued'").run(r.status,JSON.stringify({...r,receivedAt:new Date().toISOString()}),r.id);return intakeStatus(r.id);}
