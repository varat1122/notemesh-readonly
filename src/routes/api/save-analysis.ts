import type { APIEvent } from "@solidjs/start/server";
import { handleMcpPost, handleMcpOtherMethod } from "~/server/mcp/endpoint-route";
import { tracked } from "~/server/maintenance";

export const POST = tracked((event: APIEvent) => handleMcpPost(event, "save-analysis"), { holdUntilClose: true });
export const GET = tracked((event: APIEvent) => handleMcpOtherMethod(event, "save-analysis"));
export const DELETE = tracked((event: APIEvent) => handleMcpOtherMethod(event, "save-analysis"));