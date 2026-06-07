import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunReadModelPatch,
  type RunProjectionNode,
  type RunProjectionWorkView,
} from "./panel-ui-run-projection.js";

test("createRunReadModelPatch merges the targeted run transcript into cache", () => {
  const incoming = workView("run-2", [node("run-2:thinking", "run-2", 1, "新思考")]);
  const patch = createRunReadModelPatch<TestWorkView, TestDetail, TestNode>({
    workView: workView("run-1", [node("run-1:thinking", "run-1", 1, "旧思考")]),
    transcriptNodesByRunId: {
      "run-1": [node("run-1:thinking", "run-1", 1, "旧思考")],
    },
  }, {
    runId: "run-2",
    workView: incoming,
    detail: undefined,
  });

  assert.equal(patch.workView, incoming);
  assert.deepEqual(patch.transcriptNodes.map((item) => item.text), ["新思考"]);
  assert.deepEqual(patch.transcriptNodesByRunId["run-1"]?.map((item) => item.text), ["旧思考"]);
  assert.deepEqual(patch.transcriptNodesByRunId["run-2"]?.map((item) => item.text), ["新思考"]);
});

test("createRunReadModelPatch ignores previous work view from another run", () => {
  const detail = runDetail("run-2", [node("run-2:answer", "run-2", 2, "详情回答")]);
  const patch = createRunReadModelPatch<TestWorkView, TestDetail, TestNode>({
    workView: workView("run-1", [node("run-1:thinking", "run-1", 1, "旧思考")]),
    transcriptNodesByRunId: {},
  }, {
    runId: "run-2",
    workView: undefined,
    detail,
  });

  assert.equal(patch.workView, undefined);
  assert.equal(patch.detail, detail);
  assert.deepEqual(patch.transcriptNodes.map((item) => item.text), ["详情回答"]);
  assert.deepEqual(patch.transcriptNodesByRunId["run-2"]?.map((item) => item.text), ["详情回答"]);
});

test("createRunReadModelPatch can drop stale work view after mutating a run", () => {
  const stale = workView("run-1", [node("run-1:confirmation", "run-1", 1, "旧确认")]);
  const detail = runDetail("run-1", [node("run-1:resumed", "run-1", 2, "继续执行")]);
  const patch = createRunReadModelPatch<TestWorkView, TestDetail, TestNode>({
    workView: stale,
    transcriptNodesByRunId: {
      "run-1": stale.transcriptNodes ?? [],
    },
  }, {
    runId: "run-1",
    workView: undefined,
    detail,
    reusePreviousWorkView: false,
  });

  assert.equal(patch.workView, undefined);
  assert.deepEqual(patch.transcriptNodes.map((item) => item.text), ["继续执行"]);
  assert.deepEqual(patch.transcriptNodesByRunId["run-1"]?.map((item) => item.text), ["继续执行"]);
});

type TestWorkView = RunProjectionWorkView<TestNode>;

type TestDetail = {
  readonly runId: string;
  readonly transcript: {
    readonly transcriptNodes: readonly TestNode[];
  };
};

type TestNode = RunProjectionNode & {
  readonly text: string;
};

function workView(runId: string, transcriptNodes: readonly TestNode[]): TestWorkView {
  return {
    run: { runId },
    transcriptNodes,
  };
}

function runDetail(runId: string, transcriptNodes: readonly TestNode[]): TestDetail {
  return {
    runId,
    transcript: { transcriptNodes },
  };
}

function node(nodeId: string, runId: string, sequence: number, text: string): TestNode {
  return { nodeId, runId, sequence, text };
}
