import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error standalone runtime module is deliberately not bundled
import { preflight } from '../../scripts/cloud-sync-preflight.mjs';

it('backs up synced Markdown and refuses unexpected modifications, missing and untracked files',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync-preflight-'));
  const old=process.env.XDG_CONFIG_HOME;process.env.XDG_CONFIG_HOME=path.join(root,'config');
  const vault=path.join(root,'vault');fs.mkdirSync(vault);const file=path.join(vault,'Original.md');fs.writeFileSync(file,'original');
  const dir=path.join(process.env.XDG_CONFIG_HOME,'obsidian-headless/sync/fixture');fs.mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(path.join(dir,'state.db'));db.exec('CREATE TABLE local_files(path TEXT,data TEXT)');
  const stat=fs.statSync(file);const row={hash:'fixture',synchash:'fixture',size:stat.size,mtime:Math.ceil(stat.mtimeMs),folder:false};
  db.prepare('INSERT INTO local_files VALUES (?,?)').run('Original.md',JSON.stringify(row));db.close();
  try {
    fs.writeFileSync(file,'modified contents');expect(()=>preflight(vault,{vaultId:'fixture'},root)).toThrow('Unsynced');
    fs.writeFileSync(file,'original');fs.utimesSync(file,new Date(),new Date(stat.mtimeMs));
    // Record the restored platform timestamp (Windows can round it).
    const d=new DatabaseSync(path.join(dir,'state.db'));row.mtime=Math.ceil(fs.statSync(file).mtimeMs);d.prepare('UPDATE local_files SET data=?').run(JSON.stringify(row));d.close();
    fs.writeFileSync(path.join(vault,'Unexpected.md'),'new');expect(()=>preflight(vault,{vaultId:'fixture'},root)).toThrow('Unsynced');fs.unlinkSync(path.join(vault,'Unexpected.md'));
    preflight(vault,{vaultId:'fixture'},root);
    const backup=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'before-cloud-markdown.json.gz'))).toString());expect(backup[0]).toMatchObject({path:'Original.md',content:'original'});
    preflight(vault,{vaultId:'fixture'},root);expect(()=>preflight(vault,{vaultId:'another'},root)).toThrow('mismatch');
    expect(fs.readFileSync(file,'utf8')).toBe('original');
  }finally{if(old===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=old;fs.rmSync(root,{recursive:true,force:true});}
});
