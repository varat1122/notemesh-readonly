import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import type {PriceStore as Store} from "./store";
let root:string,file:string,store:Store;
const registry=Symbol.for("notemesh.maintenance.registry.v1");
const hash=()=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// The existing internal write transaction, not an exposed API or new writer.
const fenced=<T>(work:()=>T)=>(store as unknown as {write(fn:()=>T):T}).write(work);
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"price-pragma-")));process.env.DATA_DIR=root;
  delete process.env.NOTEMESH_MAINTENANCE;delete (globalThis as Record<symbol,unknown>)[registry];vi.resetModules();
  file=path.join(root,"market-prices","prices.sqlite");store=new (await import("./store")).PriceStore(file,true);
});
afterEach(()=>{store.close();vi.restoreAllMocks();delete (globalThis as Record<symbol,unknown>)[registry];delete process.env.DATA_DIR;fs.rmSync(root,{recursive:true,force:true});});

describe("F-01 closed read grammar, not write-PRAGMA blacklist",()=>{
  it.each(["user_version(7)","user_version = 7","main.user_version(+7)",'main."user_version"(7)',
    "application_id(19)","schema_version(17)","query_only(ON)","cache_size(123)","journal_mode(OFF)",
    "optimize","incremental_vacuum","wal_checkpoint(TRUNCATE)","writable_schema(ON)",
    "unknown_future_pragma", "table_info('instruments'); PRAGMA user_version(7)"])("refuses unfenced %s before any SQLite effects",command=>{
    const before=hash();expect(()=>store.db.pragma(command)).toThrow("unfenced_price_write");expect(hash()).toBe(before);
    expect(store.db.pragma("query_only",{simple:true})).toBe(0);expect(store.db.pragma("user_version",{simple:true})).toBe(0);
  });
  it.each(["PRAGMA query_only(ON)","/* header */ ; -- note\n pRaGmA main.user_version(7)",
    'PRAGMA "cache_size"(5)',"EXPLAIN /* comment */ PRAGMA query_only(ON)",
    "EXPLAIN QUERY PLAN PRAGMA query_only(ON)","PRAGMA optimize"])("raw prepare cannot evade the PRAGMA fence: %s",sql=>{
    const before=hash(),cache=store.db.pragma("cache_size",{simple:true});expect(()=>store.db.prepare(sql)).toThrow("unfenced_price_write");
    expect(store.db.pragma("query_only",{simple:true})).toBe(0);expect(store.db.pragma("cache_size",{simple:true})).toBe(cache);expect(hash()).toBe(before);
  });
  it.each(["page_size","page_count","user_version",'main."journal_mode"',"query_only","integrity_check(10)",
    "quick_check","table_info('instruments')","index_list = 'bars'","foreign_key_check"])("legitimate read %s works through pragma and prepare with unchanged bytes",sql=>{
    const before=hash();expect(()=>store.db.pragma(sql)).not.toThrow();expect(()=>store.db.prepare("PRAGMA "+sql).all()).not.toThrow();expect(hash()).toBe(before);
  });
  it("supported mutation runs only inside the verified write transaction, including all/get/iterate and rollback",()=>{
    const before=hash();
    expect(()=>fenced(()=>{store.db.pragma("user_version(7)");throw Error("rollback fixture");})).toThrow("rollback fixture");
    expect(hash()).toBe(before);expect(store.db.pragma("user_version",{simple:true})).toBe(0);
    fenced(()=>{expect(store.db.inTransaction).toBe(true);store.db.pragma("user_version(7)");});
    expect(store.db.pragma("user_version",{simple:true})).toBe(7);
    const statement=store.db.prepare("INSERT INTO instruments VALUES ('US:SYN','US','SYN','SYN','USD','UTC') RETURNING id");
    for(const method of ["run","get","all","iterate"] as const)expect(()=>statement[method]()).toThrow("unfenced_price_write");
    // SQLite will not commit an active RETURNING iterator. Exhaust it inside
    // the transaction; a later next() must still recheck the admission fence.
    const escaped=fenced(()=>{const it=statement.iterate();expect(it.next().value).toEqual({id:"US:SYN"});expect(it.next().done).toBe(true);return it;});
    expect(()=>escaped.next()).toThrow("unfenced_price_write");escaped.return?.();
    expect(store.instruments()).toHaveLength(1);
  });
  it.each(["draining","active","drain_failed"])("%s refuses PRAGMA and fenced writes; legitimate reads stay non-mutating",state=>{
    const before=hash();fs.writeFileSync(path.join(root,"maintenance.json"),JSON.stringify({version:1,id:"0f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",state,requestedAt:"2026-11-07T00:00:00Z",settledAt:null,drain:null}));
    expect(()=>store.db.pragma("user_version(7)")).toThrow("unfenced_price_write");
    expect(()=>fenced(()=>store.db.pragma("user_version(7)"))).toThrow("maintenance_active");
    expect(()=>store.acquireLease(new Date())).toThrow("maintenance_active");
    expect(store.db.pragma("integrity_check",{simple:true})).toBe("ok");expect(hash()).toBe(before);
  });
});
