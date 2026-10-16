import type { APIEvent } from "@solidjs/start/server";
import { handleMcpPost, handleMcpOtherMethod } from "~/server/mcp/endpoint-route";
export const POST = (event:APIEvent)=>handleMcpPost(event,"safe-edit");
export const GET = (event:APIEvent)=>handleMcpOtherMethod(event,"safe-edit");
export const DELETE = (event: APIEvent) => handleMcpOtherMethod(event, "safe-edit");
