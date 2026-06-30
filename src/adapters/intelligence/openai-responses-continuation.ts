import type { ModelMessage } from "../../domain/intelligence/index.js";
import { isPlainRecord } from "./provider-value-utils.js";

export const OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION = "openai_responses_output_items";

export function openAIResponsesContinuationItems(
  message: Pick<ModelMessage, "protocolExtensions">,
): readonly unknown[] | undefined {
  const value = message.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.flatMap((item) => jsonSafeClone(item)).filter(isResponseInputItemRecord);
  return items.length === 0 ? undefined : items;
}

export function openAIResponsesProtocolExtensions(input: {
  readonly responseId: string;
  readonly outputItems?: readonly unknown[];
}): Readonly<Record<string, unknown>> {
  const outputItems = openAIResponsesOutputItems(input.outputItems);
  return outputItems === undefined
    ? { response_id: input.responseId }
    : {
        response_id: input.responseId,
        [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: outputItems,
      };
}

export function openAIResponsesOutputItems(
  value: readonly unknown[] | undefined
): readonly unknown[] | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const items = value.flatMap((item) => jsonSafeClone(item)).filter(isResponseInputItemRecord);
  return items.length === 0 ? undefined : items;
}

function isResponseInputItemRecord(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && typeof value.type === "string" && value.type.length > 0;
}

function jsonSafeClone(value: unknown): readonly unknown[] {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [value];
  }
  if (Array.isArray(value)) {
    return [value.flatMap((item) => jsonSafeClone(item))];
  }
  if (!isPlainRecord(value)) {
    return [];
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const cloned = jsonSafeClone(item);
    if (cloned.length > 0) {
      result[key] = cloned[0];
    }
  }
  return [result];
}
