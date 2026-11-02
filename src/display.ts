import { formatTokensPerSecond } from "./metrics.ts";

const METER_MARKER = " [in";
const MAX_BASE_NAME = 24;

function compactRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const precision = value < 10 ? 2 : 3;
  return `$${Number(value.toPrecision(precision)).toString()}`;
}

export function formatModelRowName(
  originalName: string,
  inputPrice: number | undefined,
  outputPrice: number | undefined,
  medianTokensPerSecond: number | null,
  tier?: { type: string; size: number },
): string {
  const markerAt = originalName.lastIndexOf(METER_MARKER);
  const rawBaseName = markerAt >= 0 ? originalName.slice(0, markerAt) : originalName;
  const baseName = rawBaseName.length > MAX_BASE_NAME ? `${rawBaseName.slice(0, MAX_BASE_NAME - 1)}…` : rawBaseName;
  const price = `${compactRate(inputPrice)}/out${compactRate(outputPrice)}/1M`;
  const tierLabel = tier ? `@${Math.round(tier.size / 1000)}k` : "";
  const speed = medianTokensPerSecond === null ? "—t/s" : `~${Math.round(medianTokensPerSecond)}t/s`;
  return `${baseName}${METER_MARKER}${price}${tierLabel}·${speed}]`;
}
