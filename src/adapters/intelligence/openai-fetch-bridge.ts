export type FetchLike = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  }
) => Promise<FetchLikeResponse>;

export type FetchLikeResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
};

export function resolveGlobalFetch(): FetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: FetchLike }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl : undefined;
}

export function toOpenAIFetch(fetchImpl: FetchLike): typeof fetch {
  return async (url, init = {}) => {
    const method = typeof init.method === "string" ? init.method : "POST";
    const response = await fetchImpl(String(url), {
      method: method as "POST",
      headers: headersToRecord(init.headers),
      body: typeof init.body === "string" ? init.body : init.body === undefined ? "" : String(init.body),
      signal: init.signal === null ? undefined : init.signal,
    });

    if (response.body !== undefined && requestWantsStream(init.body)) {
      return new Response(toReadableStream(response.body), {
        status: response.status,
        headers: { "content-type": "text/event-stream" },
      });
    }

    const body = await fetchLikeResponseText(response);
    return new Response(body, {
      status: response.status,
      headers: { "content-type": looksLikeJson(body) ? "application/json" : "text/plain" },
    });
  };
}

function requestWantsStream(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") {
    return false;
  }
  try {
    return asRecord(JSON.parse(body)).stream === true;
  } catch {
    return false;
  }
}

async function fetchLikeResponseText(response: Awaited<ReturnType<FetchLike>>): Promise<string> {
  if (response.text !== undefined) {
    return response.text();
  }
  return JSON.stringify(await response.json());
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function toReadableStream(body: unknown): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) {
    return body as ReadableStream<Uint8Array>;
  }
  const iterator = iterateBytes(body);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
  });
}

async function* iterateBytes(body: unknown): AsyncGenerator<Uint8Array> {
  if (isAsyncIterable(body)) {
    for await (const chunk of body) {
      yield encodeChunk(chunk);
    }
    return;
  }
  yield encodeChunk(body);
}

function encodeChunk(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new TextEncoder().encode(String(value));
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
