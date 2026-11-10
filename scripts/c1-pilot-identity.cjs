// Shared by the server, entrypoint and the standalone importer. This is a
// restrictive instance identity, NOT reviewer authority or a new write route.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
// All emitted router bundles and the CJS importer share the same lifetime.
// No production reset/unenrollment API. A HOLD stays restrictive until restart.
const KEY=Symbol.for('notemesh.c1-pilot.identity.v1');
function hold(state,reason){state.hold??=reason;throw Error(state.hold);}
function identity(file){
  try{const s=fs.statSync(file);return `${fs.realpathSync(file)}:${s.dev}:${s.ino}`;}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function sqlite(){
  try{return require('better-sqlite3');}catch(e){
    if(e.code!=='MODULE_NOT_FOUND')throw e;
    // Standalone container entrypoint/importer shares the built server's
    // packaged dependency, without installing another SQLite implementation.
    return require('node:module').createRequire(path.resolve(__dirname,'../.output/server/index.mjs'))('better-sqlite3');
  }
}
function assertPilotIdentity(dataDir,mode=process.env.C1_RESEARCH_PILOT,driver,existing){
  const root=path.resolve(dataDir);
  const state=globalThis[KEY]??= {root,mode,rootIdentity:null,dbIdentity:null,connections:new WeakSet(),hold:null};
  if(state.hold)throw Error(state.hold);
  if(mode!==undefined&&mode!=='disposable')hold(state,'c1_pilot_invalid_mode_hold');
  if(state.root!==root||state.mode!==mode)hold(state,'c1_pilot_live_transition_hold');
  const file=path.join(root,'app.sqlite');
  try{
    const rootId=identity(root),physical=rootId?fs.realpathSync(root):root;
    if(mode===undefined&&[root,physical].some(p=>path.basename(p).startsWith('ios-c1-pilot-')))
      hold(state,'c1_pilot_mode_required_hold');
    if(mode==='disposable'&&(!rootId||physical!==root||!root.startsWith(fs.realpathSync(os.tmpdir())+path.sep)||
      !path.basename(root).startsWith('ios-c1-pilot-')||fs.realpathSync(path.join(root,'vault'))!==path.join(root,'vault')||
      process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_SERVICE_ID))hold(state,'c1_pilot_disposable_isolation_required');
    if(state.rootIdentity&&state.rootIdentity!==rootId)hold(state,'c1_pilot_instance_changed_hold');
    state.rootIdentity=rootId;
    const dbId=identity(file);
    if(state.dbIdentity&&state.dbIdentity!==dbId)hold(state,'c1_pilot_database_changed_hold');
    if(existing&&(!existing.open||existing.name!==file))hold(state,'c1_pilot_connection_scope_hold');
    // Inspect once at bootstrap and once for each newly opened writable app
    // connection, BEFORE pragmas/migrations. A missing DB isn't cached forever:
    // its first appearance is inspected too. Hot calls use O(1) file identity
    // and config checks, never journal scans or another SQLite connection.
    if(dbId&&(!state.dbIdentity||(existing&&!state.connections.has(existing)))){
      let d=existing,owned=false;
      try{
        if(!d){const Database=driver||sqlite();d=new Database(file,{readonly:true,fileMustExist:true});owned=true;}
        const enrolled=d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get()&&
          d.prepare("SELECT 1 FROM safe_edit_events WHERE event GLOB 'c1_pilot_*' LIMIT 1").get();
        if(enrolled&&mode!=='disposable')hold(state,'c1_pilot_enrolled_instance_requires_mode_hold');
        if(identity(file)!==dbId)hold(state,'c1_pilot_database_changed_hold');
        state.dbIdentity=dbId;if(existing)state.connections.add(existing);
      }finally{if(owned)d.close();}
    }
    return mode==='disposable';
  }catch{
    hold(state,state.hold||'c1_pilot_identity_unreadable_hold');
  }
}
function enrollPilotIdentity(d){
  const root=path.dirname(d.name);
  if(!assertPilotIdentity(root,process.env.C1_RESEARCH_PILOT,undefined,d))
    hold(globalThis[KEY],'c1_pilot_live_enrollment_hold');
  // Same existing Safe Edit event schema, initialized before auth/workers.
  // Append once; never modify historical receipts or previous journal rows.
  try{d.transaction(()=>{
    d.exec(`CREATE TABLE IF NOT EXISTS safe_edit_events (
      at TEXT NOT NULL, operation_id TEXT NOT NULL, actor TEXT NOT NULL,
      event TEXT NOT NULL, detail TEXT NOT NULL)`);
    if(!d.prepare("SELECT 1 FROM safe_edit_events WHERE event='c1_pilot_instance' LIMIT 1").get())
      d.prepare('INSERT INTO safe_edit_events VALUES(?,?,?,?,?)').run(new Date().toISOString(),
        'C1-PILOT-INSTANCE','server','c1_pilot_instance',JSON.stringify({policy:'C1-ANALYST-REVIEW-1',restriction:'whole_disposable_instance'}));
  }).immediate();}catch{hold(globalThis[KEY],'c1_pilot_enrollment_failed_hold');}
}
module.exports={assertPilotIdentity,enrollPilotIdentity};
