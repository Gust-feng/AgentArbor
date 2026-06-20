import { isPlainRecord } from "./provider-value-utils.js";

/**
 * OpenAI Chat Completions 协议扩展字段的共享过滤逻辑。
 *
 * 请求侧（chat-request）与响应侧（chat-response）都需要“保留非标准消息字段中、
 * 且 JSON 安全的协议扩展”，原本两份实现完全重复，这里收敛为单一来源。
 *
 * - `isStandardOpenAIMessageField`：识别标准 Chat Completions 消息字段（需排除）。
 * - `isProtocolExtensionValue`：判断单个值是否可作为协议扩展安全透传 / 保留。
 * - `filterOpenAIChatProtocolExtensions`：对一条记录做过滤，返回仅含协议扩展的新记录。
 */

const MAX_EXTENSION_CONTAINER_SIZE = 32;
const MAX_EXTENSION_DEPTH = 4;

export function isStandardOpenAIMessageField(key: string): boolean {
  return (
    key === "role" ||
    key === "content" ||
    key === "refusal" ||
    key === "tool_calls" ||
    key === "function_call" ||
    key === "tool_call_id" ||
    key === "name"
  );
}

export function isProtocolExtensionValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    default:
      return isJsonSafeProtocolExtension(value);
  }
}

/**
 * 过滤记录，仅保留“非标准消息字段且 JSON 安全的协议扩展”，返回新记录（可能为空）。
 * 请求侧直接使用返回值；响应侧在此基础上自行决定空记录是否返回 `undefined`。
 */
export function filterOpenAIChatProtocolExtensions(
  record: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !isStandardOpenAIMessageField(key) && isProtocolExtensionValue(value)
    )
  );
}

function isJsonSafeProtocolExtension(value: unknown, depth = 0): boolean {
  if (depth > MAX_EXTENSION_DEPTH) {
    return false;
  }
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_EXTENSION_CONTAINER_SIZE &&
      value.every((item) => isProtocolExtensionValueAtDepth(item, depth + 1))
    );
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_EXTENSION_CONTAINER_SIZE &&
    entries.every(([, item]) => isProtocolExtensionValueAtDepth(item, depth + 1))
  );
}

function isProtocolExtensionValueAtDepth(value: unknown, depth: number): boolean {
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    default:
      return isJsonSafeProtocolExtension(value, depth);
  }
}
