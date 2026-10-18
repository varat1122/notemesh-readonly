/** Staging-only and user-initiated Google Drive E2E probe.
 * Uses only random synthetic bytes; never traverses Vault, SQLite or DATA_DIR.
 * The encrypted test object intentionally remains in an app-created folder.
 * This is NOT a .nmb disaster recovery snapshot or production upload path.
 */
import crypto from "node:crypto";

const DRIVE = "https://www.googleapis.com";
const ID = /^[A-Za-z0-9_-]{10,150}$/;

type Fetcher = typeof fetch;
async function limitedJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) { await res.body?.cancel(); throw Error(`Google Drive request rejected (HTTP ${res.status})`); }
  const header = Number(res.headers.get("content-length") ?? 0);
  if (header > 8192) throw Error("Google Drive metadata response too large");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > 8192) throw Error("Google Drive metadata response too large");
  const data = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Invalid Google Drive metadata");
  return data as Record<string, unknown>;
}
function jsonHeaders(token: string) {
  return { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8" };
}
async function downloadBounded(res: Response, max: number): Promise<Buffer> {
  if (!res.ok || !res.body) throw Error(`Google Drive readback failed (HTTP ${res.status})`);
  const parts: Buffer[] = [];
  let count = 0;
  for await (const part of res.body) {
    const bytes = Buffer.from(part);
    count += bytes.byteLength;
    if (count > max) { await res.body.cancel().catch(() => {}); throw Error("Drive readback exceeds fixture limit"); }
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}
export type FixtureReceipt = {
  passed: true;
  kind: "synthetic-encrypted-fixture-only";
  appCreatedFolderName: string;
  encryptedBytes: number;
  sha256: string;
  uploaded: true;
  downloadedAndHashVerified: true;
  decryptedAndPlaintextVerified: true;
  noVaultDataAccess: true;
};
export async function driveSyntheticFixtureTest(accessToken: string, fetcher: Fetcher = fetch): Promise<FixtureReceipt> {
  if (!accessToken || accessToken.length > 8192) throw Error("Missing Drive access token");
  const nonce = crypto.randomBytes(12), key = crypto.randomBytes(32);
  const original = Buffer.from(JSON.stringify({
    marker: "Investment-OS-DR-SYNTHETIC-FIXTURE-NO-VAULT-DATA",
    random: crypto.randomBytes(24).toString("hex"),
  }));
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(original), cipher.final()]);
  const envelope = Buffer.concat([Buffer.from("NMDRFIX1"), nonce, ciphertext, cipher.getAuthTag()]);
  const sha256 = crypto.createHash("sha256").update(envelope).digest("hex");
  const suffix = crypto.randomBytes(6).toString("hex");
  const folderName = "NoteMesh-DR-Staging-Fixture-" + suffix;
  const fileName = "synthetic-encrypted-fixture-" + suffix + ".bin";

  // Drive.file allows the dedicated app to create *its own* folder and file,
  // without permissions to browse or modify the user's existing DR folders.
  const folder = await limitedJson(await fetcher(DRIVE + "/drive/v3/files?fields=id,name,mimeType", {
    method: "POST", headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
    redirect: "error", signal: AbortSignal.timeout(25000),
  }));
  const folderId = folder.id;
  if (typeof folderId !== "string" || !ID.test(folderId) ||
      folder.name !== folderName || folder.mimeType !== "application/vnd.google-apps.folder")
    throw Error("Google Drive did not confirm app-created test folder");

  const boundary = "nm-dr-fixture-" + suffix;
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({name:fileName,parents:[folderId],mimeType:"application/octet-stream",
        appProperties:{kind:"notemesh-synthetic-fixture",sha256}}) +
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    envelope,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const file = await limitedJson(await fetcher(DRIVE + "/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,parents,appProperties", {
    method:"POST",
    headers:{Authorization:"Bearer " + accessToken, "Content-Type":"multipart/related; boundary=" + boundary},
    body:multipart, redirect:"error", signal:AbortSignal.timeout(40000),
  }));
  if (typeof file.id !== "string" || !ID.test(file.id) || file.name !== fileName ||
      Number(file.size) !== envelope.length ||
      !Array.isArray(file.parents) || !file.parents.includes(folderId) ||
      (file.appProperties as Record<string,unknown> | undefined)?.sha256 !== sha256)
    throw Error("Encrypted fixture upload metadata mismatch");

  const downloaded = await downloadBounded(await fetcher(DRIVE + "/drive/v3/files/" + encodeURIComponent(file.id) + "?alt=media", {
    headers:{Authorization:"Bearer " + accessToken},redirect:"error",signal:AbortSignal.timeout(40000),
  }), 2048);
  const readbackSha = crypto.createHash("sha256").update(downloaded).digest("hex");
  if (downloaded.length !== envelope.length || readbackSha !== sha256)
    throw Error("Drive ciphertext readback SHA-256 mismatch");
  const tag = downloaded.subarray(downloaded.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm",key,downloaded.subarray(8,20));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(downloaded.subarray(20, -16)),decipher.final()]);
  if (!plaintext.equals(original)) throw Error("Encrypted fixture plaintext recovery mismatch");
  return {passed:true,kind:"synthetic-encrypted-fixture-only",
    appCreatedFolderName:folderName,encryptedBytes:envelope.length,sha256,
    uploaded:true,downloadedAndHashVerified:true,decryptedAndPlaintextVerified:true,noVaultDataAccess:true};
}
