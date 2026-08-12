import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSubAgents } from "./sub-agent-loader.js";

test("Sub-Agent discovery reports and ignores legacy execution controls that the nested loop cannot honor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-sub-agent-loader-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const packagePath = path.join(root, "unsupported-controls");
  await fs.mkdir(packagePath, { recursive: true });
  await fs.writeFile(path.join(packagePath, "SUB_AGENT.md"), [
    "---",
    "name: unsupported-controls",
    "description: Declares controls that are not part of the executable contract.",
    "model: gpt-5",
    "maxSteps: 12",
    "---",
    "",
    "Inspect one bounded task.",
  ].join("\n"), "utf8");
  const hyphenatedPackagePath = path.join(root, "hyphenated-step-limit");
  await fs.mkdir(hyphenatedPackagePath, { recursive: true });
  await fs.writeFile(path.join(hyphenatedPackagePath, "SUB_AGENT.md"), [
    "---",
    "name: hyphenated-step-limit",
    "description: Uses the legacy hyphenated step-limit key.",
    "max-steps: 8",
    "---",
    "",
    "Inspect another bounded task.",
  ].join("\n"), "utf8");

  const definitions = await discoverSubAgents({ roots: [root] });
  const definition = definitions.find((candidate) => candidate.id === "unsupported-controls");
  const hyphenated = definitions.find((candidate) => candidate.id === "hyphenated-step-limit");

  assert.equal(definition?.enabled, true);
  assert.equal(definition?.validationErrors, undefined);
  assert.deepEqual(definition?.validationWarnings?.map((issue) => [issue.code, issue.path]), [
    ["ignored_model_override", "model"],
    ["ignored_step_limit", "maxSteps"],
  ]);
  assert.match(definition?.validationWarnings?.[0]?.message ?? "", /parent run's frozen model/u);
  assert.match(definition?.validationWarnings?.[1]?.message ?? "", /no defined step unit/u);
  assert.equal(hyphenated?.enabled, true);
  assert.deepEqual(hyphenated?.validationWarnings?.map((issue) => [issue.code, issue.path]), [
    ["ignored_step_limit", "max-steps"],
  ]);
});