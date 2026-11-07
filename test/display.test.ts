import test from "node:test";
import assert from "node:assert/strict";
import { extractMeterSuffix, formatModelRowName } from "../src/display.ts";

test("appends compact input/output price, speed, and context window at the right end of the model row", () => {
  assert.equal(
    formatModelRowName("GPT-6.1 Terra", 1, 5, 42.3, undefined, 400_000),
    "GPT-6.1 Terra [1/5/42tps/400k]",
  );
});

test("uses an explicit unavailable speed and shows the context window", () => {
  assert.equal(
    formatModelRowName("Local Model", undefined, 0, null, { type: "context", size: 128000 }, 128000),
    "Local Model [-/0/-tps/128k]",
  );
});

test("shows a pricing tier only when it sits below the context window", () => {
  assert.equal(
    formatModelRowName("Tiered Model", 1, 5, 42.3, { type: "context", size: 128000 }, 200_000),
    "Tiered Model [1/5/42tps/200k@128k]",
  );
});

test("truncates long display names only to preserve the price and speed suffix", () => {
  const longName = "A very long model display name that would clip the speed column";
  const result = formatModelRowName(longName, 0.2, 1.5, 42.3, undefined, 128000);
  assert.equal(result, "A very long model displ… [0.2/1.5/42tps/128k]");
  assert.ok(result.endsWith("42tps/128k]"));
});

test("replaces the previous meter suffix during model registry reloads", () => {
  const first = formatModelRowName("Example Model", 0.2, 1.5, 10, undefined, 128000);
  const second = formatModelRowName(first, 0.3, 2, 20, undefined, 128000);
  assert.equal(second, "Example Model [0.3/2/20tps/128k]");
  assert.equal(extractMeterSuffix(second), "[0.3/2/20tps/128k]");
});

test("strips legacy long-form and short-form suffixes when reformatting", () => {
  assert.equal(
    formatModelRowName("Example Model [in$0.3/out$2/1M·~20t/s]", 0.3, 2, 20, undefined, 128000),
    "Example Model [0.3/2/20tps/128k]",
  );
  assert.equal(
    formatModelRowName("Example Model [0.3/2/20t/s]", 0.3, 2, 20, undefined, 128000),
    "Example Model [0.3/2/20tps/128k]",
  );
});

test("extractMeterSuffix returns undefined for plain names", () => {
  assert.equal(extractMeterSuffix("Plain Model"), undefined);
});

test("formats context windows in millions", () => {
  assert.equal(
    formatModelRowName("Big Model", 1, 5, null, undefined, 1_048_576),
    "Big Model [1/5/-tps/1M]",
  );
});
