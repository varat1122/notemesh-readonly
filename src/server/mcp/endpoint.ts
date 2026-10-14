import { env } from "../env";
import type { McpAccess } from "./server";

export type McpEndpoint = "research" | "save-analysis";
export const SAVE_SCOPES = ["vault:read", "inbox:submit"] as const;

export function mcpResourceUrl(endpoint: McpEndpoint): string {
  return `${env.baseUrl}/api/${endpoint === "research" ? "mcp" : "save-analysis"}`;
}

export function resourceMetadataUrl(endpoint: McpEndpoint): string {
  return `${env.baseUrl}/.well-known/oauth-protected-resource${endpoint === "research" ? "" : "/api/save-analysis"}`;
}

export function protectedResourceMetadata(endpoint: McpEndpoint) {
  return {
    resource: mcpResourceUrl(endpoint),
    authorization_servers: [`${env.baseUrl}/api/auth`],
    scopes_supported: [...SAVE_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

export function oauthChallenge(endpoint: McpEndpoint, insufficientScope = false): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(endpoint)}", ` +
    (insufficientScope ? 'error="insufficient_scope", ' : "") +
    `scope="${SAVE_SCOPES.join(" ")}"`;
}

// Do not derive this from approved consent, a client's registered scopes, or
// convenience flags. Only scopes carried by the verified OAuth access token
// authorize a submission. API keys never authorize this endpoint.
export function canSaveAnalysis(access: McpAccess): boolean {
  return access.label.startsWith("oauth:") &&
    SAVE_SCOPES.every((scope) => access.scopes?.includes(scope));
}

export function saveScopeRequired(): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0", id: null,
    error: { code: -32004, message: "Saving analysis requires the vault:read and inbox:submit OAuth scopes." },
  }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": oauthChallenge("save-analysis", true),
    },
  });
}
