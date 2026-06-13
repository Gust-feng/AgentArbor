import type { ModelOutputContract } from "../../domain/intelligence/index.js";

export const DESKTOP_ROOT_AGENT_OUTPUT_CONTRACT: ModelOutputContract = {
  contractId: "desktop.agent_response.v1",
  outputKind: "explanation",
  format: "text",
  minTextLength: 1,
  visibleOutput: {
    fields: ["text"],
    maxFieldLength: 128_000,
  },
};
