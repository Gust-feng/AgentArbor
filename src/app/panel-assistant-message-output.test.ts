import assert from "node:assert/strict";
import test from "node:test";
import {
  answerForWorkViewTurn,
  assistantMessageOutput,
  deliverableAsLinearText,
  deliverableForWorkViewTurn,
  deliverableResultEvidence,
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

test("work view answer projection only claims the owning run", () => {
  const workView = {
    run: { runId: "run-1" },
    answer: { content: "工作会话回答" },
    deliverable: deliverable("报告", "摘要", []),
  };

  assert.equal(answerForWorkViewTurn(workView, "run-1", "回合内容"), "工作会话回答");
  assert.equal(answerForWorkViewTurn(workView, "run-2", "回合内容"), "回合内容");
});

test("work view deliverable projection hides duplicate answer deliverables", () => {
  const workView = {
    run: { runId: "run-1" },
    deliverable: deliverable("报告", "同一答案", ["更多"]),
  };

  assert.equal(deliverableForWorkViewTurn(workView, "run-1", "同一答案"), undefined);
  assert.equal(deliverableForWorkViewTurn(workView, "run-2", "其他"), undefined);
  assert.equal(visibleDeliverable(workView.deliverable, "其他答案", "其他答案")?.title, "报告");
});

test("linear deliverable text keeps a bounded section preview", () => {
  const text = deliverableAsLinearText(deliverable("报告", "摘要", ["一", "二", "三", "四", "五"]));

  assert.equal(text.includes("### 小节 4"), true);
  assert.equal(text.includes("### 小节 5"), false);
});

test("deliverable result evidence keeps renderable file changes and trimmed next actions", () => {
  const evidence = deliverableResultEvidence({
    ...deliverable("报告", "摘要", []),
    fileChanges: [
      { kind: "file_diff_preview", path: "src/app.ts", replacements: 2, preview: "- old\n+ new" },
      { kind: "generic_tool_summary", path: "ignored" },
    ],
    nextActions: [" 运行测试 ", "", "检查视觉细节 "],
  });

  assert.deepEqual(evidence, {
    fileChanges: [{ kind: "file_diff_preview", path: "src/app.ts", replacements: 2, preview: "- old\n+ new" }],
    nextActions: ["运行测试", "检查视觉细节"],
  });
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
