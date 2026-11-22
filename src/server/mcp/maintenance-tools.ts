import { assertMutationAllowed, beginWork, endWork } from "../maintenance";

type Execute = (this: unknown, tool: unknown, args: unknown, extra: unknown) => Promise<unknown>;

/**
 * Every MCP tool call is pending work from the moment the SDK executes it until
 * it settles. This is independent of the HTTP stream: a client that disconnects
 * closes the response, but the SDK still runs the tool to completion, and a
 * drain must wait for that — not for the socket.
 *
 * The SDK has no public hook for this; executeToolHandler is the single method
 * every tool call passes through. If a future SDK renames it, this throws and
 * the endpoint fails closed rather than serving untracked tools.
 */
export function trackToolExecution<S extends object>(server: S): S {
  const target = server as unknown as { executeToolHandler?: Execute };
  const execute = target.executeToolHandler;
  if (typeof execute !== "function") throw Error("MCP tool execution cannot be tracked; endpoint refused");
  target.executeToolHandler = async function (this: unknown, tool, args, extra) {
    assertMutationAllowed("tool call");
    const id = beginWork("mcp-tool");
    try {
      return await execute.call(this, tool, args, extra);
    } finally {
      endWork(id);
    }
  };
  return server;
}
