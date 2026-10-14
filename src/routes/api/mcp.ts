import type { APIEvent } from "@solidjs/start/server";
import { handleMcpPost, handleMcpOtherMethod } from "~/server/mcp/endpoint-route";

export const POST = (event: APIEvent) => handleMcpPost(event, "research");
export const GET = (event: APIEvent) => handleMcpOtherMethod(event, "research");
export const DELETE = GET;
