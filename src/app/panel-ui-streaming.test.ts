import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeStreamingTextFrame,
  createInitialStreamingTextState,
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

test("streaming target replacement never retracts already displayed text", () => {
  const laggingState: StreamingTextState = {
    target: "准备读取文件",
    displayed: "准备读",
    queue: Array.from("取文件"),
  };

  const updated = updateStreamingTextTarget(laggingState, "准备总结结果", true);

  assert.equal(updated.displayed, "准备读");
  assert.equal(updated.target, "准备读总结结果");
  assert.equal(updated.queue.join(""), "总结结果");
});

test("streaming target ignores stale shorter targets once text is visible", () => {
  const visibleState: StreamingTextState = {
    target: "完整输出",
    displayed: "完整输出",
    queue: [],
  };

  const updated = updateStreamingTextTarget(visibleState, "完整", true);

  assert.equal(updated.displayed, "完整输出");
  assert.equal(updated.target, "完整输出");
  assert.equal(updated.queue.join(""), "");
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

test("streaming first live target can paint immediately", () => {
  const updated = updateStreamingTextTarget(createStreamingTextState(""), "你好世界", true);
  const firstFrame = consumeStreamingTextFrame(updated, "formal");

  assert.equal(firstFrame.displayed, "你好");
  assert.equal(firstFrame.queue.join(""), "世界");
});

test("streaming initial state paints the first frame without waiting for effects", () => {
  const initial = createInitialStreamingTextState("你好世界", true, false, "formal");

  assert.equal(initial.displayed, "你好");
  assert.equal(initial.queue.join(""), "世界");
});

test("settled animated initial state also paints the first frame", () => {
  const initial = createInitialStreamingTextState("等待后返回的完整答案。", false, true, "formal");

  assert.equal(initial.displayed, "等待");
  assert.equal(initial.queue.join(""), "后返回的完整答案。");
});

test("streaming first frame can fully settle very short catch-up text", () => {
  const updated = updateStreamingTextTarget(createStreamingTextState(""), "好", true);
  const firstFrame = consumeStreamingTextFrame(updated, "formal");

  assert.equal(firstFrame.displayed, "好");
  assert.equal(firstFrame.queue.length, 0);
});

test("settled catch-up can animate from an empty displayed shell", () => {
  const pendingShell: StreamingTextState = {
    target: "",
    displayed: "",
    queue: [],
  };

  const updated = updateStreamingTextTarget(pendingShell, "等待后返回的完整答案。", true);
  const firstFrame = consumeStreamingTextFrame(updated, "formal");

  assert.equal(firstFrame.displayed, "等待");
  assert.equal(firstFrame.queue.join(""), "后返回的完整答案。");
});
