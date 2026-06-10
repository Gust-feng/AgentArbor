export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message = errorMessage(parsed) ?? `请求失败：${response.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path);
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "DELETE" });
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as { readonly error?: { readonly message?: unknown }; readonly message?: unknown };
  if (typeof record.error?.message === "string") {
    return record.error.message;
  }
  return typeof record.message === "string" ? record.message : undefined;
}
