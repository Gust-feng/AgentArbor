import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { OrdinaryExecutionOutcome, OrdinaryExecutionPort } from "../ordinary-agent/contracts.js";
import { ordinaryAgentSessionRef, ordinaryRunBirth, ordinaryRunTurn } from "../ordinary-agent/test-support.js";
import { createPanelRuntime } from "./runtime.js";

test("Panel composition exposes catalog-only Sub-Agent definitions to Ordinary capability discovery", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-capability-root-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    const subAgentRoot = path.join(directory, "sub-agents");
    await writeSubAgentPackage(subAgentRoot);
    runtime = createPanelRuntime({
      configDirectory: directory,
      subAgentRoots: [{
        rootPath: subAgentRoot,
        sourceKind: "project",
        sourceRootId: "project",
        precedence: 100,
      }],
    });

    const ordinarySnapshot = await runtime.capabilityCenter.snapshot();
    assert.equal(ordinarySnapshot.toolCatalog.tools.find((tool) => tool.name === "Agent")?.catalogOnly, true);
    assert.equal(ordinarySnapshot.toolCatalog.tools.find((tool) => tool.name === "AgentSpawn")?.catalogOnly, true);

  } finally {
    await runtime?.ordinaryAgentFeature.release();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("Panel capability snapshots freeze NoteWrite so the model can actually use agent notes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-agent-notes-catalog-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory });
    const snapshot = await runtime.capabilityCenter.snapshot();
    const noteWrite = snapshot.toolCatalog.tools.find((tool) => tool.name === "NoteWrite");

    assert.notEqual(noteWrite, undefined);
    assert.equal(noteWrite?.scopes.includes("desktop-basic"), true);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("NoteWrite"), true);
  } finally {
    await runtime?.ordinaryAgentFeature.release();
    await runtime?.ordinaryPathMemoryConnector.release();
    await runtime?.pathMemoryFeature.release();
    await runtime?.releaseAgentSessionStorage();
    if (runtime !== undefined && runtime.toolOutputStore.close !== undefined) await runtime.toolOutputStore.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Panel capability snapshots freeze Space tools so an Ordinary Agent can organize references", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-catalog-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory });
    const snapshot = await runtime.capabilityCenter.snapshot();
    for (const name of ["SpaceList", "SpaceCreate", "SpaceCreateFolder", "SpaceMove", "SpaceAddReference", "SpaceRemoveReference", "SpaceRename"]) {
      assert.equal(snapshot.toolCatalog.allowedTools.includes(name), true, `${name} must be frozen for the run`);
    }
  } finally {
    await runtime?.ordinaryAgentFeature.release();
    await runtime?.ordinaryPathMemoryConnector.release();
    await runtime?.pathMemoryFeature.release();
    await runtime?.spaceFeature.release();
    await runtime?.releaseAgentSessionStorage();
    if (runtime !== undefined && runtime.toolOutputStore.close !== undefined) await runtime.toolOutputStore.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Panel composition wires Ordinary terminal runs into durable PathMemory records", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-wiring-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({
      configDirectory: directory,
      ordinaryAgentExecution: completedExecution("memory answer"),
    });
    const sessionRef = ordinaryAgentSessionRef();
    await runtime.ordinaryAgentFeature.commands.start({
      runId: "wired-run",
      sessionRef,
      turn: ordinaryRunTurn("wired-run"),
      input: { userMessage: "记录这次运行" },
      birth: ordinaryRunBirth(),
    });
    const deadline = Date.now() + 5_000;
    while ((await runtime.ordinaryAgentFeature.queries.getRun("wired-run"))?.status.kind !== "completed" &&
        Date.now() < deadline) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await runtime.ordinaryPathMemoryConnector.ready();
    // The realtime capture may still settle after ready when the terminal
    // notification arrives late; poll the durable record instead of sleeping.
    let memory = await runtime.pathMemoryFeature.queries.findBySource({ feature: "ordinary", runId: "wired-run" });
    const memoryDeadline = Date.now() + 5_000;
    while (memory === undefined && Date.now() < memoryDeadline) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      memory = await runtime.pathMemoryFeature.queries.findBySource({ feature: "ordinary", runId: "wired-run" });
    }
    assert.notEqual(memory, undefined);
    assert.equal(memory?.goal.userRequest, "记录这次运行");
    assert.equal(memory?.outcome.terminalStatus, "completed");
    assert.equal(memory?.verification.status, "not_recorded");

    const files = await fs.readdir(path.join(directory, "runtime", "path-memory", "records"));
    assert.equal(files.filter((name) => name.endsWith(".json")).length, 1);
  } finally {
    await runtime?.ordinaryAgentFeature.release();
    await runtime?.ordinaryPathMemoryConnector.release();
    await runtime?.pathMemoryFeature.release();
    await runtime?.releaseAgentSessionStorage();
    if (runtime !== undefined && runtime.toolOutputStore.close !== undefined) await runtime.toolOutputStore.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("Panel composition freezes agent-written notes into the next Ordinary run instructions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-agent-notes-runtime-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory });
    const workspace = path.join(directory, "project");
    await runtime.agentNotesFeature.commands.write({ kind: "global" }, "- Reply in Chinese.");
    await runtime.agentNotesFeature.commands.write(
      { kind: "workspace", workspaceRoot: workspace },
      "- Build this project with pnpm build.",
    );

    const birth = await runtime.prepareOrdinaryRunBirth({ goal: "check notes", workspaceDirectory: workspace });

    assert.match(birth.instructions, /<agent_notes>/u);
    assert.match(birth.instructions, /Reply in Chinese/u);
    assert.match(birth.instructions, /Build this project with pnpm build/u);
    assert.match(birth.agentDefinitionRef.promptRef, /agent-notes/u);
    assert.match(birth.agentDefinitionRef.promptVersion, /notes-/u);

    // Notes are scoped: a different workspace sees only the global notebook.
    const otherBirth = await runtime.prepareOrdinaryRunBirth({
      goal: "check other notes",
      workspaceDirectory: path.join(directory, "other-project"),
    });
    assert.match(otherBirth.instructions, /Reply in Chinese/u);
    assert.doesNotMatch(otherBirth.instructions, /pnpm build/u);
  } finally {
    await runtime?.ordinaryAgentFeature.release();
    await runtime?.ordinaryPathMemoryConnector.release();
    await runtime?.pathMemoryFeature.release();
    await runtime?.releaseAgentSessionStorage();
    if (runtime !== undefined && runtime.toolOutputStore.close !== undefined) await runtime.toolOutputStore.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function completedExecution(answer: string): OrdinaryExecutionPort {
  return {
    async execute(input) {
      await input.onSessionWriteCheckpoint?.({
        kind: "start_leaf_captured",
        sessionId: input.sessionRef.sessionId,
        startLeafRef: null,
      });
      const inputEntryRef = { sessionId: input.sessionRef.sessionId, entryId: `${input.runId}-input` };
      await input.onSessionWriteCheckpoint?.({
        kind: "input_entry_committed",
        sessionId: input.sessionRef.sessionId,
        inputEntryRef,
      });
      const assistantEntryRef = { sessionId: input.sessionRef.sessionId, entryId: `${input.runId}-assistant` };
      await input.onSessionWriteCheckpoint?.({
        kind: "assistant_response_entry_committed",
        sessionId: input.sessionRef.sessionId,
        assistantEntryRef,
      });
      const outcome: OrdinaryExecutionOutcome = {
        status: "completed",
        answer,
        session: {
          sessionId: input.sessionRef.sessionId,
          startLeafRef: null,
          inputEntryRef,
          safeLeafRef: assistantEntryRef,
          latestLeafRef: assistantEntryRef,
          compactionEntryRefs: [],
        },
        toolCalls: [],
        usage: {},
      };
      return outcome;
    },
  };
}

async function writeSubAgentPackage(root: string): Promise<void> {
  const packageDirectory = path.join(root, "reviewer");
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(packageDirectory, "SUB_AGENT.md"),
    [
      "---",
      "name: reviewer",
      "description: Review a bounded task.",
      "enabled: true",
      "allowedTools: [read]",
      "---",
      "",
      "Review the supplied task.",
    ].join("\n"),
    "utf8",
  );
}
