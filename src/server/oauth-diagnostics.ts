import type Database from "better-sqlite3";
import { db } from "./db";

// Diagnostic data only. Never use consent or refresh records to authorize a
// request; the current verified bearer token remains the authority.
const knownScopes = new Set(["openid", "profile", "email", "offline_access", "vault:read", "vault:write", "inbox:submit"]);
export function diagnosticScopes(value: unknown): string[] {
  let values: unknown = value;
  if (typeof value === "string") {
    try { values = JSON.parse(value); } catch { values = value.split(/[\s,]+/); }
  }
  return Array.isArray(values)
    ? [...new Set(values.filter((v): v is string => typeof v === "string" && knownScopes.has(v)))].sort()
    : [];
}

export function oauthScopeDiagnostics(clientId: string, connection: Database.Database = db()) {
  try {
    const client = connection.prepare('SELECT scopes FROM "oauthClient" WHERE clientId = ?').get(clientId) as {scopes: unknown} | undefined;
    if (!client) return null;
    const consents = connection.prepare('SELECT scopes FROM "oauthConsent" WHERE clientId = ?').all(clientId) as {scopes: unknown}[];
    // Select scope metadata only: no token, secret, identity, or replay fields.
    const refresh = connection.prepare('SELECT scopes, expiresAt, revoked FROM "oauthRefreshToken" WHERE clientId = ?').all(clientId) as {scopes: unknown; expiresAt: string | number; revoked: unknown}[];
    const active = refresh.filter(r => !r.revoked && (typeof r.expiresAt === "number" ? r.expiresAt : Date.parse(r.expiresAt)) > Date.now());
    return {
      registeredScopes: diagnosticScopes(client.scopes),
      approvedScopes: diagnosticScopes(consents.flatMap(r => diagnosticScopes(r.scopes))),
      activeRefreshScopes: diagnosticScopes(active.flatMap(r => diagnosticScopes(r.scopes))),
      activeRefreshCount: active.length,
    };
  } catch { return null; }
}
