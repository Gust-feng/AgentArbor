import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createOpenAITokenCounter } from "../context-maintenance/index.js";
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
import { PATH_DEPENDENCY_DIRECTORY_MAX_TOKENS } from "../path-dependencies/index.js";

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

test("Panel capability snapshots expose progressive path-dependency tools and birth injects only a compact directory", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-dependency-runtime-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const space = await runtime.spaceFeature.commands.createSpace({ title: "方法空间" });
    const methodology = `方法开头：先确认来源，再选择可验证的下载入口。${" 保留验证条件和失败边界。".repeat(30)} TAIL_NOT_INJECTED`;
    const saved = await runtime.pathDependencyFeature.commands.save({
      owner: { kind: "space", id: space.id },
      title: "下载视频的稳定方法",
      methodology,
      tags: ["video", "download"],
    });
    assert.equal(saved.status, "created");
    if (saved.status !== "created") return;
    for (let index = 0; index < 15; index += 1) {
      const extra = await runtime.pathDependencyFeature.commands.save({
        owner: { kind: "space", id: space.id },
        title: `备用下载方法 ${index}`,
        methodology: `候选 ${index}：${"保留适用条件和验证边界。".repeat(60)}`,
      });
      assert.equal(extra.status, "created");
    }

    const snapshot = await runtime.capabilityCenter.snapshot({
      executionRoot: path.join(directory, "runtime", "spaces", space.id, "files"),
      memoryOwner: { kind: "space", id: space.id },
    });
    for (const name of ["MemorySearch", "MemoryRead", "MemoryReference", "PathDependencySave"]) {
      assert.equal(snapshot.toolCatalog.allowedTools.includes(name), true, `${name} must be frozen for the run`);
    }

    const birth = await runtime.prepareOrdinaryRunBirth({
      goal: "下载视频",
      owner: { kind: "space", id: space.id },
    });
    assert.match(birth.instructions, /<path_dependency_directory>/u);
    assert.match(birth.instructions, /备用下载方法/u);
    assert.match(birth.instructions, /MemoryRead/u);
    assert.equal(birth.instructions.includes("TAIL_NOT_INJECTED"), false);
    const directoryBlock = /<path_dependency_directory>\n([\s\S]*?)\n<\/path_dependency_directory>/u.exec(birth.instructions)?.[1];
    assert.ok(directoryBlock);
    assert.equal(
      createOpenAITokenCounter(birth.config.model ?? "gpt-4o").countText(directoryBlock) <= PATH_DEPENDENCY_DIRECTORY_MAX_TOKENS,
      true,
    );
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
    for (const name of ["SpaceList", "SpaceCreate", "SpaceDelete", "ConversationDelete", "SpaceMove", "SpaceAddReference", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename", "Write", "Edit"]) {
      assert.equal(snapshot.toolCatalog.allowedTools.includes(name), true, `${name} must be frozen for the run`);
    }
    assert.equal(snapshot.toolCatalog.allowedTools.includes("SpaceWrite"), false);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("SpaceEdit"), false);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel composition revokes and stops processes when a Space reference is unlinked", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-process-revocation-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  const stoppedPids: number[] = [];
  try {
    runtime = createPanelRuntime({
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
      processTerminator: {
        killTree(pid) {
          stoppedPids.push(pid);
          return { status: "killed" };
        },
      },
    });
    const space = await runtime.spaceFeature.commands.createSpace({ title: "Space" });
    const reference = await runtime.spaceFeature.commands.addReference({
      spaceId: space.id,
      title: "Workspace",
      reference: { kind: "workspace_folder", path: directory },
    });
    runtime.processRegistry.register({
      processId: "space-process",
      conversationId: "conversation-1",
      spaceId: space.id,
      referenceId: reference.id,
      runId: "run-1",
      authorizationMode: "confirm_each",
      permissionState: "active",
      pid: 32123,
      kind: "background",
      lifetime: "workspace_session",
      owned: true,
      commandLine: "test server",
      cwd: directory,
      startedAt: "2026-08-06T00:00:00.000Z",
      status: "running",
    });

    await runtime.spaceFeature.commands.unlinkReference(reference.id);
    assert.notEqual(runtime.processRegistry.get("space-process")?.permissionState, "active");
    await runtime.flushSpaceProcessCleanup();

    assert.deepEqual(stoppedPids, [32123]);
    assert.equal(runtime.processRegistry.get("space-process")?.permissionState, "stopped");
    assert.equal(runtime.processRegistry.get("space-process")?.status, "killed");
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

test("Panel composition does not assemble or capture legacy PathMemory archives", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-legacy-memory-unload-"));
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
    assert.equal(Object.hasOwn(runtime, "pathMemoryFeature"), false);
    assert.equal(Object.hasOwn(runtime, "experienceCandidateFeature"), false);
    assert.equal(Object.hasOwn(runtime, "ordinaryPathMemoryConnector"), false);
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
    assert.equal((await runtime.ordinaryAgentFeature.queries.getRun("wired-run"))?.status.kind, "completed");
    await assert.rejects(fs.access(path.join(directory, "runtime", "path-memory")), { code: "ENOENT" });
    await assert.rejects(fs.access(path.join(directory, "runtime", "experience-candidates")), { code: "ENOENT" });
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel composition does not scan frozen Space links when an Agent run finishes", async () => {
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
    assert.notEqual(await runtime.spaceFeature.queries.getReference(reference.id), undefined);
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
    const { workspace: ownerWorkspace } = await runtime.workspaceFeature.commands.registerWorkspace({
      rootPath: workspace,
      sourceIdentity: "dev:agent-notes",
    });
    await replaceAgentNote(runtime, { kind: "global" }, "- Reply in Chinese.");
    await replaceAgentNote(
      runtime,
      { kind: "workspace", id: ownerWorkspace.id },
      "- Build this project with pnpm build.",
    );

    const birth = await runtime.prepareOrdinaryRunBirth({
      goal: "check notes",
      owner: { kind: "workspace", id: ownerWorkspace.id },
    });

    assert.match(birth.instructions, /<agent_notes>/u);
    assert.match(birth.instructions, /Reply in Chinese/u);
    assert.match(birth.instructions, /Build this project with pnpm build/u);
    assert.match(birth.agentDefinitionRef.promptRef, /agent-notes/u);
    assert.match(birth.agentDefinitionRef.promptVersion, /notes-/u);
    assert.equal(birth.workspaceSelection, "explicit");
    assert.deepEqual(birth.memoryOwner, { kind: "workspace", id: ownerWorkspace.id });
    assert.equal(birth.capabilitySnapshot.executionRoot.toLowerCase(), path.resolve(workspace).toLowerCase());
    assert.deepEqual(birth.agentNoteVersions, {
      global: agentNoteContentVersion("- Reply in Chinese."),
      owner: {
        scope: { kind: "workspace", id: ownerWorkspace.id },
        version: agentNoteContentVersion("- Build this project with pnpm build."),
      },
    });

  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel deletion coordinators purge only the deleted owner note", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-owner-note-deletion-runtime-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const workspaceRoot = path.join(directory, "project");
    await fs.mkdir(workspaceRoot, { recursive: true });
    const { workspace } = await runtime.workspaceFeature.commands.registerWorkspace({
      rootPath: workspaceRoot,
      sourceIdentity: "dev:owner-note-deletion",
    });

    await replaceAgentNote(runtime, { kind: "global" }, "- Keep this global preference.");
    await replaceAgentNote(runtime, { kind: "workspace", id: workspace.id }, "- Delete this workspace note.");
    const ownerPathDependency = await runtime.pathDependencyFeature.commands.save({
      owner: { kind: "workspace", id: workspace.id },
      title: "Owner deletion test",
      methodology: "Delete with the owner.",
    });
    assert.equal(ownerPathDependency.status, "created");

    await runtime.workspaceDeletion.deleteWorkspace(workspace.id);

    assert.equal((await runtime.agentNotesFeature.queries.get({ kind: "workspace", id: workspace.id })).content, "");
    assert.equal((await runtime.agentNotesFeature.queries.get({ kind: "global" })).content, "- Keep this global preference.");
    assert.equal((await runtime.pathDependencyFeature.queries.list({ owners: [{ kind: "workspace", id: workspace.id }] })).length, 0);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Panel composition restores the durable Workspace deleting gate", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workspace-deleting-restart-"));
  let first: ReturnType<typeof createPanelRuntime> | undefined;
  let restarted: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    first = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const workspaceRoot = path.join(directory, "project");
    await fs.mkdir(workspaceRoot, { recursive: true });
    const { workspace } = await first.workspaceFeature.commands.registerWorkspace({
      rootPath: workspaceRoot,
      sourceIdentity: "dev:workspace-deleting-restart",
    });
    // Persist the owner marker without completing a host cascade, which is
    // exactly the state a process restart must keep denied.
    await first.workspaceFeature.commands.deleteWorkspace(workspace.id);
    await releasePanelRuntimeResources(first);
    first = undefined;

    restarted = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    await restarted.workspaceDeletion.ready();

    assert.equal(restarted.workspaceDeletion.isDeleting(workspace.id), true);
    assert.throws(
      () => restarted?.workspaceDeletion.assertAvailable(workspace.id),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_deletion_in_progress",
    );
  } finally {
    try {
      if (first !== undefined) await releasePanelRuntimeResources(first);
    } finally {
      try {
        if (restarted !== undefined) await releasePanelRuntimeResources(restarted);
      } finally {
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  }
});

test("Space owner run birth uses the Space managedRoot as cwd", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-scope-runtime-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const space = await runtime.spaceFeature.commands.createSpace({ title: "产品规划" });

    const birth = await runtime.prepareOrdinaryRunBirth({
      goal: "整理构建问题",
      owner: { kind: "space", id: space.id },
    });

    const expectedRoot = path.join(directory, "runtime", "spaces", space.id, "files");
    assert.equal(birth.capabilitySnapshot.executionRoot, path.resolve(expectedRoot));
    assert.deepEqual(birth.memoryOwner, { kind: "space", id: space.id });
    assert.equal(birth.workspaceSelection, "explicit");
    assert.equal((await fs.stat(expectedRoot)).isDirectory(), true);
    assert.match(birth.ownerContext ?? "", /kind=space/u);
    assert.match(birth.ownerContext ?? "", /name=产品规划/u);
    assert.match(birth.ownerContext ?? "", /managed_root=/u);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Space owner run discovers project skills from the managedRoot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-skill-scope-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const space = await runtime.spaceFeature.commands.createSpace({ title: "技能空间" });
    const skillRoot = path.join(directory, "runtime", "spaces", space.id, "files", ".agents", "skills", "probe-skill");
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: probe-skill\ndescription: 探测技能\n---\n技能正文。\n",
      "utf8",
    );

    const birth = await runtime.prepareOrdinaryRunBirth({
      goal: "使用技能",
      owner: { kind: "space", id: space.id },
    });

    const skill = birth.capabilitySnapshot.skillCatalog.find((item) => item.name === "probe-skill");
    assert.notEqual(skill, undefined);
    assert.equal(skill?.sourceKind, "project");
    assert.equal(skill?.sourcePath.includes(path.join(".agents", "skills")), true);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Workspace owner run birth uses the current mount root as cwd", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workspace-scope-runtime-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const project = path.join(directory, "project");
    await fs.mkdir(project, { recursive: true });
    const { workspace } = await runtime.workspaceFeature.commands.registerWorkspace({
      rootPath: project,
      sourceIdentity: "dev:project",
    });

    const birth = await runtime.prepareOrdinaryRunBirth({
      goal: "修复项目",
      owner: { kind: "workspace", id: workspace.id },
    });

    assert.equal(birth.capabilitySnapshot.executionRoot.toLowerCase(), path.resolve(project).toLowerCase());
    assert.deepEqual(birth.memoryOwner, { kind: "workspace", id: workspace.id });
    assert.equal(birth.workspaceSelection, "explicit");
    assert.match(birth.ownerContext ?? "", /kind=workspace/u);
    assert.match(birth.ownerContext ?? "", /name=project/u);
    assert.match(birth.ownerContext ?? "", /path=/u);
  } finally {
    await cleanupRuntime(runtime, directory);
  }
});

test("Workspace run birth rejects a durable deleting Workspace", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workspace-deleting-birth-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    runtime = createPanelRuntime({ configDirectory: directory, testOnlySkipInitialWorkbenchData: true });
    const project = path.join(directory, "project");
    await fs.mkdir(project, { recursive: true });
    const { workspace } = await runtime.workspaceFeature.commands.registerWorkspace({
      rootPath: project,
      sourceIdentity: "dev:deleting-birth",
    });

    // Simulate a persisted deletion marker (for example after a restart). The
    // active mount remains present, so checking only mount availability would
    // incorrectly allow a new run.
    await runtime.workspaceFeature.commands.deleteWorkspace(workspace.id);
    await assert.rejects(
      () => runtime!.prepareOrdinaryRunBirth({
        goal: "不应在删除中的工作区启动",
        owner: { kind: "workspace", id: workspace.id },
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "workspace_not_available",
    );
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
