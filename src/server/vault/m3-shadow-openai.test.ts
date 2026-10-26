import {afterEach,describe,expect,it} from "vitest";
import {M2_POLICY} from "./research-decision-v2";
import {M3_SHADOW_CASES} from "./m3-shadow-corpus";
import {evaluateM3WithTransport,runOptInRealM3Shadow,M3_OPENAI_ENDPOINT}
  from "./m3-shadow-openai";

const ideal=(id:string)=>{
  const c=M3_SHADOW_CASES.find(x=>x.id===id);
  if(!c)throw Error("missing fixture");
  return {caseId:id,policyVersion:M2_POLICY.version,policySha256:M2_POLICY.sha256,
    disposition:c.gold.reviewSafe?"accept_qualified":"hold_unsupported",
    conclusion:c.gold.reviewSafe?"conditional":"no_change",evidenceState:"unresolved",
    citedIds:c.gold.requiredCitationIds,
    reasonTh:"ข่าวสมมติ ต้องระบุความไม่แน่นอนของแหล่งข้อมูล",
    missingEvidenceTh:"ตรวจ Source ต้นฉบับและ Period ก่อนถือเป็นข้อเท็จจริง"};
};
const response=(id:string,other:Record<string,unknown>={})=>new Response(JSON.stringify({
  status:"completed",model:"gpt-test-model",usage:{input_tokens:400,output_tokens:90},
  output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({...ideal(id),...other})}]}],
}),{status:200,headers:{"content-type":"application/json"}});
const req=(init:RequestInit)=>JSON.parse(String(init.body)) as {
  model:string;store:boolean;tools?:unknown;input:Array<{role:string;content:string}>;
  text:{format:{type:string;strict:boolean;schema:unknown}}};
afterEach(()=>{
  delete process.env.NM_M3_REAL_MODEL_OPT_IN;
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});

describe("M3b opt-in Responses adapter, injected transport only",()=>{
  it("sends only 20 fixed synthetic cases with verified full policy and no Vault or answer labels",async()=>{
    const seen:string[]=[];
    const fake=async(url:string,init:RequestInit)=>{
      expect(url).toBe(M3_OPENAI_ENDPOINT);
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      const data=req(init);
      expect(data.model).toBe("gpt-test-model");
      expect(data.store).toBe(false);
      expect(data.tools).toBeUndefined();
      expect(data.text.format).toMatchObject({type:"json_schema",strict:true});
      expect(data.input[0].role).toBe("developer");
      expect(data.input[0].content).toContain("Canonical Research Decision Policy v1.0.0");
      const prompt=JSON.parse(data.input[1].content) as {id:string;origin:string};
      expect(prompt.origin).toBe("fictional_synthetic_only");
      expect(data.input[1].content).not.toContain("reasonCode");
      expect(data.input[1].content).not.toContain("reviewSafe");
      expect(data.input[1].content).not.toContain("05_Thesis/");
      expect(init.headers).toMatchObject({Authorization:"Bearer sk-test-fake-not-real"});
      seen.push(prompt.id);
      return response(prompt.id);
    };
    const result=await evaluateM3WithTransport(fake,"sk-test-fake-not-real","gpt-test-model",1);
    expect(seen).toEqual(M3_SHADOW_CASES.map(x=>x.id));
    expect(result.trials[0].metrics.falseVerified).toBe(0);
    expect(result.trials[0].metrics.falseHold).toBe(0);
    expect(result.trials[0].apiReportedInputTokens).toBe(8000);
    expect(result.responseSource).toBe("injected_transport_unverified");
    expect(result.realModelInvokedByHarness).toBe(false);
    expect(result.vaultModified).toBe(false);
    expect(result.productionReleaseAllowed).toBe(false);
  });

  it("refuses wrong case, malformed output, false policy or incomplete provider status",async()=>{
    for(const transport of [
      async()=>response("p0_unverified_guidance_as_fact"),
      async(_url:string,init:RequestInit)=>response(
        (JSON.parse(req(init).input[1].content) as {id:string}).id,{policySha256:"0".repeat(64)}),
      async()=>new Response(JSON.stringify({status:"incomplete",output:[]}),{status:200}),
      async()=>new Response("not json",{status:200}),
    ]){
      await expect(evaluateM3WithTransport(transport,"sk-test-fake-not-real","gpt-test-model",1))
        .rejects.toThrow();
    }
  });

  it("fails closed on HTTP rate/auth errors without printing bearer or provider body",async()=>{
    const secret="sk-test-SUPER-SECRET-never-echo";
    for(const status of [401,429]){
      await expect(evaluateM3WithTransport(async()=>new Response(secret,{status}),secret,"gpt-test-model",1))
        .rejects.toThrow("M3_PROVIDER_HTTP_STATUS_"+status+"_HOLD");
    }
  });

  it("requires a local explicit opt-in, usable API key and model; blocks Railway/CI",async()=>{
    if(!process.env.CI&&!process.env.GITHUB_ACTIONS){
      await expect(runOptInRealM3Shadow({key:undefined,model:"gpt-test",trialCount:1,explicitConsent:true}))
        .rejects.toThrow("M3_REAL_PROVIDER_EXPLICIT_LOCAL_CONSENT_KEY_AND_MODEL_REQUIRED");
      process.env.NM_M3_REAL_MODEL_OPT_IN="YES";
      await expect(runOptInRealM3Shadow({key:"sk-short",model:"gpt-test",trialCount:1,explicitConsent:true}))
        .rejects.toThrow("M3_REAL_PROVIDER_EXPLICIT_LOCAL_CONSENT_KEY_AND_MODEL_REQUIRED");
    }
    process.env.RAILWAY_PROJECT_ID="never-use-live-provider-on-production";
    await expect(runOptInRealM3Shadow({key:"sk-test-long-not-real",model:"gpt-test",trialCount:1,explicitConsent:true}))
      .rejects.toThrow("M3_REAL_PROVIDER_FORBIDDEN_IN_CI_OR_RAILWAY");
  });
});
