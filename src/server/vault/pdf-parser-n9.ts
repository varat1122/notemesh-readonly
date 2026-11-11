/** N9-only subprocess boundary. No runtime paths/executables from MCP input.
 * One parse per process across emitted bundles; zero queue, bounded lifetime.
 * An unavailable namespace sandbox is HOLD, never an unsandboxed fallback. */
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {env} from "../env";
export const N9_PARSER_LIMITS=Object.freeze({wallMs:8000,cleanupMs:1000,outputBytes:128*1024,inputBytes:4*1024*1024});
export const N9_PARSER_ENV=Object.freeze({PATH:"/bin",LANG:"C",LC_ALL:"C",HOME:"/tmp",TMPDIR:"/tmp"});
const KEY=Symbol.for("notemesh.n9.parser.v1");
type Slot={active:boolean;quarantined:boolean};
function slot(){const g=globalThis as typeof globalThis&{[KEY]?:Slot};return g[KEY]??={active:false,quarantined:false};}
function inside(a:string,b:string){return a===b||a.startsWith(b+path.sep);}
export function n9SandboxArgs(program:"pdfinfo"|"pdftotext",page:number){
  if(!["pdfinfo","pdftotext"].includes(program)||!Number.isSafeInteger(page)||page<1||page>2000)
    throw Error("n9_pdf_parser_input_hold");
  const root=path.resolve(".n9-pdf-runtime"),data=fs.realpathSync(env.dataDir);
  if(process.platform!=="linux"||process.getuid?.()===0||fs.realpathSync(root)!==root||
    inside(root,data)||inside(data,root)||fs.readFileSync(path.join(root,"runtime-version"),"utf8")!=="N9-SANDBOX-1\n")
    throw Error("n9_pdf_sandbox_unavailable");
  return ["--unshare-all","--unshare-user","--disable-userns","--die-with-parent","--new-session","--cap-drop","ALL",
    "--clearenv",...Object.entries(N9_PARSER_ENV).flatMap(([k,v])=>["--setenv",k,v]),
    "--ro-bind",root,"/","--dir","/dev","--dev-bind","/dev/null","/dev/null",
    "--size","1048576","--tmpfs","/tmp","--chdir","/tmp",
    "--","/bin/prlimit","--cpu=4","--as=268435456","--nproc=1","--nofile=32","--fsize=1048576","--core=0",
    "/bin/"+program,...(program==="pdfinfo"?["-"]:["-f",String(page),"-l",String(page),"-layout","-enc","UTF-8","-","-"])];
}
function execute(bytes:Buffer,program:"pdfinfo"|"pdftotext",page:number,deadline:number):Promise<string>{
  let args:string[];
  try{args=n9SandboxArgs(program,page);}catch{throw Error("n9_pdf_sandbox_unavailable");}
  const remaining=Math.floor(deadline-performance.now());
  if(remaining<=0)throw Error("n9_pdf_parser_timeout");
  return new Promise((resolve,reject)=>{
    const child=spawn("/usr/bin/bwrap",args,{env:N9_PARSER_ENV,cwd:"/",stdio:["pipe","pipe","pipe"],detached:true,shell:false});
    let failure:string|undefined,total=0,done=false,closed=false;
    const chunks:Buffer[]=[];let cleanup:ReturnType<typeof setTimeout>|undefined;
    const finish=(reason?:string)=>{if(done)return;done=true;clearTimeout(timer);if(cleanup)clearTimeout(cleanup);
      if(reason)reject(Error(reason));else resolve(Buffer.concat(chunks).toString("utf8"));};
    const stop=(reason:string)=>{
      if(failure)return;failure=reason;child.stdin.destroy();
      // Detached process group + PID namespace + die-with-parent: no orphan
      // parser can outlive the wrapper. Never release admission on kill alone.
      if(child.pid){try{process.kill(-child.pid,"SIGKILL");}catch{/* wait for close */}}
      cleanup=setTimeout(()=>{if(!closed){slot().quarantined=true;finish("n9_pdf_parser_cleanup_hold");}},N9_PARSER_LIMITS.cleanupMs);
    };
    const timer=setTimeout(()=>stop("n9_pdf_parser_timeout"),remaining);
    child.once("error",()=>stop("n9_pdf_sandbox_or_parser_unavailable"));
    child.stdin.on("error",()=>stop("n9_pdf_sandbox_or_parser_unavailable"));
    for(const stream of [child.stdout,child.stderr])stream.on("data",(chunk:Buffer)=>{
      total+=chunk.length;
      if(total>N9_PARSER_LIMITS.outputBytes){stop("n9_pdf_parser_output_limit");return;}
      if(stream===child.stdout&&!failure)chunks.push(chunk);
    });
    child.once("close",code=>{closed=true;finish(failure??(code===0?undefined:"n9_pdf_sandbox_or_parser_unavailable"));});
    child.stdin.end(bytes);
  });
}
export async function pdfNativeInfo(bytes:Buffer,page:number){
  const state=slot();
  if(state.quarantined)throw Error("n9_pdf_parser_cleanup_hold");
  if(state.active)throw Error("n9_pdf_parser_busy"); // zero waiting queue
  if(bytes.length>N9_PARSER_LIMITS.inputBytes)throw Error("n9_pdf_parser_input_hold");
  state.active=true;const deadline=performance.now()+N9_PARSER_LIMITS.wallMs;
  try{
    const info=await execute(bytes,"pdfinfo",page,deadline),matched=/^Pages:\s+(\d+)\s*$/m.exec(info);
    const count=matched?Number(matched[1]):NaN;
    if(!Number.isSafeInteger(count)||count<1||count>2000)throw Error("n9_pdf_page_count_invalid");
    if(page>count)throw Error("n9_pdf_page_out_of_range");
    const text=await execute(bytes,"pdftotext",page,deadline);
    if(Buffer.byteLength(text)>12000)throw Error("n9_page_text_over_limit");
    if(!text.trim())throw Error("n9_no_native_text_on_page");
    return {count,text};
  }finally{if(!state.quarantined)state.active=false;}
}
