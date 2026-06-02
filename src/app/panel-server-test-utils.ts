import { request } from "node:http";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

export type RequestJsonOptions = {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
};

export type RequestJsonResult = {
  readonly status: number;
  readonly text: string;
  readonly body: any;
};

export type RequestSseResult = {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
  readonly events: readonly any[];
};

export function requestJson(
  baseUrl: string,
  pathname: string,
  options: RequestJsonOptions = {}
): Promise<RequestJsonResult> {
  const url = new URL(pathname, baseUrl);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        headers:
          body === undefined
            ? undefined
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            text,
            body: JSON.parse(text),
          });
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const PANEL_ASYNC_TEST_TIMEOUT_MS = 12_000;

export function requestSse(baseUrl: string, pathname: string, timeoutMs = PANEL_ASYNC_TEST_TIMEOUT_MS): Promise<RequestSseResult> {
  const url = new URL(pathname, baseUrl);
  const effectiveTimeoutMs = asyncTestTimeout(timeoutMs);
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (response) => {
      let text = "";
      const timeout = setTimeout(() => {
        req.destroy(new Error(`Timed out waiting for SSE ${pathname}`));
      }, effectiveTimeoutMs);
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        clearTimeout(timeout);
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text,
          events: parseSseEvents(text),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export function openAndAbortSse(baseUrl: string, pathname: string, timeoutMs = 2_000): Promise<void> {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`Timed out waiting for first SSE chunk ${pathname}`));
      }
    }, timeoutMs);
    const req = request(url, { method: "GET" }, (response) => {
      response.setEncoding("utf8");
      response.once("data", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          req.destroy();
          resolve();
        }
      });
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    req.end();
  });
}

export async function removeTemporaryTree(directory: string): Promise<void> {
  await fs.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

export async function waitForRun(
  baseUrl: string,
  runId: string,
  predicate: (body: any) => boolean,
  timeoutMs = PANEL_ASYNC_TEST_TIMEOUT_MS,
  runsPath = "/api/underground/runs"
): Promise<RequestJsonResult> {
  const startedAt = Date.now();
  const effectiveTimeoutMs = asyncTestTimeout(timeoutMs);
  let last: RequestJsonResult | undefined;
  while (Date.now() - startedAt < effectiveTimeoutMs) {
    last = await requestJson(baseUrl, `${runsPath}/${encodeURIComponent(runId)}`);
    if (predicate(last.body)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for panel run ${runId}; last=${last?.text}`);
}

export async function waitForBasicEvents(
  baseUrl: string,
  runId: string,
  predicate: (body: any) => boolean,
  timeoutMs = PANEL_ASYNC_TEST_TIMEOUT_MS
): Promise<RequestJsonResult> {
  const startedAt = Date.now();
  const effectiveTimeoutMs = asyncTestTimeout(timeoutMs);
  let last: RequestJsonResult | undefined;
  while (Date.now() - startedAt < effectiveTimeoutMs) {
    last = await requestJson(baseUrl, `/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=0`);
    if (predicate(last.body)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for basic agent events ${runId}; last=${last?.text}`);
}

function asyncTestTimeout(timeoutMs: number): number {
  return Math.max(timeoutMs, PANEL_ASYNC_TEST_TIMEOUT_MS);
}

export function assertSafePanelJsonText(text: string): void {
  const lower = text.toLowerCase();
  assert.equal(/\bsk-[A-Za-z0-9_-]{6,}/.test(text), false);
  assert.equal(/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(text), false);
  assert.equal(/\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/i.test(text), false);
  assert.equal(/\b(?:api[_ -]?key|apikey)\s*[:=]\s*[^;\s"'}\]]+/i.test(text), false);
  assert.equal(/\btoken\s*[:=]\s*[^;\s"'}\]]+/i.test(text), false);
  assert.equal(lower.includes("system prompt"), false);
  assert.equal(text.includes("完整 prompt"), false);
  assert.equal(text.includes("sanitizedMessages"), false);
  assert.equal(text.includes("Return JSON only"), false);
  assert.equal(lower.includes("provider raw response"), false);
  assert.equal(lower.includes("hidden reasoning"), false);
}

function parseSseEvents(text: string): readonly any[] {
  return text
    .split(/\n\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(":"))
    .map((block) => {
      const dataLine = block.split(/\n/g).find((line) => line.startsWith("data: "));
      if (dataLine === undefined) {
        return undefined;
      }
      return JSON.parse(dataLine.slice("data: ".length));
    })
    .filter((event): event is any => event !== undefined);
}
