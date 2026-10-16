import crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { driveKey, driveAccessToken } from "./drive-auth.ts";
import { googleBytes, googleJson } from "./drive-http.ts";
import { PriceError } from "./model.ts";
import { CATALOGUE_LIMIT, unpackPriceCatalogue } from "./drive-catalogue.ts";

export const DRIVE_DB_LIMIT = 4 * 1024 * 1024;
const ARCHIVE_LIMIT = DRIVE_DB_LIMIT + 65536;
const MAGIC = "InvestmentOSPriceArchiveV1\n";
const headerSchema = z.object({ version: z.literal(1), createdAt: z.string().datetime(),
  bytes: z.number().int().min(512).max(DRIVE_DB_LIMIT), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mac: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function mac(createdAt: string, bytes: number, sha256: string, compressed: Buffer): string {
  return crypto.createHmac("sha256", driveKey("archive-integrity-v1"))
    .update(JSON.stringify({ version: 1, createdAt, bytes, sha256 })).update(compressed).digest("hex");
}
export function packDriveArchive(database: Buffer, now = new Date()): Buffer {
  if (database.length > DRIVE_DB_LIMIT) throw new PriceError("drive_snapshot_limit_exceeded");
  const compressed = gzipSync(database), createdAt = now.toISOString();
  const sha256 = crypto.createHash("sha256").update(database).digest("hex");
  const header = { version: 1, createdAt, bytes: database.length, sha256, mac: mac(createdAt, database.length, sha256, compressed) };
  const output = Buffer.concat([Buffer.from(MAGIC + JSON.stringify(header) + "\n"), compressed]);
  if (output.length > ARCHIVE_LIMIT) throw new PriceError("drive_snapshot_limit_exceeded");
  return output;
}
export function unpackDriveArchive(archive: Buffer): { database: Buffer; createdAt: string } {
  try {
    if (archive.length > ARCHIVE_LIMIT || archive.subarray(0, MAGIC.length).toString() !== MAGIC) throw Error();
    const end = archive.indexOf(10, MAGIC.length);
    if (end < 0 || end > 1024) throw Error();
    const header = headerSchema.parse(JSON.parse(archive.subarray(MAGIC.length, end).toString("utf8")));
    const compressed = archive.subarray(end + 1), signature = mac(header.createdAt, header.bytes, header.sha256, compressed);
    if (!crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(header.mac, "hex"))) throw Error();
    // Authenticate BEFORE decompression or handing bytes to SQLite. Limit decompression too.
    const database = gunzipSync(compressed, { maxOutputLength: DRIVE_DB_LIMIT });
    if (database.length !== header.bytes || crypto.createHash("sha256").update(database).digest("hex") !== header.sha256 ||
      database.subarray(0, 16).toString() !== "SQLite format 3\0") throw Error();
    return { database, createdAt: header.createdAt };
  } catch { throw new PriceError("drive_snapshot_integrity_failed"); }
}
const fileSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) });
const listSchema = z.object({ files: z.array(fileSchema).max(2), nextPageToken: z.string().optional() });
// Archive/catalogue repositories share the resolved folder within the immutable server configuration.
// This also avoids creating a duplicate while Drive indexes the first newly created folder.
const datasetFolders = new Map<string, string>();
export interface ArchiveRepository {
  latest(): Promise<{ bytes: Buffer; id: string } | null>;
  get(id: string): Promise<Buffer>;
  publish(bytes: Buffer): Promise<{ bytes: Buffer; id: string }>;
}

/** Creates private, immutable generations. Never patches/deletes/shares files or mounts Drive. */
export class GoogleDriveArchives implements ArchiveRepository {
  private readonly role: "priceArchive" | "priceCatalogue";
  constructor(role: "priceArchive" | "priceCatalogue" = "priceArchive") { this.role = role; }
  private folderId: string | null = null;
  private namespace = crypto.createHmac("sha256", driveKey("dataset-namespace-v1")).update("prices").digest("hex").slice(0, 32);
  private async headers() { return { Authorization: `Bearer ${await driveAccessToken()}` }; }
  private async list(query: string, latest = false) {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.search = new URLSearchParams({ q: query, fields: "files(id),nextPageToken", pageSize: latest ? "1" : "2",
      orderBy: "createdTime desc", spaces: "drive" }).toString();
    const result = listSchema.safeParse(await googleJson(url.toString(), { headers: await this.headers() }));
    if (!result.success) throw new PriceError("drive_invalid_listing");
    return result.data;
  }
  private async folder(create: boolean): Promise<string | null> {
    this.folderId ??= datasetFolders.get(this.namespace) ?? null;
    if (this.folderId) return this.folderId;
    const query = `trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='investmentOsPrices' and value='${this.namespace}' }`;
    const result = await this.list(query);
    if (result.files.length > 1 || result.nextPageToken) throw new PriceError("drive_ambiguous_dataset_folder");
    if (result.files[0]) this.folderId = result.files[0].id;
    else if (create) {
      const result = fileSchema.safeParse(await googleJson("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST", headers: { ...await this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Investment OS - Market Prices", mimeType: "application/vnd.google-apps.folder",
          appProperties: { investmentOsPrices: this.namespace } }),
      }));
      if (!result.success) throw new PriceError("drive_invalid_folder_response");
      this.folderId = result.data.id;
    }
    if (this.folderId) datasetFolders.set(this.namespace, this.folderId);
    return this.folderId;
  }
  async get(id: string): Promise<Buffer> {
    fileSchema.parse({ id });
    return googleBytes(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
      { headers: await this.headers() }, this.role === "priceArchive" ? ARCHIVE_LIMIT : CATALOGUE_LIMIT);
  }
  async latest() {
    const folder = await this.folder(false); if (!folder) return null;
    const result = await this.list(`trashed=false and '${folder}' in parents and appProperties has { key='${this.role}' and value='${this.role === "priceArchive" ? "v1" : "v2"}' }`, true);
    if (!result.files[0]) return null;
    const id = result.files[0].id; return { id, bytes: await this.get(id) };
  }
  async publish(bytes: Buffer) {
    if (this.role === "priceArchive") unpackDriveArchive(bytes);
    else unpackPriceCatalogue(bytes);
    const folder = await this.folder(true);
    const boundary = "investment-os-" + crypto.randomBytes(16).toString("hex");
    const metadata = { name: `${this.role}-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}.${this.role === "priceArchive" ? "iop" : "ioc"}`,
      mimeType: "application/octet-stream", parents: [folder], appProperties: { [this.role]: this.role === "priceArchive" ? "v1" : "v2" } };
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const result = fileSchema.safeParse(await googleJson("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { ...await this.headers(), "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    }));
    if (!result.success) throw new PriceError("drive_invalid_upload_response");
    // Accept only a byte-for-byte read-back of the new generation, not just an upload receipt.
    const readBack = await this.get(result.data.id);
    if (!readBack.equals(bytes)) throw new PriceError("drive_readback_mismatch");
    return { id: result.data.id, bytes: readBack };
  }
}
