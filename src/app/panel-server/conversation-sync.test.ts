import test from "node:test";
import assert from "node:assert/strict";
import { PanelConversationStore } from "../panel-conversations.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-stream-contracts.js";
import { syncConversationTurnForJob, type PanelConversationSyncRunResponse } from "./conversation-sync.js";

test("syncConversationTurnForJob completes assistant turn from desktop answer canvas", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "completed",
      canvas: {
        kind: "desktop_agent_canvas",
        taskSoil: taskSoilCanvas(),
        agent: {
          status: "completed",
          answer: {
            answer: "已整理完成。",
            modelCallRefs: [],
            toolCallRefs: [],
            evidenceRefs: [],
            resultBlocks: [],
          },
          modelCallRefs: [],
          toolCallRefs: [],
          activity: [],
        },
        explanation: {
          resultWhyReasonable: "基于当前会话答案。",
          observationPanelRole: "展示安全投影。",
        },
      },
    }),
  });

  const conversation = conversations.getReadModel(job.conversationId ?? "");
  const assistant = conversation?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "已完成");
  assert.equal(assistant?.content, "已整理完成。");
  assert.equal(assistant?.status, "completed");
  assert.equal(assistant?.responseModel?.model, "gpt-sync-latest");
});

test("syncConversationTurnForJob keeps approval requests as running previews", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "approval_needed",
      canvas: {
        kind: "desktop_agent_canvas",
        taskSoil: taskSoilCanvas(),
        agent: {
          status: "confirmation_needed",
          pendingConfirmation: {
            confirmationId: "confirmation-write",
            title: "需要确认",
            question: "是否写入文件？",
            consequence: "会修改工作区文件。",
            riskLevel: "medium",
            modelCallRefs: [],
            toolCallRefs: [],
            sourceRefs: [],
          },
          modelCallRefs: [],
          toolCallRefs: [],
          activity: [],
        },
        explanation: {
          resultWhyReasonable: "等待用户确认。",
          observationPanelRole: "展示安全投影。",
        },
      },
    }),
  });

  const conversation = conversations.getReadModel(job.conversationId ?? "");
  const assistant = conversation?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "需要确认");
  assert.equal(assistant?.content.includes("是否写入文件？"), true);
  assert.equal(assistant?.content.includes("会修改工作区文件。"), true);
  assert.equal(assistant?.status, "running");
});

test("syncConversationTurnForJob prefers HTTP event errors for failed turns", () => {
  const { conversations, job } = startedConversationJob();
  const secret = "sk-sync-secret";

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "failed",
      error: {
        code: "provider_failed",
        message: `raw provider response ${secret}`,
      },
      transcriptEvents: [
        streamEvent({
          detail: {
            kind: "work",
            error: `HTTP 401 provider rejected Bearer ${secret}`,
          },
        }),
      ],
    }),
  });

  const conversation = conversations.getReadModel(job.conversationId ?? "");
  const assistant = conversation?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "这次没有完成");
  assert.equal(assistant?.status, "failed");
  assert.equal(assistant?.content.includes("HTTP 401"), true);
  assert.equal(assistant?.content.includes(secret), false);
});

function startedConversationJob(): {
  readonly conversations: PanelConversationStore;
  readonly job: PanelRunJob;
} {
  const conversations = new PanelConversationStore();
  const start = conversations.startDesktopMessage({ goal: "整理当前任务" });
  conversations.attachRun({
    conversationId: start.conversation.conversationId,
    assistantTurnId: start.assistantTurn.turnId,
    runId: "run-sync",
    responseModel: {
      profileId: "default",
      model: "gpt-sync",
    },
  });
  return {
    conversations,
    job: {
      runId: "run-sync",
      runKind: "desktop",
      runMode: "agent",
      goal: "整理当前任务",
      aiMode: "fake",
      conversationId: start.conversation.conversationId,
      assistantTurnId: start.assistantTurn.turnId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
      config: config(),
      informationAccess: informationAccess(),
      streamEvents: [],
      streamEventIds: new Set<string>(),
      nextStreamSequence: 1,
      confirmationDecisions: [],
    },
  };
}

function response(input: {
  readonly status: PanelConversationSyncRunResponse["status"];
  readonly canvas?: PanelConversationSyncRunResponse["canvas"];
  readonly error?: PanelConversationSyncRunResponse["error"];
  readonly transcriptEvents?: readonly PanelRunStreamEvent[];
}): PanelConversationSyncRunResponse {
  return {
    status: input.status,
    config: config(),
    error: input.error,
    canvas: input.canvas,
    transcript: {
      events: input.transcriptEvents ?? [],
      modelCalls: [
        {
          requestId: "model-call-sync",
          status: "completed",
          model: "gpt-sync-latest",
          candidateRefs: [],
          eventRefs: [],
        },
      ],
    },
  };
}

function config(): PanelConversationSyncRunResponse["config"] {
  return {
    enabled: true,
    profileId: "default",
    label: "默认模型",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test/v1",
    model: "gpt-sync",
    defaultAiMode: "fake",
    secretRef: "secret:model:test",
    secretConfigured: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function informationAccess(): PanelRunJob["informationAccess"] {
  return {
    sourcePreference: [],
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret:tavily:test",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}

function taskSoilCanvas() {
  return {
    taskSoilId: "task-soil-sync",
    traceId: "trace-sync",
    goalSummary: "整理当前任务",
    contextRefs: [],
    permissionBoundaryRefs: [],
  };
}

function streamEvent(input: {
  readonly detail: NonNullable<PanelRunStreamEvent["detail"]>;
}): PanelRunStreamEvent {
  return {
    eventId: "event-sync",
    runId: "run-sync",
    sequence: 1,
    type: "run.failed",
    createdAt: "2026-01-01T00:00:01.000Z",
    detail: input.detail,
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: [],
  };
}
