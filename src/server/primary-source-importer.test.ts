import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { importSource } = require("../../scripts/primary-source-importer.cjs") as {
  importSource: (x: Record<string, unknown>) => {
    mode: string; documentPath: string; notePath: string; sha256: string;
    documentStatus?: string; receiptStatus?: string; readback?: string;
  };
};

let root: string;
let vault: string;
let sourceFile: string;
const raw = Buffer.from('{"company":"NVDA","metric":"revenue"}\n');
const manifest = {
  issuer: "NVDA", category: "Earnings", period: "FY27Q2",
  eventDate: "2026-08-26", publishedAt: "2026-08-26",
  retrievedAt: "2026-10-17T08:30:00+07:00",
  originalUrl: "https://investor.example.com/earnings/2026/report.json",
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "primary-source-test-"));
  vault = path.join(root, "vault");
  fs.mkdirSync(path.join(vault, "07_Sources", "Earnings"), { recursive: true });
  sourceFile = path.join(root, "issuer.json");
  fs.writeFileSync(sourceFile, raw);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("offline immutable source archive importer", () => {
  it("dry run never writes files or subdirectories", () => {
    const result = importSource({ vault, sourceFile, manifest });
    expect(result.mode).toBe("dry_run");
    expect(result.documentPath).toMatch(/^07_Sources\/Earnings\/NVDA\/2026\/[a-f0-9]{64}\.json$/);
    expect(fs.existsSync(path.join(vault, "07_Sources", "Earnings", "NVDA"))).toBe(false);
  });

  it("preserves original bytes, SHA-256 and an explicitly unverified note", () => {
    const result = importSource({ vault, sourceFile, manifest, commit: true });
    expect(result.mode).toBe("commit");
    expect(result.documentStatus).toBe("written");
    expect(result.readback).toBe("sha256_verified");
    expect(fs.readFileSync(path.join(vault, result.documentPath))).toEqual(raw);
    expect(result.sha256).toBe(crypto.createHash("sha256").update(raw).digest("hex"));
    const md = fs.readFileSync(path.join(vault, result.notePath), "utf8");
    expect(md).toContain("verification: not_reverified");
    expect(md).toContain("source_sha256: " + JSON.stringify(result.sha256));
    expect(md).not.toContain("verified_against_primary");
  });

  it("allows idempotent import of identical original source", () => {
    importSource({ vault, sourceFile, manifest, commit: true });
    const again = importSource({ vault, sourceFile, manifest, commit: true });
    expect(again.documentStatus).toBe("already_present_identical");
    expect(again.receiptStatus).toBe("already_present_identical");
  });

  it("rejects mismatched claimed SHA-256 without creating company folder", () => {
    expect(() => importSource({ vault, sourceFile,
      manifest: { ...manifest, expectedSha256: "0".repeat(64) }, commit: true }))
      .toThrow(/SHA-256 mismatch/);
    expect(fs.existsSync(path.join(vault, "07_Sources", "Earnings", "NVDA"))).toBe(false);
  });

  it("refuses unsafe URL and issuer names", () => {
    expect(() => importSource({ vault, sourceFile,
      manifest: { ...manifest, issuer: "../NVDA" }, commit: true })).toThrow();
    expect(() => importSource({ vault, sourceFile,
      manifest: { ...manifest, originalUrl: "http://localhost/internal" }, commit: true })).toThrow();
  });

  it("refuses to overwrite a conflicted receipt", () => {
    const result = importSource({ vault, sourceFile, manifest, commit: true });
    fs.writeFileSync(path.join(vault, result.notePath), "changed");
    expect(() => importSource({ vault, sourceFile, manifest, commit: true })).toThrow(/receipt conflict/);
    expect(fs.readFileSync(path.join(vault, result.notePath), "utf8")).toBe("changed");
  });

  it("refuses a symlink directory pointing outside the Vault", () => {
    fs.symlinkSync(root, path.join(vault, "07_Sources", "Earnings", "NVDA"));
    expect(() => importSource({ vault, sourceFile, manifest, commit: true })).toThrow(/Symlink/);
  });

  it("validates PDF and ZIP headers rather than only extension", () => {
    const badPdf = path.join(root, "fake.pdf"); fs.writeFileSync(badPdf, "not a pdf");
    expect(() => importSource({ vault, sourceFile: badPdf,
      manifest: { ...manifest, category: "Company Filings" } })).toThrow();
    const badZip = path.join(root, "fake.zip"); fs.writeFileSync(badZip, "not a zip");
    expect(() => importSource({ vault, sourceFile: badZip,
      manifest: { ...manifest, category: "Company Filings" } })).toThrow();
  });
});
