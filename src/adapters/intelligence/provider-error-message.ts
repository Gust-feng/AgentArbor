export function providerErrorMessage(error: unknown, fallback: string, maxLength = 1_000): string {
  const message = extractProviderErrorMessage(error) ?? fallback;
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function extractProviderErrorMessage(error: unknown): string | undefined {
  const record = asRecord(error);
  const status = statusFromRecord(record);
  const message = stringOrUndefined(record.message);
  return (
    messageFromPayload(record.error) ??
    messageFromPayload(record.cause) ??
    messageFromPayload(record.body) ??
    stripSdkStatusPrefix(message, status)
  );
}

function messageFromPayload(value: unknown): string | undefined {
  const direct = stringOrUndefined(value);
  if (direct !== undefined) {
    return direct;
  }

  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  return (
    stringOrUndefined(record.message) ??
    stringOrUndefined(record.error_description) ??
    stringOrUndefined(record.detail) ??
    ("error" in record && record.error !== value ? messageFromPayload(record.error) : undefined)
  );
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stripSdkStatusPrefix(message: string | undefined, status: number | undefined): string | undefined {
  if (message === undefined) {
    return message;
  }
  const matched = /^(\d{3})\s+status code \(no body\)$/i.exec(message);
  if (matched !== null) {
    return `HTTP ${matched[1]}`;
  }
  if (status === undefined) {
    return message;
  }
  const prefix = `${status} `;
  if (!message.startsWith(prefix)) {
    return message;
  }
  const body = message.slice(prefix.length).trim();
  return body === "status code (no body)" ? `HTTP ${status}` : body;
}

function statusFromRecord(record: Record<string, unknown>): number | undefined {
  const value = record.status ?? record.statusCode;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
