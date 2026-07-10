export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

export function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
