import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({signedIn:true,prepared:[] as unknown[],issued:[] as unknown[],revoked:[] as unknown[]}));
vi.mock("~/server/auth",()=>({runAuthMigrations:async()=>{},auth:{api:{getSession:async()=>
  state.signedIn?{user:{id:"synthetic-human"}}:null}}}));
vi.mock("~/server/env",()=>({env:{baseUrl:"https://primary-approval-fixture.test"}}));
vi.mock("~/server/audit",()=>({audit:()=>{}}));
vi.mock("~/server/vault/primary-evidence-attestation-m551",async(importOriginal)=>{
  const original=await importOriginal<typeof import("~/server/vault/primary-evidence-attestation-m551")>();
  return {...original,
    preparePrimaryEvidenceAttestation:(...args:unknown[])=>{state.prepared.push(args);return {phase:"unsigned_preparation"};},
    importSignedPrimaryEvidence:(...args:unknown[])=>{state.issued.push(args);return {status:"issued"};},
    revokePrimaryEvidenceReceipt:(...args:unknown[])=>{state.revoked.push(args);return {status:"revoked"};}}
});
import {GET,POST} from "./primary-evidence-receipt";
const target="https://primary-approval-fixture.test/api/primary-evidence-receipt";
const original={version:"M551-PRIMARY-1",snapshotId:"a".repeat(64),sourceSha256:"b".repeat(64),
  primarySourceUrl:"https://www.sec.gov/Archives/test.htm",entity:"MU",metric:"revenue guidance",
  period:"FY2027",unit:"% YoY",verifiedValue:"+20%",sourceLocator:"Page 2 guidance paragraph",
  rawSourceExcerpt:"FY2027 guidance +20% YoY",reviewedAt:"2026-10-26T12:00:00.000Z",
  primaryOriginAdjudicated:true,conflictingValuesAdjudicated:true,counterClaims:[{
    value:"-20%",sourceUrl:null,sourceLabel:"Unverified claim",publishedAt:null,
    disposition:"unverified",rationale:"Original filing does not substantiate this contrary claim."
  }]};
const signed={attestation:original,
  reviewer:{keyId:"approved-reviewer",signatureBase64:"a".repeat(88)},
  approver:{keyId:"approved-approver",signatureBase64:"b".repeat(88)}};
const event=(request:Request)=>({request}) as Parameters<typeof POST>[0];
const post=(body:unknown,origin="https://primary-approval-fixture.test")=>
  POST(event(new Request(target,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},
    body:JSON.stringify(body)})));
beforeEach(()=>{state.signedIn=true;state.prepared=[];state.issued=[];state.revoked=[];});

it("rejects unauthenticated issue even with a caller-provided OAuth-looking payload",async()=>{
  state.signedIn=false;
  expect((await post({action:"issue",signed})).status).toBe(401);
  expect(state.issued).toHaveLength(0);
});
it("rejects missing/foreign origin for every approval action",async()=>{
  for(const action of [{action:"prepare",attestation:original},{action:"issue",signed},
    {action:"revoke",receiptId:"PEV-"+"A".repeat(32),reason:"Correction found in source"}]){
    expect((await post(action,"https://evil.example")).status).toBe(403);
  }
  const noOrigin=new Request(target,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"issue",signed})});
  expect((await POST(event(noOrigin))).status).toBe(403);
  expect(state.issued).toHaveLength(0);
});
it("routes prepare, issue and irreversible revoke only after session and same-origin checks",async()=>{
  expect((await post({action:"prepare",attestation:original})).status).toBe(200);
  expect(state.prepared).toHaveLength(1);
  expect(state.issued).toHaveLength(0);
  expect((await post({action:"issue",signed})).status).toBe(200);
  expect(state.issued).toEqual([[signed,"admin:synthetic-human"]]);
  const receiptId="PEV-"+"A".repeat(32);
  expect((await post({action:"revoke",receiptId,reason:"Material amendment supersedes the value"})).status).toBe(200);
  expect(state.revoked).toEqual([[receiptId,"Material amendment supersedes the value","admin:synthetic-human"]]);
});
it("rejects unknown fields, incomplete signatures, oversized JSON, and GET",async()=>{
  expect((await post({action:"issue",signed:{...signed,administratorApproved:true}})).status).toBe(400);
  expect((await post({action:"issue",signed:{...signed,approver:undefined}})).status).toBe(400);
  expect((await post({action:"prepare",attestation:{...original,sourceLocator:"x".repeat(17000)}})).status).toBe(400);
  expect((await GET()).status).toBe(405);
  expect(state.issued).toHaveLength(0);
});
