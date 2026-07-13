import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
} from "./file-system-runtime-database.js";

test("FileSystemRuntimeDatabase persists a safe Lite Profile run snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-db-"));
  try {
    const paths = resolveAgentArborRuntimeDatabasePaths(path.join(root, "config"));
    const database = new FileSystemRuntimeDatabase(paths);
    const runHome = database.runHome("panel-run-0001");
    const workspace = {
      workspaceId: "workspace:current",
      kind: "local_directory",
      path: path.join(root, "workspace"),
      label: "workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    } as const;
    await database.upsertConversation({
      conversationId: "conversation-0001",
      title: "safe goal summary",
      preview: "Safe assistant result.",
      status: "completed",
      latestRunId: "panel-run-0001",
      queuedRunIds: [],
      queuedRunCount: 0,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:01.000Z",
      turns: [
        {
          turnId: "turn-user-0001",
          role: "user",
          title: "你的消息",
          content: "safe goal summary",
          status: "completed",
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
        {
          turnId: "turn-assistant-0001",
          role: "assistant",
          title: "已完成",
          content: "Safe assistant result.",
          status: "completed",
          runId: "panel-run-0001",
          createdAt: "2026-05-10T00:00:01.000Z",
          updatedAt: "2026-05-10T00:00:01.000Z",
        },
      ],
    });
    const run = {
      runId: "panel-run-0001",
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status: "completed",
      goalSummary: "safe goal summary",
      aiMode: "fake",
      workspaceId: "workspace:current",
      workspacePath: path.join(root, "workspace"),
      traceId: "trace-0001",
      goalId: "goal-0001",
      appHome: paths.appHome,
      runHome,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:01.000Z",
      completedAt: "2026-05-10T00:00:01.000Z",
      resultTitle: "已完成",
      resultSummary: "Safe assistant result.",
    } as const;
    const events = [
      {
        eventId: "panel-run-0001:event:1",
        runId: "panel-run-0001",
        sequence: 1,
        type: "goal.received",
        summary: "已接收任务。",
        scope: "soil",
        severity: "info",
        progress: { status: "completed", label: "目标已接收" },
        refs: [{ kind: "trace", id: "trace-0001" }],
        traceId: "trace-0001",
        intent: "start_desktop_agent_session",
        createdAt: "2026-05-10T00:00:00.000Z",
        recordedAt: "2026-05-10T00:00:00.000Z",
      },
    ] as const;
    const modelCalls = [
      {
        requestId: "model-request-0001",
        runId: "panel-run-0001",
        responseId: "model-response-0001",
        status: "completed",
        purpose: "desktop_agent",
        outputContractId: "desktop.agent_response.v1",
        model: "fake",
        usage: {
          inputTokens: 12,
          outputTokens: 4,
          totalTokens: 16,
          cachedInputTokens: 3,
        },
        eventRefs: ["event:msg-0001"],
      },
    ] as const;
    const toolCalls = [
      {
        callId: "tool-call-0001",
        runId: "panel-run-0001",
        toolName: "read_file",
        status: "completed",
        eventRefs: ["event:msg-0002"],
        createdAt: "2026-05-10T00:00:01.000Z",
      },
    ] as const;
    const artifacts = [
      {
        runId: "panel-run-0001",
        ref: {
          id: "artifact-0001",
          producedBy: "desktop-agent-session",
          type: "report",
          version: "1.0.0",
          createdAt: "2026-05-10T00:00:01.000Z",
        },
        summary: "Safe artifact summary.",
      },
    ] as const;
    const confirmations = [
      {
        confirmationId: "confirmation-0001",
        runId: "panel-run-0001",
        status: "pending",
        title: "确认修改文件",
        actionSummary: "修改 README.md",
        affectedResources: ["README.md"],
        riskLevel: "high",
        requestedAt: "2026-05-10T00:00:01.000Z",
        eventRefs: ["event:approval-0001"],
      },
    ] as const;
    const subAgentRuns = [
      {
        parentRunId: "panel-run-0001",
        parentToolCallId: "tool-call-sub-agent",
        subRunId: "sub-run-0001",
        subAgentId: "creative-advisor",
        subAgentName: "Creative Advisor",
        task: "Generate ideas",
        status: "completed",
        startedAt: "2026-05-10T00:00:01.000Z",
        completedAt: "2026-05-10T00:00:02.000Z",
        durationMs: 1000,
        modelRounds: 1,
        toolCalls: 0,
        summary: "Three ideas.",
        modelExchanges: [],
        toolTraces: [],
      },
    ] as const;
    await database.saveRunSnapshot({
      run,
      workspace,
      basicRun: undefined,
      basicEvents: [],
      events,
      modelCalls,
      toolCalls,
      artifacts,
      confirmations,
      subAgentRuns,
      contextLedger: undefined,
    });

    const snapshot = await database.getRun("panel-run-0001");
    const modelCallsByRun = await database.listModelCallsForRuns(["panel-run-0001"]);
    const runs = await database.listRuns();
    const conversation = await database.getConversation("conversation-0001");
    const conversations = await database.listConversations();
    await database.upsertConversation({
      ...conversation!,
      conversationId: "conversation-pinned",
      title: "pinned",
      pinnedAt: "2026-05-10T00:00:02.000Z",
    });
    const pinnedConversations = await database.listConversations();
    await database.deleteConversation("conversation-0001");
    const deletedConversation = await database.getConversation("conversation-0001");

    assert.equal(snapshot?.run.runId, "panel-run-0001");
    assert.equal(snapshot?.run.resultSummary, "Safe assistant result.");
    assert.equal(snapshot?.workspace?.workspaceId, "workspace:current");
    assert.equal(snapshot?.events[0]?.type, "goal.received");
    assert.equal(snapshot?.modelCalls[0]?.requestId, "model-request-0001");
    assert.deepEqual(snapshot?.modelCalls[0]?.usage, {
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      cachedInputTokens: 3,
    });
    assert.equal(modelCallsByRun[0]?.runId, "panel-run-0001");
    assert.deepEqual(modelCallsByRun[0]?.modelCalls[0]?.usage, {
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      cachedInputTokens: 3,
    });
    assert.equal(snapshot?.toolCalls[0]?.toolName, "read_file");
    assert.deepEqual(snapshot?.toolCalls[0]?.eventRefs, ["event:msg-0002"]);
    assert.equal(snapshot?.artifacts[0]?.ref.id, "artifact-0001");
    assert.equal(snapshot?.confirmations[0]?.confirmationId, "confirmation-0001");
    assert.equal(snapshot?.confirmations[0]?.status, "pending");
    assert.equal(snapshot?.subAgentRuns[0]?.subRunId, "sub-run-0001");
    assert.equal(snapshot?.subAgentRuns[0]?.parentToolCallId, "tool-call-sub-agent");
    assert.deepEqual(runs.map((run) => run.runId), ["panel-run-0001"]);
    assert.equal(conversation?.turns[1]?.content, "Safe assistant result.");
    assert.deepEqual(conversations.map((item) => item.conversationId), ["conversation-0001"]);
    assert.deepEqual(pinnedConversations.map((item) => item.conversationId), [
      "conversation-pinned",
      "conversation-0001",
    ]);
    assert.equal(deletedConversation, undefined);
    assert.equal(path.resolve(snapshot?.run.runHome ?? "").startsWith(path.resolve(paths.runtimeHome)), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("FileSystemRuntimeDatabase keeps run-born workspace records immutable across later runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-db-workspace-"));
  try {
    const paths = resolveAgentArborRuntimeDatabasePaths(path.join(root, "config"));
    const database = new FileSystemRuntimeDatabase(paths);
    const firstWorkspace = {
      workspaceId: "workspace:run:run-first",
      kind: "local_directory" as const,
      path: path.join(root, "first-workspace"),
      label: "first-workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    const secondWorkspace = {
      workspaceId: "workspace:run:run-second",
      kind: "local_directory" as const,
      path: path.join(root, "second-workspace"),
      label: "second-workspace",
      selectedAt: "2026-05-10T00:01:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
    };

    await database.saveRunSnapshot(emptyRunSnapshot(
      runRecord("run-first", paths, firstWorkspace.workspaceId, firstWorkspace.path),
      firstWorkspace,
    ));
    await database.saveRunSnapshot(emptyRunSnapshot(
      runRecord("run-second", paths, secondWorkspace.workspaceId, secondWorkspace.path),
      secondWorkspace,
    ));

    const firstSnapshot = await database.getRun("run-first");
    const secondSnapshot = await database.getRun("run-second");

    assert.equal(firstSnapshot?.workspace?.path, firstWorkspace.path);
    assert.equal(firstSnapshot?.run.workspacePath, firstWorkspace.path);
    assert.equal(secondSnapshot?.workspace?.path, secondWorkspace.path);
    assert.equal(secondSnapshot?.run.workspacePath, secondWorkspace.path);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("FileSystemRuntimeDatabase commits monotonic snapshot revisions through one manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-db-revisions-"));
  try {
    const paths = resolveAgentArborRuntimeDatabasePaths(path.join(root, "config"));
    const database = new FileSystemRuntimeDatabase(paths);
    const runId = "run-revisions";
    const workspace = {
      workspaceId: `workspace:run:${runId}`,
      kind: "local_directory" as const,
      path: path.join(root, "workspace"),
      label: "workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    const first = emptyRunSnapshot(
      runRecord(runId, paths, workspace.workspaceId, workspace.path),
      workspace,
    );
    await database.saveRunSnapshot(first);
    first.run.goalSummary = "mutated after save";
    assert.equal((await database.getRun(runId))?.run.goalSummary, runId);

    const second = {
      ...first,
      run: {
        ...first.run,
        goalSummary: runId,
        updatedAt: "2026-05-10T00:00:02.000Z",
        resultSummary: "second revision",
      },
    };
    const third = {
      ...second,
      run: {
        ...second.run,
        updatedAt: "2026-05-10T00:00:03.000Z",
        resultSummary: "third revision",
      },
    };
    await Promise.all([
      database.saveRunSnapshot(second),
      database.saveRunSnapshot(third),
    ]);

    const runDirectory = database.runHome(runId);
    const manifest = JSON.parse(await fs.readFile(path.join(runDirectory, "run.json"), "utf8")) as {
      schemaVersion: string;
      revision: number;
      snapshotRef: string;
      run: { resultSummary?: string; capabilitySnapshot?: unknown };
    };
    const snapshotFiles = (await fs.readdir(path.join(runDirectory, "snapshots")))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const document = JSON.parse(
      await fs.readFile(path.join(runDirectory, manifest.snapshotRef), "utf8"),
    ) as { schemaVersion: string; revision: number; content: { run: { resultSummary?: string } } };

    assert.equal(manifest.schemaVersion, "runtime-run-manifest/v1");
    assert.equal(manifest.revision, 3);
    assert.equal(manifest.snapshotRef, "snapshots/3.json");
    assert.equal(manifest.run.resultSummary, "third revision");
    assert.equal(manifest.run.capabilitySnapshot, undefined);
    assert.equal(document.schemaVersion, "runtime-run-snapshot/v1");
    assert.equal(document.revision, 3);
    assert.equal(document.content.run.resultSummary, "third revision");
    assert.deepEqual(snapshotFiles, ["2.json", "3.json"]);
    assert.equal((await database.getRun(runId))?.run.resultSummary, "third revision");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("FileSystemRuntimeDatabase rejects legacy manifests and broken snapshot pointers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-db-incompatible-"));
  try {
    const paths = resolveAgentArborRuntimeDatabasePaths(path.join(root, "config"));
    const database = new FileSystemRuntimeDatabase(paths);
    const legacyRunId = "legacy-run";
    const legacyDirectory = database.runHome(legacyRunId);
    await fs.mkdir(legacyDirectory, { recursive: true });
    await fs.writeFile(
      path.join(legacyDirectory, "run.json"),
      `${JSON.stringify(runRecord(legacyRunId, paths, "workspace:legacy", root), null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      database.getRun(legacyRunId),
      runtimeSnapshotIncompatible,
    );
    await assert.rejects(
      database.listRuns(),
      runtimeSnapshotIncompatible,
    );

    await fs.rm(legacyDirectory, { recursive: true, force: true });
    const brokenRunId = "broken-run";
    const workspace = {
      workspaceId: `workspace:run:${brokenRunId}`,
      kind: "local_directory" as const,
      path: path.join(root, "workspace"),
      label: "workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    await database.saveRunSnapshot(emptyRunSnapshot(
      runRecord(brokenRunId, paths, workspace.workspaceId, workspace.path),
      workspace,
    ));
    const brokenDirectory = database.runHome(brokenRunId);
    await fs.rm(path.join(brokenDirectory, "snapshots", "1.json"), { force: true });
    await assert.rejects(
      database.getRun(brokenRunId),
      runtimeSnapshotIncompatible,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("FileSystemRuntimeDatabase rejects invalid snapshot enums, identities, and stale manifest summaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-db-validation-"));
  try {
    const paths = resolveAgentArborRuntimeDatabasePaths(path.join(root, "config"));
    const database = new FileSystemRuntimeDatabase(paths);
    const runId = "validation-run";
    const workspace = {
      workspaceId: `workspace:run:${runId}`,
      kind: "local_directory" as const,
      path: path.join(root, "workspace"),
      label: "workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    await database.saveRunSnapshot(emptyRunSnapshot(
      runRecord(runId, paths, workspace.workspaceId, workspace.path),
      workspace,
    ));

    const runDirectory = database.runHome(runId);
    const manifestPath = path.join(runDirectory, "run.json");
    const snapshotPath = path.join(runDirectory, "snapshots", "1.json");
    const originalManifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const originalDocument = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      content: Record<string, unknown>;
    };

    const invalidStatusDocument = structuredClone(originalDocument);
    (invalidStatusDocument.content.run as Record<string, unknown>).status = "not-a-runtime-status";
    await fs.writeFile(snapshotPath, `${JSON.stringify(invalidStatusDocument)}\n`, "utf8");
    await assert.rejects(database.getRun(runId), runtimeSnapshotIncompatible);

    await fs.writeFile(snapshotPath, `${JSON.stringify(originalDocument)}\n`, "utf8");
    const invalidContinuationDocument = structuredClone(originalDocument);
    (invalidContinuationDocument.content.run as Record<string, unknown>).continuationAvailability = "future";
    await fs.writeFile(snapshotPath, `${JSON.stringify(invalidContinuationDocument)}\n`, "utf8");
    await assert.rejects(database.getRun(runId), runtimeSnapshotIncompatible);

    await fs.writeFile(snapshotPath, `${JSON.stringify(originalDocument)}\n`, "utf8");
    const foreignRunDocument = structuredClone(originalDocument);
    (foreignRunDocument.content.run as Record<string, unknown>).runId = "another-run";
    await fs.writeFile(snapshotPath, `${JSON.stringify(foreignRunDocument)}\n`, "utf8");
    await assert.rejects(database.getRun(runId), runtimeSnapshotIncompatible);

    await fs.writeFile(snapshotPath, `${JSON.stringify(originalDocument)}\n`, "utf8");
    const staleManifest = structuredClone(originalManifest);
    (staleManifest.run as Record<string, unknown>).status = "running";
    await fs.writeFile(manifestPath, `${JSON.stringify(staleManifest)}\n`, "utf8");
    await assert.rejects(database.getRun(runId), runtimeSnapshotIncompatible);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("FileSystemRuntimeDatabase validates snapshot content before committing it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-db-write-validation-"));
  try {
    const paths = resolveAgentArborRuntimeDatabasePaths(path.join(root, "config"));
    const database = new FileSystemRuntimeDatabase(paths);
    const runId = "write-validation-run";
    const workspace = {
      workspaceId: `workspace:run:${runId}`,
      kind: "local_directory" as const,
      path: path.join(root, "workspace"),
      label: "workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    const snapshot = emptyRunSnapshot(
      runRecord(runId, paths, workspace.workspaceId, workspace.path),
      workspace,
    );

    await assert.rejects(
      database.saveRunSnapshot({
        ...snapshot,
        run: { ...snapshot.run, continuationAvailability: "future" as never },
      }),
      runtimeSnapshotIncompatible,
    );
    await assert.rejects(
      database.saveRunSnapshot({
        ...snapshot,
        workspace: { ...workspace, path: path.join(root, "another-workspace") },
      }),
      runtimeSnapshotIncompatible,
    );
    assert.equal(await database.getRun(runId), undefined);

    await database.saveRunSnapshot({
      ...snapshot,
      run: { ...snapshot.run, continuationAvailability: "live" },
    });
    assert.equal((await database.getRun(runId))?.run.continuationAvailability, "live");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("FileSystemRuntimeDatabase keeps storage I/O errors distinct from incompatible JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-runtime-db-io-error-"));
  try {
    const paths = resolveAgentArborRuntimeDatabasePaths(path.join(root, "config"));
    const database = new FileSystemRuntimeDatabase(paths);
    const runId = "io-error-run";
    const workspace = {
      workspaceId: `workspace:run:${runId}`,
      kind: "local_directory" as const,
      path: path.join(root, "workspace"),
      label: "workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    await database.saveRunSnapshot(emptyRunSnapshot(
      runRecord(runId, paths, workspace.workspaceId, workspace.path),
      workspace,
    ));

    const manifestPath = path.join(database.runHome(runId), "run.json");
    await fs.writeFile(manifestPath, "{broken-json\n", "utf8");
    await assert.rejects(database.getRun(runId), runtimeSnapshotIncompatible);
    await fs.rm(manifestPath, { force: true });
    await fs.mkdir(manifestPath);
    await assert.rejects(
      database.getRun(runId),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.notEqual((error as { readonly code?: string }).code, "runtime_snapshot_incompatible");
        return ["EISDIR", "EACCES", "EPERM"].includes((error as { readonly code?: string }).code ?? "");
      },
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function runRecord(
  runId: string,
  paths: ReturnType<typeof resolveAgentArborRuntimeDatabasePaths>,
  workspaceId: string,
  workspacePath: string
) {
  return {
    runId,
    profile: "lite" as const,
    runKind: "desktop" as const,
    runMode: "agent" as const,
    status: "completed" as const,
    goalSummary: runId,
    aiMode: "fake" as const,
    workspaceId,
    workspacePath,
    appHome: paths.appHome,
    runHome: path.join(paths.runtimeHome, "runs", encodeURIComponent(runId)),
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:01.000Z",
    completedAt: "2026-05-10T00:00:01.000Z",
  };
}

function emptyRunSnapshot(
  run: ReturnType<typeof runRecord>,
  workspace: {
    readonly workspaceId: string;
    readonly kind: "local_directory";
    readonly path: string;
    readonly label: string;
    readonly selectedAt: string;
    readonly updatedAt: string;
  },
) {
  return {
    run,
    workspace,
    basicRun: undefined,
    basicEvents: [],
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
    subAgentRuns: [],
    contextLedger: undefined,
  };
}

function runtimeSnapshotIncompatible(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === "runtime_snapshot_incompatible";
}
