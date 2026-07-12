import type {
  ToolContinuation,
  ToolExecutor,
  ToolExecutorResult,
  ToolExecutionContext,
  ToolFactValue,
} from "../../../domain/tools/index.js";

export type HttpRequestMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE";

export type HttpRequestFetchLike = (
  url: string,
  init: {
    readonly method: HttpRequestMethod;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  }
) => Promise<HttpRequestFetchResponseLike>;

export type HttpRequestFetchResponseLike = {
  readonly status: number;
  readonly statusText?: string;
  readonly headers?: HeadersLike;
  readonly body?: ReadableStream<Uint8Array> | null;
  readonly text?: () => Promise<string>;
};

export type HeadersLike = {
  forEach?(callback: (value: string, key: string) => void): void;
  entries?(): IterableIterator<[string, string]> | Iterable<[string, string]>;
};

export type HttpRequestToolOptions = {
  readonly fetch?: HttpRequestFetchLike;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly maxBodyChars?: number;
};

export type HttpRequestToolOutput = {
  readonly url: string;
  readonly method: HttpRequestMethod;
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly durationMs: number;
  readonly startChar: number;
  readonly bodyChars: number;
  readonly hasMoreAfter: boolean;
  readonly reachedStartCharCeiling: boolean;
  readonly startCharCeiling: number;
  readonly truncated: boolean;
  readonly continuation?: ToolContinuation;
};

export type HttpRequestIncompleteOutput = {
  readonly url: string;
  readonly method: HttpRequestMethod;
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyPreview: string;
  readonly responseBodyComplete: false;
  readonly durationMs: number;
  readonly startChar: number;
  readonly bodyChars: number;
  readonly startCharCeiling: number;
};

export type HttpRequestErrorFacts = {
  readonly url: string;
  readonly method: HttpRequestMethod;
  readonly durationMs: number;
  readonly code?: string;
  readonly statusCode?: number;
  readonly statusText?: string;
  readonly errno?: string | number;
  readonly syscall?: string;
  readonly address?: string;
  readonly port?: number;
  readonly hostname?: string;
  readonly timedOut?: boolean;
  readonly timeoutMs?: number;
};

export class HttpRequestError extends Error {
  readonly facts: HttpRequestErrorFacts;

  constructor(message: string, facts: HttpRequestErrorFacts, cause: unknown) {
    super(message, { cause });
    this.name = "HttpRequestError";
    this.facts = facts;
  }
}

type MutableNetworkFacts = {
  code?: string;
  statusCode?: number;
  statusText?: string;
  errno?: string | number;
  syscall?: string;
  address?: string;
  port?: number;
  hostname?: string;
  timedOut?: boolean;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BODY_CHARS = 128_000;
const MAX_BODY_JSON_CHARS = 180_000;
const MAX_BODY_START_CHAR = 2_000_000;
const ALLOWED_METHODS = new Set<HttpRequestMethod>(["GET", "HEAD", "POST", "PUT", "DELETE"]);

export function createHttpRequestTool(options: HttpRequestToolOptions = {}): ToolExecutor {
  const maxBodyChars = Math.max(1, Math.floor(options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS));
  return {
    definition: {
      name: "http_request",
      description: "Send a bounded stateless HTTP or HTTPS request and return status, headers, response body, duration, and truncation state.",
      modelContract: {
        purpose: "Send a stateless HTTP or HTTPS request for API inspection, local dev server checks, and simple endpoint debugging.",
        whenToUse: [
          "Use for JSON or text API endpoints when raw HTTP status, headers, and body are needed.",
          "Use for local development servers or external HTTP resources that do not require browser rendering.",
          "Use HEAD when only status and headers are needed.",
        ],
        whenNotToUse: [
          "Do not use for rendered page inspection, logged-in browser sessions, OAuth flows, or browser-only pages; use browser_snapshot when the current rendered page text matters.",
          "Do not use for non-HTTP URLs.",
          "Do not use for file uploads or file downloads.",
        ],
        inputNotes: [
          "url is required and must use http or https.",
          "method defaults to GET and supports GET, HEAD, POST, PUT, and DELETE.",
          "headers is an optional object of string header values.",
          "body may be a string or JSON-serializable value for POST, PUT, or DELETE; GET and HEAD do not accept a body.",
          "startChar continues a truncated GET response from a zero-based character offset; it is not accepted for side-effecting methods.",
          `timeoutMs defaults to ${DEFAULT_TIMEOUT_MS} and is capped at ${options.maxTimeoutMs ?? MAX_TIMEOUT_MS}.`,
        ],
        usageNotes: [
          "Non-2xx HTTP responses are successful tool results; inspect statusCode and body instead of treating them as tool failures.",
          "HEAD returns an empty body and does not read the response body.",
          "This tool does not persist cookies or authentication state between calls.",
        ],
        outputNotes: [
          "statusCode and statusText contain the HTTP response status.",
          "headers is a plain object of response headers.",
          "body is bounded text and may be empty.",
          "hasMoreAfter reports whether more body text exists; continuation.nextInput provides the executable next GET window.",
          "A POST, PUT, or DELETE whose response body cannot fit completely returns a failed observation with bodyPreview and responseBodyComplete=false; requestCompleted/retryable facts are carried by the error and no continuation is emitted.",
          "A GET that reaches the continuation ceiling while more body remains also returns a failed observation instead of completed+truncated without a continuation.",
          `truncated is true only for a completed GET window that can continue, after exceeding ${maxBodyChars} characters or the shared serialized body budget.`,
          "durationMs is measured inside the HTTP tool and may differ slightly from the outer tool event duration.",
        ],
        runtimeHints: [
          { label: "session state", value: "no OAuth flow, no cookie jar, no upload or download handling" },
          { label: "default timeoutMs", value: String(DEFAULT_TIMEOUT_MS) },
          { label: "max body chars", value: String(maxBodyChars) },
          { label: "max startChar", value: String(MAX_BODY_START_CHAR) },
        ],
        examples: [
          { title: "GET JSON", input: { url: "https://api.example.test/status" } },
          { title: "HEAD only", input: { method: "HEAD", url: "https://example.test/" } },
          { title: "POST JSON", input: { method: "POST", url: "http://localhost:3000/api/items", body: { name: "demo" } } },
        ],
      },
      metadata: {
        category: "web",
        riskLevel: "medium",
        operationType: "external-submit",
        requiresConfirmation: false,
      },
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "HTTP or HTTPS URL to request." },
          method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "DELETE"], description: "HTTP method. Defaults to GET." },
          headers: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Optional request headers with string values.",
          },
          body: { description: "Optional string or JSON-serializable request body for POST, PUT, or DELETE." },
          startChar: { type: "number", description: "Zero-based body character offset for continuing a truncated GET response." },
          timeoutMs: { type: "number", description: `Optional timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}.` },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    execute: (input, context) => executeHttpRequest(input, context, options, maxBodyChars),
  };
}

async function executeHttpRequest(
  input: unknown,
  context: ToolExecutionContext,
  options: HttpRequestToolOptions,
  maxBodyChars: number
): Promise<HttpRequestToolOutput | ToolExecutorResult> {
  throwIfAborted(context.abortSignal);
  const record = asRecord(input);
  const url = requireHttpUrl(record.url);
  const method = methodFromInput(record.method);
  const startChar = boundedBodyStartChar(record.startChar);
  if (startChar > 0 && method !== "GET") {
    throw new Error("http_request startChar continuation is only supported for GET requests.");
  }
  const timeoutMs = boundedPositiveInteger(
    record.timeoutMs,
    options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.maxTimeoutMs ?? MAX_TIMEOUT_MS
  );
  const headers = headersFromInput(record.headers);
  const body = bodyFromInput(record.body, method, headers);
  const fetchImpl = options.fetch ?? resolveGlobalFetch();
  if (fetchImpl === undefined) {
    throw new Error("http_request requires fetch to be available in this runtime.");
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const detachAbort = attachAbortForwarder(context.abortSignal, controller);
  const timeoutReason = timeoutError(timeoutMs);
  const timeout = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: Object.keys(headers).length === 0 ? undefined : headers,
      body,
      signal: controller.signal,
    });
    const bodyResult = method === "HEAD"
      ? { body: "", startChar: 0, bodyChars: 0, hasMoreAfter: false, reachedStartCharCeiling: false, startCharCeiling: MAX_BODY_START_CHAR, truncated: false }
      : await readResponseBody(response, maxBodyChars, startChar);
    const durationMs = Date.now() - startedAt;
    const statusText = response.statusText ?? "";
    const output: HttpRequestToolOutput = {
      url,
      method,
      statusCode: response.status,
      statusText,
      headers: headersToRecord(response.headers),
      body: bodyResult.body,
      durationMs,
      startChar: bodyResult.startChar,
      bodyChars: bodyResult.bodyChars,
      hasMoreAfter: bodyResult.hasMoreAfter,
      reachedStartCharCeiling: bodyResult.reachedStartCharCeiling,
      startCharCeiling: bodyResult.startCharCeiling,
      truncated: bodyResult.truncated,
      continuation: method !== "GET" || bodyResult.nextStartChar === undefined
        ? undefined
        : {
            nextInput: {
              url,
              method,
              ...(Object.keys(headers).length === 0 ? {} : { headers }),
              startChar: bodyResult.nextStartChar,
              timeoutMs,
            },
          },
    };
    if (bodyResult.hasMoreAfter && (method !== "GET" || bodyResult.nextStartChar === undefined)) {
      const continuationLimitReached = method === "GET";
      return {
        kind: "tool_call_result",
        result: {
          callId: context.toolCallId ?? "http_request",
          toolName: "http_request",
          input: input as ToolFactValue | undefined,
          output: incompleteHttpResponseOutput(output),
          status: "failed",
          error: continuationLimitReached
            ? "HTTP GET completed, but the response body exceeds the supported continuation range."
            : "HTTP request completed, but the response body cannot be fully observed without replaying a side-effecting request.",
          errorDomain: "runtime_error",
          errorFacts: {
            code: continuationLimitReached
              ? "http_response_continuation_limit_reached"
              : "http_response_continuation_unavailable",
            requestCompleted: true,
            retryable: false,
            ...(continuationLimitReached ? { startCharCeiling: bodyResult.startCharCeiling } : {}),
          },
          durationMs,
        },
      };
    }
    return output;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === timeoutReason) {
      throw normalizeHttpRequestFailure({
        error: timeoutReason,
        url,
        method,
        durationMs: Date.now() - startedAt,
      });
    }
    if (context.abortSignal?.aborted === true) {
      throw new Error("http_request was cancelled.");
    }
    throw normalizeHttpRequestFailure({
      error,
      url,
      method,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    clearTimeout(timeout);
    detachAbort();
  }
}

function incompleteHttpResponseOutput(output: HttpRequestToolOutput): HttpRequestIncompleteOutput {
  return {
    url: output.url,
    method: output.method,
    statusCode: output.statusCode,
    statusText: output.statusText,
    headers: output.headers,
    bodyPreview: output.body,
    responseBodyComplete: false,
    durationMs: output.durationMs,
    startChar: output.startChar,
    bodyChars: output.bodyChars,
    startCharCeiling: output.startCharCeiling,
  };
}

function requireHttpUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("url must be an HTTP or HTTPS URL.");
  }
  const text = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("url must be a valid HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http_request only accepts HTTP or HTTPS URLs.");
  }
  return parsed.toString();
}

function methodFromInput(value: unknown): HttpRequestMethod {
  if (value === undefined) {
    return "GET";
  }
  if (typeof value !== "string") {
    throw new Error("method must be one of GET, HEAD, POST, PUT, or DELETE.");
  }
  const method = value.trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method as HttpRequestMethod)) {
    throw new Error("method must be one of GET, HEAD, POST, PUT, or DELETE.");
  }
  return method as HttpRequestMethod;
}

function headersFromInput(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  const record = asRecordOrUndefined(value);
  if (record === undefined) {
    throw new Error("headers must be an object with string values.");
  }
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(record)) {
    if (typeof headerValue !== "string") {
      throw new Error("headers must be an object with string values.");
    }
    if (key.trim().length > 0) {
      headers[key.trim()] = headerValue;
    }
  }
  return headers;
}

function bodyFromInput(value: unknown, method: HttpRequestMethod, headers: Record<string, string>): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (method === "GET" || method === "HEAD") {
    throw new Error("GET and HEAD requests do not accept a request body.");
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    typeof value === "object"
  ) {
    setDefaultContentType(headers);
    return JSON.stringify(value);
  }
  throw new Error("body must be a string or JSON-serializable value.");
}

function setDefaultContentType(headers: Record<string, string>): void {
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (!hasContentType) {
    headers["content-type"] = "application/json";
  }
}

async function readResponseBody(
  response: HttpRequestFetchResponseLike,
  maxBodyChars: number,
  startChar: number
): Promise<{
  readonly body: string;
  readonly startChar: number;
  readonly bodyChars: number;
  readonly hasMoreAfter: boolean;
  readonly nextStartChar?: number;
  readonly reachedStartCharCeiling: boolean;
  readonly startCharCeiling: number;
  readonly truncated: boolean;
}> {
  const readLimit = startChar + maxBodyChars + 1;
  if (response.body !== undefined && response.body !== null) {
    return bodyWindow(await readStreamBody(response.body, readLimit), startChar, maxBodyChars);
  }
  if (response.text !== undefined) {
    const text = await response.text();
    return bodyWindow(text, startChar, maxBodyChars);
  }
  return { body: "", startChar, bodyChars: 0, hasMoreAfter: false, reachedStartCharCeiling: false, startCharCeiling: MAX_BODY_START_CHAR, truncated: false };
}

async function readStreamBody(
  stream: ReadableStream<Uint8Array>,
  maxReadChars: number
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        break;
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > maxReadChars) {
        text = text.slice(0, maxReadChars);
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

function bodyWindow(
  text: string,
  startChar: number,
  maxBodyChars: number
): {
  readonly body: string;
  readonly startChar: number;
  readonly bodyChars: number;
  readonly hasMoreAfter: boolean;
  readonly nextStartChar?: number;
  readonly reachedStartCharCeiling: boolean;
  readonly startCharCeiling: number;
  readonly truncated: boolean;
} {
  const requestedEndChar = Math.min(text.length, startChar + maxBodyChars);
  const endChar = transportSafeBodyEnd(text, startChar, requestedEndChar);
  const body = text.slice(startChar, endChar);
  const hasMoreAfter = text.length > endChar;
  const rawNextStartChar = hasMoreAfter ? startChar + body.length : undefined;
  const nextStartChar = rawNextStartChar !== undefined && rawNextStartChar > startChar && rawNextStartChar <= MAX_BODY_START_CHAR
    ? rawNextStartChar
    : undefined;
  return {
    body,
    startChar,
    bodyChars: body.length,
    hasMoreAfter,
    nextStartChar,
    reachedStartCharCeiling: hasMoreAfter && rawNextStartChar !== undefined && rawNextStartChar > MAX_BODY_START_CHAR,
    startCharCeiling: MAX_BODY_START_CHAR,
    truncated: hasMoreAfter,
  };
}

function transportSafeBodyEnd(text: string, startChar: number, requestedEndChar: number): number {
  if (startChar >= requestedEndChar) {
    return requestedEndChar;
  }
  if (JSON.stringify(text.slice(startChar, requestedEndChar)).length <= MAX_BODY_JSON_CHARS) {
    return requestedEndChar;
  }
  let low = startChar;
  let high = requestedEndChar;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(text.slice(startChar, middle)).length <= MAX_BODY_JSON_CHARS) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

async function cancelBody(stream: ReadableStream<Uint8Array> | null | undefined): Promise<void> {
  if (stream === undefined || stream === null) {
    return;
  }
  await stream.cancel().catch(() => undefined);
}

function headersToRecord(headers: HeadersLike | undefined): Readonly<Record<string, string>> {
  if (headers === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }
  if (typeof headers.entries === "function") {
    for (const [key, value] of headers.entries()) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

function boundedPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return Math.min(Math.max(1, Math.floor(fallback)), Math.max(1, Math.floor(max)));
  }
  return Math.min(Math.floor(value), Math.max(1, Math.floor(max)));
}

function boundedBodyStartChar(value: unknown): number {
  return Math.min(MAX_BODY_START_CHAR, Math.max(0, positiveInteger(value) ?? 0));
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function resolveGlobalFetch(): HttpRequestFetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: HttpRequestFetchLike }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl : undefined;
}

function attachAbortForwarder(parent: AbortSignal | undefined, controller: AbortController): () => void {
  if (parent === undefined) {
    return () => undefined;
  }
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) {
    abort();
    return () => undefined;
  }
  parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

export function createHttpTimeoutCause(label: string, timeoutMs: number): Error & {
  readonly code: "ETIMEDOUT";
  readonly timedOut: true;
  readonly timeoutMs: number;
} {
  return Object.assign(new Error(`${label} timed out after ${timeoutMs}ms.`), {
    code: "ETIMEDOUT" as const,
    timedOut: true as const,
    timeoutMs,
  });
}

function timeoutError(timeoutMs: number): Error {
  return createHttpTimeoutCause("http_request", timeoutMs);
}

export function normalizeHttpRequestFailure(input: {
  readonly error: unknown;
  readonly url: string;
  readonly method: HttpRequestMethod;
  readonly durationMs: number;
}): HttpRequestError {
  const causeFacts = networkFailureFacts(input.error);
  const facts = createHttpRequestErrorFacts({
    url: input.url,
    method: input.method,
    durationMs: input.durationMs,
    ...causeFacts,
  });
  return new HttpRequestError(
    `http_request failed: ${describeFailure(input.error, facts)}.`,
    facts,
    input.error
  );
}

export function createHttpRequestErrorFacts(facts: HttpRequestErrorFacts): HttpRequestErrorFacts {
  return compactFacts(facts);
}

export function createHttpStatusErrorFacts(input: {
  readonly url: string;
  readonly method: HttpRequestMethod;
  readonly durationMs: number;
  readonly statusCode: number;
  readonly statusText?: string;
}): HttpRequestErrorFacts {
  return createHttpRequestErrorFacts({
    url: input.url,
    method: input.method,
    durationMs: input.durationMs,
    statusCode: input.statusCode,
    statusText: input.statusText,
  });
}

function networkFailureFacts(error: unknown): MutableNetworkFacts {
  const facts: MutableNetworkFacts = {};
  for (const value of errorCauseChain(error)) {
    const record = asRecordOrUndefined(value);
    if (record === undefined) {
      continue;
    }
    facts.code ??= stringOrUndefined(record.code);
    facts.statusCode ??= numberOrUndefined(record.statusCode);
    facts.statusText ??= stringOrUndefined(record.statusText);
    facts.errno ??= stringOrNumberOrUndefined(record.errno);
    facts.syscall ??= stringOrUndefined(record.syscall);
    facts.address ??= stringOrUndefined(record.address);
    facts.port ??= numberOrUndefined(record.port);
    facts.hostname ??= stringOrUndefined(record.hostname);
    facts.timedOut ??= booleanOrUndefined(record.timedOut);
    facts.timeoutMs ??= numberOrUndefined(record.timeoutMs);
  }
  return facts;
}

function errorCauseChain(error: unknown): readonly unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = asRecordOrUndefined(current)?.cause;
  }
  return chain;
}

function describeFailure(error: unknown, facts: HttpRequestErrorFacts): string {
  const messages = failureMessages(error);
  const message = messages.length === 0 ? undefined : messages.join("; cause=");
  const parts = [
    facts.code === undefined ? undefined : `code=${facts.code}`,
    facts.statusCode === undefined ? undefined : `statusCode=${facts.statusCode}`,
    facts.statusText === undefined ? undefined : `statusText=${facts.statusText}`,
    facts.errno === undefined ? undefined : `errno=${String(facts.errno)}`,
    facts.syscall === undefined ? undefined : `syscall=${facts.syscall}`,
    facts.hostname === undefined ? undefined : `hostname=${facts.hostname}`,
    facts.address === undefined ? undefined : `address=${facts.address}`,
    facts.port === undefined ? undefined : `port=${facts.port}`,
    facts.timedOut === true ? "timedOut=true" : undefined,
    facts.timeoutMs === undefined ? undefined : `timeoutMs=${facts.timeoutMs}`,
    `durationMs=${facts.durationMs}`,
  ].filter(isString);
  const factsText = parts.join(", ");
  return message === undefined ? factsText : `${message} (${factsText})`;
}

function failureMessages(error: unknown): readonly string[] {
  const messages: string[] = [];
  for (const value of errorCauseChain(error)) {
    const message = value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : undefined;
    const text = stringOrUndefined(message);
    if (text !== undefined && !messages.includes(text)) {
      messages.push(text);
    }
  }
  return messages;
}

function compactFacts(facts: HttpRequestErrorFacts): HttpRequestErrorFacts {
  return {
    url: facts.url,
    method: facts.method,
    durationMs: facts.durationMs,
    code: stringOrUndefined(facts.code),
    statusCode: numberOrUndefined(facts.statusCode),
    statusText: stringOrUndefined(facts.statusText),
    errno: facts.errno,
    syscall: stringOrUndefined(facts.syscall),
    address: stringOrUndefined(facts.address),
    port: numberOrUndefined(facts.port),
    hostname: stringOrUndefined(facts.hostname),
    timedOut: facts.timedOut === true ? true : undefined,
    timeoutMs: numberOrUndefined(facts.timeoutMs),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("http_request was cancelled.");
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return asRecordOrUndefined(value) ?? {};
}

function asRecordOrUndefined(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function stringOrNumberOrUndefined(value: unknown): string | number | undefined {
  return typeof value === "number" ? value : stringOrUndefined(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return value === true ? true : value === false ? false : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
