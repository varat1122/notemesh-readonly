import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAccess } from "./server";
import { canSaveAnalysis, resourceMetadataUrl } from "./endpoint";
import { registerIntakeTools } from "./intake-tools";

// Every tool on this endpoint has the same required scopes, so clients never
// establish a read-only connection while discovering a separate write tool.
export function createSaveMcpServer(access: McpAccess): McpServer {
  const server = new McpServer({
    name: "investment-os-save-analysis",
    title: "Investment OS — Save Linked Notes",
    version: "1.3.0",
  });
  registerIntakeTools(server, canSaveAnalysis(access), resourceMetadataUrl("save-analysis"));
  return server;
}
