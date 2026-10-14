import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { diagnosticScopes, oauthScopeDiagnostics } from "./oauth-diagnostics";

it("reports only scope metadata for the selected client, preserving narrow refresh grants", () => {
  const d = new Database(":memory:");
  try {
    d.exec('CREATE TABLE oauthClient (clientId TEXT, scopes TEXT, clientSecret TEXT); CREATE TABLE oauthConsent (clientId TEXT, scopes TEXT); CREATE TABLE oauthRefreshToken (clientId TEXT, scopes TEXT, expiresAt INTEGER, revoked TEXT, token TEXT);');
    d.prepare('INSERT INTO oauthClient VALUES (?, ?, ?)').run("own", '["vault:read","inbox:submit"]', "SECRET");
    d.prepare('INSERT INTO oauthConsent VALUES (?, ?)').run("own", '["vault:read","inbox:submit"]');
    d.prepare('INSERT INTO oauthConsent VALUES (?, ?)').run("other", '["vault:write"]');
    d.prepare('INSERT INTO oauthRefreshToken VALUES (?, ?, ?, ?, ?)').run("own", '["vault:read"]', Date.now()+60000, null, "TOKEN");
    d.prepare('INSERT INTO oauthRefreshToken VALUES (?, ?, ?, ?, ?)').run("own", '["inbox:submit"]', Date.now()-1, null, "EXPIRED");
    d.prepare('INSERT INTO oauthRefreshToken VALUES (?, ?, ?, ?, ?)').run("own", '["inbox:submit"]', Date.now()+60000, "revoked", "REVOKED");
    const result = oauthScopeDiagnostics("own", d);
    expect(result).toEqual({registeredScopes:["inbox:submit","vault:read"], approvedScopes:["inbox:submit","vault:read"], activeRefreshScopes:["vault:read"], activeRefreshCount:1});
    expect(JSON.stringify(result)).not.toMatch(/SECRET|TOKEN|EXPIRED|REVOKED|vault:write|own|other/);
    expect(oauthScopeDiagnostics("absent", d)).toBeNull();
  } finally { d.close(); }
});
it("filters malformed values and unknown strings from diagnostic output", () => {
  expect(diagnosticScopes('["vault:read","vault:read","arbitrary-secret",12]')).toEqual(["vault:read"]);
  expect(diagnosticScopes("vault:read, inbox:submit")).toEqual(["inbox:submit","vault:read"]);
  expect(diagnosticScopes('{"secret":"value"}')).toEqual([]);
});
