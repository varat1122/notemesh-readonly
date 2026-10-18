import {expect,it} from "vitest";
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
