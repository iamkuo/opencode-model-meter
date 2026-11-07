# OpenCode Model Meter

OpenCode 2 plugin for the TUI. It fetches the **complete Models.dev catalog** when the server plugin starts and again on every TUI launch, measures output-token speed from OpenCode session-step events, and appends compact price/speed data to every model's display name so it appears at the end of each row in the built-in `/models` picker.

## Features

- Fetches `https://models.dev/api.json` on every server-plugin startup, TUI launch, and manual refresh with HTTP caching disabled. A typed plugin RPC lets the TUI refresh even before a chat session exists. The live catalog was about 6 MB when this package was authored; it persists only the normalized price index.
- Appends a compact suffix such as `[1/5/42tps/200k]` (input price / output price / output speed in tps / context window, prices per 1M tokens) to each model display name; a pricing tier that bites mid-context shows as a trailing `@128k`. The OpenCode TUI plugin API does not expose a per-row model-picker renderer, so this uses the documented server-side `Model.Info` transform. It is a right-edge name suffix, not a separate pixel-aligned column; long names are shortened to keep the price/speed visible.
- Prefers OpenCode's resolved model rates (including local configuration), then uses an exact provider/model match from the freshly fetched catalog. It does not fuzzy-match model names.
- Tracks provider-reported output tokens, the first text-start event, and step completion. Speed is `output tokens / (step completion - first text start)`; it is an estimate and excludes time-to-first-token. The displayed speed is the median of up to 20 recent samples for that provider/model.
- Speed starts as `—t/s` until a successful response on that exact model is recorded. The plugin does not backfill old chat history.
- Records usage metadata only; it never stores prompt text. It keeps up to 1,000 samples.
- Keeps cached prices and speed samples if a later refresh fails. Models without measurable speed show `—t/s` instead of an invented estimate.

## Commands

- Open the TUI command palette and choose **Refresh all model prices**, or run `/model-meter refresh` to refetch the whole catalog and rebuild the model rows. Both work without an active chat session.
- Run `/model-meter status` to inspect the selected model's annotated name.
- The server command `/model-meter-refresh` is also registered for direct invocation.

See [DESIGN.md](./DESIGN.md) for the detailed implementation plan, source APIs, test results, and limitations.

## Install locally

Copy this folder to a stable path, then add the absolute path to your OpenCode 2 `opencode.json` plugin list:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-model-meter"]
}
```

Restart OpenCode. The server plugin and TUI startup both trigger a full, no-cache refetch of Models.dev; available model entries receive price and speed suffixes. Open `/models` to see the annotations.

## Compatibility and validation

This source targets the OpenCode 2 plugin API (`@opencode/plugin` 2.2.5 and OpenTUI 0.8). It does not target the OpenCode 1 plugin API. The server plugin was loaded through the official OpenCode 2.2.5 CLI and its `model.list` API returned decorated model names. The full interactive TUI also loaded the plugin and showed the annotations in the built-in `/models` picker. The suffix approach depends on the built-in picker rendering `Model.Info.name`; unlike a custom row renderer, it cannot guarantee fixed-column alignment on every terminal width.

## Development checks

```bash
npm install
npm run typecheck
npm test
npm run test:live-catalog
```

`test:live-catalog` makes a live request to Models.dev; it is not part of the offline unit-test suite.
