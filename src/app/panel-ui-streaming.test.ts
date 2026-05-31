import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeStreamingTextFrame,
  createStreamingTextState,
  updateStreamingTextTarget,
  type StreamingTextState,
} from "./panel-ui-streaming.js";

test("streaming target appends only the new suffix while display lags", () => {
  const laggingState: StreamingTextState = {
    target: "你好",
    displayed: "你",
    queue: ["好"],
  };

  const updated = updateStreamingTextTarget(laggingState, "你好世界", true);

  assert.equal(updated.displayed, "你");
  assert.equal(updated.target, "你好世界");
  assert.equal(updated.queue.join(""), "好世界");
});

test("streaming target replacement keeps only the stable prefix", () => {
  const laggingState: StreamingTextState = {
    target: "准备读取文件",
    displayed: "准备读",
    queue: Array.from("取文件"),
  };

  const updated = updateStreamingTextTarget(laggingState, "准备总结结果", true);

  assert.equal(updated.displayed, "准备");
  assert.equal(updated.target, "准备总结结果");
  assert.equal(updated.queue.join(""), "总结结果");
});

test("settled target flushes all pending stream state", () => {
  const streamingState: StreamingTextState = {
    target: "旧输出",
    displayed: "旧",
    queue: ["输", "出"],
  };

  const updated = updateStreamingTextTarget(streamingState, "最终输出", false);

  assert.deepEqual(updated, createStreamingTextState("最终输出"));
});

test("streaming frame consumes a paced visible burst", () => {
  const state: StreamingTextState = {
    target: "abcdef",
    displayed: "ab",
    queue: Array.from("cdef"),
  };

  const updated = consumeStreamingTextFrame(state, "formal");

  assert.equal(updated.displayed, "abcd");
  assert.equal(updated.queue.join(""), "ef");
});
