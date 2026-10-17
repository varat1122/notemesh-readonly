"use strict";
// Offline, operator-invoked byte-preserving import for the protected Obsidian
// source archive. This is deliberately NOT a public HTTP endpoint or an MCP
// action. Safe Edit's protected-folder guard remains intact.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CATEGORIES = new Set(["Company Filings", "Earnings", "News", "Research"]);
const EXTENSIONS = new Set([".pdf", ".html", ".htm", ".txt", ".json", ".csv", ".zip"]);
const MAX_BYTES = 20_000_000;
const MIN_FREE_AFTER_WRITE = 50_000_000;
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

function fail(message) { throw new Error(message); }
function safePart(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(value)
    || value === "." || value === "..") fail("Invalid " + label);
  return value;
}
function validDay(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(value + "T00:00:00Z"))
    || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) fail("Invalid " + label);
  return value;
}
function validTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)
    || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    fail("retrievedAt must contain timezone");
  return value;
}
function validURL(value) {
  if (typeof value !== "string" || value.length > 1800) fail("Invalid originalUrl");
  let u;
  try { u = new URL(value); } catch { fail("Invalid originalUrl"); }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password
    || u.hash) fail("originalUrl must be a direct HTTPS URL without credentials or fragment");
  if (/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|.*\.local)$/i.test(u.hostname))
    fail("Local/nonpublic URL forbidden");
  return u.href;
}
function validateManifest(m, bytes, filename) {
  if (!m || typeof m !== "object" || Array.isArray(m)) fail("Invalid manifest");
  if (!CATEGORIES.has(m.category)) fail("Unknown source category");
  const issuer = safePart(m.issuer, "issuer");
  const period = typeof m.period === "string" && m.period.length <= 120 && m.period.trim()
    ? m.period.trim() : fail("Invalid reporting period");
  const originalUrl = validURL(m.originalUrl);
  const publishedAt = validDay(m.publishedAt ?? null, "publishedAt");
  const eventDate = validDay(m.eventDate ?? null, "eventDate");
  const retrievedAt = validTime(m.retrievedAt);
  const expected = m.expectedSha256;
  if (expected !== undefined && (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)))
    fail("Invalid expectedSha256");
  const digest = sha256(bytes);
  if (expected !== undefined && digest !== expected) fail("Source SHA-256 mismatch");
  const ext = path.extname(filename).toLowerCase();
  if (!EXTENSIONS.has(ext)) fail("Source extension not allowed");
  if (ext === ".pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") fail("Bad PDF header");
  if (ext === ".zip" && !["504b0304", "504b0506", "504b0708"].includes(bytes.subarray(0, 4).toString("hex")))
    fail("Bad ZIP header");
  if (ext === ".json") { try { JSON.parse(bytes.toString("utf8")); } catch { fail("Bad JSON source"); } }
  const year = (publishedAt ?? retrievedAt.slice(0, 10)).slice(0, 4);
  const prefix = path.posix.join("07_Sources", m.category, issuer, year);
  return {issuer, period, originalUrl, publishedAt, eventDate, retrievedAt,
    category:m.category, sha256:digest, bytes:bytes.length, extension:ext,
    documentPath:prefix + "/" + digest + ext, notePath:prefix + "/" + digest + ".md"};
}
function ensureSafePath(root, rel, create) {
  if (typeof rel !== "string" || rel.includes("\\") || rel.startsWith("/") ||
    rel.split("/").some(s => !s || s === "." || s === ".." || s.startsWith(".")))
    fail("Unsafe destination");
  const base = fs.realpathSync(root);
  if (!fs.statSync(base).isDirectory()) fail("Not a vault directory");
  let cursor = base;
  const parts = rel.split("/");
  for (const segment of parts.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) {
      if (!create) continue;
      fs.mkdirSync(cursor);
    }
    const s = fs.lstatSync(cursor);
    if (!s.isDirectory() || s.isSymbolicLink()) fail("Symlink/non-directory in source archive path");
  }
  const dest = path.join(base, ...parts);
  if (fs.existsSync(dest) && (fs.lstatSync(dest).isSymbolicLink() || !fs.lstatSync(dest).isFile()))
    fail("Existing destination is not a regular file");
  return dest;
}
function neverOverwrite(abs, bytes) {
  if (fs.existsSync(abs)) {
    if (sha256(fs.readFileSync(abs)) !== sha256(bytes)) fail("Existing file conflicts, never overwrite: " + abs);
    return "already_present_identical";
  }
  const flags=fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  const fd=fs.openSync(abs, flags, 0o600);
  try {
    let n=0;
    while (n < bytes.length) n += fs.writeSync(fd, bytes, n, bytes.length - n);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (sha256(fs.readFileSync(abs)) !== sha256(bytes)) fail("Readback checksum mismatch");
  return "written";
}
function note(m) {
  const yaml = (s) => JSON.stringify(s);
  return [
    "---",
    "type: immutable_original_source_receipt",
    "source_type: operator_supplied_original_bytes",
    "verification: not_reverified",
    "status: bytes_sha256_verified_issuer_content_not_verified",
    "issuer: " + yaml(m.issuer),
    "reporting_period: " + yaml(m.period),
    "category: " + yaml(m.category),
    "event_date: " + yaml(m.eventDate),
    "published_at: " + yaml(m.publishedAt),
    "retrieved_at: " + yaml(m.retrievedAt),
    "original_url: " + yaml(m.originalUrl),
    "source_sha256: " + yaml(m.sha256),
    "source_bytes: " + m.bytes,
    "original_file: " + yaml(m.documentPath),
    "---",
    "",
    "# Original source bytes — archive receipt",
    "",
    "**Bytes preserved and SHA-256 independently read back.** This does NOT",
    "verify the issuer's identity, the document's factual content, or an investment claim.",
    "",
    "- Raw attachment: [[" + m.documentPath + "|View the preserved original]]",
    "- Original HTTPS URL: " + m.originalUrl,
    "- Fiscal period: " + m.period.replace(/[\r\n]/g," "),
    "- SHA-256 of exact stored original bytes: " + m.sha256,
    "",
    "No claim ID, Current Thesis update or portfolio action was generated.",
    ""
  ].join("\n");
}
function importSource({vault, sourceFile, manifest, commit=false, receiptDir}) {
  if (typeof vault !== "string" || typeof sourceFile !== "string") fail("Missing paths");
  const st = fs.lstatSync(sourceFile);
  if (st.isSymbolicLink() || !st.isFile() || st.size < 1 || st.size > MAX_BYTES)
    fail("Source must be a regular nonempty file of at most 20 MB");
  const bytes=fs.readFileSync(sourceFile);
  const m=validateManifest(manifest, bytes, sourceFile);
  const root=fs.realpathSync(vault);
  const archiveRoot=ensureSafePath(root, "07_Sources/" + m.category + "/source_path_check", false);
  // The category directory itself must already exist, regardless of --commit.
  if (!fs.statSync(path.dirname(archiveRoot)).isDirectory()) fail("Source category folder is missing");
  const destination=ensureSafePath(root,m.documentPath,false);
  const meta=ensureSafePath(root,m.notePath,false);
  const md=Buffer.from(note(m),"utf8");
  if (fs.existsSync(destination) && sha256(fs.readFileSync(destination)) !== m.sha256)
    fail("Existing raw source hash conflict");
  if (fs.existsSync(meta) && sha256(fs.readFileSync(meta)) !== sha256(md))
    fail("Existing receipt conflict");
  const plan={mode:commit?"commit":"dry_run",originalSource:m.originalUrl,issuer:m.issuer,
    category:m.category,documentPath:m.documentPath,notePath:m.notePath,
    sha256:m.sha256,bytes:m.bytes,verification:"not_reverified"};
  if (!commit) return plan;
  const free=fs.statfsSync(root);
  if (free.bavail * free.bsize < MIN_FREE_AFTER_WRITE + bytes.length + md.length)
    fail("Insufficient vault disk headroom");
  ensureSafePath(root,m.documentPath,true);
  ensureSafePath(root,m.notePath,true);
  const documentStatus=neverOverwrite(destination,bytes);
  const receiptStatus=neverOverwrite(meta,md);
  if (receiptDir) {
    if (!fs.existsSync(receiptDir) || !fs.statSync(receiptDir).isDirectory()
      || fs.lstatSync(receiptDir).isSymbolicLink()) fail("Invalid external receipt directory");
    const proof=Buffer.from(JSON.stringify({...plan,documentStatus,receiptStatus,operatorReceipt:"bytes_checked_only"},null,2)+"\n");
    neverOverwrite(path.join(receiptDir,m.sha256+".json"),proof);
  }
  return {...plan,documentStatus,receiptStatus,readback:"sha256_verified"};
}
function parseCli(argv) {
  const args={commit:false};
  for(let i=0;i<argv.length;i++){
    const t=argv[i];
    if(t==="--commit"){args.commit=true;continue;}
    const map={"--vault":"vault","--file":"sourceFile","--manifest":"manifestPath","--receipt-dir":"receiptDir"};
    if(!map[t] || !argv[i+1]) fail("Unknown or incomplete CLI option: "+t);
    args[map[t]]=argv[++i];
  }
  if(!args.vault||!args.sourceFile||!args.manifestPath)fail("Usage: node scripts/primary-source-importer.cjs --vault PATH --manifest manifest.json --file original.pdf [--commit] [--receipt-dir EXISTING_DIR]");
  return args;
}
if(require.main===module){
  try{
    const opts=parseCli(process.argv.slice(2));
    const raw=fs.readFileSync(opts.manifestPath,"utf8");
    if(Buffer.byteLength(raw)>20_000)fail("Manifest too large");
    const manifest=JSON.parse(raw);
    process.stdout.write(JSON.stringify(importSource({...opts,manifest}),null,2)+"\n");
  }catch(e){process.stderr.write(String(e.message||e)+"\n");process.exitCode=1;}
}
module.exports={importSource,validateManifest,ensureSafePath,neverOverwrite};
