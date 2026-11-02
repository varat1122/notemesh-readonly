/**
 * Read-only SOURCE CODE writer-surface inventory for human review.
 * Intentionally NOT a proof of runtime writer coverage or production approval.
 * Reports source paths and line numbers only; does not read DATA_DIR.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEARCH_ROOTS = ["src/server", "src/routes"];
const SUFFIX = /\.(?:ts|tsx|js|mjs)$/;
const MUTATORS = [
  ["sqlite_statement", /\.(?:run|exec|transaction)\s*\(/],
  ["sqlite_open", /\bnew\s+(?:Database|DatabaseSync)\s*\(/],
  ["auth_adapter", /\bauth\.api\.[A-Za-z_$][\w$]*\s*\(/],
  ["filesystem", /\bfs\.(?:writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|rmdirSync|mkdirSync|unlinkSync|linkSync|truncateSync)\s*\(/],
  ["filesystem_handle", /\bfs\.openSync\s*\(/],
  // A common blind spot: native async fs writes often bypass the sync fs.*
  // signatures above. An open() is only a candidate; its flag may be read-only.
  ["filesystem_async", /\b(?:fs(?:\.promises)?|fsp|fsPromises)\.(?:writeFile|appendFile|copyFile|rename|rm|rmdir|mkdir|unlink|link|truncate|cp|open)\s*\(/],
  ["filesystem_stream", /\bfs\.createWriteStream\s*\(/],
  ["filesystem_filehandle", /\.\s*(?:writeFile|appendFile|truncate)\s*\(/],
  ["external_process", /\b(?:runGit|runOb|spawn|execa|execFileSync)\s*\(/],
];

// Named imports from node:fs/promises can be renamed and called with no "fs."
// qualifier. Discover only explicit imports from Node fs modules. As elsewhere,
// this is candidate identification, not proof of a real write or fence coverage.
const NAMED_FS_MUTATORS = new Set([
  "writeFile","appendFile","copyFile","rename","rm","rmdir","mkdir",
  "unlink","link","truncate","cp","open","createWriteStream",
]);
function namedFsWritePattern(source) {
  const aliases=[];
  const re=/\bimport\s*\{([^}]+)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/g;
  for (const match of source.matchAll(re)) {
    for(const token of match[1].split(",")) {
      const name=token.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if(name && NAMED_FS_MUTATORS.has(name[1]))aliases.push(name[2]??name[1]);
    }
  }
  return aliases.length
    ? new RegExp(`\\b(?:${[...new Set(aliases)].join("|")})\\s*\\(`)
    : null;
}

function visit(dir, relative, collected) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes:true }).sort((a,b)=>a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw Error("writer_audit_symlink_refused");
    const sub = path.posix.join(relative,entry.name);
    const filename=path.join(dir,entry.name);
    if(entry.isDirectory()) { visit(filename,sub,collected);continue; }
    if(!entry.isFile() || !SUFFIX.test(entry.name) || /\.(?:test|spec)\.[jt]sx?$/.test(entry.name))continue;
    collected.push({filename,relative:sub});
  }
}

export function inventoryWriterSurfaces(repoRoot) {
  const root=fs.realpathSync(repoRoot);
  const files=[];
  for(const rel of SEARCH_ROOTS)visit(path.join(root,rel),rel,files);
  const candidates=[];
  for(const {filename,relative} of files){
    const source=fs.readFileSync(filename,"utf8");
    const referencesFence=source.includes("inProcessDrWriterFence") ||
      source.includes("SnapshotWriterFence");
    const importedFsWrites=namedFsWritePattern(source);
    source.split("\n").forEach((line,i)=>{
      const trimmed=line.trim();
      if(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))return;
      const patterns=importedFsWrites
        ? [...MUTATORS,["filesystem_named_import",importedFsWrites]]
        : MUTATORS;
      for(const [kind,pattern] of patterns)if(pattern.test(line)){
        candidates.push({file:relative,line:i+1,kind,
          // Presence of a reference is NOT proof the particular write is fenced.
          fenceReferencedSomewhereInFile:referencesFence,
          verified:false});
      }
    });
  }
  const withoutFenceReference=candidates.filter(c=>!c.fenceReferencedSomewhereInFile);
  return {
    format:"notemesh-writer-source-inventory/1",
    productionSnapshotReady:false,
    externalWriterQuiescenceVerified:false,
    completeRuntimeWriterCoverageVerified:false,
    evidenceClassification:"source_heuristic_human_review_required",
    analyzedFiles:files.length,
    candidateCount:candidates.length,
    noFenceReferenceCount:withoutFenceReference.length,
    candidates,
  };
}

function main(){
  const root=path.resolve(fileURLToPath(new URL("../../",import.meta.url)));
  console.log(JSON.stringify(inventoryWriterSurfaces(root),null,2));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main();
