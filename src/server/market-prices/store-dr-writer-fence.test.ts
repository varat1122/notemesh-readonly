import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {PriceStore} from "./store";
import {inProcessDrWriterFence as fence} from "../backup/writer-fence";

const roots:string[]=[];
const fresh=()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-price-fence-"));
  roots.push(dir);
  return path.join(dir,"prices.sqlite");
};
afterEach(()=>{
  for(const dir of roots.splice(0))fs.rmSync(dir,{recursive:true,force:true});
});

it("a writable PriceStore holds its ticket across direct SQLite writes until close",async()=>{
  const filename=fresh();
  const store=new PriceStore(filename,true);
  try {
    expect(fence.status.activeWriters).toBeGreaterThanOrEqual(1);
    expect(fence.getAdmissionEvidence().activeByClass.market_price_sqlite).toBeGreaterThanOrEqual(1);
    expect(fence.getAdmissionEvidence().productionSnapshotReady).toBe(false);
    store.db.exec("CREATE TABLE IF NOT EXISTS dr_fixture(x INTEGER)");
    store.db.prepare("INSERT INTO dr_fixture VALUES(1)").run();
    await expect(fence.withFrozenWriters(()=>false,{drainTimeoutMs:15}))
      .rejects.toThrow(/drain_timeout/);
    expect(fence.status.frozen).toBe(false);
    const actual=store.db.prepare("SELECT x FROM dr_fixture").all() as {x:number}[];
    expect(actual[0].x).toBe(1);
  } finally {store.close();}
  await fence.withFrozenWriters(async()=>{
    expect(()=>new PriceStore(filename,true)).toThrow(/backup_writer_freeze_active/);
    const readonly=new PriceStore(filename,false);
    try {expect(readonly.db.prepare("SELECT x FROM dr_fixture").get()).toEqual({x:1});}
    finally {readonly.close();}
  });
  const after=new PriceStore(filename,true);
  after.close();
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
  expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
});

it("releases lifetime ticket if a writable PriceStore constructor fails before opening",async()=>{
  const filename=fresh();
  const linked=filename+"-link";
  fs.writeFileSync(filename,Buffer.from("not a SQLite DB"));
  fs.symlinkSync(filename,linked);
  const previous=fence.status.activeWriters;
  expect(()=>new PriceStore(linked,true)).toThrow(/linked_price_database_refused/);
  expect(fence.status.activeWriters).toBe(previous);
});
