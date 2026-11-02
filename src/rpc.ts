import { Rpc } from "@opencode/plugin";

export interface RefreshResult {
  providerCount: number;
  totalModelCount: number;
  pricedModelCount: number;
}

export const modelMeterRpc = Rpc.define({
  id: "opencode-model-meter",
  methods: {
    refresh: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          providerCount: { type: "integer" },
          totalModelCount: { type: "integer" },
          pricedModelCount: { type: "integer" },
        },
        required: ["providerCount", "totalModelCount", "pricedModelCount"],
        additionalProperties: false,
      },
    },
  },
  events: {},
});
