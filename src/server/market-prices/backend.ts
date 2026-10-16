import { readPriceStore } from "./store.ts";
import { drivePriceCache, type PriceReader } from "./drive-backend.ts";
import { PriceError, type InstrumentInput } from "./model.ts";
export async function readCachedPrices<T>(read: (store: PriceReader) => T, requested: InstrumentInput[] = []) {
  const backend = process.env.MARKET_PRICES_STORAGE ?? "disk";
  if (backend === "google-drive") return drivePriceCache().read(read, requested);
  if (backend === "disk") return readPriceStore(read);
  throw new PriceError("invalid_price_storage_backend");
}
