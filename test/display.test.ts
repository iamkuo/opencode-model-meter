import test from "node:test";
import assert from "node:assert/strict";
import { formatModelRowName } from "../src/display.ts";

test("appends compact input/output price and estimated speed at the right end of the model row", () => {
  assert.equal(
    formatModelRowName("GPT-6.1 Terra", 1, 5, 42.3),
    "GPT-6.1 Terra [in$1/out$5/1M·~42t/s]",
  );
});

test("uses an explicit unavailable speed and includes context tier when needed", () => {
  assert.equal(
    formatModelRowName("Local Model", undefined, 0, null, { type: "context", size: 128000 }),
    "Local Model [in—/out$0/1M@128k·—t/s]",
  );
});

test("truncates long display names only to preserve the price and speed suffix", () => {
  const longName = "A very long model display name that would clip the speed column";
  const result = formatModelRowName(longName, 0.2, 1.5, 42.3);
  assert.equal(result, "A very long model displ… [in$0.2/out$1.5/1M·~42t/s]");
  assert.ok(result.endsWith("~42t/s]"));
});

test("replaces the previous meter suffix during model registry reloads", () => {
  const first = formatModelRowName("Example Model", 0.2, 1.5, 10);
  const second = formatModelRowName(first, 0.3, 2, 20);
  assert.equal(second, "Example Model [in$0.3/out$2/1M·~20t/s]");
  assert.equal(second.split(" [in").length - 1, 1);
});
