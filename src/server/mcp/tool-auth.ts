import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// SDK 1.30 lists _meta but does not emit top-level securitySchemes. Publish
// both representations so current ChatGPT clients and older clients agree.
export function withToolAuthMetadata(message: JSONRPCMessage): JSONRPCMessage {
  if (!("result" in message) || !Array.isArray(message.result.tools)) return message;
  return { ...message, result: { ...message.result, tools: message.result.tools.map((tool) => {
    const meta = tool._meta ?? {};
    const securitySchemes = meta.securitySchemes ?? [{type:"oauth2",scopes:["vault:read"]}];
    return { ...tool, securitySchemes, _meta: { ...meta, securitySchemes } };
  }) } };
}
