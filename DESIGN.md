# Model Meter: implementation design

## Scope and assumptions

This package targets the OpenCode 2.2.5 server and TUI plugin APIs. It ships two entry points in one package: the server plugin (`src/server.ts`) and TUI extension (`src/tui.tsx`). The model-picker display uses the server plugin's documented `ctx.model.transform` API; the TUI API does not provide a custom row-render hook for the built-in picker.

## Deterministic behavior

| Requirement | Implementation | Acceptance check |
| --- | --- | --- |
| Refresh all pricing data on startup | Server setup and every TUI setup call `fetchFullCatalog()` through a typed server RPC. Fetch uses `cache: "no-store"`, a 20-second timeout, a 15 MB response cap, and one retry. | Live catalog check returns providers/models; OpenCode plugin storage contains the complete normalized index. |
| Keep prices available if offline | Persist the normalized catalog and usage samples under a plugin-owned storage key; retain the last good in-memory/persisted snapshot if a future fetch fails. | Catalog/parser tests reject invalid payloads without overwriting a valid snapshot. |
| Show price for each model in `/models` | A server `Model.Info` transform appends compact input/output rates per 1M tokens to every model name. OpenCode runtime price metadata (including user overrides) wins; otherwise use an exact Models.dev provider/model match. | OpenCode 2.2.5 `model.list` returns annotated names; full TUI picker visibly shows the suffix on multiple rows. |
| Show output speed per model | Subscribe to OpenCode session-step start, first text start, and successful step end. Compute `output tokens / (completedAt - firstTextAt)` and display the median of the latest 20 successful samples for the exact provider/model. | Unit tests cover valid timing, missing timing, zero/invalid durations, median and model grouping. |
| Refresh from the TUI | A TUI command-palette action and `/model-meter refresh` call the typed server RPC, so neither requires an active chat session. `/model-meter status` shows the selected model. | The command palette action was invoked from the home screen in OpenCode 2.2.5 and the catalog was persisted. |
| Avoid prompt-data collection | Persist model IDs, token counts, cost, and event timestamps only; never persist prompt or generated text. Retain at most 1,000 samples. | Source review and storage payload shape contain metadata only. |

## Model-row format

The suffix is compact to fit the built-in picker: `[1/5/42tps/200k]` (input / output price per 1M tokens, output speed in tps, context window), with an optional `@128k` suffix when a pricing tier sits below the context window. `-tps` means no speed sample exists yet for that exact model. Long display names are shortened to 24 characters before the suffix so price and speed remain visible on typical terminal widths. It is appended to the name, not rendered as a separate aligned column; the public plugin API does not expose a per-row model-picker renderer.

Runtime model prices are used first, so explicit OpenCode model configuration takes priority. When those rates are missing, exact provider/model IDs from the full Models.dev index are used. No fuzzy name matching is performed. Context-tier pricing is marked with a short `@Nk` suffix when the runtime model exposes a selected tier.

## Speed measurement and data lifecycle

The plugin captures `session.step.started` to bind the model ID, `session.text.started` as the first generated-text timestamp, and `session.step.ended` for output-token counts and completion time. The estimate excludes time-to-first-token and can differ from provider billing or a provider's own throughput metric. Samples begin accumulating after the plugin is installed; prior conversation history is not backfilled. Until a successful sample exists, the picker shows `—t/s` rather than guessing.

The plugin stores a bounded rolling history (maximum 1,000 records) and calculates a per-model median across the latest 20 valid samples. It stores no prompts, generated text, or message bodies. Catalog refresh failures leave the previous snapshot in use; model prices from OpenCode's runtime metadata can still render.

## Validation performed

- TypeScript type-check against `@opencode/plugin@2.2.5` and OpenTUI 0.8.
- 14 offline unit tests pass for full-catalog parsing, strict price matching, row labels, and speed calculations.
- Live Models.dev smoke check returned 235 providers, 8,940 models, and 8,542 priced models at test time.
- The official `@opencode/cli@2.2.5` loaded the server and TUI plugin entries. Its `model.list` API returned decorated `Model.Info.name` values, and the full interactive TUI showed price/speed suffixes on multiple `/models` rows. The palette refresh was invoked from the home screen, and the plugin storage record contained the full normalized catalog.

## References

- [OpenCode 2 server plugins](https://opencode.ai/v2/docs/build/plugins/server/)
- [OpenCode 2 TUI plugins](https://opencode.ai/v2/docs/build/plugins/cli/)
- [OpenCode 2 model configuration](https://opencode.ai/v2/docs/models/)
- [Models.dev](https://models.dev/)
- [OpenCode model-picker cost discussion](https://github.com/anomalyco/opencode/issues/14524)
