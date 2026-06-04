const counters = new Map<string, number>();

export function createId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

export function reserveId(id: string | undefined): void {
  if (id === undefined) return;
  const match = /^(.+)-(\d+)$/.exec(id);
  if (match === null) return;
  const prefix = match[1];
  const value = Number(match[2]);
  if (prefix === undefined || !Number.isSafeInteger(value) || value <= 0) return;
  counters.set(prefix, Math.max(counters.get(prefix) ?? 0, value));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function resetIdsForTests(): void {
  counters.clear();
}
