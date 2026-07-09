import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeStreamingTextFrame,
  createInitialStreamingTextState,
  createStreamingTextState,
  stabilizeStreamingMarkdown,
  updateStreamingTextTarget,
  type StreamingTextState,
} from "../src/streaming-text.js";

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

test("streaming initial state does not replay restored live text on mount", () => {
  const initial = createInitialStreamingTextState("你好世界", false, "formal");

  assert.equal(initial.displayed, "你好世界");
  assert.equal(initial.queue.join(""), "");
});

test("settled animated initial state also paints the first frame", () => {
  const initial = createInitialStreamingTextState("等待后返回的完整答案。", true, "formal");

  assert.equal(initial.displayed, "等待");
  assert.equal(initial.queue.join(""), "后返回的完整答案。");
});

test("streaming initial state still animates when mount animation is explicitly requested", () => {
  const initial = createInitialStreamingTextState("你好世界", true, "formal");

  assert.equal(initial.displayed, "你好");
  assert.equal(initial.queue.join(""), "世界");
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

test("stabilizeStreamingMarkdown leaves complete markdown unchanged", () => {
  const input = "# 标题\n\n**粗体** 与 *斜体* 和 `code`。\n\n```ts\nconst x = 1;\n```";
  assert.equal(stabilizeStreamingMarkdown(input), input);
});

test("stabilizeStreamingMarkdown closes unclosed inline markers", () => {
  assert.equal(stabilizeStreamingMarkdown("**未闭合粗体"), "**未闭合粗体**");
  assert.equal(stabilizeStreamingMarkdown("*未闭合斜体"), "*未闭合斜体*");
  assert.equal(stabilizeStreamingMarkdown("`未闭合代码"), "`未闭合代码`");
  assert.equal(stabilizeStreamingMarkdown("~~未闭合删除"), "~~未闭合删除~~");
  assert.equal(stabilizeStreamingMarkdown("__未闭合下划线粗体"), "__未闭合下划线粗体__");
});

test("stabilizeStreamingMarkdown closes unclosed code fences", () => {
  const input = "```ts\nconst x = 1;\n";
  assert.equal(stabilizeStreamingMarkdown(input), "```ts\nconst x = 1;\n\n```");
});

test("stabilizeStreamingMarkdown ignores inline markers inside code blocks", () => {
  const input = "```\n**not bold\n`not code\n```";
  assert.equal(stabilizeStreamingMarkdown(input), input);
});

test("stabilizeStreamingMarkdown does not double close complete markers", () => {
  const input = "`**` 是一个完整内联代码";
  assert.equal(stabilizeStreamingMarkdown(input), input);
});
