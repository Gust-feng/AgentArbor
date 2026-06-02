import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunReadModelPatch,
  type RunProjectionNode,
  type RunProjectionWorkSession,
} from "./panel-ui-run-projection.js";

test("createRunReadModelPatch merges the targeted run transcript into cache", () => {
  const incoming = workSession("run-2", [node("run-2:thinking", "run-2", 1, "新思考")]);
  const patch = createRunReadModelPatch<TestWorkSession, TestDetail, TestNode>({
    workSession: workSession("run-1", [node("run-1:thinking", "run-1", 1, "旧思考")]),
    transcriptNodesByRunId: {
      "run-1": [node("run-1:thinking", "run-1", 1, "旧思考")],
    },
  }, {
    runId: "run-2",
    workSession: incoming,
    detail: undefined,
  });

  assert.equal(patch.workSession, incoming);
  assert.deepEqual(patch.transcriptNodes.map((item) => item.text), ["新思考"]);
  assert.deepEqual(patch.transcriptNodesByRunId["run-1"]?.map((item) => item.text), ["旧思考"]);
  assert.deepEqual(patch.transcriptNodesByRunId["run-2"]?.map((item) => item.text), ["新思考"]);
});

test("createRunReadModelPatch ignores previous work session from another run", () => {
  const detail = runDetail("run-2", [node("run-2:answer", "run-2", 2, "详情回答")]);
  const patch = createRunReadModelPatch<TestWorkSession, TestDetail, TestNode>({
    workSession: workSession("run-1", [node("run-1:thinking", "run-1", 1, "旧思考")]),
    transcriptNodesByRunId: {},
  }, {
    runId: "run-2",
    workSession: undefined,
    detail,
  });

  assert.equal(patch.workSession, undefined);
  assert.equal(patch.detail, detail);
  assert.deepEqual(patch.transcriptNodes.map((item) => item.text), ["详情回答"]);
  assert.deepEqual(patch.transcriptNodesByRunId["run-2"]?.map((item) => item.text), ["详情回答"]);
});

type TestWorkSession = RunProjectionWorkSession<TestNode>;

type TestDetail = {
  readonly runId: string;
  readonly transcript: {
    readonly transcriptNodes: readonly TestNode[];
  };
};

type TestNode = RunProjectionNode & {
  readonly text: string;
};

function workSession(runId: string, transcriptNodes: readonly TestNode[]): TestWorkSession {
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
