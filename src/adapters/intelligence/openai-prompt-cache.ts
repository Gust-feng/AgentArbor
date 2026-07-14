import { createHash } from "node:crypto";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import { modelVisibleToolDescription } from "../../domain/tools/index.js";

export function promptCacheKeyForModelRequest(input: {
  readonly protocol: "chat" | "responses";
  readonly model: string;
  readonly request: ModelRequest;
}): string {
  const rootMessage = input.request.sanitizedMessages.find((message) =>
    message.role === "system" && message.ref?.startsWith("context:system:") === true
  ) ?? input.request.sanitizedMessages.find((message) => message.role === "system");
  const stablePrefixIdentity = JSON.stringify({
    protocol: input.protocol,
    model: input.model,
    root: rootMessage === undefined
      ? undefined
      : { content: rootMessage.content, ref: rootMessage.ref },
    outputContractId: input.request.outputContract.contractId,
    tools: (input.request.tools ?? []).map((tool) => ({
      name: tool.name,
      description: modelVisibleToolDescription(tool),
      inputSchema: tool.inputSchema,
    })),
  });
  const digest = createHash("sha256").update(stablePrefixIdentity).digest("hex").slice(0, 32);
  return `agentarbor:${digest}`;
}
