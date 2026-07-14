import type { ModelMessage } from "./contracts.js";

export const OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION = "openai_responses_output_items";

export type PersistedModelProtocolExtensionFailureReason =
  | "not_array"
  | "empty_items"
  | "not_json_safe"
  | "invalid_item";

/**
 * Raised when a known provider continuation is present but cannot be retained
 * without breaking the provider's replay contract. Unknown provider fields are
 * intentionally ignored; this error is only for the explicit Responses key.
 */
export class ModelProtocolContinuationPersistenceError extends Error {
  readonly code = "model_protocol_continuation_not_persistable" as const;
  readonly errorDomain = "runtime_error" as const;
  readonly facts: Readonly<{
    code: "model_protocol_continuation_not_persistable";
    extension: typeof OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION;
    reason: PersistedModelProtocolExtensionFailureReason;
  }>;

  constructor(reason: PersistedModelProtocolExtensionFailureReason) {
    super(`[model_protocol_continuation_not_persistable] Model protocol continuation ${OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION} cannot be persisted (${reason}).`);
    this.name = "ModelProtocolContinuationPersistenceError";
    this.facts = {
      code: this.code,
      extension: OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION,
      reason,
    };
  }
}

/**
 * Produces the exact JSON-safe protocol continuation facts that a feature may
 * persist without interpreting provider-private data. Request-only extensions
 * and model attachments remain ephemeral.
 */
export function persistedModelProtocolExtensions(
  extensions: ModelMessage["protocolExtensions"],
): Readonly<Record<string, unknown>> | undefined {
  if (extensions === undefined || !Object.prototype.hasOwnProperty.call(extensions, OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION)) {
    return undefined;
  }
  const rawItems = extensions[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION];
  if (!Array.isArray(rawItems)) {
    throw new ModelProtocolContinuationPersistenceError("not_array");
  }
  if (rawItems.length === 0) {
    throw new ModelProtocolContinuationPersistenceError("empty_items");
  }
  if (!isProtocolJsonValue(rawItems, new Set<object>(), 0)) {
    throw new ModelProtocolContinuationPersistenceError("not_json_safe");
  }
  const serialized = JSON.stringify(rawItems);
  const detached = JSON.parse(serialized) as unknown;
  if (!Array.isArray(detached) || !detached.every(isProtocolOutputItem)) {
    throw new ModelProtocolContinuationPersistenceError("invalid_item");
  }
  return { [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: detached };
}

function isProtocolJsonValue(value: unknown, ancestors: Set<object>, depth: number): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || depth >= 100 || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index) || !isProtocolJsonValue(value[index], ancestors, depth + 1)) {
          return false;
        }
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    if (Object.getOwnPropertySymbols(value).some((symbol) => Object.prototype.propertyIsEnumerable.call(value, symbol))) {
      return false;
    }
    return Object.values(value).every((item) => isProtocolJsonValue(item, ancestors, depth + 1));
  } finally {
    ancestors.delete(value);
  }
}

function isProtocolOutputItem(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const type = (value as { readonly type?: unknown }).type;
  return typeof type === "string" && type.length > 0;
}
