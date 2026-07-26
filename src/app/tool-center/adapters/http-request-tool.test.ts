import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { ToolCenter } from "../tool-center.js";
import { InMemoryToolOutputStore } from "../tool-output-store.js";
import { createHttpRequestTool, type HttpRequestErrorFacts, type HttpRequestFetchLike } from "./http-request-tool.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("http_request GET returns JSON and text responses", async () => {
  const server = await createServer(async (request, response) => {
    if (request.url === "/json") {
      response.writeHead(200, { "content-type": "application/json", "x-test": "json" });
      response.end(JSON.stringify({ ok: true, path: request.url }));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("plain text response");
  });
  const tool = createHttpRequestTool();
  try {
    const json = asHttpOutput(await tool.execute({ url: `${server.origin}/json` }, context));
    const text = asHttpOutput(await tool.execute({ url: `${server.origin}/text` }, context));

    assert.equal(json.method, "GET");
    assert.equal(json.statusCode, 200);
    assert.equal(json.headers["content-type"]?.includes("application/json"), true);
    assert.equal(json.headers["x-test"], "json");
    assert.equal(json.body, '{"ok":true,"path":"/json"}');
    assert.equal(json.truncated, false);
    assert.equal(text.body, "plain text response");
  } finally {
    await server.close();
  }
});

test("http_request HEAD returns headers and empty body without reading response body", async () => {
  const server = await createServer(async (_request, response) => {
    response.writeHead(204, { "x-head": "ok" });
    response.end("body should not matter");
  });
  const tool = createHttpRequestTool();
  try {
    const output = asHttpOutput(await tool.execute({ method: "HEAD", url: `${server.origin}/head` }, context));

    assert.equal(output.method, "HEAD");
    assert.equal(output.statusCode, 204);
    assert.equal(output.headers["x-head"], "ok");
    assert.equal(output.body, "");
    assert.equal(output.truncated, false);
  } finally {
    await server.close();
  }
});

test("http_request POST sends JSON body and preserves non-2xx as structured result", async () => {
  const server = await createServer(async (request, response) => {
    const body = await readRequestBody(request);
    response.writeHead(422, { "content-type": "application/json" });
    response.end(JSON.stringify({
      method: request.method,
      contentType: request.headers["content-type"],
      body,
    }));
  });
  const tool = createHttpRequestTool();
  try {
    const output = asHttpOutput(await tool.execute({
      method: "POST",
      url: `${server.origin}/items`,
      body: { name: "demo" },
    }, context));

    assert.equal(output.statusCode, 422);
    assert.equal(output.method, "POST");
    assert.match(output.body, /"method":"POST"/);
    assert.match(output.body, /"contentType":"application\/json"/);
    assert.match(output.body, /"body":"\{\\"name\\":\\"demo\\"\}"/);
  } finally {
    await server.close();
  }
});

test("http_request times out and rejects invalid URLs", async () => {
  const server = await createServer(async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    response.writeHead(200);
    response.end("late");
  });
  const tool = createHttpRequestTool();
  try {
    await assert.rejects(
      () => tool.execute({ url: `${server.origin}/slow`, timeoutMs: 20 }, context),
      (error: unknown) => {
        assertError(error);
        assert.match(error.message, /timed out after 20ms/);
        assert.doesNotMatch(error.message, /cancelled/);
        const facts = factsFromError(error);
        assert.equal(facts.code, "ETIMEDOUT");
        assert.equal(facts.timedOut, true);
        assert.equal(facts.timeoutMs, 20);
        assert.equal(facts.method, "GET");
        assert.equal(facts.url, `${server.origin}/slow`);
        assert.equal(typeof facts.durationMs, "number");
        return true;
      }
    );
    await assert.rejects(
      () => tool.execute({ url: "file:///tmp/secret" }, context),
      /HTTP or HTTPS/
    );
    await assert.rejects(
      () => tool.execute({ url: "not a url" }, context),
      /valid HTTP or HTTPS/
    );
  } finally {
    await server.close();
  }
});

test("http_request preserves caller cancellation separately from timeout", async () => {
  const server = await createServer(async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    response.writeHead(200);
    response.end("late");
  });
  const tool = createHttpRequestTool();
  const abort = new AbortController();
  try {
    const request = tool.execute(
      { url: `${server.origin}/cancelled`, timeoutMs: 5_000 },
      { ...context, abortSignal: abort.signal }
    );
    setTimeout(() => abort.abort(new Error("caller cancelled")), 20);
    await assert.rejects(
      () => request,
      (error: unknown) => {
        assertError(error);
        assert.match(error.message, /cancelled/);
        assert.doesNotMatch(error.message, /timed out/);
        return true;
      }
    );
  } finally {
    await server.close();
  }
});

test("http_request network failures expose ECONNREFUSED cause facts", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:43210"), {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 43210,
  });
  const tool = createHttpRequestTool({ fetch: rejectingFetch(fetchFailureWithCause(cause)) });

  await assert.rejects(
    () => tool.execute({ url: "http://127.0.0.1:43210/status" }, context),
    (error: unknown) => {
      assertError(error);
      assert.match(error.message, /ECONNREFUSED/);
      assert.match(error.message, /address=127\.0\.0\.1/);
      assert.match(error.message, /port=43210/);
      assert.equal("recoveryHint" in error, false);
      const facts = factsFromError(error);
      assert.equal(facts.code, "ECONNREFUSED");
      assert.equal(facts.errno, -4078);
      assert.equal(facts.syscall, "connect");
      assert.equal(facts.address, "127.0.0.1");
      assert.equal(facts.port, 43210);
      assert.equal(facts.method, "GET");
      assert.equal(facts.url, "http://127.0.0.1:43210/status");
      assert.equal(typeof facts.durationMs, "number");
      return true;
    }
  );
});

test("http_request network failures expose ENOTFOUND hostname facts", async () => {
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND missing.example.test"), {
    code: "ENOTFOUND",
    errno: -3008,
    syscall: "getaddrinfo",
    hostname: "missing.example.test",
  });
  const tool = createHttpRequestTool({ fetch: rejectingFetch(fetchFailureWithCause(cause)) });

  await assert.rejects(
    () => tool.execute({ url: "https://missing.example.test/api" }, context),
    (error: unknown) => {
      assertError(error);
      assert.match(error.message, /ENOTFOUND/);
      assert.match(error.message, /hostname=missing\.example\.test/);
      assert.equal("recoveryHint" in error, false);
      const facts = factsFromError(error);
      assert.equal(facts.code, "ENOTFOUND");
      assert.equal(facts.errno, -3008);
      assert.equal(facts.syscall, "getaddrinfo");
      assert.equal(facts.hostname, "missing.example.test");
      assert.equal(facts.method, "GET");
      assert.equal(facts.url, "https://missing.example.test/api");
      assert.equal(typeof facts.durationMs, "number");
      return true;
    }
  );
});

test("http_request truncates large response bodies at the configured limit", async () => {
  const server = await createServer(async (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("x".repeat(32));
  });
  const tool = createHttpRequestTool({ maxBodyChars: 12 });
  try {
    const output = asHttpOutput(await tool.execute({ url: `${server.origin}/large` }, context));

    assert.equal(output.body, "x".repeat(12));
    assert.equal(output.truncated, true);
    assert.equal(output.startChar, 0);
    assert.equal(output.bodyChars, 12);
    assert.equal(output.hasMoreAfter, true);
    assert.equal(output.continuation?.nextInput?.startChar, 12);
    assert.equal(output.truncated, true);
  } finally {
    await server.close();
  }
});

test("http_request continues truncated GET response bodies with startChar", async () => {
  const server = await createServer(async (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("0123456789abcdef");
  });
  const tool = createHttpRequestTool({ maxBodyChars: 5 });
  try {
    const output = asHttpOutput(await tool.execute({ url: `${server.origin}/large`, startChar: 5 }, context));

    assert.equal(output.body, "56789");
    assert.equal(output.startChar, 5);
    assert.equal(output.bodyChars, 5);
    assert.equal(output.hasMoreAfter, true);
    assert.equal(output.continuation?.nextInput?.startChar, 10);
    assert.equal(output.truncated, true);
  } finally {
    await server.close();
  }
});

test("http_request clamps zero body budgets so every GET truncation advances", async () => {
  const tool = createHttpRequestTool({
    maxBodyChars: 0,
    fetch: async () => ({
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "abc",
    }),
  });

  const output = asHttpOutput(await tool.execute({ url: "https://example.test/zero-budget" }, context));

  assert.equal(output.body.length >= 1, true);
  assert.equal(output.truncated, true);
  assert.equal(output.hasMoreAfter, true);
  assert.equal(output.continuation?.nextInput?.startChar, output.bodyChars);
  assert.equal((output.continuation?.nextInput?.startChar ?? 0) > output.startChar, true);
});

test("http_request stops continuation at the startChar ceiling without hiding overflow", async () => {
  const center = new ToolCenter();
  center.register(createHttpRequestTool({
    maxBodyChars: 5,
    fetch: async () => ({
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => `${"x".repeat(2_000_000)}abcdeTAIL`,
    }),
  }));

  const result = await center.execute(
    {
      callId: "call-http-ceiling",
      toolName: "HttpRequest",
      input: { url: "https://example.test/ceiling", startChar: 2_000_000 },
    },
    context,
    { callerAgentId: context.callerAgentId, allowedTools: ["HttpRequest"] }
  );
  const output = asIncompleteHttpOutput(result.output);

  assert.equal(result.status, "failed");
  assert.equal(output.bodyPreview, "abcde");
  assert.equal(output.startChar, 2_000_000);
  assert.equal(output.bodyChars, 5);
  assert.equal(output.responseBodyComplete, false);
  assert.equal(output.startCharCeiling, 2_000_000);
  assert.equal("truncated" in output, false);
  assert.equal("continuation" in output, false);
  assert.equal(result.errorFacts?.code, "http_response_continuation_limit_reached");
  assert.equal(result.errorFacts?.requestCompleted, true);
  assert.equal(result.errorFacts?.retryable, false);
});

test("http_request fails explicitly when a GET exceeds the exact retained snapshot ceiling", async () => {
  const center = new ToolCenter();
  center.register(createHttpRequestTool({
    maxBodyChars: 5,
    outputStore: new InMemoryToolOutputStore(),
    fetch: async () => ({
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => `${"x".repeat(2_000_001)}tail`,
    }),
  }));

  const result = await center.execute(
    { callId: "call-http-snapshot-ceiling", toolName: "HttpRequest", input: { url: "https://example.test/huge" } },
    context,
    { callerAgentId: context.callerAgentId, allowedTools: ["HttpRequest"] },
  );
  const output = asIncompleteHttpOutput(result.output);

  assert.equal(result.status, "failed");
  assert.equal(output.responseBodyComplete, false);
  assert.equal("continuation" in output, false);
  assert.equal(result.errorFacts?.code, "http_response_snapshot_limit_reached");
  assert.equal(result.errorFacts?.requestCompleted, true);
  assert.equal(result.errorFacts?.retryable, false);
});

test("http_request fails partial side-effecting responses without a replay continuation", async () => {
  for (const method of ["POST", "PUT", "DELETE"] as const) {
    const center = new ToolCenter();
    center.register(createHttpRequestTool({
      maxBodyChars: 5,
      fetch: async () => ({
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "0123456789",
      }),
    }));

    const result = await center.execute(
      {
        callId: `call-${method.toLowerCase()}-partial-response`,
        toolName: "HttpRequest",
        input: { method, url: "https://example.test/items", body: { name: "demo" } },
      },
      context,
      {
        callerAgentId: context.callerAgentId,
        allowedTools: ["HttpRequest"],
        // Side-effect HTTP submissions are confirmation-gated; this test is
        // about partial-response delivery after an approved submission.
        approvedConfirmationIds: [`confirmation-call-${method.toLowerCase()}-partial-response`],
      }
    );
    const output = asIncompleteHttpOutput(result.output);
    const errorFacts = result.errorFacts as Readonly<Record<string, unknown>> | undefined;

    assert.equal(result.status, "failed");
    assert.equal(output.bodyPreview, "01234");
    assert.equal(output.responseBodyComplete, false);
    assert.equal("truncated" in output, false);
    assert.equal("continuation" in output, false);
    assert.equal(errorFacts?.code, "http_response_continuation_unavailable");
    assert.equal(errorFacts?.requestCompleted, true);
    assert.equal(errorFacts?.retryable, false);
  }
});

test("http_request continues one retained GET response without issuing another request", async () => {
  let requests = 0;
  const tool = createHttpRequestTool({
    maxBodyChars: 4,
    outputStore: new InMemoryToolOutputStore(),
    fetch: async () => {
      requests += 1;
      return {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "abcdefghijkl",
      };
    },
  });

  const first = asHttpOutput(await tool.execute({ url: "https://example.test/stable" }, context));
  const secondInput = asRecord(asRecord(first.continuation).nextInput);
  const second = asRecord(await tool.execute(secondInput, context));
  const third = asRecord(await tool.execute(asRecord(asRecord(second.continuation).nextInput), context));

  assert.equal(requests, 1);
  assert.equal(typeof secondInput.responseRef, "string");
  assert.equal(`${first.body}${second.body}${third.body}`, "abcdefghijkl");
  assert.equal(second.headers, undefined);
  assert.equal(third.continuation, undefined);
});

test("http_request reports a missing retained response without replaying the request", async () => {
  let requests = 0;
  const tool = createHttpRequestTool({
    outputStore: new InMemoryToolOutputStore(),
    fetch: async () => {
      requests += 1;
      throw new Error("must not request again");
    },
  });

  await assert.rejects(
    tool.execute({ responseRef: "tool-output://missing", startChar: 4 }, context),
    (error: unknown) => error instanceof Error && (error as Error & { readonly code?: string }).code === "tool_output_not_found",
  );
  assert.equal(requests, 0);
});

type TestServer = {
  readonly origin: string;
  close(): Promise<void>;
};

async function createServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void> | void
): Promise<TestServer> {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "handler failed");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assertAddressInfo(address);
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  };
}

function assertAddressInfo(value: string | AddressInfo | null): asserts value is AddressInfo {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

type HttpOutputForTest = {
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly startChar: number;
  readonly bodyChars: number;
  readonly hasMoreAfter: boolean;
  readonly reachedStartCharCeiling: boolean;
  readonly startCharCeiling: number;
  readonly truncated: boolean;
  readonly continuation?: {
    readonly nextInput?: { readonly startChar?: number };
  };
};

type IncompleteHttpOutputForTest = {
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  readonly bodyPreview: string;
  readonly responseBodyComplete: false;
  readonly startChar: number;
  readonly bodyChars: number;
  readonly startCharCeiling: number;
};

function asHttpOutput(value: unknown): HttpOutputForTest {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const output = value as Readonly<Record<string, unknown>>;
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `http output must not contain ${legacyField}`);
  }
  assert.equal(typeof output.url, "string");
  assert.equal(typeof output.method, "string");
  assert.equal(typeof output.statusCode, "number");
  assert.equal(typeof output.headers, "object");
  assert.equal(typeof output.body, "string");
  assert.equal(typeof output.truncated, "boolean");
  return value as HttpOutputForTest;
}

function asIncompleteHttpOutput(value: unknown): IncompleteHttpOutputForTest {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const output = value as Readonly<Record<string, unknown>>;
  for (const legacyField of ["action", "status", "summary", "result", "truncated", "continuation"]) {
    assert.equal(legacyField in output, false, `incomplete HTTP output must not contain ${legacyField}`);
  }
  assert.equal(typeof output.bodyPreview, "string");
  assert.equal(output.responseBodyComplete, false);
  return value as IncompleteHttpOutputForTest;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function rejectingFetch(error: unknown): HttpRequestFetchLike {
  return async () => {
    throw error;
  };
}

function fetchFailureWithCause(cause: Error): Error {
  const error = new TypeError("fetch failed") as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

function assertError(value: unknown): asserts value is Error {
  assert.equal(value instanceof Error, true);
}

function factsFromError(error: Error): HttpRequestErrorFacts {
  const value = error as Error & { facts?: unknown };
  assert.equal(typeof value.facts, "object");
  assert.notEqual(value.facts, null);
  return value.facts as HttpRequestErrorFacts;
}
