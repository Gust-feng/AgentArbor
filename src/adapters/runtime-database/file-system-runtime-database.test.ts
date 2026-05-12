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
    await database.upsertWorkspace({
      workspaceId: "workspace:current",
      kind: "local_directory",
      path: path.join(root, "workspace"),
      label: "workspace",
      selectedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
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
    await database.upsertRun({
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
    });
    await database.replaceRunEvents("panel-run-0001", [
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
    ]);
    await database.replaceModelCalls("panel-run-0001", [
      {
        requestId: "model-request-0001",
        runId: "panel-run-0001",
        responseId: "model-response-0001",
        status: "completed",
        purpose: "desktop_agent",
        outputContractId: "desktop.agent_response.v1",
        model: "fake",
        eventRefs: ["event:msg-0001"],
      },
    ]);
    await database.replaceToolCalls("panel-run-0001", [
      {
        callId: "tool-call-0001",
        runId: "panel-run-0001",
        toolName: "read_file",
        status: "completed",
        action: "read_file",
        path: "README.md",
        summary: "README.md · 12 bytes",
        truncated: false,
        eventRefs: ["event:msg-0002"],
        createdAt: "2026-05-10T00:00:01.000Z",
      },
    ]);
    await database.replaceArtifacts("panel-run-0001", [
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
    ]);
    await database.replaceConfirmations("panel-run-0001", [
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
    ]);

    const snapshot = await database.getRun("panel-run-0001");
    const runs = await database.listRuns();
    const conversation = await database.getConversation("conversation-0001");
    const conversations = await database.listConversations();

    assert.equal(snapshot?.run.runId, "panel-run-0001");
    assert.equal(snapshot?.run.resultSummary, "Safe assistant result.");
    assert.equal(snapshot?.workspace?.workspaceId, "workspace:current");
    assert.equal(snapshot?.events[0]?.type, "goal.received");
    assert.equal(snapshot?.modelCalls[0]?.requestId, "model-request-0001");
    assert.equal(snapshot?.toolCalls[0]?.toolName, "read_file");
    assert.equal(snapshot?.toolCalls[0]?.path, "README.md");
    assert.equal(snapshot?.artifacts[0]?.ref.id, "artifact-0001");
    assert.equal(snapshot?.confirmations[0]?.confirmationId, "confirmation-0001");
    assert.equal(snapshot?.confirmations[0]?.status, "pending");
    assert.deepEqual(runs.map((run) => run.runId), ["panel-run-0001"]);
    assert.equal(conversation?.turns[1]?.content, "Safe assistant result.");
    assert.deepEqual(conversations.map((item) => item.conversationId), ["conversation-0001"]);
    assert.equal(path.resolve(snapshot?.run.runHome ?? "").startsWith(path.resolve(paths.runtimeHome)), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
