const {spawn}=require("child_process"),fs=require("fs");const dir=process.argv[2];
const c=spawn("git",["commit","-qm","trigger","--no-gpg-sign"],{cwd:dir,detached:true,stdio:"ignore"});
c.on("exit",(code)=>{const out=[];for(const d of fs.readdirSync("/proc")){if(!/^\d+$/.test(d)||+d===process.pid)continue;try{
 const s=fs.readFileSync(`/proc/${d}/stat`,"utf8"),r=s.slice(s.lastIndexOf(")")+2).split(" ");
 const cmd=fs.readFileSync(`/proc/${d}/cmdline`,"utf8").split("\0").join(" ").trim();
 if(fs.readlinkSync(`/proc/${d}/cwd`).startsWith(dir)&&/git/.test(cmd))out.push({pid:+d,ppid:+r[1],pgid:+r[2],sid:+r[3],cmd});}catch{}}
 console.log(JSON.stringify({gitRootPid:c.pid,rootPgid:c.pid,rootExit:code,gitSurvivorsAfterRootExit:out}));});
