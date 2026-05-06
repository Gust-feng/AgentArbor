import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceProjectionView, createWorkspaceView, InMemoryWorkspace, type WorkspaceSnapshot } from "./index.js";

type NestedWorkspaceSnapshot = WorkspaceSnapshot<{
  readonly nested: {
    value: string;
  };
}>;

test("WorkspaceView exposes defensive snapshots instead of writable shared state", () => {
  const workspace = new InMemoryWorkspace<NestedWorkspaceSnapshot>({
    traceId: "trace-workspace",
    goalId: "goal-workspace",
    goal: "protect workspace state",
    data: {
      nested: {
        value: "original",
      },
    },
  });

  const firstSnapshot = workspace.snapshot();
  firstSnapshot.data.nested.value = "mutated outside";

  assert.equal(workspace.snapshot().data.nested.value, "original");
});

test("createWorkspaceView only exposes the read-only snapshot surface", () => {
  const view = createWorkspaceView<NestedWorkspaceSnapshot>({
    traceId: "trace-readonly-workspace",
    data: {
      nested: {
        value: "visible",
      },
    },
  });

  assert.equal(typeof view.snapshot, "function");
  assert.equal("patch" in view, false);
  assert.equal("replace" in view, false);
});

test("workspace projection view returns defensive snapshots", () => {
  const view = createWorkspaceProjectionView({
    goalId: "goal-projection",
    nested: {
      value: "original",
    },
  });

  const firstSnapshot = view.snapshot();
  firstSnapshot.nested.value = "mutated outside";

  assert.equal(view.snapshot().nested.value, "original");
  assert.equal("patch" in view, false);
  assert.equal("replace" in view, false);
});
