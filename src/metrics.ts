export interface SpeedSample {
  providerID: string;
  modelID: string;
  outputTokens: number;
  reasoningTokens: number;
  costUSD: number;
  firstTextAt: number | null;
  completedAt: number;
  tokensPerSecond: number | null;
}

export function calculateTokensPerSecond(
  outputTokens: number,
  firstTextAt: number | null | undefined,
  completedAt: number | null | undefined,
): number | null {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return null;
  if (!Number.isFinite(firstTextAt) || !Number.isFinite(completedAt)) return null;
  const durationMs = (completedAt as number) - (firstTextAt as number);
  if (durationMs <= 0) return null;
  return (outputTokens * 1000) / durationMs;
}

export function median(values: readonly number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function rollingModelMedian(
  samples: readonly SpeedSample[],
  providerID: string,
  modelID: string,
  windowSize = 20,
): { medianTokensPerSecond: number | null; sampleCount: number } {
  const matching = samples
    .filter((sample) => sample.providerID === providerID && sample.modelID === modelID && sample.tokensPerSecond !== null)
    .slice(-Math.max(0, windowSize));
  return {
    medianTokensPerSecond: median(matching.map((sample) => sample.tokensPerSecond as number)),
    sampleCount: matching.length,
  };
}

export function formatTokensPerSecond(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "not measured";
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} tok/s`;
}
