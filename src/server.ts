import { Plugin } from "@opencode/plugin";
import { fetchFullCatalog, resolveModelPrice, type CatalogSnapshot, type RuntimeModelPrice, type SelectedModel } from "./catalog.ts";
import { formatModelRowName } from "./display.ts";
import { calculateTokensPerSecond, rollingModelMedian, type SpeedSample } from "./metrics.ts";
import { modelMeterRpc } from "./rpc.ts";

interface PersistedState {
  catalog: CatalogSnapshot | null;
  samples: SpeedSample[];
}

interface PendingStep {
  sessionID: string;
  providerID: string;
  modelID: string;
  firstTextAt: number | null;
}

const STORAGE_KEY = "opencode-model-meter.state.v1";
const HISTORY_LIMIT = 1000;
const METRIC_WINDOW = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPriceRecord(value: unknown): value is CatalogSnapshot["prices"][number] {
  if (!isRecord(value)) return false;
  return typeof value.providerID === "string" && typeof value.modelID === "string";
}

function readPersistedState(value: unknown): PersistedState {
  if (!isRecord(value)) return { catalog: null, samples: [] };
  const rawCatalog = value.catalog;
  const catalog = isRecord(rawCatalog) && Array.isArray(rawCatalog.prices)
    ? {
        fetchedAt: typeof rawCatalog.fetchedAt === "number" ? rawCatalog.fetchedAt : 0,
        providerCount: typeof rawCatalog.providerCount === "number" ? rawCatalog.providerCount : 0,
        totalModelCount: typeof rawCatalog.totalModelCount === "number" ? rawCatalog.totalModelCount : 0,
        pricedModelCount: typeof rawCatalog.pricedModelCount === "number" ? rawCatalog.pricedModelCount : 0,
        prices: rawCatalog.prices.filter(isPriceRecord),
      }
    : null;
  const samples = Array.isArray(value.samples)
    ? value.samples.filter((sample): sample is SpeedSample => {
        if (!isRecord(sample)) return false;
        return typeof sample.providerID === "string"
          && typeof sample.modelID === "string"
          && typeof sample.outputTokens === "number"
          && typeof sample.costUSD === "number"
          && (sample.tokensPerSecond === null || typeof sample.tokensPerSecond === "number");
      }).slice(-HISTORY_LIMIT)
    : [];
  return { catalog, samples };
}

function toRuntimePrice(model: {
  providerID: string;
  id: string;
  modelID: string;
  canonical?: string;
  cost: readonly { input: number; output: number; cache: { read: number; write: number }; tier?: { type: string; size: number } }[];
}): RuntimeModelPrice {
  return {
    providerID: model.providerID,
    id: model.id,
    modelID: model.modelID,
    canonical: model.canonical,
    cost: model.cost,
  };
}

export default Plugin.define({
  id: "opencode-model-meter",
  async setup(ctx) {
    const stored = await ctx.storage.get(STORAGE_KEY).catch(() => undefined);
    const state = readPersistedState(stored);
    let catalog = state.catalog;
    let samples = state.samples;
    const pending = new Map<string, PendingStep>();
    let refreshInFlight: Promise<CatalogSnapshot> | undefined;
    let reloadInFlight: Promise<void> | undefined;
    let reloadRequested = false;

    const persist = async () => {
      const json = JSON.parse(JSON.stringify({ catalog, samples })) as Parameters<typeof ctx.storage.set>[1];
      await ctx.storage.set(STORAGE_KEY, json);
    };

    const reloadModelLabels = (): Promise<void> => {
      reloadRequested = true;
      if (reloadInFlight) return reloadInFlight;
      reloadInFlight = (async () => {
        while (reloadRequested) {
          reloadRequested = false;
          await ctx.model.reload();
        }
      })().finally(() => {
        reloadInFlight = undefined;
        if (reloadRequested) void reloadModelLabels();
      });
      return reloadInFlight;
    };

    const refreshCatalog = (): Promise<CatalogSnapshot> => {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = (async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const fresh = await fetchFullCatalog();
            catalog = fresh;
            await reloadModelLabels();
            await persist().catch((error: unknown) => {
              console.error("[opencode-model-meter] Could not persist refreshed catalog", error);
            });
            return fresh;
          } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      })().finally(() => {
        refreshInFlight = undefined;
      });
      return refreshInFlight;
    };

    const modelRegistration = await ctx.model.transform((editor) => {
      for (const model of editor.list()) {
        const selected: SelectedModel = { providerID: model.providerID, modelID: model.id };
        const runtime = toRuntimePrice(model);
        const price = resolveModelPrice(catalog, selected, [runtime]);
        const speed = rollingModelMedian(samples, model.providerID, model.id, METRIC_WINDOW);
        const displayName = formatModelRowName(
          model.name,
          price?.input,
          price?.output,
          speed.medianTokensPerSecond,
          price?.tier,
          model.limit?.context,
        );
        if (displayName !== model.name) {
          editor.update(model.providerID, model.id, (draft) => {
            draft.name = displayName;
          });
        }
      }
    });

    const commandRegistration = await ctx.command.transform((editor) => {
      editor.add({
        name: "model-meter-refresh",
        description: "Refresh the complete Models.dev catalog and update model-picker labels",
        execute: async () => {
          await refreshCatalog();
        },
      });
    });
    const rpcRegistration = await ctx.rpc.register(modelMeterRpc, {
      refresh: async () => {
        const snapshot = await refreshCatalog();
        return {
          providerCount: snapshot.providerCount,
          totalModelCount: snapshot.totalModelCount,
          pricedModelCount: snapshot.pricedModelCount,
        };
      },
    });

    const controller = new AbortController();
    const eventTask = (async () => {
      const events = ctx.event.subscribe({
        signal: controller.signal,
        types: [
          "session.step.started",
          "session.text.started",
          "session.step.ended",
          "session.step.failed",
          "session.execution.failed",
        ],
      });
      for await (const event of events) {
        if (event.type === "session.step.started") {
          pending.set(event.data.assistantMessageID, {
            sessionID: event.data.sessionID,
            providerID: event.data.model.providerID,
            modelID: event.data.model.id,
            firstTextAt: null,
          });
          continue;
        }
        if (event.type === "session.text.started") {
          const step = pending.get(event.data.assistantMessageID);
          if (step && step.firstTextAt === null) step.firstTextAt = event.created;
          continue;
        }
        if (event.type === "session.step.ended") {
          const messageID = event.data.assistantMessageID;
          const step = pending.get(messageID);
          pending.delete(messageID);
          if (!step) continue;

          const sample: SpeedSample = {
            providerID: step.providerID,
            modelID: step.modelID,
            outputTokens: event.data.tokens.output,
            reasoningTokens: event.data.tokens.reasoning,
            costUSD: event.data.cost,
            firstTextAt: step.firstTextAt,
            completedAt: event.created,
            tokensPerSecond: calculateTokensPerSecond(event.data.tokens.output, step.firstTextAt, event.created),
          };
          samples = [...samples, sample].slice(-HISTORY_LIMIT);
          await persist().catch((error: unknown) => {
            console.error("[opencode-model-meter] Could not persist usage metrics", error);
          });
          await reloadModelLabels().catch((error: unknown) => {
            console.error("[opencode-model-meter] Could not reload model labels", error);
          });
          continue;
        }
        if (event.type === "session.step.failed") {
          pending.delete(event.data.assistantMessageID);
          continue;
        }
        if (event.type === "session.execution.failed") {
          for (const [messageID, step] of pending) {
            if (step.sessionID === event.data.sessionID) pending.delete(messageID);
          }
        }
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) console.error("[opencode-model-meter] Event subscription stopped", error);
    });

    // Always bypass HTTP caches and refetch the entire catalog on server startup.
    void refreshCatalog().catch((error: unknown) => {
      console.error("[opencode-model-meter] Startup full-catalog refresh failed; keeping cached/runtime prices", error);
    });

    return async () => {
      controller.abort();
      pending.clear();
      await eventTask;
      await Promise.all([modelRegistration.dispose(), commandRegistration.dispose(), rpcRegistration.dispose()]);
    };
  },
});
