import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { enqueue, intakeSchema, intakeStatus } from "../intake";
import { env } from "../env";
const securitySchemes = [{type:"oauth2",scopes:["vault:read","inbox:submit"]}];
function needsConsent(metadataUrl:string){
  return {isError:true,content:[{type:"text" as const,text:"Analysis was not submitted. Approve the inbox:submit OAuth scope for this connection first."}],
    _meta:{"mcp/www_authenticate":[`Bearer resource_metadata="${metadataUrl}", error="insufficient_scope", error_description="Approve inbox:submit to save new linked analysis notes", scope="vault:read inbox:submit"`]}};
}
export function registerIntakeTools(server:McpServer, granted:boolean, metadataUrl=`${env.baseUrl}/.well-known/oauth-protected-resource`){
  server.registerTool("submit_investment_notes",{
    title:"Save analysis to Investment OS inbox",
    description:"Queue completed investment analysis for import as new Markdown notes in Investment_OS. Each item contains source material, analysis, an event date, and existing related note paths for wikilinks. Returns a durable submission receipt. Identical payloads are deduplicated. This action creates new content; it cannot edit or delete existing notes. The Railway cloud receiver imports queued packages without the user computer. imported confirms server files; arrival on other devices depends on Obsidian Sync.",
    inputSchema:intakeSchema.shape,
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    _meta:{securitySchemes},
  },async input=>{if(!granted)return needsConsent(metadataUrl);try{return {content:[{type:"text" as const,text:JSON.stringify(enqueue(input))}]};}catch(e){return {isError:true,content:[{type:"text" as const,text:e instanceof Error?e.message:"Submission failed"}]};}});
  server.registerTool("get_submission_status",{
    description:"Read a submission receipt by ID. Status is queued, imported, or blocked. imported confirms files were written by the receiver and includes their paths. Cloud receipts do not require the user computer. Reading through NoteMesh and arrival on another device are separate checks.",
    inputSchema:{id:z.string().regex(/^[a-f0-9]{64}$/).describe("Submission ID returned by submit_investment_notes")},annotations:{readOnlyHint:true,openWorldHint:false},
    _meta:{securitySchemes},
  },async({id})=>{if(!granted)return needsConsent(metadataUrl);try{return {content:[{type:"text" as const,text:JSON.stringify(intakeStatus(id))}]};}catch{return {isError:true,content:[{type:"text" as const,text:"Unknown submission"}]};}});
}
