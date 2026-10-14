import { expect, it } from "vitest";
import { withToolAuthMetadata } from "./tool-auth";
it('declares tool-specific scopes at top level and in the compatibility mirror',()=>{
  const message={jsonrpc:'2.0' as const,id:1,result:{tools:[{name:'read_note',inputSchema:{type:'object'}},{name:'submit_investment_notes',_meta:{securitySchemes:[{type:'oauth2',scopes:['vault:read','inbox:submit']}]}}]}};
  const out=withToolAuthMetadata(message) as typeof message & {result:{tools:any[]}};
  expect(out.result.tools[0].securitySchemes).toEqual([{type:'oauth2',scopes:['vault:read']}]);
  expect(out.result.tools[1].securitySchemes).toEqual([{type:'oauth2',scopes:['vault:read','inbox:submit']}]);
  expect(out.result.tools[1]._meta.securitySchemes).toEqual(out.result.tools[1].securitySchemes);
  expect((message.result.tools[0] as any).securitySchemes).toBeUndefined();
});
it('does not alter call results, errors or notifications',()=>{
  for(const message of [{jsonrpc:'2.0' as const,id:1,result:{content:[{type:'text',text:'private data'}]}},{jsonrpc:'2.0' as const,id:1,error:{code:-32001,message:'Unauthorized'}},{jsonrpc:'2.0' as const,method:'notifications/initialized'}])expect(withToolAuthMetadata(message)).toBe(message);
});
