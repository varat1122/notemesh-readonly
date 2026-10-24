// Exact API allowlist. Paths under /api not listed here fail closed before routing.
// Only paths ending in "/" are intentional prefix matches.
const API_PREFIXES = [
  "/api/health", "/api/mcp", "/api/save-analysis", "/api/safe-edit",
  "/api/safe-edit-approval", "/api/staging-git-pilot", "/api/staging-research-review", "/api/market-prices-drive",
  "/api/market-prices-drive/callback", "/api/backup-drive",
  "/api/backup-drive/callback", "/api/backup-drive/credential-check", "/api/backup-drive/fixture-upload",
  "/api/intake-worker", "/api/auth/", "/api/rpc/", "/api/attachment",
] as const;

export function isKnownApiPath(pathname: string): boolean {
  return API_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}
