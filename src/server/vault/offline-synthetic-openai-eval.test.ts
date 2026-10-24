import {afterEach,describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {OpenAIEvaluationBudget,budgetedEvaluationTransport}
  from "./openai-evaluation-budget";
import {SYNTHETIC_SEMANTIC_CASES}
  from "./offline-semantic-benchmark-corpus";
import {
  evaluateSyntheticCasesWithTransport,
  evaluationCredentialFromEnvironment,
  runOptInRealOpenAISyntheticEvaluation,
  SYNTHETIC_OPENAI_ENDPOINT,
} from "./offline-synthetic-openai-eval";
import {type SyntheticModelPrediction}
  from "./offline-semantic-benchmark-score";

const gold=new Map(SYNTHETIC_SEMANTIC_CASES.map(c=>[c.id,c]));
function responseText(answer:SyntheticModelPrediction){
  return new Response(JSON.stringify({
    status:"completed",
    output:[{type:"message",content:[
      {type:"output_text",text:JSON.stringify(answer)},
    ]}],
  }),{status:200,headers:{"content-type":"application/json"}});
}
const ideal=(caseId:string):SyntheticModelPrediction=>{
  const c=gold.get(caseId);
  if(!c)throw Error("unexpected synthetic case");
  return {
    caseId,proposedRelation:c.goldRelation,
    citedIds:["T0","I0S0"],
    abstainsForMissingEvidence:c.goldAbstain,
    proposedEconomicChannel:c.goldChannel,
    economicReasoning:"hypothesis",
    primarySourceStillRequired:"Original issuer source and independent checks",
    counterEvidenceCoverage:"not_exhaustively_checked",
    limitations:"Fictional data only; no complete counter-evidence verified.",
  };
};
type Payload={model:string;store:boolean;tools?:unknown;
  input:Array<{role:string;content:string}>;
  text:{format:{type:string;strict:boolean;schema:unknown}}};
const decode=(init:RequestInit)=>{
  const payload=JSON.parse(String(init.body)) as Payload;
  const input=JSON.parse(payload.input[1].content) as {id:string};
  return {payload,input};
};
afterEach(()=>{
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
  delete process.env.NM_ENABLE_SYNTHETIC_OPENAI_RUN;
});
describe("PR #91: real-provider-ready, mock-transport-tested SYNTH-only adapter",()=>{
  it("accepts opaque cloud proxy bindings without treating syntax as authentication or falling back",()=>{
    expect(evaluationCredentialFromEnvironment({NM_EVAL_API_KEY:"proxy-token"})).toBe("proxy-token");
    expect(evaluationCredentialFromEnvironment({OPENAI_API_KEY:"sk-local-fixture"})).toBe("sk-local-fixture");
    expect(evaluationCredentialFromEnvironment({NM_EVAL_API_KEY:"proxy-token",
      OPENAI_API_KEY:"sk-local-fixture"})).toBe("proxy-token");
    expect(evaluationCredentialFromEnvironment({})).toBeUndefined();
    for(const key of [""," ","token\nheader", "x".repeat(8193)]){
      expect(()=>evaluationCredentialFromEnvironment({NM_EVAL_API_KEY:key,
        OPENAI_API_KEY:"sk-local-fixture"})).toThrow("invalid_credential_binding_hold");
    }
  });
  it("runs the existing eight-case workflow through cumulative accounting and charges invalid semantic output",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-triage-budget-"));
    const file=path.join(root,"campaign.sqlite");
    OpenAIEvaluationBudget.initialize(file);
    const budget=new OpenAIEvaluationBudget(file);
    const pricing={model:"gpt-test-2026-10-21",contextTokens:400_000,maxOutputTokens:128_000,
      inputUsdPerMillion:"1.25",outputUsdPerMillion:"10",evidenceSha256:"c".repeat(64)};
    let calls=0;
    const transport=async(_url:string,init:RequestInit)=>{
      calls++;
      const {input}=decode(init);
      const output=await responseText(ideal(calls===9?"different_period_same_number":input.id)).json();
      return Response.json({...output,id:"resp_triage_"+calls,model:pricing.model,service_tier:"default",
        usage:{input_tokens:1000,output_tokens:2000,total_tokens:3000,
          input_tokens_details:{cached_tokens:500},output_tokens_details:{reasoning_tokens:1000}}});
    };
    const options={model:pricing.model,maxOutputTokens:32_768,reasoningEffort:"high" as const};
    try{
      const result=await evaluateSyntheticCasesWithTransport(
        budgetedEvaluationTransport(budget,pricing,"baseline",transport),"fake",options);
      expect(result.cases).toBe(8);
      expect(budget.status()).toMatchObject({requests:8,chargedNanoUsd:170_000_000,reservedNanoUsd:0});
      await expect(evaluateSyntheticCasesWithTransport(
        budgetedEvaluationTransport(budget,pricing,"deliberate-second-round",transport),"fake",options))
        .rejects.toThrow("case_identity_mismatch");
      expect(calls).toBe(9);
      expect(budget.status().chargedNanoUsd).toBe(191_250_000);
    }finally{budget.close();fs.rmSync(root,{recursive:true,force:true});}
  });
  it("would send precisely 8 fixed fictional cases to constant HTTPS endpoint, never Vault data",async()=>{
    const received:string[]=[];
    const transport=async(url:string,init:RequestInit)=>{
      expect(url).toBe(SYNTHETIC_OPENAI_ENDPOINT);
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      const {payload,input}=decode(init);
      expect(payload.model).toBe("gpt-5-mini");
      expect(payload.store).toBe(false);
      expect(payload.tools).toBeUndefined();
      expect(payload.text.format).toMatchObject({
        type:"json_schema",strict:true,
      });
      expect(init.headers).toMatchObject({
        Authorization:"Bearer sk-fake-REDACTED-test-only",
      });
      expect(JSON.stringify(payload)).not.toContain("05_Thesis/NVDA");
      expect(JSON.stringify(payload)).not.toContain("goldRelation");
      expect(JSON.stringify(payload)).not.toContain("requiredReviewQueue");
      expect(JSON.stringify(payload)).toContain("synthetic_fixture_only");
      received.push(input.id);
      return responseText(ideal(input.id));
    };
    const result=await evaluateSyntheticCasesWithTransport(
      transport,"sk-fake-REDACTED-test-only");
    expect(received).toEqual(SYNTHETIC_SEMANTIC_CASES.map(c=>c.id));
    expect(result).toMatchObject({
      responseSource:"injected_transport_unverified",
      providerResponsesAuthenticated:false,
      providerCallWasPerformedByThisFunction:false,
      productionReleaseAllowed:false,
      ownerApprovalGranted:false,
      vaultModified:false,
    });
    expect(result.metrics.allFixtureExpectationsMatched).toBe(true);
  });
  it("reports false duplicate / missing human escalation on a simulated model mistake",async()=>{
    const result=await evaluateSyntheticCasesWithTransport(async(_url,init)=>{
      const {input}=decode(init);
      const answer=ideal(input.id);
      if(input.id==="same_event_numeric_conflict"){
        answer.proposedRelation="duplicate_candidate";
        answer.abstainsForMissingEvidence=false;
      }
      return responseText(answer);
    },"sk-test-fake");
    expect(result.metrics.unsafeFalseDuplicates).toBe(1);
    expect(result.metrics.missedCriticalReviews).toBe(1);
    expect(result.metrics.safetyChecksPassed).toBe(false);
    expect(result.productionReleaseAllowed).toBe(false);
  });
  it("holds nonmatching case ID, malformed JSON, non-completed provider response",async()=>{
    for(const fake of [
      new Response(JSON.stringify({
        status:"completed",output:[{type:"message",content:[
          {type:"output_text",text:JSON.stringify(ideal("different_period_same_number"))},
        ]}],
      })),
      new Response(JSON.stringify({
        status:"incomplete",output:[{type:"message",content:[
          {type:"output_text",text:JSON.stringify(ideal("same_event_exact_reimport"))},
        ]}],
      })),
      new Response("{not json",{
        status:200,headers:{"content-type":"application/json"},
      }),
    ]){
      await expect(evaluateSyntheticCasesWithTransport(
        async()=>fake,"sk-test-fake")).rejects.toThrow();
    }
  });
  it("fails closed on 401/429 and never includes bearer token or raw body in error",async()=>{
    const secret="sk-test-SECRET-never-log";
    for(const code of [401,429]){
      try{
        await evaluateSyntheticCasesWithTransport(
          async()=>new Response(secret,{
            status:code,headers:{"content-type":"text/plain"},
          }),secret);
        throw Error("expected_failure");
      }catch(e){
        const msg=String(e);
        expect(msg).toContain("synthetic_openai_http_status_"+code+"_hold");
        expect(msg).not.toContain(secret);
      }
    }
  });
  it("blocks non-explicit or CI/Railway live-provider execution with no outgoing call",async()=>{
    if(!process.env.CI&&!process.env.GITHUB_ACTIONS){
      await expect(runOptInRealOpenAISyntheticEvaluation(undefined,false))
        .rejects.toThrow("synthetic_openai_explicit_local_opt_in_and_key_required");
      process.env.NM_ENABLE_SYNTHETIC_OPENAI_RUN="YES";
      await expect(runOptInRealOpenAISyntheticEvaluation("invalid header\n",true))
        .rejects.toThrow("synthetic_openai_explicit_local_opt_in_and_key_required");
    }
    process.env.RAILWAY_PROJECT_ID="do-not-contact-any-provider";
    await expect(runOptInRealOpenAISyntheticEvaluation(
      "sk-fake-REDACTED-test-only",true))
      .rejects.toThrow("synthetic_live_inference_forbidden_in_ci_or_railway");
  });
});
