export function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return record;
}

export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

export function requireString(value: unknown, field: string): string {
  const text = optionalString(value);
  if (text === undefined) {
    throw new Error(`Work Session output field ${field} must be a non-empty string.`);
  }
  return safeText(text, 1200);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map((item) => optionalString(item)).filter((item): item is string => item !== undefined).map((item) => safeText(item, 360))
    : [];
}

export function nonEmptyStringArray(value: unknown, field: string): readonly string[] {
  const values = stringArray(value);
  if (values.length === 0) {
    throw new Error(`Work Session output field ${field} must contain at least one string.`);
  }
  return values;
}

export function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function safeToken(value: string | undefined, fallback: string): string {
  const raw = value === undefined || value.trim().length === 0 ? fallback : value.trim();
  const token = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return token.length === 0 ? fallback : token;
}

export function safeText(value: string, maxLength: number): string {
  const normalized = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:api[_ -]?key|apikey|token|password)\s*[:=]\s*[^;\s"'}\]]+/gi, "$1=[redacted]")
    .trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
