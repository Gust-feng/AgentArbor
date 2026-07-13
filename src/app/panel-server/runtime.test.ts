import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type {
  BasicAgentRunExecutionInput,
  BasicAgentRunExecutionResult,
} from "../basic-agent-runtime/index.js";
import { createMinimalRuntime } from "../runtime.js";
import { createPanelRuntime, resolveDefaultPanelSkillRoots, resolveDefaultPanelSubAgentRoots } from "./runtime.js";

test("panel runtime appends explicit additional skill roots without replacing default roots", async (t) => {
  const runtime = await createTestPanelRuntime(t, {
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

test("panel runtime discovers project sub-agents from the run workspace", async (t) => {
  const defaultWorkspace = await mkdtemp(path.join(tmpdir(), "agentarbor-sub-agent-default-"));
  const runWorkspace = await mkdtemp(path.join(tmpdir(), "agentarbor-sub-agent-run-"));
  t.after(async () => {
    await Promise.all([
      removeTestDirectory(defaultWorkspace),
      removeTestDirectory(runWorkspace),
    ]);
  });
  await writeSubAgentPackage(defaultWorkspace, "default-helper", "Default helper.");
  await writeSubAgentPackage(runWorkspace, "run-helper", "Run helper.");
  const runtime = await createTestPanelRuntime(t, {}, noopHooks());
  await runtime.configCenter.updateWorkspaceConfig({ workspaceDirectory: defaultWorkspace });

  const defaultSubAgents = await runtime.capabilityCenter.listSubAgents();
  const runSnapshot = await runtime.capabilityCenter.snapshot({ workspaceDirectory: runWorkspace });

  assert.equal(defaultSubAgents.some((subAgent) => subAgent.name === "default-helper"), true);
  assert.equal(defaultSubAgents.some((subAgent) => subAgent.name === "run-helper"), false);
  assert.equal(runSnapshot.subAgentCatalog.some((subAgent) => subAgent.name === "run-helper"), true);
  assert.equal(runSnapshot.subAgentCatalog.some((subAgent) => subAgent.name === "default-helper"), false);
});

test("panel runtime skillRoots remains a full override for tests and custom hosts", async (t) => {
  const runtime = await createTestPanelRuntime(t, {
    skillRoots: [{ rootPath: path.join("Z:", "custom", "skills"), sourceKind: "custom", sourceRootId: "custom", precedence: 1 }],
    additionalSkillRoots: [{ rootPath: path.join("Z:", "ignored", "skills"), sourceKind: "plugin", sourceRootId: "plugin:ignored", precedence: 500 }],
  }, noopHooks());

  assert.deepEqual(runtime.skillRoots, [
    { rootPath: path.join("Z:", "custom", "skills"), sourceKind: "custom", sourceRootId: "custom", precedence: 1 },
  ]);
});

test("panel runtime records process residue summaries when ordinary runs reach terminal status", async (t) => {
  const runtime = await createTestPanelRuntime(t, {}, {
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

test("panel runtime keeps Ordinary-owned retained tool outputs after terminal for conversation continuation", async (t) => {
  const traceId = "trace-tool-output-owner";
  let retainedRef: string | undefined;
  const runtime = await createTestPanelRuntime(t, {}, {
    async executeRun(panelRuntime, execution): Promise<BasicAgentRunExecutionResult> {
      execution.onRuntimeReady({
        runtime: createMinimalRuntime(),
        traceId,
        goalId: "goal-tool-output-owner",
      });
      const retained = await panelRuntime.toolOutputStore.retain({
        mediaType: "text/plain",
        content: "ordinary-owned-output",
        sourceToolName: "ordinary_fixture",
        sourceCallId: "ordinary-fixture-call",
        ownerId: traceId,
      });
      retainedRef = retained.ref;
      return { completed: true };
    },
    async failRun(): Promise<void> {
      throw new Error("tool output owner cleanup test should not fail a run");
    },
    scheduleNextQueuedConversationRun(): void {
      return undefined;
    },
  });

  await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "retain tool output for a later conversation turn",
    aiMode: "fake",
  });
  await Promise.allSettled([...runtime.activeRunJobs]);

  assert.equal(typeof retainedRef, "string");
  assert.equal(
    (await runtime.toolOutputStore.read(retainedRef!, { startChar: 0, maxChars: 30_000 }))?.content,
    "ordinary-owned-output",
  );
});

test("panel runtime projects published runtime facts once before read paths observe them", async (t) => {
  const runtime = await createTestPanelRuntime(t, {}, {
    async executeRun(_runtime, execution: BasicAgentRunExecutionInput): Promise<BasicAgentRunExecutionResult> {
      const sourceRuntime = createMinimalRuntime();
      execution.onRuntimeReady({
        runtime: sourceRuntime,
        traceId: "trace-write-side-projection",
        goalId: "goal-write-side-projection",
      });
      sourceRuntime.bus.publish({
        id: "message-write-side-tool",
        traceId: "trace-write-side-projection",
        from: { id: "desktop-agent", role: "desktop_agent" },
        to: { group: "underground-center" },
        type: "tool.requested",
        intent: "request_tool",
        payload: {
          callId: "tool-call-write-side",
          toolName: "read_file",
          input: { path: "README.md" },
        },
        createdAt: "2026-06-16T00:00:01.000Z",
      });
      return { completed: true };
    },
    async failRun(): Promise<void> {
      throw new Error("write-side projection test should not fail a run");
    },
    scheduleNextQueuedConversationRun(): void {
      return undefined;
    },
  });

  const run = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "project events on publication",
    aiMode: "fake",
  });
  await waitUntil(() => runtime.runJobs.get(run.runId)?.status === "completed", 5_000);

  const job = runtime.runJobs.get(run.runId);
  const replay = runtime.runExecutor.replayEvents(run.runId, 0);
  assert.deepEqual(job?.streamEvents.map((event) => event.type), ["run.started", "tool.requested"]);
  assert.deepEqual(replay?.events.map((event) => event.type), ["run.started", "tool.requested"]);
  assert.equal(new Set(job?.streamEvents.map((event) => event.eventId)).size, 2);
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

async function createTestPanelRuntime(
  t: TestContext,
  options: Parameters<typeof createPanelRuntime>[0],
  hooks: Parameters<typeof createPanelRuntime>[1],
) {
  const configDirectory = await mkdtemp(path.join(tmpdir(), "agentarbor-panel-runtime-"));
  const runtime = createPanelRuntime({ ...options, configDirectory }, hooks);
  t.after(async () => {
    const multiAgentDisposal = runtime.multiAgentFeature.dispose();
    runtime.runExecutor.quiesce();
    while (runtime.activeRunJobs.size > 0) {
      for (const controller of runtime.abortControllers.values()) {
        controller.abort();
      }
      await Promise.allSettled([...runtime.activeRunJobs]);
    }
    await multiAgentDisposal;
    await runtime.runExecutor.dispose();
    await runtime.toolOutputStore.clear();
    await Promise.allSettled([...runtime.persistenceChains.values()]);
    await removeTestDirectory(configDirectory);
  });
  return runtime;
}

function removeTestDirectory(directory: string): Promise<void> {
  return rm(directory, {
    force: true,
    recursive: true,
    maxRetries: 10,
    retryDelay: 100,
  });
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
