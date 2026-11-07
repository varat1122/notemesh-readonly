/** SQLite PRAGMAs are not classified by '=' or sqlite3_stmt_readonly:
 * parentheses can assign, argument-free commands can write, and some settings
 * take effect during prepare. Only this closed read grammar bypasses write().
 * Unknown/new PRAGMAs and syntax are fenced, never assumed read-only. */
const scalarReads=new Set([
  "application_id","auto_vacuum","busy_timeout","cache_size","collation_list",
  "compile_options","database_list","data_version","encoding","foreign_keys",
  "freelist_count","function_list","journal_mode","locking_mode","max_page_count",
  "mmap_size","module_list","page_count","page_size","pragma_list","query_only",
  "read_uncommitted","schema_version","synchronous","user_version","wal_autocheckpoint",
]);
const argumentReads=new Set(["table_info","table_xinfo","table_list","index_info",
  "index_xinfo","index_list","foreign_key_list","foreign_key_check","integrity_check","quick_check"]);
const identifier='(?:[A-Za-z_][A-Za-z_0-9]*|"[A-Za-z_][A-Za-z_0-9]*"|`[A-Za-z_][A-Za-z_0-9]*`|\\[[A-Za-z_][A-Za-z_0-9]*\\]|\'[A-Za-z_][A-Za-z_0-9]*\')';
const literal='(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+|\'(?:[^\']|\'\')*\'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\\[[^\\]]*\\])';
const readSyntax=new RegExp(`^\\s*(?:(${identifier})\\s*\\.\\s*)?(${identifier})\\s*(?:(?:\\(\\s*(${literal})\\s*\\))|(?:=\\s*(${literal})))?\\s*;?\\s*$`);
const unquote=(s:string)=>s.replace(/^["`[']|["`\]']$/g,"").toLowerCase();
export function readOnlyPricePragma(source:string):boolean {
  if(source.length>8192)return false;
  const m=readSyntax.exec(source);if(!m)return false;
  if(m[1]&&!["main","temp"].includes(unquote(m[1])))return false;
  const name=unquote(m[2]),hasArgument=m[3]!==undefined||m[4]!==undefined;
  return argumentReads.has(name)||!hasArgument&&scalarReads.has(name);
}
// SQLite permits comments, BOMs and empty statements before its first token.
// Do not prepare a PRAGMA to ask SQLite whether it was safe: that is too late.
function leading(sql:string):string {
  return sql.replace(/^(?:[\s;]|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/,"");
}
export function preparedPricePragma(sql:string):string|null {
  let s=leading(sql);
  if(/^EXPLAIN\b/i.test(s)){
    s=leading(s.slice(7));
    if(/^QUERY\b/i.test(s)){
      s=leading(s.slice(5));if(/^PLAN\b/i.test(s))s=leading(s.slice(4));
    }
  }
  return /^PRAGMA\b/i.test(s)?s.slice(6):null;
}
