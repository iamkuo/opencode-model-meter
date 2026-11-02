import test from "node:test";
import assert from "node:assert/strict";
import { parseModelsDevCatalog, resolveModelPrice, type CatalogSnapshot } from "../src/catalog.ts";

const fixture = {
  openai: {
    id: "openai",
    models: {
      "gpt-test": {
        id: "gpt-test",
        name: "GPT Test",
        cost: { input: 1.25, output: 10, cache_read: 0.125, cache_write: 1.5 },
      },
      "free-test": {
        id: "free-test",
        cost: { input: 0, output: 0 },
      },
      "missing-cost": { id: "missing-cost", name: "Unpriced" },
    },
  },
  relay: {
    id: "relay",
    models: {
      "gpt-alias": {
        id: "gpt-alias",
        canonical_model_id: "openai/gpt-test",
        cost: { input: 2, output: 12 },
      },
    },
  },
};

function snapshot(): CatalogSnapshot {
  return parseModelsDevCatalog(fixture, 1234);
}

test("parses the full provider/model structure and preserves zero prices", () => {
  const result = snapshot();
  assert.equal(result.fetchedAt, 1234);
  assert.equal(result.providerCount, 2);
  assert.equal(result.totalModelCount, 4);
  assert.equal(result.pricedModelCount, 3);
  assert.deepEqual(result.prices.find((row) => row.modelID === "gpt-test"), {
    providerID: "openai",
    modelID: "gpt-test",
    canonicalModelID: undefined,
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 1.5,
  });
  assert.equal(result.prices.find((row) => row.modelID === "free-test")?.input, 0);
});

test("rejects invalid or empty catalog payloads rather than replacing a working cache", () => {
  assert.throws(() => parseModelsDevCatalog(null), /JSON object/);
  assert.throws(() => parseModelsDevCatalog({ openai: { models: {} } }), /no usable/);
});

test("prefers the OpenCode runtime override for the selected model", () => {
  const price = resolveModelPrice(
    snapshot(),
    { providerID: "openai", modelID: "gpt-test" },
    [{ providerID: "openai", id: "gpt-test", modelID: "gpt-test", cost: [{ input: 0.5, output: 4, cache: { read: 0.05, write: 0.5 } }] }],
  );
  assert.equal(price?.source, "OpenCode runtime model");
  assert.equal(price?.input, 0.5);
  assert.equal(price?.output, 4);
});

test("uses an exact provider/model match before any canonical fallback", () => {
  const price = resolveModelPrice(snapshot(), { providerID: "relay", modelID: "gpt-alias" });
  assert.equal(price?.source, "Models.dev exact match");
  assert.equal(price?.input, 2);
});

test("uses configured canonical provider only as explicit fallback", () => {
  const price = resolveModelPrice(
    snapshot(),
    { providerID: "custom", modelID: "gpt-test" },
    [{ providerID: "custom", id: "local-alias", modelID: "gpt-test", canonical: "openai", cost: [] }],
  );
  assert.equal(price?.source, "Models.dev canonical fallback");
  assert.equal(price?.output, 10);
});

test("does not fuzzy-match by a model's display name", () => {
  const price = resolveModelPrice(snapshot(), { providerID: "openai", modelID: "GPT Test" });
  assert.equal(price, undefined);
});
