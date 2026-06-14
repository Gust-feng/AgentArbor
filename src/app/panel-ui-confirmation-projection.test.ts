import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmationForNode,
  type ConfirmationIdentity,
  pendingForTurn,
  timelineConfirmationProjection,
} from "./panel-transcript-confirmation-projection.js";
import { projectConfirmationDisplay } from "./panel-confirmation-display-projection.js";

type TestConfirmation = ConfirmationIdentity & {
  readonly runId: string;
  readonly actionSummary: string;
};

type TestConfirmationNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly confirmation?: TestConfirmation;
};

test("timeline confirmation projection matches pending approvals by confirmation id, not run id", () => {
  const pending = confirmation("confirmation-current", "run-1", "当前删除文件");
  const projection = timelineConfirmationProjection([
    confirmationNode("old-node", 1, confirmation("confirmation-old", "run-1", "旧确认")),
    confirmationNode("other-node", 2, confirmation("confirmation-other", "run-1", "另一个确认")),
  ], pending);

  assert.equal(projection.currentNodeId, undefined);
  assert.equal(projection.current?.confirmationId, "confirmation-current");
  assert.equal(projection.current?.actionSummary, "当前删除文件");
});

test("timeline confirmation projection replaces the matching node with the live pending confirmation", () => {
  const pending = confirmation("confirmation-current", "run-1", "最新动作说明");
  const projection = timelineConfirmationProjection([
    confirmationNode("match-node", 1, confirmation("confirmation-current", "run-1", "旧动作说明")),
  ], pending);

  assert.equal(projection.currentNodeId, "match-node");
  assert.equal(projection.current?.confirmationId, "confirmation-current");
  assert.equal(projection.current?.actionSummary, "最新动作说明");
});

test("confirmation projection keeps historical node details when pending id differs", () => {
  const node = confirmationNode("history-node", 1, confirmation("confirmation-history", "run-1", "历史动作"));
  const projected = confirmationForNode(node, confirmation("confirmation-current", "run-1", "当前动作"));

  assert.equal(projected?.confirmationId, "confirmation-history");
  assert.equal(projected?.actionSummary, "历史动作");
});

test("pending confirmation projection stays scoped to the owning turn", () => {
  const pending = confirmation("confirmation-current", "run-1", "当前动作");

  assert.equal(pendingForTurn(pending, "run-1")?.confirmationId, "confirmation-current");
  assert.equal(pendingForTurn(pending, "run-2"), undefined);
  assert.equal(pendingForTurn(pending, undefined), undefined);
});

test("confirmation display projection keeps only concrete action copy", () => {
  const view = projectConfirmationDisplay({
    title: "需要你判断",
    actionSummary: "运行命令：pnpm test",
    riskLevel: "high",
  });

  assert.equal(view.title, "运行命令：pnpm test");
  assert.equal(view.actionPreview, "pnpm test");
  assert.equal(view.showActionPreview, true);
  assert.equal(view.riskLevel, "high");
});

test("confirmation display projection keeps shell command preview concrete without duplicating the title", () => {
  const view = projectConfirmationDisplay({
    title: "Shell 命令",
    actionSummary: "Shell 命令：python -c print('ok')",
    riskLevel: "medium",
  });

  assert.equal(view.title, "Shell 命令");
  assert.equal(view.actionPreview, "python -c print('ok')");
  assert.equal(view.showActionPreview, true);
});

test("confirmation display projection filters internal resources and resume loss", () => {
  const view = projectConfirmationDisplay({
    title: "删除文件",
    actionSummary: "删除文件：old.txt",
    affectedResources: [
      "old.txt",
      "new.txt",
      "README.md",
      "package.json",
      "src/app/index.ts",
      "docs/guide.md",
      "hidden-by-limit.txt",
      "tool:call-delete",
      "model_call:model-1",
      "call_delete_123456789",
    ],
    riskLevel: "unknown",
    resumeAvailability: "lost_after_restart",
  });

  assert.deepEqual(view.resources, [
    "old.txt",
    "new.txt",
    "README.md",
    "package.json",
    "src/app/index.ts",
    "docs/guide.md",
  ]);
  assert.equal(view.riskLevel, "medium");
  assert.equal(view.resumeLost, true);
  assert.equal(view.resumeLostSummary, "这次操作无法原地继续。发送新消息即可基于当前上下文继续。");
});

function confirmation(
  confirmationId: string,
  runId: string,
  actionSummary: string
): TestConfirmation {
  return {
    confirmationId,
    runId,
    actionSummary,
  };
}

function confirmationNode(
  nodeId: string,
  sequence: number,
  confirmation: TestConfirmation
): TestConfirmationNode {
  return {
    nodeId,
    runId: confirmation.runId,
    sequence,
    kind: "confirmation",
    confirmation,
  };
}
