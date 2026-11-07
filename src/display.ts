// Matches a previously applied meter suffix such as " [0/0/53tps/200k]" or a
// legacy " [in$1/out$5/1M·~42t/s]" suffix — both always contain "tps" or "t/s".
const METER_PATTERN = / \[[^\[\]]*(?:tps|t\/s)[^\[\]]*\]$/;
const MAX_BASE_NAME = 24;

function compactRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  const precision = value < 10 ? 2 : 3;
  return Number(value.toPrecision(precision)).toString();
}

/** Formats a token count as "128k" or "1.5M". */
function compactCount(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "?";
  if (size >= 1_000_000) return `${Math.round(size / 100_000) / 10}M`;
  return `${Math.round(size / 1000)}k`;
}

/** Returns the meter suffix of a decorated model name, if present (without the leading space). */
export function extractMeterSuffix(name: string): string | undefined {
  const match = name.match(METER_PATTERN);
  return match ? match[0].slice(1) : undefined;
}

export function formatModelRowName(
  originalName: string,
  inputPrice: number | undefined,
  outputPrice: number | undefined,
  medianTokensPerSecond: number | null,
  tier?: { type: string; size: number },
  contextWindow?: number,
): string {
  const rawBaseName = originalName.replace(METER_PATTERN, "");
  const baseName = rawBaseName.length > MAX_BASE_NAME ? `${rawBaseName.slice(0, MAX_BASE_NAME - 1)}…` : rawBaseName;
  const price = `${compactRate(inputPrice)}/${compactRate(outputPrice)}`;
  const speed = medianTokensPerSecond === null ? "-tps" : `${Math.round(medianTokensPerSecond)}tps`;
  const context = contextWindow ? `/${compactCount(contextWindow)}` : "";
  // A pricing tier at or above the context window duplicates it; only show tiers that bite mid-context.
  const tierLabel = tier && tier.size > 0 && (!contextWindow || tier.size < contextWindow) ? `@${compactCount(tier.size)}` : "";
  return `${baseName} [${price}/${speed}${context}${tierLabel}]`;
}
