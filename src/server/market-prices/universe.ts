// Reviewed identifiers, not holdings. Provider responses and team-use rights remain unverified.
export const ASSET_DEFINITIONS = {
  "US:AAPL": { assetClass: "equity", venue: "XNAS", providerType: "EQUITY", providerVenue: "NMS", supported: true },
  "US:MSFT": { assetClass: "equity", venue: "XNAS", providerType: "EQUITY", providerVenue: "NMS", supported: true },
  "US:SPY": { assetClass: "equity_etf", venue: "ARCX", providerType: "ETF", providerVenue: "PCX", supported: true },
  "US:QQQ": { assetClass: "equity_etf", venue: "XNAS", providerType: "ETF", providerVenue: "NGM", supported: true },
  "US:^GSPC": { assetClass: "index_level", venue: "S&P_DJI_INDEX", providerType: "INDEX", providerVenue: "SNP", supported: true },
  "US:GLD": { assetClass: "gold_etf", venue: "ARCX", providerType: "ETF", providerVenue: "PCX", supported: true },
  "TH:PTT": { assetClass: "equity", venue: "XBKK", providerType: "EQUITY", providerVenue: "SET", supported: true },
  "JP:7203": { assetClass: "equity", venue: "XTKS", providerType: "EQUITY", providerVenue: "JPX", supported: true },
  // Identified category gaps. Never substitute GLD, a continuous future or spot for one another.
  "US:XAUUSD=X": { assetClass: "gold_spot", venue: "OTC_UNVERIFIED", providerType: "CURRENCY", providerVenue: "UNVERIFIED", supported: false },
  "US:GC=F": { assetClass: "gold_futures_continuous", venue: "COMEX_UNVERIFIED_ROLL", providerType: "FUTURE", providerVenue: "CMX", supported: false },
} as const;
export const REVIEWED_PILOT = [
  { market: "US", symbol: "AAPL" }, { market: "US", symbol: "MSFT" },
  { market: "US", symbol: "SPY" }, { market: "US", symbol: "QQQ" },
  { market: "US", symbol: "^GSPC" }, { market: "US", symbol: "GLD" },
  { market: "TH", symbol: "PTT" }, { market: "JP", symbol: "7203" },
] as const;
export function assetDefinition(id: string) {
  return ASSET_DEFINITIONS[id as keyof typeof ASSET_DEFINITIONS];
}
export const MVP_PILOT = [
  { market: "US", symbol: "AAPL" }, { market: "US", symbol: "MSFT" },
  { market: "US", symbol: "SPY" }, { market: "US", symbol: "GLD" },
  { market: "US", symbol: "^GSPC" },
] as const;
export const mvpPriceProfile = () => process.env.MARKET_PRICES_PROFILE === "free-first-mvp-v1";
export const reviewedPriceProfile = () => mvpPriceProfile() || process.env.MARKET_PRICES_PROFILE === "reviewed-pilot-v1";
// Explicit bounded engineering profile. This does not attest rights or verify issuer/venue identity.
export const listingLocalPriceProfile = () => process.env.MARKET_PRICES_PROFILE === "listing-local-bounded-v1";
export const priceInstrumentLimit = () => mvpPriceProfile() ? 5 : listingLocalPriceProfile() ? 20 : 204;
