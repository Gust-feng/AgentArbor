import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

test("Trellis git ignore rules keep local workflow state out of the source baseline", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(gitignore, /^\.trellis\/$/m);
  assert.doesNotMatch(gitignore, /!\.trellis\/tasks\/\*\*/);

  assert.equal(isIgnored(".trellis/spec/backend/index.md"), true);
  assert.equal(isIgnored(".trellis/tasks/05-02-underground-minimal-usable-loop/prd.md"), true);
  assert.equal(isIgnored(".trellis/scripts/task.py"), true);
  assert.equal(isIgnored(".trellis/workflow.md"), true);
  assert.equal(isIgnored(".trellis/config.yaml"), true);
  assert.equal(isIgnored(".trellis/.version"), true);
  assert.equal(isIgnored(".trellis/.gitignore"), true);
  assert.equal(isIgnored(".trellis/.runtime/session.json"), true);
  assert.equal(isIgnored(".trellis/workspace/xzf28/journal-1.md"), true);
  assert.equal(isIgnored(".trellis/.developer"), true);
  assert.equal(isIgnored(".trellis/.current-task"), true);
  assert.equal(isIgnored(".trellis/scripts/__pycache__/task.cpython-312.pyc"), true);
});

function isIgnored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--no-index", path], {
    cwd: process.cwd(),
  });

  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }

  throw new Error(`git check-ignore failed for ${path}: ${result.stderr.toString("utf8")}`);
}
