import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmationForNode,
  type ConfirmationIdentity,
  pendingForTurn,
  timelineConfirmationProjection,
} from "./panel-transcript-confirmation-projection.js";

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
