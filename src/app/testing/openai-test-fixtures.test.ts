import assert from "node:assert/strict";
import test from "node:test";
import type { ConfiguredModelProtocolKind } from "../../domain/config/index.js";
import { createOpenAiTextResponse } from "./openai-test-fixtures.js";

test("OpenAI test responses keep JSON and streaming payloads inside the configured protocol", async () => {
  const protocols: readonly ConfiguredModelProtocolKind[] = [
    "openai_responses",
    "openai_compatible_chat_completions",
  ];

  for (const protocol of protocols) {
    const response = createOpenAiTextResponse(protocol, "fixture-model", "fixture-output");
    const json = asRecord(await response.json());
    const events = await readSseEvents(response.body);

    if (protocol === "openai_responses") {
      assert.equal(Array.isArray(json.output), true);
      assert.equal(json.choices, undefined);
      assert.equal(events.every((event) => typeof event.type === "string" && event.type.startsWith("response.")), true);
      assert.equal(events.some((event) => Array.isArray(event.choices)), false);
      continue;
    }

    assert.equal(Array.isArray(json.choices), true);
    assert.equal(json.output, undefined);
    assert.equal(events.every((event) => Array.isArray(event.choices)), true);
    assert.equal(events.some((event) => typeof event.type === "string" && event.type.startsWith("response.")), false);
  }
});

async function readSseEvents(body: unknown): Promise<Readonly<Record<string, unknown>>[]> {
  assert.equal(isAsyncIterable(body), true, "fixture response body must be an async iterable");
  if (!isAsyncIterable(body)) {
    return [];
  }
  const events: Readonly<Record<string, unknown>>[] = [];
  for await (const chunk of body) {
    assert.equal(typeof chunk, "string");
    if (typeof chunk !== "string") {
      continue;
    }
    const data = chunk.trim().replace(/^data:\s*/u, "");
    if (data === "[DONE]") {
      continue;
    }
    events.push(asRecord(JSON.parse(data)));
  }
  return events;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
