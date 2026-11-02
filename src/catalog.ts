export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MAX_CATALOG_CHARS = 15_000_000;

export interface PriceRecord {
  providerID: string;
  modelID: string;
  canonicalModelID?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface CatalogSnapshot {
  fetchedAt: number;
  providerCount: number;
  totalModelCount: number;
  pricedModelCount: number;
  prices: PriceRecord[];
}

export interface SelectedModel {
  providerID: string;
  modelID: string;
}

export interface RuntimeModelCost {
  input: number;
  output: number;
  cache?: { read?: number; write?: number };
  tier?: { type: string; size: number };
}

export interface RuntimeModelPrice {
  providerID: string;
  id: string;
  modelID: string;
  canonical?: string;
  cost?: readonly RuntimeModelCost[];
}

export interface ResolvedPrice {
  providerID: string;
  modelID: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  source: "OpenCode runtime model" | "Models.dev exact match" | "Models.dev canonical fallback";
  tier?: { type: string; size: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNonnegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parsePrice(value: unknown, providerID: string, fallbackModelID: string): PriceRecord | undefined {
  if (!isRecord(value) || !isRecord(value.cost)) return undefined;
  const cost = value.cost;
  const input = optionalNonnegativeNumber(cost.input);
  const output = optionalNonnegativeNumber(cost.output);
  const cacheRead = optionalNonnegativeNumber(cost.cache_read);
  const cacheWrite = optionalNonnegativeNumber(cost.cache_write);

  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined;
  }

  const modelID = typeof value.id === "string" && value.id.length > 0 ? value.id : fallbackModelID;
  const canonicalModelID = typeof value.canonical_model_id === "string" ? value.canonical_model_id : undefined;
  return { providerID, modelID, canonicalModelID, input, output, cacheRead, cacheWrite };
}

/** Parse the complete Models.dev provider catalog. Never fuzzy-match model names. */
export function parseModelsDevCatalog(payload: unknown, fetchedAt = Date.now()): CatalogSnapshot {
  if (!isRecord(payload)) throw new Error("Models.dev catalog must be a JSON object");

  let providerCount = 0;
  let totalModelCount = 0;
  const prices: PriceRecord[] = [];

  for (const [providerID, rawProvider] of Object.entries(payload)) {
    if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;
    providerCount += 1;

    for (const [modelKey, rawModel] of Object.entries(rawProvider.models)) {
      totalModelCount += 1;
      const parsed = parsePrice(rawModel, providerID, modelKey);
      if (parsed) prices.push(parsed);
    }
  }

  if (providerCount === 0 || totalModelCount === 0 || prices.length === 0) {
    throw new Error("Models.dev response contained no usable provider/model price data");
  }

  return {
    fetchedAt,
    providerCount,
    totalModelCount,
    pricedModelCount: prices.length,
    prices,
  };
}

/** Download and parse the entire catalog, rejecting bad HTTP responses and oversized bodies. */
export async function fetchFullCatalog(
  fetchImpl: typeof fetch = fetch,
  fetchedAt = Date.now(),
): Promise<CatalogSnapshot> {
  const response = await fetchImpl(MODELS_DEV_API_URL, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Models.dev returned HTTP ${response.status}`);

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CATALOG_CHARS) {
    throw new Error(`Models.dev catalog exceeds the ${MAX_CATALOG_CHARS.toLocaleString()} character safety limit`);
  }

  const text = await response.text();
  if (text.length > MAX_CATALOG_CHARS) {
    throw new Error(`Models.dev catalog exceeds the ${MAX_CATALOG_CHARS.toLocaleString()} character safety limit`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Models.dev response was not valid JSON");
  }
  return parseModelsDevCatalog(payload, fetchedAt);
}

function runtimePrice(model: RuntimeModelPrice): ResolvedPrice | undefined {
  const costs = model.cost ?? [];
  const selectedCost = costs.find((item) => !item.tier) ?? costs[0];
  if (!selectedCost) return undefined;
  return {
    providerID: model.providerID,
    modelID: model.id,
    input: optionalNonnegativeNumber(selectedCost.input),
    output: optionalNonnegativeNumber(selectedCost.output),
    cacheRead: optionalNonnegativeNumber(selectedCost.cache?.read),
    cacheWrite: optionalNonnegativeNumber(selectedCost.cache?.write),
    source: "OpenCode runtime model",
    tier: selectedCost.tier,
  };
}

/** Resolve configured OpenCode rates first, then exact Models.dev IDs, then a provider-canonical fallback. */
export function resolveModelPrice(
  snapshot: CatalogSnapshot | null | undefined,
  selected: SelectedModel | null | undefined,
  runtimeModels: readonly RuntimeModelPrice[] = [],
): ResolvedPrice | undefined {
  if (!selected) return undefined;

  const runtime = runtimeModels.find(
    (model) => model.providerID === selected.providerID && (model.id === selected.modelID || model.modelID === selected.modelID),
  );
  const configured = runtime ? runtimePrice(runtime) : undefined;
  if (configured) return configured;
  if (!snapshot) return undefined;

  const candidates = [...new Set([selected.modelID, runtime?.modelID, runtime?.id].filter((id): id is string => Boolean(id)))];
  for (const modelID of candidates) {
    const exact = snapshot.prices.find((price) => price.providerID === selected.providerID && price.modelID === modelID);
    if (exact) {
      return { ...exact, source: "Models.dev exact match" };
    }
  }

  if (runtime?.canonical) {
    for (const modelID of candidates) {
      const canonical = snapshot.prices.find((price) => price.providerID === runtime.canonical && price.modelID === modelID);
      if (canonical) {
        return { ...canonical, source: "Models.dev canonical fallback" };
      }
    }
  }

  return undefined;
}

export function formatRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "unavailable";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
