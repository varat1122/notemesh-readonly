// Build-time only: fixed, trusted distro ELF binaries and their shared libraries.
// Never run ldd on a PDF or caller-selected executable. No server data/config is
// copied. The resulting root is mounted read-only, with no host root fallback.
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
const root=path.resolve(".n9-pdf-runtime");
fs.mkdirSync(root,{mode:0o755}); // Refuse reuse of a stale/partially built root.
for(const dir of ["tmp","dev"])fs.mkdirSync(path.join(root,dir),{mode:0o755});
fs.writeFileSync(path.join(root,"dev/null"),"",{flag:"wx",mode:0o444});
const environment={PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C"};
const files=new Map();
for(const name of ["pdfinfo","pdftotext","prlimit"]){
  const binary="/usr/bin/"+name;
  files.set("/bin/"+name,binary);
  const report=execFileSync("/usr/bin/ldd",[binary],{env:environment,encoding:"utf8",timeout:5000,maxBuffer:65536});
  if(report.includes("not found"))throw Error("N9 runtime library missing");
  for(const line of report.split("\n")){
    const library=/\s(\/(?:usr\/)?lib[^\s]*)\s+\(/.exec(line)?.[1];
    if(library)files.set(library,library);
  }
}
if(files.size<5||files.size>128)throw Error("N9 runtime inventory invalid");
for(const [destination,source] of files){
  if(!fs.statSync(source).isFile())throw Error("N9 runtime regular file required");
  const target=path.join(root,destination);
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});
  fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target,0o555);
}
// Optional distro character maps only, not /etc, fonts, home, credentials or
// entire system library trees. Missing maps may produce a conservative HOLD.
if(fs.existsSync("/usr/share/poppler"))fs.cpSync("/usr/share/poppler",path.join(root,"usr/share/poppler"),{recursive:true,dereference:true});
fs.writeFileSync(path.join(root,"runtime-version"),"N9-SANDBOX-1\n",{flag:"wx",mode:0o444});
console.log(`N9 isolated runtime: ${files.size} fixed ELF files plus distro character maps`);
