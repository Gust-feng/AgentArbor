import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeStreamingTextFrame,
  createInitialStreamingTextState,
  createFrozenMarkdownStreamState,
  createStreamingTextState,
  frozenMarkdownStreamTail,
  markdownStreamViewport,
  settleFrozenMarkdownStreamState,
  stableMarkdownCommitLength,
  updateFrozenMarkdownStreamState,
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

test("frozen markdown stream waits for paragraph boundaries before rich rendering", () => {
  const first = updateFrozenMarkdownStreamState(
    createFrozenMarkdownStreamState(),
    "结论\n\n- 第一项\n- 第二",
    true
  );
  const second = updateFrozenMarkdownStreamState(first, "结论\n\n- 第一项\n- 第二项\n", true);

  assert.deepEqual(first.chunks.map((chunk) => chunk.text), ["结论\n\n"]);
  assert.equal(frozenMarkdownStreamTail(first), "- 第一项\n- 第二");
  assert.deepEqual(second.chunks.map((chunk) => chunk.text), ["结论\n\n"]);
  assert.equal(frozenMarkdownStreamTail(second), "- 第一项\n- 第二项\n");
});

test("frozen markdown stream preserves committed chunk identity as new text arrives", () => {
  const first = updateFrozenMarkdownStreamState(
    createFrozenMarkdownStreamState(),
    "先说明。\n\n正在写",
    true
  );
  const second = updateFrozenMarkdownStreamState(first, "先说明。\n\n正在写后续。\n\n", true);

  assert.equal(first.chunks[0]?.key, second.chunks[0]?.key);
  assert.equal(second.chunks[0]?.text, "先说明。\n\n");
  assert.equal(second.chunks[1]?.text, "正在写后续。\n\n");
});

test("markdown stream viewport exposes committed blocks and one live tail", () => {
  const state = updateFrozenMarkdownStreamState(
    createFrozenMarkdownStreamState(),
    "已经稳定。\n\n正在继续输出",
    true
  );
  const viewport = markdownStreamViewport(state);

  assert.deepEqual(viewport.committedBlocks.map((chunk) => chunk.text), ["已经稳定。\n\n"]);
  assert.equal(viewport.liveTail, "正在继续输出");
});

test("frozen markdown stream waits for closed code fences before committing", () => {
  const openFence = "```ts\nconst value = 1;\n";
  const closedFence = `${openFence}\`\`\`\n`;

  assert.equal(stableMarkdownCommitLength(openFence), 0);
  assert.equal(stableMarkdownCommitLength(closedFence), closedFence.length);
});

test("frozen markdown stream settles to a single complete markdown render", () => {
  const live = updateFrozenMarkdownStreamState(
    createFrozenMarkdownStreamState(),
    "| A | B |\n| - | - |\n| 1 | 2 |",
    true
  );
  const settled = updateFrozenMarkdownStreamState(live, "| A | B |\n| - | - |\n| 1 | 2 |", false);

  assert.equal(live.chunks.length, 0);
  assert.equal(frozenMarkdownStreamTail(live), "| A | B |\n| - | - |\n| 1 | 2 |");
  assert.deepEqual(settled.chunks.map((chunk) => chunk.text), ["| A | B |\n| - | - |\n| 1 | 2 |"]);
  assert.equal(frozenMarkdownStreamTail(settled), "");
});

test("settled markdown stream preserves committed chunk identity and appends tail", () => {
  const live = updateFrozenMarkdownStreamState(
    createFrozenMarkdownStreamState(),
    "已经稳定。\n\n正在继续",
    true
  );
  const settled = settleFrozenMarkdownStreamState(live, "已经稳定。\n\n正在继续输出。");

  assert.equal(settled.chunks[0]?.key, live.chunks[0]?.key);
  assert.deepEqual(settled.chunks.map((chunk) => chunk.text), ["已经稳定。\n\n", "正在继续输出。"]);
  assert.equal(frozenMarkdownStreamTail(settled), "");
});

test("markdown stream keeps the whole text in live tail until a stable boundary exists", () => {
  const state = updateFrozenMarkdownStreamState(
    createFrozenMarkdownStreamState(),
    "第一行\n第二行",
    true
  );
  const viewport = markdownStreamViewport(state);

  assert.deepEqual(viewport.committedBlocks.map((chunk) => chunk.text), []);
  assert.equal(viewport.liveTail, "第一行\n第二行");
});
