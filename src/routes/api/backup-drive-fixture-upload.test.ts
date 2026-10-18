import {beforeEach, afterEach, expect, it, vi} from "vitest";
const vars=vi.hoisted(()=>({user:"fixture-admin" as string|null,driveRuns:0}));
vi.mock("~/server/auth",()=>({runAuthMigrations:async()=>{},
  auth:{api:{getSession:async()=>vars.user?{user:{id:vars.user},session:{id:"fixture-session"}}:null}}}));
vi.mock("~/server/backup/drive-auth",()=>({
  driveSetupEnabled:()=>true,
  driveSetupClient:()=>({id:"fixture-id.apps.googleusercontent.com",secret:"fixture-secret"}),
  openDrCredential:()=>({refreshToken:"fixture-refresh",clientId:"fixture-id.apps.googleusercontent.com",
    scope:"https://www.googleapis.com/auth/drive.file"}),
  DR_DRIVE_SCOPE:"https://www.googleapis.com/auth/drive.file",
}));
vi.mock("~/server/backup/drive-fixture",()=>({
  driveSyntheticFixtureTest:async()=>{vars.driveRuns++;return {
    passed:true,appCreatedFolderName:"NoteMesh-DR-Staging-Fixture-123",
    sha256:"b".repeat(64),encryptedBytes:128,
  };},
}));
import { POST } from "./backup-drive/fixture-upload";
import { issueDrConsentFormProof } from "~/server/backup/drive-consent-form";
import { env } from "~/server/env";

const origin="https://dr-fixture.example";
const event=(options:{origin?:string,proof?:string}={})=>({
  request:new Request(origin+"/api/backup-drive/fixture-upload",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded",
      ...(options.origin?{Origin:options.origin}:{})},
    body:new URLSearchParams({dr_consent_proof:options.proof??issueDrConsentFormProof("fixture-session",env.encryptionKey)}),
  })
}) as Parameters<typeof POST>[0];
beforeEach(()=>{
  vars.user="fixture-admin";vars.driveRuns=0;
  vi.stubEnv("BASE_URL",origin);
  vi.stubEnv("ENCRYPTION_KEY","31".repeat(32));
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME","staging");
  vi.stubEnv("NOTEMESH_DRIVE_FIXTURE_TEST_ENABLED","1");
  vi.stubEnv("NOTEMESH_DRIVE_CREDENTIAL","fixture-envelope-never-leaked");
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it("never permits writing outside staging",async()=>{
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME","production");
  expect((await POST(event())).status).toBe(403);
  expect(vars.driveRuns).toBe(0);
});
it("rejects a disabled explicit upload gate",async()=>{
  vi.stubEnv("NOTEMESH_DRIVE_FIXTURE_TEST_ENABLED","0");
  expect((await POST(event())).status).toBe(403);
  expect(vars.driveRuns).toBe(0);
});
it("rejects unauthenticated users",async()=>{
  vars.user=null;
  expect((await POST(event())).status).toBe(401);
  expect(vars.driveRuns).toBe(0);
});
it("rejects cross-origin or unverifiable forms",async()=>{
  expect((await POST(event({origin:"https://attacker.invalid"}))).status).toBe(403);
  expect((await POST(event({proof:"invalid"}))).status).toBe(403);
  expect(vars.driveRuns).toBe(0);
});
it("issues exactly one explicit Google Drive synthetic write after admin CSRF proof",async()=>{
  const spy=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({
    access_token:"fixture-access-token",token_type:"Bearer",
    scope:"https://www.googleapis.com/auth/drive.file",
  }));
  const response=await POST(event({origin}));
  expect(response.status).toBe(200);
  const body=await response.text();
  expect(body).toContain("PASS:");
  expect(body).toContain("No Vault");
  expect(body).not.toContain("fixture-refresh");
  expect(body).not.toContain("fixture-access-token");
  expect(vars.driveRuns).toBe(1);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/token");
  expect((await POST(event({origin}))).status).toBe(409);
  expect(vars.driveRuns).toBe(1);
});
