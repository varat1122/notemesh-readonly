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
    title:"LEGACY: Inbox-only analysis archive (not canonical Company/Industry Review)",
    description:"LEGACY INBOX-ONLY ARCHIVE. This tool always imports N01.md/N02.md and Submission.md under 00_Inbox/ChatGPT/<date>-<submission-id>/; it NEVER places a Research Review under Company/Industry/Macro knowledge folders. DO NOT call it for newly analyzed Micro/Macro/PDF/Stock news when canonical Company/Industry/Macro writeback is requested or authorized. Instead call plan_investment_writeback with sourceChat and completedAnalysis on Investment OS -NoteMesh V2, then use separately authorized Investment OS — Safe Edit Chat create_note/apply_edit for the planner's exact add-only Source and canonical Research Review steps. Only use this legacy tool if the user specifically requests an Inbox-only archive; no automatic conversion to canonical is implied. Identical payloads deduplicate; cloud import confirms server files, not device Sync.",
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
