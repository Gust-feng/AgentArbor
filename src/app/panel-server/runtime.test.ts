import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { FileSystemAgentSessionRepository } from "../../adapters/intelligence/file-system-agent-session-repository.js";
import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { OrdinaryExecutionOutcome, OrdinaryExecutionPort } from "../ordinary-agent/contracts.js";
import { ordinaryAgentSessionRef, ordinaryRunBirth, ordinaryRunTurn } from "../ordinary-agent/test-support.js";
import {
  createFileSystemSpaceReferenceDeletionJournal,
  type SpaceReferenceDeletionJournalRecord,
} from "../spaces/file-system-reference-deletion-journal.js";
import { releasePanelRuntimeResources } from "./request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "./runtime.js";
import { spaceReferenceAttachmentId } from "../spaces/space-file-access.js";
import {
  type AgentNoteScope,
  agentNoteContentVersion,
} from "../agent-notes/index.js";

test("Panel composition closes failed Workbench storage before Space recovery starts", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workbench-startup-failure-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const sourcePath = path.join(directory, "source.md");
  await fs.writeFile(sourcePath, "staged content", "utf8");

  const first = createPanelRuntime({
    configDirectory: directory,
    testOnlySkipInitialWorkbenchData: true,
  });
  const space = await first.spaceFeature.commands.createSpace({ title: "Startup recovery" });
  const reference = await first.spaceFeature.commands.addReference({
    spaceId: space.id,
    title: "source.md",
    reference: { kind: "local_file", path: sourcePath },
  });
  await releasePanelRuntimeResources(first);

  const runtimeHome = path.join(directory, "runtime");
  const databasePath = path.join(runtimeHome, "workbench.sqlite3");
  const setupDatabase = new SqliteRuntimeDatabase(databasePath);
  setupDatabase.connection.prepare("DELETE FROM schema_migrations WHERE owner = ?").run("personal-knowledge");
  setupDatabase.close();

  const deletionId = "startup-migration-failure";
  const stagedPath = path.join(
    path.dirname(sourcePath),
    `.${path.basename(sourcePath)}.agentarbor-delete-${deletionId}-0`,
  );
  await fs.rename(sourcePath, stagedPath);
  const journal = createFileSystemSpaceReferenceDeletionJournal(
    path.join(runtimeHome, "space-reference-deletions"),
  );
  const record: SpaceReferenceDeletionJournalRecord = {
    schemaVersion: "space-reference-deletion/v1",
    deletionId,
    phase: "files_staged",
    rootReferenceId: reference.id,
    removedReferences: [reference],
    ownedAssetIds: [],
    targets: [{
      referenceId: reference.id,
      kind: "local_file",
      sourcePath: path.resolve(sourcePath),
      stagedPath,
    }],
    createdAt: reference.createdAt,
  };
  await journal.save(record);

  const originalClose = SqliteRuntimeDatabase.prototype.close;
  let closeCalls = 0;
  t.mock.method(SqliteRuntimeDatabase.prototype, "close", function (this: SqliteRuntimeDatabase) {
    closeCalls += 1;
    return originalClose.call(this);
  });

  assert.throws(
    () => createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true }),
    (error: unknown) => error instanceof Error && /personal_notes/u.test(error.message),
  );
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  assert.equal(closeCalls, 1);
  await assert.rejects(fs.access(sourcePath), { code: "ENOENT" });
  assert.equal(await fs.readFile(stagedPath, "utf8"), "staged content");
  assert.deepEqual(await journal.list(), [record]);
});

test("Panel composition exposes catalog-only Sub-Agent definitions to Ordinary capability discovery", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-capability-root-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    const subAgentRoot = path.join(directory, "sub-agents");
    await writeSubAgentPackage(subAgentRoot);
    runtime = createPanelRuntime({
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
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
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel capability snapshots freeze NoteWrite so the model can actually use agent notes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-agent-notes-catalog-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const snapshot = await runtime.capabilityCenter.snapshot();
    const noteWrite = snapshot.toolCatalog.tools.find((tool) => tool.name === "NoteWrite");

    assert.notEqual(noteWrite, undefined);
    assert.equal(noteWrite?.scopes.includes("desktop-basic"), true);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("NoteWrite"), true);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel capability snapshots freeze Space tools so an Ordinary Agent can organize references", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-catalog-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const snapshot = await runtime.capabilityCenter.snapshot();
    for (const name of ["SpaceList", "SpaceCreate", "SpaceDelete", "SpaceMove", "SpaceAddReference", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename"]) {
      assert.equal(snapshot.toolCatalog.allowedTools.includes(name), true, `${name} must be frozen for the run`);
    }
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel capability snapshots freeze Personal Knowledge tools for Ordinary runs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-personal-knowledge-catalog-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const snapshot = await runtime.capabilityCenter.snapshot();
    for (const name of ["KnowledgeSearch", "KnowledgeRead", "KnowledgeCreateNote", "KnowledgeUpdateNote", "KnowledgeCollect"]) {
      assert.equal(snapshot.toolCatalog.allowedTools.includes(name), true, `${name} must be frozen for the run`);
    }
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel composition wires Ordinary terminal runs into durable PathMemory records", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-wiring-"));
  const sessionEnvironment = new NodeExecutionEnv({ cwd: directory });
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    const sessionRepository = new FileSystemAgentSessionRepository({
      fileSystem: sessionEnvironment,
      sessionsRoot: path.join(directory, "runtime", "ordinary-agent", "agent-sessions"),
    });
    const sessionRef = await sessionRepository.create({ sessionId: "wired-session", sessionCwd: directory });
    runtime = createPanelRuntime({
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
      ordinaryAgentExecution: completedExecution("memory answer", sessionRepository),
    });
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
    if (runtime !== undefined) await releasePanelRuntimeResources(runtime);
    await sessionEnvironment.cleanup();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Panel composition removes a frozen Space file link after a failed Agent run deleted its source", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-file-terminal-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    const source = path.join(directory, "linked.md");
    await fs.writeFile(source, "delete me", "utf8");
    runtime = createPanelRuntime({
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
      ordinaryAgentExecution: {
        async execute(input) {
          await fs.rm(source);
          return {
            status: "failed",
            error: { code: "provider_failed", message: `run ${input.runId} failed after deleting the file` },
            toolCalls: [],
            usage: {},
          };
        },
      },
    });
    const space = await runtime.spaceFeature.commands.createSpace({ title: "资料" });
    const reference = await runtime.spaceFeature.commands.addReference({
      spaceId: space.id,
      title: "linked.md",
      reference: { kind: "local_file", path: source },
    });
    const cursor = runtime.workbenchProjectionChanges.replay().cursor;

    await runtime.ordinaryAgentFeature.commands.start({
      runId: "delete-space-file-run",
      sessionRef: ordinaryAgentSessionRef(),
      turn: ordinaryRunTurn("delete-space-file-run"),
      input: {
        userMessage: "删除文件",
        taskSoil: {
          contextRefs: [{
            attachmentId: spaceReferenceAttachmentId(reference.id),
            ref: `local-file:${source}`,
            kind: "file",
          }],
        },
      },
      birth: ordinaryRunBirth(),
    });
    const deadline = Date.now() + 5_000;
    while ((await runtime.ordinaryAgentFeature.queries.getRun("delete-space-file-run"))?.status.kind !== "failed" &&
        Date.now() < deadline) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    while (await runtime.spaceFeature.queries.getReference(reference.id) !== undefined && Date.now() < deadline) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    assert.equal(await runtime.spaceFeature.queries.getReference(reference.id), undefined);
    assert.equal(runtime.workbenchProjectionChanges.replay(cursor).changes.some((change) =>
      change.owners.includes("spaces") && change.referenceIds?.includes(reference.id)
    ), true);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel composition freezes agent-written notes into the next Ordinary run instructions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-agent-notes-runtime-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const workspace = path.join(directory, "project");
    await fs.mkdir(workspace, { recursive: true });
    await runtime.configCenter.updateWorkspaceConfig({ workspaceDirectory: workspace });
    runtime.capabilityCenter.invalidate();
    await replaceAgentNote(runtime, { kind: "global" }, "- Reply in Chinese.");
    await replaceAgentNote(
      runtime,
      { kind: "workspace", workspaceRoot: workspace },
      "- Build this project with pnpm build.",
    );

    const birth = await runtime.prepareOrdinaryRunBirth({ goal: "check notes" });

    assert.match(birth.instructions, /<agent_notes>/u);
    assert.match(birth.instructions, /Reply in Chinese/u);
    assert.match(birth.instructions, /Build this project with pnpm build/u);
    assert.match(birth.agentDefinitionRef.promptRef, /agent-notes/u);
    assert.match(birth.agentDefinitionRef.promptVersion, /notes-/u);
    assert.equal(birth.workspaceSelection, "default");
    assert.equal(birth.capabilitySnapshot.workspace.workspaceDirectory, path.resolve(workspace));
    assert.deepEqual(birth.agentNoteVersions, {
      global: agentNoteContentVersion("- Reply in Chinese."),
      workspace: agentNoteContentVersion("- Build this project with pnpm build."),
    });

    // Notes are scoped: a different workspace sees only the global notebook.
    const otherBirth = await runtime.prepareOrdinaryRunBirth({
      goal: "check other notes",
      workspaceDirectory: path.join(directory, "other-project"),
    });
    assert.match(otherBirth.instructions, /Reply in Chinese/u);
    assert.doesNotMatch(otherBirth.instructions, /pnpm build/u);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

async function replaceAgentNote(
  runtime: PanelRuntime,
  scope: AgentNoteScope,
  content: string,
): Promise<void> {
  const current = await runtime.agentNotesFeature.queries.get(scope);
  const result = await runtime.agentNotesFeature.commands.write({
    scope,
    content,
    expectedVersion: current.version,
  });
  assert.equal(result.status, "saved");
}

async function cleanupRuntime(runtime: PanelRuntime | undefined, directory: string): Promise<void> {
  if (runtime !== undefined) await releasePanelRuntimeResources(runtime);
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function completedExecution(
  answer: string,
  sessionRepository: FileSystemAgentSessionRepository,
): OrdinaryExecutionPort {
  return {
    async execute(input) {
      const lease = await sessionRepository.acquire(input.sessionRef);
      try {
        const startLeafId = await lease.session.getLeafId();
        const startLeafRef = startLeafId === null
          ? null
          : { sessionId: input.sessionRef.sessionId, entryId: startLeafId };
        await input.onSessionWriteCheckpoint?.({
          kind: "start_leaf_captured",
          sessionId: input.sessionRef.sessionId,
          startLeafRef,
        });
        const inputEntryId = await lease.session.appendMessage({
          role: "user",
          content: input.runInput.userMessage,
          timestamp: Date.now(),
        });
        const inputEntryRef = { sessionId: input.sessionRef.sessionId, entryId: inputEntryId };
        await input.onSessionWriteCheckpoint?.({
          kind: "input_entry_committed",
          sessionId: input.sessionRef.sessionId,
          inputEntryRef,
        });
        const assistantEntryId = await lease.session.appendMessage(fauxAssistantMessage(answer));
        const assistantEntryRef = { sessionId: input.sessionRef.sessionId, entryId: assistantEntryId };
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
            startLeafRef,
            inputEntryRef,
            safeLeafRef: inputEntryRef,
            latestLeafRef: assistantEntryRef,
            compactionEntryRefs: [],
          },
          toolCalls: [],
          usage: {},
        };
        return outcome;
      } finally {
        await lease.release();
      }
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