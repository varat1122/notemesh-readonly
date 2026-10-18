import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { driveSyntheticFixtureTest } from "./drive-fixture";

const folderId = "STAGING_FIXTURE_FOLDER_123456";
const fileId = "STAGING_FIXTURE_FILE_123456";
const token = "fixture-access-token";
function fakeDrive({corrupt=false}:{corrupt?:boolean}={}) {
  let binary = Buffer.alloc(0);
  let fileName = "", folderName = "", sha256 = "";
  const called:string[]=[];
  const fetcher = vi.fn(async (input: string | URL | Request, options?:RequestInit) => {
    const url=String(input);
    called.push(url);
    expect(options?.headers).toBeDefined();
    const hdr=options?.headers as Record<string,string>;
    expect(hdr.Authorization).toBe("Bearer " + token);
    expect(options?.redirect).toBe("error");
    if(url==="https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType"){
      expect(options?.method).toBe("POST");
      const body=JSON.parse(String(options!.body));
      expect(body.mimeType).toBe("application/vnd.google-apps.folder");
      folderName=body.name;
      expect(folderName).toMatch(/^NoteMesh-DR-Staging-Fixture-/);
      return Response.json({id:folderId,name:folderName,mimeType:body.mimeType});
    }
    if(url.startsWith("https://www.googleapis.com/upload/drive/v3/files?")){
      expect(options?.method).toBe("POST");
      const b=Buffer.from(options!.body as Uint8Array);
      const begin=b.indexOf(Buffer.from("NMDRFIX1"));
      expect(begin).toBeGreaterThan(0);
      const terminator=b.indexOf(Buffer.from("\r\n--nm-dr-fixture-"),begin);
      expect(terminator).toBeGreaterThan(begin);
      binary=b.subarray(begin,terminator);
      expect(binary.length).toBeGreaterThan(50);
      const metadata=JSON.parse(b.subarray(0,begin).toString("utf8").split("\r\n\r\n")[1]!.split("\r\n--")[0]!);
      fileName=metadata.name;
      sha256=metadata.appProperties.sha256;
      expect(metadata.parents).toEqual([folderId]);
      return Response.json({id:fileId,name:fileName,size:String(binary.length),
        parents:[folderId],appProperties:{sha256}});
    }
    if(url==="https://www.googleapis.com/drive/v3/files/"+fileId+"?alt=media"){
      expect(options?.method).toBeUndefined();
      const served=Buffer.from(binary);
      if(corrupt)served[25]^=1;
      return new Response(new Uint8Array(served),{status:200});
    }
    throw Error("Unexpected Google call: "+url);
  });
  return {fetcher,called};
}
beforeEach(()=>{});
afterEach(()=>vi.restoreAllMocks());
it("creates a new app-owned folder, uploads encrypted SYNTHETIC data, readbacks ciphertext and decrypts",async()=>{
  const t=fakeDrive();
  const receipt=await driveSyntheticFixtureTest(token,t.fetcher as unknown as typeof fetch);
  expect(receipt.passed).toBe(true);
  expect(receipt.kind).toBe("synthetic-encrypted-fixture-only");
  expect(receipt.noVaultDataAccess).toBe(true);
  expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.encryptedBytes).toBeLessThan(2048);
  expect(t.called).toHaveLength(3);
  expect(t.called.every(x=>x.startsWith("https://www.googleapis.com/"))).toBe(true);
  expect(t.called.every(x=>!x.includes("delete")&&!x.includes("permissions"))).toBe(true);
});
it("fails closed if downloaded encrypted bytes differ by one bit",async()=>{
  const t=fakeDrive({corrupt:true});
  await expect(driveSyntheticFixtureTest(token,t.fetcher as unknown as typeof fetch)).rejects.toThrow(/SHA-256 mismatch/);
  expect(t.called).toHaveLength(3);
});
it("rejects blank access token without Google calls",async()=>{
  const t=fakeDrive();
  await expect(driveSyntheticFixtureTest("",t.fetcher as unknown as typeof fetch)).rejects.toThrow(/Missing Drive/);
  expect(t.called).toHaveLength(0);
});
