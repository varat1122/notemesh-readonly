import type Database from "better-sqlite3";
export function assertPilotIdentity(dataDir:string,mode?:string,driver?:typeof Database):void;
export function enrollPilotIdentity(d:Database.Database):void;
