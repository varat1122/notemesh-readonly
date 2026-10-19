/** Types for the matching .mjs OFFLINE fixture module; never a production gate. */
export declare function assertIsolatedInterprocessFixture(root:string):string;
export declare function acquireFixtureInterprocessTicket(root:string,purpose:"writer"|"snapshot"):{release():void};
export declare function withFixtureInterprocessExclusion<T>(
  root:string,purpose:"writer"|"snapshot",perform:()=>Promise<T>|T
):Promise<T>;
