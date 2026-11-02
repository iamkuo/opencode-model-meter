import test from "node:test";
import assert from "node:assert/strict";
import { calculateTokensPerSecond, median, rollingModelMedian, type SpeedSample } from "../src/metrics.ts";

function sample(modelID: string, tps: number | null, providerID = "p"): SpeedSample {
  return {
    providerID,
    modelID,
    outputTokens: 90,
    reasoningTokens: 0,
    costUSD: 0.01,
    firstTextAt: 1000,
    completedAt: 4000,
    tokensPerSecond: tps,
  };
}

test("calculates output speed from the first text timestamp to completion", () => {
  assert.equal(calculateTokensPerSecond(900, 1000, 4000), 300);
});

test("does not invent a speed for missing, zero, or invalid timing data", () => {
  assert.equal(calculateTokensPerSecond(0, 1000, 4000), null);
  assert.equal(calculateTokensPerSecond(10, null, 4000), null);
  assert.equal(calculateTokensPerSecond(10, 4000, 4000), null);
  assert.equal(calculateTokensPerSecond(Number.NaN, 1000, 2000), null);
});

test("calculates a robust median", () => {
  assert.equal(median([40, 10, 30, 20]), 25);
  assert.equal(median([4, 2, 3]), 3);
  assert.equal(median([0, -1, Number.NaN]), null);
});

test("groups rolling speed history by exact provider and model", () => {
  const rows = [sample("a", 10), sample("a", 30), sample("b", 100), sample("a", null), sample("a", 20, "other")];
  assert.deepEqual(rollingModelMedian(rows, "p", "a"), { medianTokensPerSecond: 20, sampleCount: 2 });
  assert.deepEqual(rollingModelMedian(rows, "p", "missing"), { medianTokensPerSecond: null, sampleCount: 0 });
});
