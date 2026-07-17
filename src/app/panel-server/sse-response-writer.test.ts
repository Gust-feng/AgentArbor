import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { SseResponseWriter } from "./sse-response-writer.js";

test("SseResponseWriter waits for drain after Node reports transport backpressure", async () => {
  const response = fakeResponse([false]);
  const writer = new SseResponseWriter(response.value);
  let settled = false;
  const writing = writer.write("event: delta\ndata: one\n\n").then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  response.events.emit("drain");
  assert.equal(await writing, true);
});

test("SseResponseWriter bounds queued frames while a local renderer is stalled", async () => {
  const response = fakeResponse([false, true]);
  const writer = new SseResponseWriter(response.value, { maxQueuedFrames: 2 });
  assert.equal(writer.enqueue("one"), true);
  assert.equal(writer.enqueue("two"), true);
  assert.equal(writer.enqueue("three"), false);
  await Promise.resolve();
  response.events.emit("drain");
  await writer.idle();
  assert.deepEqual(response.writes, ["one", "two"]);
});

test("SseResponseWriter close releases a pending drain wait", async () => {
  const response = fakeResponse([false]);
  const writer = new SseResponseWriter(response.value);
  const writing = writer.write("one");
  await Promise.resolve();
  writer.close();
  assert.equal(await writing, false);
});

function fakeResponse(writeResults: boolean[]) {
  const events = new EventEmitter();
  const writes: string[] = [];
  const response = events as EventEmitter & {
    writableEnded: boolean;
    write(frame: string): boolean;
  };
  response.writableEnded = false;
  response.write = (frame: string) => {
    writes.push(frame);
    return writeResults.shift() ?? true;
  };
  return { events, writes, value: response };
}
