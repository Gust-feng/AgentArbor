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

export function eventRefsFor<T extends string>(
  eventEntries: readonly { readonly type: T; readonly message: { readonly id: string } }[],
  types: readonly T[]
): string[] {
  const typeSet = new Set(types);
  return eventEntries.filter((entry) => typeSet.has(entry.type)).map((entry) => entry.message.id);
}

export function hasEvent<T extends string>(
  eventEntries: readonly { readonly type: T }[],
  type: T
): boolean {
  return eventEntries.some((entry) => entry.type === type);
}

export function lastRecordedAt(
  eventEntries: readonly { readonly message: { readonly id: string }; readonly recordedAt: string }[],
  eventRefs: readonly string[]
): string | undefined {
  const refSet = new Set(eventRefs);
  return eventEntries.filter((entry) => refSet.has(entry.message.id)).at(-1)?.recordedAt;
}
