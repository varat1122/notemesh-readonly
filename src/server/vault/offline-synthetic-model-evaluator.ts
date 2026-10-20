/**
 * PR #90 — injectable synthetic-only model test runner.
 *
 * NO provider URL, credentials, fetch, production notes, or real-owner
 * private information exists in this module. A CALLER-SUPPLIED evaluator
 * can receive ONLY fixed fictional benchmark inputs, never arbitrary
 * Vault packets. The callback could itself perform I/O, so this is NOT
 * a security sandbox or a trusted inference provider.
 */
import {getSyntheticModelBenchmarkInputs}
  from "./offline-semantic-benchmark-corpus";
import {scoreSyntheticSemanticPredictions,
  type SyntheticModelPrediction} from "./offline-semantic-benchmark-score";

type FixedSyntheticInput=ReturnType<
  typeof getSyntheticModelBenchmarkInputs>[number];
type FrozenSyntheticInput=
  Omit<Readonly<FixedSyntheticInput>,"historicalExcerpts"> & {
    readonly historicalExcerpts:ReadonlyArray<
      Readonly<FixedSyntheticInput["historicalExcerpts"][number]>>;
  };

export async function runSyntheticOnlyModelEvaluation(
  candidateModel:(testInput:FrozenSyntheticInput)=>
    Promise<SyntheticModelPrediction>,
){
  if(typeof candidateModel!=="function")
    throw Error("synthetic_model_callback_required");
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("synthetic_model_evaluation_forbidden_in_railway");
  // Only hardcoded synthetic test data, never caller-supplied text or file
  // paths. Freeze the per-case view to prevent shared fixture mutation.
  const prompts=getSyntheticModelBenchmarkInputs();
  const predictions:SyntheticModelPrediction[]=[];
  for(const p of prompts){
    const frozen=Object.freeze({
      ...p,
      historicalExcerpts:Object.freeze(p.historicalExcerpts.map(x=>
        Object.freeze({...x}))),
    });
    predictions.push(await candidateModel(frozen));
  }
  // Scorer validates full schema, hallucinated IDs, abstentions, unsafe
  // duplicate/critical-review mistakes. Scores are not deployment approval.
  return scoreSyntheticSemanticPredictions(predictions);
}
