import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCatchupTextFragment,
  appendTextStreamAssembly,
  accumulateStreamTextFragments,
  emptyTextStreamAssembly,
  appendReadableTextFragment,
  appendSnapshotTextFragment,
  appendStreamTextEventFragment,
  appendStreamTextFragment,
  textStreamFragmentSourceFromEventId,
} from "./readable-text-fragments.js";

test("stream text fragments append model deltas exactly by default", () => {
  assert.equal(accumulateStreamTextFragments(["Now", " let", " me answer."]), "Now let me answer.");
  assert.equal(accumulateStreamTextFragments(["foo", "bar"]), "foobar");
  assert.equal(accumulateStreamTextFragments(["ha", "ha"]), "haha");
});

test("stream text fragments still accept full target snapshots", () => {
  assert.equal(appendStreamTextFragment("foo", "foobar"), "foobar");
});

test("snapshot text fragments deduplicate replayed chunks with overlap", () => {
  assert.equal(appendSnapshotTextFragment("foobar", "bar"), "foobar");
  assert.equal(appendSnapshotTextFragment("abcdefghijklmnop", "ijklmnopqrstuvwxyz"), "abcdefghijklmnopqrstuvwxyz");
  assert.equal(appendSnapshotTextFragment("foo", "foobar"), "foobar");
});

test("event text fragments preserve ordinary repeated replay chunks", () => {
  assert.equal(
    appendStreamTextEventFragment("ha", "ha", "run-1:event:1:model.output.delta:2"),
    "haha"
  );
  assert.equal(
    appendStreamTextEventFragment("the cat ", "the dog", "run-1:event:1:model.output.delta:2"),
    "the cat the dog"
  );
});

test("catchup text fragments merge replay after live output without swallowing repeats", () => {
  let state = appendCatchupTextFragment("foo", "", "foo");
  assert.equal(state.text, "foo");
  state = appendCatchupTextFragment(state.text, state.catchup, "bar");
  assert.equal(state.text, "foobar");

  state = appendCatchupTextFragment("ha", "", "ha");
  state = appendCatchupTextFragment(state.text, state.catchup, "ha");
  assert.equal(state.text, "haha");
});

test("catchup text fragments do not infer inserted boundaries", () => {
  let state = appendCatchupTextFragment("HelloWorld", "", "Hello ");
  assert.equal(state.text, "HelloWorld");
  state = appendCatchupTextFragment(state.text, state.catchup, "World");
  assert.equal(state.text, "HelloWorld");
  assert.equal(state.catchup, "Hello World");
});

test("catchup text fragments do not repair compact replay text", () => {
  let state = appendCatchupTextFragment("The user is", "", "Theuser");
  assert.equal(state.text, "The user is");
  state = appendCatchupTextFragment(state.text, state.catchup, "isasking");
  assert.equal(state.text, "The user is");
  assert.equal(state.catchup, "Theuserisasking");
});

test("catchup text fragments can repair compact replay text in readable mode", () => {
  let state = appendCatchupTextFragment("The user is", "", "Theuser", { boundary: "readable" });
  assert.equal(state.text, "The user is");
  state = appendCatchupTextFragment(state.text, state.catchup, "isasking", { boundary: "readable" });
  assert.equal(state.text, "The user is asking");
  assert.equal(state.catchup, "Theuser isasking");
});

test("snapshot text fragments do not rewrite compact-equivalent text", () => {
  assert.equal(appendSnapshotTextFragment("The user is", "Theuserisasking"), "The user isTheuserisasking");
  assert.equal(appendSnapshotTextFragment("HelloWorld", "Hello World!"), "HelloWorldHello World!");
  assert.equal(appendSnapshotTextFragment("Hello World", "HelloWorld"), "Hello WorldHelloWorld");
});

test("text stream assembly centralizes live replay catch-up policy", () => {
  let stream = emptyTextStreamAssembly();
  stream = appendTextStreamAssembly(stream, "foo", textStreamFragmentSourceFromEventId("run-1:live:model.output.delta:model-1:1"));
  stream = appendTextStreamAssembly(stream, "foo", textStreamFragmentSourceFromEventId("run-1:event:10:model.output.delta:1"));
  stream = appendTextStreamAssembly(stream, "bar", textStreamFragmentSourceFromEventId("run-1:event:10:model.output.delta:2"));
  assert.equal(stream.text, "foobar");

  let replayOnly = emptyTextStreamAssembly();
  replayOnly = appendTextStreamAssembly(replayOnly, "ha", textStreamFragmentSourceFromEventId("run-1:event:10:model.output.delta:1"));
  replayOnly = appendTextStreamAssembly(replayOnly, "ha", textStreamFragmentSourceFromEventId("run-1:event:10:model.output.delta:2"));
  assert.equal(replayOnly.text, "haha");
});

test("text stream assembly can apply readable live replay catch-up", () => {
  let stream = emptyTextStreamAssembly();
  stream = appendTextStreamAssembly(stream, "The user is", textStreamFragmentSourceFromEventId("run-1:live:model.output.delta:model-1:1"), { boundary: "readable" });
  stream = appendTextStreamAssembly(stream, "Theuser", textStreamFragmentSourceFromEventId("run-1:event:10:model.output.delta:1"), { boundary: "readable" });
  stream = appendTextStreamAssembly(stream, "isasking", textStreamFragmentSourceFromEventId("run-1:event:10:model.output.delta:2"), { boundary: "readable" });
  assert.equal(stream.text, "The user is asking");
});

test("readable boundary mode is explicit and limited to non-raw fragments", () => {
  assert.equal(appendStreamTextFragment("hello", "world", { boundary: "readable" }), "hello world");
  assert.equal(appendStreamTextFragment("hello world", "helloworld", { boundary: "readable" }), "hello world");
  assert.equal(appendReadableTextFragment("hello", "world"), "hello world");
});
