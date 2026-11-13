import { AsyncLocalStorage } from "node:async_hooks";
import { PriceError } from "./model.ts";

// Shared only by price-provider/Drive requests, never an LLM or Vault writer.
export const priceDeadline = new AsyncLocalStorage<number>();
export const priceProviderBudget = new AsyncLocalStorage<{ requests: number; limit: number }>();
export function claimPriceRequest() {
  const budget = priceProviderBudget.getStore();
  if (budget) {
    if (budget.requests >= budget.limit) throw new PriceError("provider_request_budget_exhausted");
    budget.requests++;
  }
}
export function assertPriceTime() {
  const deadline = priceDeadline.getStore();
  if (deadline !== undefined && deadline <= Date.now()) throw new PriceError("price_refresh_deadline_exceeded");
}
export function priceRequestSignal() {
  assertPriceTime();
  return AbortSignal.timeout(Math.min(25000, Math.max(1, (priceDeadline.getStore() ?? Date.now() + 25000) - Date.now())));
}
