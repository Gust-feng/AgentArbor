import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFolderSummaryFromPath } from "./workspace-folder-summary.js";

test("configured fallback workspace keeps its standard presentation instead of exposing its folder name", () => {
  assert.deepEqual(
    workspaceFolderSummaryFromPath("C:/Users/example/.agentarbor/workspace", "default"),
    {
      label: "默认工作区",
      path: "C:/Users/example/.agentarbor/workspace",
      selection: "default",
    },
  );
});

test("explicit workspace selection remains identifiable by its folder name", () => {
  assert.deepEqual(
    workspaceFolderSummaryFromPath("Z:/projects/agent-arbor", "explicit"),
    {
      label: "agent-arbor",
      path: "Z:/projects/agent-arbor",
      selection: "explicit",
    },
  );
});
