import type Database from "better-sqlite3";
export function assertPilotIdentity(dataDir:string,mode?:string,driver?:typeof Database,existing?:Database.Database):boolean;
export function enrollPilotIdentity(d:Database.Database):void;
