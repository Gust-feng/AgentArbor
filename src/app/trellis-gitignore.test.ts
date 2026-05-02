import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

test("Trellis git ignore rules share specs/tasks/scripts while excluding runtime state", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(gitignore, /!\.trellis\/spec\/\*\*/);
  assert.match(gitignore, /!\.trellis\/tasks\/\*\*/);
  assert.match(gitignore, /!\.trellis\/scripts\/\*\*/);
  assert.match(gitignore, /\.trellis\/\.runtime\//);
  assert.match(gitignore, /\.trellis\/workspace\//);

  assert.equal(isIgnored(".trellis/spec/backend/index.md"), false);
  assert.equal(isIgnored(".trellis/tasks/05-02-underground-minimal-usable-loop/prd.md"), false);
  assert.equal(isIgnored(".trellis/scripts/task.py"), false);
  assert.equal(isIgnored(".trellis/workflow.md"), false);
  assert.equal(isIgnored(".trellis/config.yaml"), false);
  assert.equal(isIgnored(".trellis/.version"), false);
  assert.equal(isIgnored(".trellis/.gitignore"), false);
  assert.equal(isIgnored(".trellis/.runtime/session.json"), true);
  assert.equal(isIgnored(".trellis/workspace/xzf28/journal-1.md"), true);
  assert.equal(isIgnored(".trellis/.developer"), true);
  assert.equal(isIgnored(".trellis/.current-task"), true);
  assert.equal(isIgnored(".trellis/scripts/__pycache__/task.cpython-312.pyc"), true);
});

function isIgnored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", path], {
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
