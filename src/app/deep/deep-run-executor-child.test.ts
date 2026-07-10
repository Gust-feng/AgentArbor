import assert from "node:assert/strict";
import test from "node:test";
import type { FakeModelProviderResponse } from "../../adapters/intelligence/fake-model-provider-contracts.js";
import { resetIdsForTests } from "../../kernel/id.js";
import {
  makeStartInput,
  makeTurnRuntime,
  startDeepRun,
} from "./deep-run-executor-test-support.js";
test("continue_child 让父层审查后驱动同一个 child run 继续标准 loop，并替换旧材料", async () => {
  resetIdsForTests();
  const responses: FakeModelProviderResponse[] = [
    {
      output: {
        action: "spawn_children",
        childSpecs: [
          {
            specId: "child-spec-risk",
            displayName: "风险角度",
            role: "risk",
            objective: "从风险角度核查 OAuth2 迁移，初步识别缺口。",
            allowedTools: [],
            inputRefs: ["goal:goal-test-deep"],
          },
        ],
        decisionSummary: "先派生风险角度。",
        rationale: "需要 child 初步材料。",
        uncertainty: "缺少回滚证据。",
        confidence: 0.68,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "风险角度：初步材料完成，但缺少回滚证据。",
        findings: ["回调兼容性需要验证"],
        evidenceRefs: ["child:risk:initial"],
        uncertainty: "回滚路径证据缺失。",
        confidence: 0.42,
      },
    },
    {
      output: {
        action: "continue_child",
        childSpecs: [],
        childOperations: [
          {
            childRunId: "deep-child-run-0001",
            review: {
              decision: "needs_followup",
              reason: "风险 child 初轮材料缺少 OAuth2 回滚证据，父层要求同一个 child 继续补齐。",
              evidenceRefs: ["child:risk:initial"],
              confidence: 0.66,
            },
            instruction: "继续沿用风险角度，补齐 OAuth2 回滚路径证据后重新输出 child material JSON。",
          },
        ],
        decisionSummary: "父层审查认为同一个风险子任务需要继续补证据。",
        rationale: "旧材料不足，但不需要新建重复子任务。",
        uncertainty: "回滚证据仍缺失。",
        confidence: 0.7,
        reasoningRefs: [],
      },
    },
    {
      output: {
        summary: "风险角度：补齐回滚证据，确认保留旧认证入口可降低迁移风险。",
        findings: ["保留旧认证入口是关键回滚措施"],
        evidenceRefs: ["child:risk:rollback"],
        uncertainty: "仍需项目内验证入口数量。",
        confidence: 0.74,
      },
    },
    {
      output: {
        action: "synthesize",
        childSpecs: [],
        decisionSummary: "同一个风险 child 已补齐材料，可以综合。",
        rationale: "父层已审查并补齐缺口。",
        uncertainty: "仍需执行阶段验证。",
        confidence: 0.78,
        reasoningRefs: [],
      },
    },
    {
      output: {
        conclusion: "OAuth2 迁移可推进，但必须保留旧认证入口作为回滚路径。",
        oneLineRationale: "同一个风险子任务补齐后证明回滚措施可行。",
        keyEvidenceRefs: ["child:risk:rollback"],
        candidateDispositions: [
          { candidateId: "risk", label: "风险角度", selected: true, reason: "补齐后的风险材料可采纳。" },
        ],
        mainUncertainty: "入口数量仍需项目内验证。",
        confidence: 0.77,
      },
    },
  ];
  const config = makeTurnRuntime(responses);
  const input = makeStartInput("评估 OAuth2 迁移风险并补齐回滚证据", true);

  const result = await startDeepRun(input, config);

  assert.equal(result.stopReason, "synthesized");
  assert.equal(result.run.status, "completed");
  assert.deepEqual(result.decisions.map((decision) => decision.action), [
    "spawn_children",
    "continue_child",
    "synthesize",
  ]);
  assert.equal(result.steps[1].dispatchedAction, "continue_child");
  assert.deepEqual(result.steps[1].operatedChildRunIds, ["deep-child-run-0001"]);
  assert.equal(result.childSummaries.length, 1, "同一个 child 继续后应替换旧材料而不是追加重复材料");
  assert.equal(result.childSummaries[0]?.childRunId, "deep-child-run-0001");
  assert.deepEqual(result.childSummaries[0]?.evidenceRefs, ["child:risk:rollback"]);
  assert.equal(result.childRuns.length, 1);
  assert.equal(result.childRuns[0]?.childRunId, "deep-child-run-0001");
  assert.equal(result.childRuns[0]?.status, "completed");
  assert.equal(result.childRuns[0]?.evidenceRefs[0], "child:risk:rollback");
  assert.equal(result.childRuns[0]?.executionHistory?.length, 2);
  assert.deepEqual(
    result.childRuns[0]?.executionHistory?.map((segment) => segment.outcome),
    ["completed", "completed"],
  );
  assert.equal(result.childRuns[0]?.parentInstructions?.length, 1);
  assert.equal(result.childRuns[0]?.parentInstructions?.[0]?.source, "manager");
  assert.equal(result.childRuns[0]?.parentInstructions?.[0]?.status, "executed");
  assert.equal(result.childRuns[0]?.parentInstructions?.[0]?.messageRef?.startsWith("child_message:"), true);
  assert.equal(
    result.childRuns[0]?.parentInstructions?.[0]?.instructionSummary.includes("补齐"),
    true,
  );
  assert.deepEqual(result.childRuns[0]?.parentInstructions?.[0]?.review, {
    decision: "needs_followup",
    reason: "风险 child 初轮材料缺少 OAuth2 回滚证据，父层要求同一个 child 继续补齐。",
    evidenceRefs: ["child:risk:initial"],
    confidence: 0.66,
  });
  const snapshot = result.taskBoard?.snapshot();
  assert.ok(snapshot !== undefined);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0]?.status, "completed");
  assert.equal(snapshot.tasks[0]?.summary?.evidenceRefs[0], "child:risk:rollback");
});
