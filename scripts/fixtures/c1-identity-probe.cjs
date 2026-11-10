// Disposable emitted-server instrumentation only; never loaded by production.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const serverRequire=createRequire(path.resolve('.output/server/index.mjs'));
const Database=serverRequire('better-sqlite3'),prepare=Database.prototype.prepare;
const counters={connections:0,identityQueries:0};
// Count native connection construction, including ESM import facades which
// retain the original JS constructor even if require.cache.exports changes.
const addon=serverRequire(path.join(path.dirname(serverRequire.resolve('better-sqlite3')),'binding.js')).getBinding();
addon.Database=new Proxy(addon.Database,{
 construct(target,args,newTarget){counters.connections++;return Reflect.construct(target,args,newTarget);}
});
Database.prototype.prepare=function(sql,...args){
 const s=prepare.call(this,sql,...args);
 if(sql.includes("event GLOB 'c1_pilot_*'")||sql==="SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'"){
  const get=s.get;s.get=function(...values){counters.identityQueries++;return get.apply(this,values);};
 }
 return s;
};
process.on('SIGUSR2',()=>{
 const file=process.env.C1_IDENTITY_PROBE_FILE;
 if(!file)throw Error('disposable probe output required');
 fs.writeFileSync(file+'.tmp',JSON.stringify(counters));fs.renameSync(file+'.tmp',file);
});
