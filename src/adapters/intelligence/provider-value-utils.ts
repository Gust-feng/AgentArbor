/**
 * 适配器层共享的值处理工具。
 *
 * 这里集中存放与具体协议/厂商无关的纯函数 helper，供 OpenAI Chat Completions、
 * OpenAI Responses、Anthropic Messages、模型 catalog 以及 fetch 桥接等适配器复用，
 * 避免同一份逻辑在多个文件里各自重定义。
 */

export function removeUndefinedValues(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export function parseStructuredOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export function parseToolArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value ?? {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { rawArguments: value };
  }
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * 判断一个值是否为“普通记录对象”（非 null、非数组、typeof === "object"）。
 * 作为 `asRecord` 的唯一判定来源，确保所有调用点对“记录”的语义完全一致。
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把任意值规整为普通记录对象；非记录值（null、数组、原始类型、undefined）返回空对象 `{}`。
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}
