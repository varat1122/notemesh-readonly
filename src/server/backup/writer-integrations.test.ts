import {expect, it} from "vitest";
import {inProcessDrWriterFence} from "./writer-fence";
import {storeUserAttachment} from "../user-attachment-vault";
import {captureOriginalDocumentBytes} from "../research-source-archive";
import {enqueue, acknowledge} from "../intake";
import {setSetting,deleteSetting} from "../db";

it("rejects attachment, original-source and intake SQLite mutations during a DR freeze",async()=>{
  // Inputs are intentionally invalid: the admission must refuse BEFORE any
  // decoding, filesystem, SQLite, ingest or source-archive side effect.
  await inProcessDrWriterFence.withFrozenWriters(async()=>{
    expect(()=>storeUserAttachment({base64:"",contentType:"application/pdf"})).toThrow(/backup_writer_freeze_active/);
    expect(()=>captureOriginalDocumentBytes({} as never)).toThrow(/backup_writer_freeze_active/);
    expect(()=>enqueue({})).toThrow(/backup_writer_freeze_active/);
    expect(()=>acknowledge({})).toThrow(/backup_writer_freeze_active/);
    expect(()=>setSetting("dr_test_key","fixture")).toThrow(/backup_writer_freeze_active/);
    expect(()=>deleteSetting("dr_test_key")).toThrow(/backup_writer_freeze_active/);
    expect(inProcessDrWriterFence.status.activeWriters).toBe(0);
  });
  expect(inProcessDrWriterFence.status).toEqual({frozen:false,activeWriters:0});
});
