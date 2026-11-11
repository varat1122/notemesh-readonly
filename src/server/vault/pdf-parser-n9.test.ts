import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {EventEmitter} from "node:events";import {PassThrough} from "node:stream";
import net from "node:net";import {execFileSync,spawn} from "node:child_process";
import {syntheticPdf} from "../../../tests/fixtures/n9-pdf";
const hooks=vi.hoisted(()=>({intercept:null as null|((...args:any[])=>any)}));
vi.mock("node:child_process",async original=>{
  const actual=await original<typeof import("node:child_process")>();
  return {...actual,spawn:(...args:any[])=>hooks.intercept?hooks.intercept(...args):(actual.spawn as any)(...args)};
});
let root:string;
const bytes=syntheticPdf(["Synthetic page one text.","Synthetic page two text."]);
beforeEach(()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.n9.parser.v1")];
 root=fs.mkdtempSync(path.join(os.tmpdir(),"n9-parser-test-"));vi.stubEnv("DATA_DIR",root);vi.stubEnv("N9_SYNTHETIC_SECRET","synthetic-only-not-a-live-secret");});
afterEach(()=>{hooks.intercept=null;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
it("runs the real benign PDF asynchronously with a single shared slot and zero waiting queue",async()=>{
 const p=await import("./pdf-parser-n9");let tick=false;
 const timer=new Promise<void>(r=>setImmediate(()=>{tick=true;r();}));
 const one=p.pdfNativeInfo(bytes,2);
 vi.resetModules(); // Emitted bundles/module reloads cannot create a second slot.
 const other=await import("./pdf-parser-n9");
 await expect(other.pdfNativeInfo(bytes,1)).rejects.toThrow("n9_pdf_parser_busy");
 expect((await one).text).toContain("page two");expect(tick).toBe(true);await timer;
 expect((await other.pdfNativeInfo(bytes,1)).count).toBe(2);
});
it("requires the runtime sandbox, fixed program/page, minimal env and disjoint DATA_DIR",async()=>{
 const p=await import("./pdf-parser-n9");
 expect(Object.keys(p.N9_PARSER_ENV).sort()).toEqual(["HOME","LANG","LC_ALL","PATH","TMPDIR"]);
 expect(()=>p.n9SandboxArgs("/bin/sh" as any,1)).toThrow();
 expect(()=>p.n9SandboxArgs("pdfinfo",1.5)).toThrow();
 vi.stubEnv("DATA_DIR",path.resolve(".n9-pdf-runtime"));
 await expect(p.pdfNativeInfo(bytes,1)).rejects.toThrow("n9_pdf_sandbox_unavailable");
});
function fakeChild(){
 const c=Object.assign(new EventEmitter(),{pid:987654321,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
 hooks.intercept=vi.fn((_exe,_args,opts)=>{expect(opts.env.N9_SYNTHETIC_SECRET).toBeUndefined();expect(opts.shell).toBe(false);return c;});
 vi.spyOn(process,"kill").mockReturnValue(true);return c;
}
it("timeout kills the process group and does not release admission before close",async()=>{
 vi.useFakeTimers();const p=await import("./pdf-parser-n9"),c=fakeChild();
 const result=p.pdfNativeInfo(bytes,1).catch(e=>e.message);
 await vi.advanceTimersByTimeAsync(p.N9_PARSER_LIMITS.wallMs);
 expect(process.kill).toHaveBeenCalledWith(-c.pid,"SIGKILL");
 await expect(p.pdfNativeInfo(bytes,1)).rejects.toThrow("n9_pdf_parser_busy");
 c.emit("close",null);expect(await result).toBe("n9_pdf_parser_timeout");
});
it("uncertain cleanup quarantines admission even after a late close",async()=>{
 vi.useFakeTimers();const p=await import("./pdf-parser-n9"),c=fakeChild();
 const result=p.pdfNativeInfo(bytes,1).catch(e=>e.message);
 await vi.advanceTimersByTimeAsync(p.N9_PARSER_LIMITS.wallMs+p.N9_PARSER_LIMITS.cleanupMs);
 expect(await result).toBe("n9_pdf_parser_cleanup_hold");c.emit("close",null);
 await expect(p.pdfNativeInfo(bytes,1)).rejects.toThrow("n9_pdf_parser_cleanup_hold");
 expect(hooks.intercept).toHaveBeenCalledTimes(1);
});
it.each(["stdout","stderr"] as const)("bounds combined %s without returning parser diagnostics",async stream=>{
 const p=await import("./pdf-parser-n9"),c=fakeChild(),result=p.pdfNativeInfo(bytes,1).catch(e=>e.message);
 c[stream].emit("data",Buffer.alloc(p.N9_PARSER_LIMITS.outputBytes+1,65));c.emit("close",null);
 expect(await result).toBe("n9_pdf_parser_output_limit");expect(process.kill).toHaveBeenCalledTimes(1);
});
it("sandbox spawn failure is restrictive and releases only after close",async()=>{
 const p=await import("./pdf-parser-n9"),c=fakeChild(),result=p.pdfNativeInfo(bytes,1).catch(e=>e.message);
 c.emit("error",Error("synthetic sensitive stderr"));c.emit("close",null);
 expect(await result).toBe("n9_pdf_sandbox_or_parser_unavailable");
});
it("proves filesystem, env, network, FD and resource isolation using a benign native probe",async()=>{
 const p=await import("./pdf-parser-n9"),probe=path.join(root,"probe");
 execFileSync("/usr/bin/cc",["tests/fixtures/n9-sandbox-probe.c","-o",probe],{timeout:10000,maxBuffer:65536});
 const secret=path.join(root,"synthetic-secret"),protectedFile=path.join(root,"protected.md"),unwanted=path.join(root,"unwanted");
 fs.writeFileSync(secret,"not a real credential");fs.writeFileSync(protectedFile,"unchanged");
 const server=net.createServer(socket=>socket.destroy());await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 try{
   const args=p.n9SandboxArgs("pdfinfo",1),separator=args.indexOf("--");
   // TEST ONLY: substitute a known benign probe in the exact same sandbox.
   // Production has no API/environment setting for executables or mount paths.
   args.splice(separator,0,"--ro-bind",probe,"/bin/pdfinfo");
   args.splice(args.length-1,1,secret,protectedFile,unwanted,String((server.address() as net.AddressInfo).port));
   const out=execFileSync("/usr/bin/bwrap",args,{env:p.N9_PARSER_ENV,cwd:"/",timeout:5000,maxBuffer:65536,encoding:"utf8"});
   expect(out).toContain("isolation PASS");expect(fs.existsSync(unwanted)).toBe(false);
   expect(fs.readFileSync(protectedFile,"utf8")).toBe("unchanged");
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
it("real sandbox lifecycle: kills a benign sleeping child on deadline and permits a clean next parse",async()=>{
 const p=await import("./pdf-parser-n9"),probe=path.join(root,"probe");
 execFileSync("/usr/bin/cc",["tests/fixtures/n9-sandbox-probe.c","-o",probe],{timeout:10000,maxBuffer:65536});
 const actual=await vi.importActual<typeof import("node:child_process")>("node:child_process");let child:ReturnType<typeof spawn>|undefined;
 let ready=false;
 hooks.intercept=(exe,args,options)=>{
   expect(options.env).toEqual(p.N9_PARSER_ENV);
   const changed=[...args],separator=changed.indexOf("--");changed.splice(separator,0,"--ro-bind",probe,"/bin/pdfinfo");changed[changed.length-1]="--sleep";
   child=actual.spawn(exe,changed,options);
   child.stdout!.once("data",chunk=>{ready=chunk.toString().includes("ready");});return child;
 };
 await expect(p.pdfNativeInfo(bytes,1)).rejects.toThrow("n9_pdf_parser_timeout");
 expect(child?.signalCode).toBe("SIGKILL");expect(()=>process.kill(-child!.pid!,0)).toThrow();
 // The sleeping probe retains stdout. A close event (awaited by the parser)
 // proves that both wrapper and probe pipes ended, not merely a sent signal.
 expect(ready).toBe(true);expect(child!.stdout!.readableEnded).toBe(true);
 hooks.intercept=null;expect((await p.pdfNativeInfo(bytes,2)).text).toContain("page two");
},15000);
