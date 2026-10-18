import {expect,it,vi} from "vitest";
// Vite's Vitest server resolver maps @solidjs/router's json helper to its
// client-only entry. Mock only that serializer for this route unit test.
vi.mock("@solidjs/router",()=>({
  json:(body:unknown,init?:ResponseInit)=>Response.json(body,init),
}));
import type {APIEvent} from "@solidjs/start/server";
import {POST} from "./rpc/[fn]";
import {inProcessDrWriterFence as fence} from "~/server/backup/writer-fence";

it("blocks new RPC requests before any lazy auth/schema/session work during freeze",async()=>{
  const invalid={
    params:{fn:"not-a-valid-name!"},
    request:new Request("https://fixture.example/api/rpc/not-a-valid-name!",{
      method:"POST",body:"[]",
    }),
  } as unknown as APIEvent;
  await fence.withFrozenWriters(async()=>{
    await expect(POST(invalid)).rejects.toThrow(/backup_writer_freeze_active/);
    expect(fence.status).toEqual({frozen:true,activeWriters:0});
  });
  const response=await POST(invalid);
  expect(response.status).toBe(400);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});
