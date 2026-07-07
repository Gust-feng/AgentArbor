import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { BasicAgentRunExecutionResult } from "../basic-agent-runtime/index.js";
import { createPanelRuntime, resolveDefaultPanelSkillRoots, resolveDefaultPanelSubAgentRoots } from "./runtime.js";

test("panel runtime appends explicit additional skill roots without replacing default roots", () => {
  const runtime = createPanelRuntime({
    additionalSkillRoots: [
      { rootPath: path.join("C:", "managed", "skills"), sourceKind: "admin", sourceRootId: "admin", precedence: 1_000 },
      { rootPath: path.join("Z:", "plugin", "skills"), sourceKind: "plugin", sourceRootId: "plugin:repo-tools", precedence: 500 },
    ],
  }, noopHooks());

  assert.equal(runtime.skillRoots.length, 4);
  assert.deepEqual(runtime.skillRoots.slice(2), [
    { rootPath: path.join("C:", "managed", "skills"), sourceKind: "admin", sourceRootId: "admin", precedence: 1_000 },
    { rootPath: path.join("Z:", "plugin", "skills"), sourceKind: "plugin", sourceRootId: "plugin:repo-tools", precedence: 500 },
  ]);
});

test("default panel skill roots use the workspace directory for project scope", () => {
  const roots = resolveDefaultPanelSkillRoots({
    cwd: path.join("Z:", "process-cwd"),
    home: path.join("C:", "Users", "developer"),
    workspaceDirectory: path.join("Z:", "AgentArbor"),
  });

  assert.deepEqual(roots, [
    {
      rootPath: path.join("C:", "Users", "developer", ".agents", "skills"),
      sourceKind: "user",
      sourceRootId: "user",
      precedence: 10,
    },
    {
      rootPath: path.join("Z:", "AgentArbor", ".agents", "skills"),
      sourceKind: "project",
      sourceRootId: "project",
      precedence: 100,
    },
  ]);
});

test("default panel sub-agent roots use the workspace directory for project scope", () => {
  const roots = resolveDefaultPanelSubAgentRoots({
    cwd: path.join("Z:", "process-cwd"),
    home: path.join("C:", "Users", "developer"),
    builtinRoot: path.join("Z:", "AgentArbor", "src", "app", "sub-agents", "builtin"),
    workspaceDirectory: path.join("Z:", "AgentArbor"),
  });

  assert.deepEqual(roots, [
    {
      rootPath: path.join("Z:", "AgentArbor", "src", "app", "sub-agents", "builtin"),
      sourceKind: "builtin",
      sourceRootId: "builtin",
      precedence: 1,
    },
    {
      rootPath: path.join("C:", "Users", "developer", ".agents", "sub-agents"),
      sourceKind: "user",
      sourceRootId: "user",
      precedence: 10,
    },
    {
      rootPath: path.join("Z:", "AgentArbor", ".agents", "sub-agents"),
      sourceKind: "project",
      sourceRootId: "project",
      precedence: 100,
    },
  ]);
});

test("panel runtime discovers project sub-agents from the run workspace", async () => {
  const defaultWorkspace = mkdtempSync(path.join(tmpdir(), "agentarbor-sub-agent-default-"));
  const runWorkspace = mkdtempSync(path.join(tmpdir(), "agentarbor-sub-agent-run-"));
  await writeSubAgentPackage(defaultWorkspace, "default-helper", "Default helper.");
  await writeSubAgentPackage(runWorkspace, "run-helper", "Run helper.");
  const runtime = createPanelRuntime({}, noopHooks());
  await runtime.configCenter.updateWorkspaceConfig({ workspaceDirectory: defaultWorkspace });

  const defaultSubAgents = await runtime.capabilityCenter.listSubAgents();
  const runSnapshot = await runtime.capabilityCenter.snapshot({ workspaceDirectory: runWorkspace });

  assert.equal(defaultSubAgents.some((subAgent) => subAgent.name === "default-helper"), true);
  assert.equal(defaultSubAgents.some((subAgent) => subAgent.name === "run-helper"), false);
  assert.equal(runSnapshot.subAgentCatalog.some((subAgent) => subAgent.name === "run-helper"), true);
  assert.equal(runSnapshot.subAgentCatalog.some((subAgent) => subAgent.name === "default-helper"), false);
});

test("panel runtime skillRoots remains a full override for tests and custom hosts", () => {
  const runtime = createPanelRuntime({
    skillRoots: [{ rootPath: path.join("Z:", "custom", "skills"), sourceKind: "custom", sourceRootId: "custom", precedence: 1 }],
    additionalSkillRoots: [{ rootPath: path.join("Z:", "ignored", "skills"), sourceKind: "plugin", sourceRootId: "plugin:ignored", precedence: 500 }],
  }, noopHooks());

  assert.deepEqual(runtime.skillRoots, [
    { rootPath: path.join("Z:", "custom", "skills"), sourceKind: "custom", sourceRootId: "custom", precedence: 1 },
  ]);
});

test("panel runtime records process residue summaries when ordinary runs reach terminal status", async () => {
  const runtime = createPanelRuntime({}, {
    async executeRun(_runtime, _execution): Promise<BasicAgentRunExecutionResult> {
      return { completed: true };
    },
    async failRun(): Promise<void> {
      throw new Error("runtime residue test should not fail a run");
    },
    scheduleNextQueuedConversationRun(): void {
      return undefined;
    },
  });

  const run = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "complete with residue inspection",
    aiMode: "fake",
  });
  await waitUntil(() => runtime.runJobs.get(run.runId)?.status === "completed", 5_000);

  const summaries = runtime.processRegistry.listRunResidueSummaries(run.runId);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.kind, "process_run_residue_summary");
  assert.equal(summaries[0]?.runId, run.runId);
});

function noopHooks() {
  return {
    async executeRun(_runtime: unknown, _execution: unknown): Promise<BasicAgentRunExecutionResult> {
      return { completed: true };
    },
    async failRun(): Promise<void> {
      throw new Error("noop runtime should not fail a run");
    },
    scheduleNextQueuedConversationRun(): void {
      return undefined;
    },
  };
}

async function writeSubAgentPackage(workspace: string, name: string, description: string): Promise<void> {
  const packageDir = path.join(workspace, ".agents", "sub-agents", name);
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "SUB_AGENT.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "enabled: true",
      "---",
      "",
      description,
      "",
    ].join("\n"),
    "utf8"
  );
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
