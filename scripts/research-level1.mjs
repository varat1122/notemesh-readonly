#!/usr/bin/env node
// IOS-ORCH-RI-001: replay mechanical fixtures, never real semantic/human acceptance.
import {spawnSync} from "node:child_process";
import {mkdirSync,writeFileSync,openSync,closeSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const cases={
  "L1-01":["src/server/mcp/c1-pilot-admission.test.ts","src/server/mcp/m54-canonical-integration.test.ts"],
  "L1-02":["src/server/mcp/macro-source-history.test.ts","src/server/mcp/m54-canonical-integration.test.ts"],
  "L1-03":["src/server/mcp/source-review-reuse.test.ts","src/server/mcp/source-event-admission.test.ts"],
  "L1-04":["src/server/mcp/risk-draft-admission.test.ts","src/server/mcp/research-judge.test.ts"],
  "L1-05":["src/server/mcp/research-judge.test.ts","src/server/mcp/c1-pilot-admission.test.ts"],
  "L1-06":["src/server/mcp/c1-pilot-cold.test.ts","src/server/mcp/macro-source-history.test.ts","tests/http/c1-pilot.test.ts"],
  "L1-07":["src/server/mcp/research-judge.test.ts","src/server/mcp/c1-pilot-admission.test.ts","src/server/safe-edit/engine.test.ts"]
};
const out=resolve(process.argv[2]??"test-results/research-level1");
const selected=process.argv.slice(3);
if(selected.some(id=>!cases[id]))throw Error("Unknown L1 case; do not silently omit a case");
const ids=selected.length?selected:Object.keys(cases);
const files=[...new Set(ids.flatMap(id=>cases[id]))];
mkdirSync(out,{recursive:true});
const log=resolve(out,"mechanical.log"),fd=openSync(log,"wx");
const args=["exec","vitest","run",...files,"--maxWorkers=2","--testTimeout=30000","--hookTimeout=120000","--reporter=default","--reporter=json",`--outputFile.json=${resolve(out,"vitest.json")}`];
const run=spawnSync("pnpm",args,{stdio:["ignore",fd,fd],timeout:30*60_000});closeSync(fd);
const report={task:"IOS-ORCH-RI-001",command:["pnpm",...args],cases:Object.fromEntries(ids.map(id=>[id,{files:cases[id],realE2E:"NOT_RUN"}])),
  exitCode:run.status,signal:run.signal,error:run.error?.message??null,logSHA256:createHash("sha256").update(readFileSync(log)).digest("hex"),
  boundary:"Synthetic fixtures and simulated analyst/reviewer decisions prove mechanisms only. Actual actor/model/independent fresh ChatGPT room must be evaluated separately. No per-story DB intervention.",
  runtime:{node:process.version,abi:process.versions.modules}};
writeFileSync(resolve(out,"run.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));process.exit(run.status===0?0:1);
