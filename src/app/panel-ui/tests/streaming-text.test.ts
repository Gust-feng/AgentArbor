import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeStreamingTextFrame,
  createInitialStreamingTextState,
  createStreamingTextState,
  splitStreamingMarkdown,
  stabilizeStreamingMarkdown,
  streamingTextHasPendingDisplay,
  updateStreamingTextTarget,
} from "../src/streaming-text.js";

test("streaming text spreads a provider chunk across several frames", () => {
  const target = "abcdefghijklmnopqrst";
  const pending = updateStreamingTextTarget(createStreamingTextState(), target, true, 0);
  const firstFrame = consumeStreamingTextFrame(pending, 0);

  assert.equal(firstFrame.displayed.length > 0, true);
  assert.equal(firstFrame.displayed.length < target.length, true);
  assert.equal(streamingTextHasPendingDisplay(firstFrame), true);
});

test("streaming text reaches the authoritative target by its deadline", () => {
  const target = "abcdefghijklmnopqrstuvwxyz";
  const pending = updateStreamingTextTarget(createStreamingTextState(), target, true, 0);

  assert.equal(consumeStreamingTextFrame(pending, pending.deadlineAt ?? 0).displayed, target);
});

test("continuous chunks extend smoothing without exceeding the bounded lag", () => {
  const first = updateStreamingTextTarget(createStreamingTextState(), "abcdefghij", true, 0);
  const partiallyDisplayed = consumeStreamingTextFrame(first, 16);
  const extended = updateStreamingTextTarget(partiallyDisplayed, "abcdefghijklmnopqrstuvwxyz", true, 80);

  assert.equal(extended.animationStartedAt, 0);
  assert.equal(extended.deadlineAt, 160);
});

test("streaming text never splits a surrogate pair", () => {
  const pending = updateStreamingTextTarget(createStreamingTextState(), "😀😀😀😀😀😀", true, 0);
  const firstFrame = consumeStreamingTextFrame(pending, 0);

  assert.equal(Array.from(firstFrame.displayed).every((value) => value === "😀"), true);
  assert.equal(firstFrame.displayed.includes("�"), false);
});

test("settled and restored text renders completely without replay", () => {
  const pending = updateStreamingTextTarget(createStreamingTextState(), "正在流式输出", true, 0);
  const partial = consumeStreamingTextFrame(pending, 0);

  assert.deepEqual(updateStreamingTextTarget(partial, "最终完整输出", false, 20), createStreamingTextState("最终完整输出"));
  assert.deepEqual(
    createInitialStreamingTextState("恢复中的完整输出", true, false, 0),
    createStreamingTextState("恢复中的完整输出"),
  );
});

test("new live text reveals a first chunk in its initial render", () => {
  const initial = createInitialStreamingTextState("abcdefghijklmnopqrst", true, true, 0);

  assert.equal(initial.displayed.length > 0, true);
  assert.equal(initial.displayed.length < initial.target.length, true);
  assert.equal(streamingTextHasPendingDisplay(initial), true);
});

test("streaming Markdown keeps completed blocks separate from the active tail", () => {
  assert.deepEqual(splitStreamingMarkdown("# 标题\n\n第一段\n\n第二段"), {
    completedBlocks: ["# 标题\n\n", "第一段\n\n"],
    activeBlock: "第二段",
  });
});

test("streaming Markdown does not split an unfinished fenced code block", () => {
  assert.deepEqual(splitStreamingMarkdown("说明\n\n```ts\nconst value = 1;\n\n"), {
    completedBlocks: ["说明\n\n"],
    activeBlock: "```ts\nconst value = 1;\n\n",
  });
});

test("streaming Markdown closes a finished fenced block at the following blank line", () => {
  assert.deepEqual(splitStreamingMarkdown("```ts\nconst value = 1;\n```\n\n下一段"), {
    completedBlocks: ["```ts\nconst value = 1;\n```\n\n"],
    activeBlock: "下一段",
  });
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
