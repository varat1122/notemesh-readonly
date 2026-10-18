import { describe, expect, it } from "vitest";
import { isKnownApiPath } from "./api-paths";

describe("fail-closed API routing", () => {
  it.each([
    "/api/backup-drive",
    "/api/backup-drive/callback",
    "/api/backup-drive/credential-check",
    "/api/backup-drive/fixture-upload",
    "/api/health",
    "/api/mcp",
    "/api/market-prices-drive",
    "/api/safe-edit",
    "/api/auth/session",
    "/api/rpc/getSetupProgress",
  ])("allows known exact or deliberately prefixed route %s", (path) => {
    expect(isKnownApiPath(path)).toBe(true);
  });

  it.each([
    "/api/backup-drive/credential-check/extra",
    "/api/backup-drive/fixture-upload/extra",
    "/api/backup-drive/fixture-upload-evil",
    "/api/backup-drive/credential-check-evil",
    "/api/backup-drive/foo",
    "/api/backup-drive/callback/extra",
    "/api/mcp-malicious",
    "/api/healthz",
    "/api/market-prices-drive-evil",
    "/api/unknown",
  ])("rejects unregistered API route %s", (path) => {
    expect(isKnownApiPath(path)).toBe(false);
  });
});
