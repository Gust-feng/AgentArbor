import type { ToolErrorDomain, ToolErrorFactValue, ToolErrorFacts } from "./contracts.js";

const MAX_FACT_ENTRIES = 24;
const MAX_FACT_DEPTH = 2;

export type NormalizeToolErrorFactsOptions = {
  readonly compactString?: (value: string) => string;
};

export function isToolErrorDomain(value: unknown): value is ToolErrorDomain {
  return value === "tool_error" ||
    value === "runtime_error" ||
    value === "model_error" ||
    value === "ui_submit_error" ||
    value === "process_error";
}

export function normalizeToolErrorFacts(
  value: unknown,
  options: NormalizeToolErrorFactsOptions = {}
): ToolErrorFacts | undefined {
  const record = asRecord(value);
  const result: Record<string, ToolErrorFactValue> = {};
  for (const [key, item] of Object.entries(record).slice(0, MAX_FACT_ENTRIES)) {
    const fact = normalizeToolErrorFactValue(item, options, 0);
    if (fact !== undefined) {
      result[key] = fact;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

export function normalizeToolErrorFactValue(
  value: unknown,
  options: NormalizeToolErrorFactsOptions = {},
  depth = 0
): ToolErrorFactValue | undefined {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return options.compactString?.(value) ?? value;
  }
  if (depth >= MAX_FACT_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_FACT_ENTRIES)
      .map((item) => normalizeToolErrorFactValue(item, options, depth + 1))
      .filter((item): item is ToolErrorFactValue => item !== undefined);
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, ToolErrorFactValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_FACT_ENTRIES)) {
      const fact = normalizeToolErrorFactValue(item, options, depth + 1);
      if (fact !== undefined) {
        result[key] = fact;
      }
    }
    return result;
  }
  return undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
