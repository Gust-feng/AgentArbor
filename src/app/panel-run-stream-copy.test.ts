import assert from "node:assert/strict";
import test from "node:test";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import {
  agentNoteForEvent,
  chunkText,
  modelFailedSummary,
  modelFailureStreamDetail,
  visibleOutputText,
} from "./panel-run-stream-copy.js";

test("panel stream copy preserves visible output whitespace", () => {
  assert.equal(
    visibleOutputText(visibleTextOutput("\n\n- 第一项\n- 第二项\n")),
    "\n\n- 第一项\n- 第二项\n"
  );
});

test("panel stream chunking preserves outer whitespace", () => {
  assert.deepEqual(chunkText("\n\n开始回答。", 90), ["\n\n开始回答。"]);
});

test("panel model failure copy treats stream parse failures as compatibility issues", () => {
  const payload = {
    failureKind: "provider_response",
    failureMessage: "OpenAI-compatible provider stream response could not be parsed.",
  };

  assert.equal(modelFailedSummary(payload).includes("流式返回格式不兼容"), true);
  assert.equal(modelFailedSummary(payload).includes("OpenAI-compatible provider"), false);
  assert.equal(modelFailureStreamDetail(payload)?.error?.includes("流式返回格式不兼容"), true);
});

test("panel model failure copy prefers stable user copy for provider network failures", () => {
  const payload = {
    failureKind: "provider_network",
    failureMessage: "fetch failed ECONNRESET apiKey=sk-network-secret",
    requestId: "model-request-123",
    responseId: "model-response-123",
  };

  assert.equal(modelFailedSummary(payload), "模型服务连接失败。");
  assert.equal(modelFailureStreamDetail(payload)?.error, "模型服务连接失败。");
});

test("panel agent note copy keeps received-goal activity minimal", () => {
  const note = agentNoteForEvent({ type: "goal.received" } as Parameters<typeof agentNoteForEvent>[0], {});

  assert.equal(note?.agentLabel, "用户");
  assert.equal(note?.summary, "消息已收到。");
  assert.equal(note?.summary.includes("调试区"), false);
});

function visibleTextOutput(value: string): ModelVisibleOutputProjection {
  return {
    source: "text_output",
    contractId: "test.visible_text.v1",
    outputKind: "explanation",
    validationStatus: "passed",
    items: [
      {
        itemId: "text:1",
        fields: [
          {
            name: "text",
            value,
            truncated: false,
          },
        ],
      },
    ],
    truncated: false,
  };
}
