import type { ModelMessage } from "../../domain/intelligence/index.js";
import {
  toolModelAttachmentsFromOutput,
  type ToolCallResult,
} from "../../domain/tools/index.js";

/** Canonical model-facing message for one factual tool result. */
export function canonicalToolResultMessage(result: ToolCallResult): ModelMessage {
  const attachments = toolModelAttachmentsFromOutput(result.output);
  return {
    role: "tool",
    content: JSON.stringify(result),
    toolCallId: result.callId,
    toolName: result.toolName,
    attachments: attachments === undefined
      ? undefined
      : attachments.map((attachment) => globalThis.structuredClone(attachment)),
  };
}
