import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerPriceTools } from "../mcp/price-tools.ts";
import { syntheticPilotBundle } from "./drive-pilot-demo.ts";
import { DrivePilotSession, pilotSha256, type PilotCheckpoint } from "./drive-pilot.ts";
import { gateDigest, verifyGatePermit, type OwnerAuthority, type GatePermit } from "./drive-pilot-approval.ts";
import { PilotJournal, type PilotLease } from "./drive-pilot-journal.ts";
import { PilotOperation } from "./drive-pilot-operation.ts";
import { PilotOAuthBinding } from "./drive-pilot-bootstrap.ts";
import { GoogleDriveArchives } from "./drive-archive.ts";
import { DrivePriceCache } from "./drive-backend.ts";
import { PriceError } from "./model.ts";

export function singleUseGatePlan() {
  return { task: "IOS-PRICES-005", status: "LIVE_HOLD", liveExecutionEnabled: false, candidateTree: "UNSET", source: "two_fabricated_AAPL_bars_only", rights: "RIGHTS_HOLD",
    principalId: "UNSET", clientId: "UNSET", redirectUri: "UNSET", actualScope: "UNSET", requiredScope: "https://www.googleapis.com/auth/drive.file", folderId: "UNSET", folderAclEvidence: "UNSET",
    independentOwnerPublicKeySpkiSha256: "UNSET", ownerKeyEnrollmentEvidence: "UNSET", bootstrapPermit: "UNSET", uploadPermit: "UNSET", quotaStorageBillingEvidence: "UNSET", signingKeyCustody: "UNSET", tokenCustody: "UNSET", persistentJournalVolume: "UNSET", executionWindow: "UNSET",
    bootstrap: { maxFolders: 1, maxDriveRequests: 8, maxOAuthTokenCalls: 2, parent: "root", folderFlow: "app_created_private_empty_My_Drive_only", allocateFutureBinaryFileIds: 2 },
    upload: { maxFileCreatePOSTs: 2, maxDriveRequests: 24, maxUploadedWireBytes: 1048576, maxDownloadReservationBytes: 2097152, maxDurationMs: 120000, maxArchiveBytes: 262144, maxCatalogueBytes: 65536 },
    expectedCostUSD: 0, chargeCeilingUSD: 0, costCondition: "No execution until actual account/project/storage/quota evidence confirms zero charge; no paid or overage fallback.",
    approvalScheme: "detached_Ed25519_permit_verified_against_independently_enrolled_pinned_Owner_public_key; no live signer or default trust root",
    journal: { engine: "SQLite_FULL_DELETE", explicitFileAndDirectoryFsyncRequired: true, missingJournal: "HOLD", existingJournalResetAllowed: false, deadProcessLeaseTakeover: "explicit_recovery_only", countersRefundedOnRestart: false },
    recovery: "Exact parent+pilot marker+role+signed hash+reserved ID reconciliation before any continuation; ambiguous/missing/ACL/tamper/budget/auth failure =>HOLD. No repost of attempted roles, deletion, sharing, refresh or automatic reauthorization.",
    checks: { offline: "UNSET", liveOAuth: "UNSET", liveFolder: "UNSET", liveApproval: "UNSET", liveQuota: "UNSET", realDriveReadback: "UNSET" },
    nextDecision: "Separate Owner bootstrap consent/folder-only decision after Coordinator acceptance; collect exact IDs/ACL/signed manifests; separate upload decision. No live CLI in this task." };
}

/** A proposal is inert: no authority signature, no permit consumption, no HTTP. */
export function uploadPermitProposal(journal: PilotJournal, window: { notBefore: string; expiresAt: string; permitId: string; ownerEvidenceRef: string; quotaEvidenceRef: string }) {
  const r = journal.read();
  if (r.stage !== "READY" || !r.folderId || !r.folderEvidenceSha256 || !r.allocatedIds || !r.bootstrapPermitDigest) throw new PriceError("pilot_bootstrap_receipt_required");
  const bundle = syntheticPilotBundle(), catalogue = bundle.catalogue(r.allocatedIds.archive);
  return { version: 1, phase: "upload", ...window, binding: r.binding, expectedCostUSD: 0, chargeCeilingUSD: 0,
    bootstrapPermitDigest: r.bootstrapPermitDigest, folderId: r.folderId, folderEvidenceSha256: r.folderEvidenceSha256,
    instrumentId: "US:AAPL", syntheticBars: 2,
    archive: { id: r.allocatedIds.archive, sha256: pilotSha256(bundle.archive), bytes: bundle.archive.length },
    catalogue: { id: r.allocatedIds.catalogue, sha256: pilotSha256(catalogue), bytes: catalogue.length },
    limits: { files: 2, requests: 24, uploadedWireBytes: 1048576, downloadReservationBytes: 2097152, durationMs: 120000, archiveBytes: 262144, catalogueBytes: 65536 } } satisfies GatePermit;
}
function saveCheckpoint(operation: PilotOperation, checkpoint: PilotCheckpoint) {
  operation.update(r => {
    r.upload = checkpoint;
    if (checkpoint.stopped) { r.stage = "HOLD"; r.holdCode = checkpoint.stopped; }
    else {
      const progress = ["UPLOAD_STARTED", "ARCHIVE_VERIFIED", "CATALOGUE_VERIFIED", "READBACK_VERIFIED"];
      const derived = checkpoint.objects.find(o => o.role === "priceCatalogue")?.phase === "confirmed" ? "CATALOGUE_VERIFIED"
        : checkpoint.objects.find(o => o.role === "priceArchive")?.phase === "confirmed" ? "ARCHIVE_VERIFIED" : null;
      // A recovered readback may spend more budget without losing validated progress.
      if (derived && progress.indexOf(derived) > progress.indexOf(r.stage)) r.stage = derived;
    }
  });
}
async function coldMcpRead(session: DrivePilotSession, operation: PilotOperation) {
  const cache = new DrivePriceCache(new GoogleDriveArchives("priceArchive", session), new GoogleDriveArchives("priceCatalogue", session));
  const server = new McpServer({ name: "single-use-pilot-readback", version: "1.0" });
  const client = new Client({ name: "synthetic-only-reader", version: "1.0" });
  try {
    registerPriceTools(server, (read, requested) => cache.read(read, requested));
    const [ct, st] = InMemoryTransport.createLinkedPair(); await operation.run(() => Promise.all([server.connect(st), client.connect(ct)]));
    const bars = await operation.run(() => client.callTool({ name: "read_price_bars", arguments: { market: "US", symbol: "AAPL", limit: 2 } }));
    const instruments = await operation.run(() => client.callTool({ name: "list_price_instruments", arguments: {} }));
    if (bars.isError || instruments.isError) throw new PriceError("pilot_cold_mcp_read_failed");
    const body = JSON.parse((bars.content as { text: string }[])[0].text);
    if (body.instrument.id !== "US:AAPL" || body.instrument.currency !== "USD" || body.instrument.timeZone !== "America/New_York" || body.series.dataOrigin !== "synthetic_fixture" || body.bars.length !== 2 || body.series.rights.status !== "RIGHTS_HOLD") throw new PriceError("pilot_cold_mcp_manifest_failed");
    operation.check(); return { bars: body, instruments: JSON.parse((instruments.content as { text: string }[])[0].text) };
  } finally {
    // Always initiate both local closes, even after expiry; never await cleanup beyond
    // this invocation's deadline. Any pending tool continuation still needs admission.
    const closing = Promise.allSettled([client.close(), server.close()]);
    try { await operation.run(async () => { if ((await closing).some(r => r.status === "rejected")) throw new PriceError("pilot_cold_mcp_close_failed"); }); }
    finally { cache.close(); }
  }
}
/** Internal executor only; CLI never exposes live execution, custody or approval arguments. */
export async function executePilotUpload(journal: PilotJournal, oauth: PilotOAuthBinding, envelope: unknown, authority: OwnerAuthority, recover = false) {
  let consumed = false, lease: PilotLease | undefined, operation: PilotOperation | undefined;
  try {
    const r = journal.read(), approved = verifyGatePermit(envelope, authority, r.binding, "upload"), p = approved.permit;
    if (p.phase !== "upload" || gateDigest(oauth.binding) !== gateDigest(r.binding) || p.folderId !== r.folderId || p.folderEvidenceSha256 !== r.folderEvidenceSha256 ||
      p.bootstrapPermitDigest !== r.bootstrapPermitDigest || p.archive.id !== r.allocatedIds?.archive || p.catalogue.id !== r.allocatedIds.catalogue) throw new PriceError("pilot_approved_folder_or_bootstrap_mismatch");
    const bundle = syntheticPilotBundle(), catalogueBytes = bundle.catalogue(p.archive.id);
    if (p.archive.sha256 !== pilotSha256(bundle.archive) || p.archive.bytes !== bundle.archive.length || p.catalogue.sha256 !== pilotSha256(catalogueBytes) || p.catalogue.bytes !== catalogueBytes.length) throw new PriceError("pilot_exact_signed_payload_mismatch");
    lease = journal.acquire(); journal.consume(approved, recover, lease); consumed = true;
    r.upload = journal.read().upload;
    const op = operation = new PilotOperation(journal, lease, Math.min(Date.parse(p.expiresAt), r.upload!.startedAt + p.limits.durationMs));
    await op.run(() => oauth.validThrough(Date.parse(p.expiresAt), op));
    const session = new DrivePilotSession({ folderId: p.folderId, pilotId: r.binding.pilotId, principalId: r.binding.principalId,
      clientId: r.binding.clientId, scope: r.binding.scope, approvalRef: p.ownerEvidenceRef }, () => oauth.grant(op), {
      initial: r.upload, payloads: { priceArchive: bundle.archive, priceCatalogue: catalogueBytes },
      plannedIds: { priceArchive: p.archive.id, priceCatalogue: p.catalogue.id }, folderEvidenceSha256: p.folderEvidenceSha256,
      deadlineAt: op.deadlineAt, operation: op, save: checkpoint => saveCheckpoint(op, checkpoint),
    });
    const archives = new GoogleDriveArchives("priceArchive", session), catalogues = new GoogleDriveArchives("priceCatalogue", session);
    const reconciled: { role: string; result: string; id: string }[] = [];
    if (recover) {
      await op.run(() => session.folder()); // Revalidate principal, ACL, parent and journaled children before any possible write.
      for (const o of r.upload?.objects ?? []) {
        if (o.phase === "uncertain") { const result = await op.run(() => session.reconcile(o.role)); reconciled.push({ role: o.role, result: result.status, id: result.id }); }
        else if (o.phase === "confirmed") { await op.run(() => (o.role === "priceArchive" ? archives : catalogues).get(o.id!)); reconciled.push({ role: o.role, result: "PREVIOUS_ID_READ_VERIFIED_NO_REPOST", id: o.id! }); }
        else throw new PriceError("pilot_pre_dispatch_crash_hold");
      }
    }
    if (!r.upload?.objects.some(o => o.role === "priceArchive")) await op.run(() => archives.publish(bundle.archive));
    if (!r.upload?.objects.some(o => o.role === "priceCatalogue")) await op.run(() => catalogues.publish(catalogueBytes));
    const mcp = await op.run(() => coldMcpRead(session, op));
    op.update(s => { s.stage = "READBACK_VERIFIED"; s.readback = { ...s.readback, instrumentId: "US:AAPL", syntheticBars: 2, archiveId: p.archive.id, catalogueId: p.catalogue.id,
      archiveSha256: p.archive.sha256, catalogueSha256: p.catalogue.sha256, mcpBarsDigest: gateDigest(mcp.bars), reconciled }; });
    const receipt = { status: "DONE", syntheticOnly: true, candidateTree: r.binding.candidateTree, permitDigest: gateDigest(p), journalId: r.binding.journalId,
      readback: journal.read().readback, budget: session.status(), reconciled, mcp, durability: journal.durability() };
    op.update(s => { s.stage = "DONE"; }); return receipt;
  } catch (e) {
    const code = e instanceof PriceError ? e.code : "pilot_execution_failed";
    // Unknown transport completion is explicitly resumable; every other failure is terminal HOLD.
    if (consumed && journal.owns(lease) && code !== "drive_request_failed") journal.hold(code, lease);
    throw new PriceError(code);
  } finally { operation?.close(); journal.close(lease); }
}
