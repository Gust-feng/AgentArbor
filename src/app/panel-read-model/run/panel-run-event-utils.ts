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
