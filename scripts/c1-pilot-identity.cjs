// Shared by the server, entrypoint and the standalone importer. This is a
// restrictive instance identity, NOT reviewer authority or a new write route.
const fs=require('node:fs'),path=require('node:path');
function sqlite(){
  try{return require('better-sqlite3');}catch(e){
    if(e.code!=='MODULE_NOT_FOUND')throw e;
    // Standalone container entrypoint/importer shares the built server's
    // packaged dependency, without installing another SQLite implementation.
    return require('node:module').createRequire(path.resolve(__dirname,'../.output/server/index.mjs'))('better-sqlite3');
  }
}
function assertPilotIdentity(dataDir,mode=process.env.C1_RESEARCH_PILOT){
  const root=path.resolve(dataDir);
  if(mode!==undefined){
    if(mode!=='disposable')throw Error('c1_pilot_invalid_mode_hold');
    return;
  }
  let physical=root;
  try{physical=fs.realpathSync(root);}catch(e){if(e.code!=='ENOENT')throw Error('c1_pilot_identity_unreadable_hold');}
  if([root,physical].some(p=>path.basename(p).startsWith('ios-c1-pilot-')))
    throw Error('c1_pilot_mode_required_hold');
  const file=path.join(root,'app.sqlite');
  try{fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return;throw Error('c1_pilot_identity_unreadable_hold');}
  let d;
  try{
    // No migrations, new database, key access or journal rewrites. The query
    // also recognizes pre-hardening c1_pilot_source/assessment/review events.
    const Database=sqlite();d=new Database(file,{readonly:true,fileMustExist:true});
    if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get()&&
      d.prepare("SELECT 1 FROM safe_edit_events WHERE event GLOB 'c1_pilot_*' LIMIT 1").get())
      throw Error('c1_pilot_enrolled_instance_requires_mode_hold');
  }catch(e){
    if(e.message==='c1_pilot_enrolled_instance_requires_mode_hold')throw e;
    throw Error('c1_pilot_identity_unreadable_hold');
  }finally{d?.close();}
}
function enrollPilotIdentity(d){
  // Same existing Safe Edit event schema, initialized before auth/workers.
  // Append once; never modify historical receipts or previous journal rows.
  d.transaction(()=>{
    d.exec(`CREATE TABLE IF NOT EXISTS safe_edit_events (
      at TEXT NOT NULL, operation_id TEXT NOT NULL, actor TEXT NOT NULL,
      event TEXT NOT NULL, detail TEXT NOT NULL)`);
    if(!d.prepare("SELECT 1 FROM safe_edit_events WHERE event='c1_pilot_instance' LIMIT 1").get())
      d.prepare('INSERT INTO safe_edit_events VALUES(?,?,?,?,?)').run(new Date().toISOString(),
        'C1-PILOT-INSTANCE','server','c1_pilot_instance',JSON.stringify({policy:'C1-ANALYST-REVIEW-1',restriction:'whole_disposable_instance'}));
  }).immediate();
}
module.exports={assertPilotIdentity,enrollPilotIdentity};
