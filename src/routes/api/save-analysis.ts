import type { APIEvent } from "@solidjs/start/server";
import { handleMcpPost, handleMcpOtherMethod } from "~/server/mcp/endpoint-route";

export const POST = (event: APIEvent) => handleMcpPost(event, "save-analysis");
export const GET = (event: APIEvent) => handleMcpOtherMethod(event, "save-analysis");
export const DELETE = (event: APIEvent) => handleMcpOtherMethod(event, "save-analysis");
