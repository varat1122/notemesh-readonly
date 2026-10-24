/**
 * Staging-only owner-operated acceptance screen for the exact Git Pilot note.
 * No API/MCP proxy, no generic writes, no automatic apply.
 * Each write still requires a fresh preview token, independently authenticated
 * administrator approval of the exact hash, and a separate owner's POST.
 */
import crypto from "node:crypto";
import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { inProcessDrWriterFence } from "~/server/backup/writer-fence";
import { env } from "~/server/env";
import { previewGitPilot, applyGitPilot } from "~/server/safe-edit/git-pilot";
import { assertGitPilot, note } from "~/server/safe-edit/git-pilot-policy";
import { status } from "~/server/safe-edit/engine";
import { applySchema } from "~/server/safe-edit/schema";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "same-origin",
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const html = (body: string, code = 200) =>
  new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Staging Git Pilot</title><body><main>' +
    body + '</main></body></html>', {status: code, headers});
const denied = (message: string, code: number) => html('<h1>Not available</h1><p>'+escapeHtml(message)+'</p>',code);

async function owner(request: Request) {
  await runAuthMigrations();
  // A session lookup may write OAuth/session SQLite; hold the DR fence for the
  // whole awaited adapter lifetime, as on the existing approval page.
  return inProcessDrWriterFence.withWrite(
    () => auth.api.getSession({headers:request.headers}), "better_auth_adapter");
}
async function smallForm(request: Request) {
  if (Number(request.headers.get("content-length")) > 2048) throw Error("Form too large");
  const reader = request.body?.getReader();
  if (!reader) throw Error("Missing form");
  const chunks: Uint8Array[] = []; let size=0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2048) throw Error("Form too large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    throw Error("Unsupported form type");
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
const actor = (id: string) => 'staging-owner-pilot:' + id;
const noteBody = (id:string) =>
  '# Pilot 001 — Git Safe Writeback (Staging Only)\n\n' +
  '- Date: 2026-10-24\n' +
  '- Scope: Private Staging Test Vault only\n' +
  '- Operation ID: '+id+'\n' +
  '- Test marker: PILOT001_OWNER_REVIEWED_WRITEBACK_20261024\n' +
  '- Purpose: Validate preview, independent admin approval, owner-triggered Apply, Git commit and GitHub readback.\n' +
  '- Evidence status: Synthetic operational test; not investment evidence.\n\n' +
  'This note must never be treated as investment research.\n';

export async function GET({request}: APIEvent) {
  const s=await owner(request);
  if (!s) return denied("Sign in to the Staging administrator dashboard first.",401);
  try {assertGitPilot();} catch {return denied("Not the authorized one-note Staging Git Pilot.",403);}
  return html('<h1>Staging Git Safe Writeback — One-note acceptance</h1>' +
    '<p>This is a human-operated Staging Test Vault action, not a ChatGPT tool write.</p>' +
    '<p>Only '+escapeHtml(note)+' may be created. No production or thesis notes.</p>' +
    '<form method="post"><input type="hidden" name="action" value="preview">' +
    '<button type="submit">1. Prepare preview — no note write</button></form>');
}
export async function POST({request}: APIEvent) {
  if (request.headers.get("origin")!==env.baseUrl)
    return denied("Forbidden origin",403);
  const s=await owner(request);
  if (!s) return denied("Sign in to the Staging administrator dashboard first.",401);
  try {assertGitPilot();} catch {return denied("Not the authorized one-note Staging Git Pilot.",403);}
  let form: URLSearchParams;
  try {form=await smallForm(request);} catch {return denied("Invalid or oversized form",400);}
  const who=actor(s.user.id);
  if (form.get("action")==="preview") {
    const id="pilot001-owner-"+crypto.randomBytes(10).toString("hex");
    try {
      const p=await previewGitPilot({
        operationId:id, path:note,
        reason:"Owner initiated Staging-only synthetic Git Safe Writeback Pilot; exact one-file acceptance",
        change:{kind:"create",content:noteBody(id)},
      },who);
      if (typeof p.previewToken!=="string" || !p.requiresAdminApproval || !p.approvalUrl)
        throw Error("Preview missing required safeguards");
      // Token only appears in the authenticated no-store page, never in an URL,
      // log, or a tool response. The POST returns no file writes.
      return html('<h1>Review exact one-note preview</h1><p>Do not apply until you independently approve this diff.</p>' +
        '<p>Operation: <code>'+escapeHtml(p.operationId)+'</code></p>' +
        '<p>File: <code>'+escapeHtml(p.path)+'</code></p>' +
        '<pre>'+escapeHtml(JSON.stringify({diff:p.diff,warnings:p.warnings,afterHash:p.afterHash,expiresAt:p.expiresAt},null,2))+'</pre>' +
        '<p><a href="'+escapeHtml(p.approvalUrl)+'" target="_blank" rel="noopener noreferrer">' +
        '2. Review and approve the exact diff in a new tab</a></p>' +
        '<form method="post"><input type="hidden" name="action" value="apply">' +
        '<input type="hidden" name="operationId" value="'+escapeHtml(p.operationId)+'">' +
        '<input type="hidden" name="expectedHash" value="'+escapeHtml(p.beforeHash)+'">' +
        '<input type="hidden" name="previewToken" value="'+escapeHtml(p.previewToken)+'">' +
        '<button type="submit">3. Apply exactly this approved note once</button></form>' +
        '<p>If the page or preview expires, start a fresh preview; never retry after an uncertain Apply outcome.</p>');
    } catch {
      return denied("Preview refused. Check pilot status and reconcile manually; no Apply attempted.",409);
    }
  }
  if (form.get("action")==="apply") {
    const operationId=form.get("operationId")??"";
    if (!/^pilot001-owner-[a-f0-9]{20}$/.test(operationId))
      return denied("Invalid owner-only operation ID",400);
    const parsed=applySchema.safeParse({
      operationId, previewToken:form.get("previewToken"),
      expectedHash:form.get("expectedHash"),
    });
    if(!parsed.success) return denied("Invalid token or hash form",400);
    try {
      const reviewed=status(operationId,who);
      if (reviewed.path!==note || reviewed.status!=="preview" ||
          !reviewed.requiresAdminApproval || !reviewed.approved)
        return denied("Admin approval for this exact preview is still required.",409);
      if (new Date(reviewed.expiresAt).getTime() < Date.now())
        return denied("Preview expired. Start a fresh preview; do not reuse this token.",409);
      const applied=await applyGitPilot(parsed.data,who);
      const pilot=applied.receipt?.gitPilot;
      return html('<h1>Apply result</h1><pre>'+escapeHtml(JSON.stringify({
        operationId:applied.operationId,status:applied.status,path:applied.path,
        beforeHash:applied.beforeHash,afterHash:applied.afterHash,
        gitPilot:pilot
      },null,2))+'</pre><p>Verify the new note and SHA independently on GitHub.</p>');
    } catch {
      // A Git push can have an unknown outcome. Never trigger a retry here.
      return denied("Apply outcome requires manual receipt/GitHub review. Do not resubmit.",409);
    }
  }
  return denied("Unknown action",400);
}
