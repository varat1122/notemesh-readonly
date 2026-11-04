import { createServer } from "node:http";
import type { Runner } from "./runner";

export function controlServer(runner: Runner) {
  const server = createServer(async (req, res) => {
    // Losing the response must not cancel an admitted operation or its terminal
    // audit. Runner completion is independent of HTTP connection lifetime.
    res.on("error", () => { /* terminal audit belongs to Runner, not the socket */ });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // There is deliberately no unauthenticated inspection/health endpoint.
    if (req.method !== "POST" || req.url !== "/v1/maintenance") { res.writeHead(404); res.end('{"error":"NOT_FOUND"}'); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) { res.writeHead(413); res.end('{"error":"PAYLOAD_TOO_LARGE"}'); return; }
        chunks.push(Buffer.from(chunk));
      }
      const header = (name: string) => typeof req.headers[name] === "string" ? req.headers[name] as string : "";
      const result = await runner.execute(Buffer.concat(chunks).toString("utf8"), header("x-ios-key-id"), header("x-ios-signature"));
      if (!res.destroyed) { res.writeHead(result.status); res.end(JSON.stringify(result.body)); }
    } catch {
      if (!res.destroyed) { res.writeHead(503); res.end('{"terminal":"HOLD","error":"CONTROL_UNAVAILABLE"}'); }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 20;
  server.maxConnections = 16;
  return server;
}
