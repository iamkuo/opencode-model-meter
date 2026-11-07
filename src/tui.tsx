import { Plugin } from "@opencode/plugin/tui";
import { modelMeterRpc } from "./rpc.ts";
import type { RefreshResult } from "./rpc.ts";
import { extractMeterSuffix } from "./display.ts";

export default Plugin.define({
  id: "opencode-model-meter",
  async setup(context) {
    const location = context.location ?? context.data.location.default();
    let refreshing = false;

    const showToast = async (message: string, variant: "info" | "success" | "warning" | "error" = "info") => {
      try {
        await context.ui.toast.show({ title: "Model Meter", message, variant, duration: 5000 });
      } catch {
        // The slash/palette command remains usable even if this TUI host cannot show a toast.
      }
    };

    const selectedModel = () => context.ui.model.current();
    const selectedInfo = () => {
      const selected = selectedModel();
      if (!selected) return undefined;
      return (context.data.location.model.list(location) ?? []).find(
        (model) => model.providerID === selected.providerID && (model.id === selected.modelID || model.modelID === selected.modelID),
      );
    };

    const refreshOnServer = async (notify = true) => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await context.client.rpc(modelMeterRpc).refresh({}) as RefreshResult;
        await context.data.location.model.sync(location);
        if (notify) {
          await showToast(
            `Refreshed ${result.providerCount} providers, ${result.totalModelCount.toLocaleString()} models (${result.pricedModelCount.toLocaleString()} priced).`,
            "success",
          );
        }
      } catch (error) {
        if (notify) {
          await showToast(`Full catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      } finally {
        refreshing = false;
      }
    };

    const showStatus = async () => {
      const selected = selectedModel();
      if (!selected) {
        await context.ui.dialog.alert({ title: "Model Meter", message: "No model is currently selected." });
        return;
      }
      const info = selectedInfo();
      const detail = info?.name ?? selected.modelID;
      await context.ui.dialog.alert({
        title: "Model Meter",
        message: `${selected.providerID}/${selected.modelID}\n\n${detail}\n\nUse /model-meter refresh to refetch the complete catalog.`,
      });
    };

    const slotCleanup = context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const selected = selectedModel();
        if (!selected) return <text>Model Meter: select a model</text>;
        const info = selectedInfo();
        const detail = extractMeterSuffix(info?.name ?? "") ?? "price/speed loading";
        const model = selected.modelID.length > 18 ? `${selected.modelID.slice(0, 15)}…` : selected.modelID;
        return <text>{`Meter ${model} ${detail}${refreshing ? " · refreshing" : ""}`}</text>;
      },
    });

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "opencode-model-meter.refresh",
          title: "Refresh all model prices",
          description: "Refetch the complete Models.dev catalog and update model-picker rows.",
          group: "Model Meter",
          palette: true,
          suggested: true,
          run: () => refreshOnServer(),
        },
        {
          id: "opencode-model-meter.command",
          title: "Model Meter status or refresh",
          description: "Use `/model-meter status` to inspect the selected model, or `/model-meter refresh` to refresh prices.",
          group: "Model Meter",
          palette: true,
          slash: { name: "model-meter", arguments: true },
          run: async (input) => {
            const action = input?.trim().toLowerCase();
            if (action === "refresh") return refreshOnServer();
            if (action && action !== "status") {
              await context.ui.dialog.alert({ title: "Model Meter", message: "Usage: `/model-meter status` or `/model-meter refresh`." });
              return;
            }
            await showStatus();
          },
        },
      ],
    }));

    const unsubscribeModelUpdated = context.data.on("model.updated", () => {
      void context.data.location.model.sync(location).catch(() => undefined);
    });
    void context.data.location.model.sync(location).catch(() => undefined);
    // Refetch on each TUI startup, including when OpenCode reuses an already-running server.
    void refreshOnServer(false);

    return () => {
      slotCleanup();
      unsubscribeModelUpdated();
    };
  },
});
