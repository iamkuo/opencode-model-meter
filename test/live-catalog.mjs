import { fetchFullCatalog } from "../src/catalog.ts";

const snapshot = await fetchFullCatalog();
if (snapshot.providerCount < 1 || snapshot.totalModelCount < 1 || snapshot.pricedModelCount < 1) {
  throw new Error("Live Models.dev response did not contain expected catalog data");
}
console.log(
  `OK: fetched ${snapshot.providerCount} providers, ${snapshot.totalModelCount} models, ${snapshot.pricedModelCount} priced models`,
);
