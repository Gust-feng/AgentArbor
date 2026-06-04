import assert from "node:assert/strict";
import test from "node:test";
import {
  answerForWorkSessionTurn,
  assistantMessageOutput,
  deliverableAsLinearText,
  deliverableForWorkSessionTurn,
  visibleDeliverable,
  type AssistantDeliverableLike,
} from "./panel-assistant-message-output.js";

test("assistant message output prefers visible assistant content over deliverable fallback", () => {
  assert.deepEqual(
    assistantMessageOutput({
      content: "直接回答",
      deliverable: deliverable("报告", "摘要", ["正文"]),
    }),
    {
      text: "直接回答",
      hasAnswer: true,
    }
  );
});

test("assistant message output falls back to linear deliverable text", () => {
  const output = assistantMessageOutput({
    content: "   ",
    deliverable: deliverable("报告", "摘要", ["第一段", "第二段"]),
  });

  assert.equal(output.hasAnswer, true);
  assert.equal(output.text.includes("## 报告"), true);
  assert.equal(output.text.includes("### 小节 1"), true);
});

test("work session answer projection only claims the owning run", () => {
  const workSession = {
    run: { runId: "run-1" },
    answer: { content: "工作会话回答" },
    deliverable: deliverable("报告", "摘要", []),
  };

  assert.equal(answerForWorkSessionTurn(workSession, "run-1", "回合内容"), "工作会话回答");
  assert.equal(answerForWorkSessionTurn(workSession, "run-2", "回合内容"), "回合内容");
});

test("work session deliverable projection hides duplicate answer deliverables", () => {
  const workSession = {
    run: { runId: "run-1" },
    deliverable: deliverable("报告", "同一答案", ["更多"]),
  };

  assert.equal(deliverableForWorkSessionTurn(workSession, "run-1", "同一答案"), undefined);
  assert.equal(deliverableForWorkSessionTurn(workSession, "run-2", "其他"), undefined);
  assert.equal(visibleDeliverable(workSession.deliverable, "其他答案", "其他答案")?.title, "报告");
});

test("linear deliverable text keeps a bounded section preview", () => {
  const text = deliverableAsLinearText(deliverable("报告", "摘要", ["一", "二", "三", "四", "五"]));

  assert.equal(text.includes("### 小节 4"), true);
  assert.equal(text.includes("### 小节 5"), false);
});

function deliverable(title: string, summary: string, sectionContents: readonly string[]): AssistantDeliverableLike {
  return {
    title,
    summary,
    sections: sectionContents.map((content, index) => ({
      title: `小节 ${index + 1}`,
      content,
    })),
  };
}
