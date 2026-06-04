import test from "node:test";
import assert from "node:assert/strict";
import { PanelConversationStore } from "../panel-conversations.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-stream-contracts.js";
import {
  syncConversationPreviewsForRunningJobs,
  syncConversationTurnForJob,
  type PanelConversationSyncRunResponse,
} from "./conversation-sync.js";

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

test("syncConversationTurnForJob keeps concrete confirmation preview", () => {
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
            confirmationId: "confirmation-delete",
            title: "需要确认",
            question: "删除文件：C:\\repo\\old.txt",
            consequence: "",
            riskLevel: "high",
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

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "需要确认");
  assert.equal(assistant?.content, "删除文件：C:\\repo\\old.txt");
});

test("syncConversationTurnForJob ignores run started copy and refreshes from model output", () => {
  const { conversations, job } = startedConversationJob();
  const secret = "sk-running-preview-secret";

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          type: "run.started",
          summary: "不应该显示的启动占位文案。",
          detail: {
            kind: "thinking",
            preview: "不应该显示的启动占位文案。",
          },
        }),
        streamEvent({
          sequence: 2,
          type: "model.output.delta",
          delta: `正在整理可见回答，密钥 ${secret} 不应出现。`,
          detail: {
            kind: "thinking",
            preview: `正在整理可见回答，密钥 ${secret} 不应出现。`,
          },
        }),
      ],
    }),
  });

  const conversation = conversations.getReadModel(job.conversationId ?? "");
  const summary = conversations.list().find((item) => item.conversationId === job.conversationId);
  const assistant = conversation?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "正在回复");
  assert.equal(assistant?.content.includes("正在整理可见回答"), true);
  assert.equal(assistant?.content.includes("启动占位"), false);
  assert.equal(assistant?.content.includes(secret), false);
  assert.equal(assistant?.status, "running");
  assert.equal(summary?.status, "running");
  assert.equal(summary?.currentAction.includes("正在整理可见回答"), true);
  assert.equal(summary?.currentAction.includes(secret), false);
});

test("syncConversationTurnForJob accumulates running model output deltas", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          sequence: 1,
          type: "model.output.delta",
          delta: "Now",
          detail: {
            kind: "thinking",
            preview: "Now",
          },
        }),
        streamEvent({
          sequence: 2,
          type: "model.output.delta",
          delta: " let",
          detail: {
            kind: "thinking",
            preview: " let",
          },
        }),
        streamEvent({
          sequence: 3,
          type: "model.output.delta",
          delta: " me demonstrate.",
          detail: {
            kind: "thinking",
            preview: " me demonstrate.",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "正在回复");
  assert.equal(assistant?.content, "Now let me demonstrate.");
});

test("syncConversationTurnForJob preserves repeated live output deltas", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          eventId: "run-sync:live:model.output.delta:model-call-sync:1",
          sequence: 1,
          type: "model.output.delta",
          delta: "ha",
          detail: {
            kind: "thinking",
            preview: "ha",
          },
        }),
        streamEvent({
          eventId: "run-sync:live:model.output.delta:model-call-sync:2",
          sequence: 2,
          type: "model.output.delta",
          delta: "ha",
          detail: {
            kind: "thinking",
            preview: "ha",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.content, "haha");
});

test("syncConversationTurnForJob merges completed replay over live output in running preview", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          eventId: "run-sync:live:model.output.delta:model-call-sync:1",
          sequence: 1,
          type: "model.output.delta",
          delta: "foo",
          detail: {
            kind: "thinking",
            preview: "foo",
          },
        }),
        streamEvent({
          eventId: "run-sync:live:model.output.delta:model-call-sync:2",
          sequence: 2,
          type: "model.output.delta",
          delta: "bar",
          detail: {
            kind: "thinking",
            preview: "bar",
          },
        }),
        streamEvent({
          eventId: "run-sync:event:2:model.output.delta:1",
          sequence: 3,
          type: "model.output.delta",
          delta: "foobar",
          detail: {
            kind: "thinking",
            preview: "foobar",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.content, "foobar");
});

test("syncConversationTurnForJob does not collapse spaced live preview into compact replay", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          eventId: "run-sync:live:model.output.delta:model-call-sync:1",
          sequence: 1,
          type: "model.output.delta",
          delta: "The user is",
          detail: {
            kind: "thinking",
            preview: "The user is",
          },
        }),
        streamEvent({
          eventId: "run-sync:event:2:model.output.delta:1",
          sequence: 2,
          type: "model.output.delta",
          delta: "Theuser",
          detail: {
            kind: "thinking",
            preview: "Theuser",
          },
        }),
        streamEvent({
          eventId: "run-sync:event:2:model.output.delta:2",
          sequence: 3,
          type: "model.output.delta",
          delta: "isasking",
          detail: {
            kind: "thinking",
            preview: "isasking",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.content, "The user is asking");
});

test("syncConversationTurnForJob preserves repeated replay output chunks", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          eventId: "run-sync:event:1:model.output.delta:1",
          sequence: 1,
          type: "model.output.delta",
          delta: "ha",
          detail: {
            kind: "thinking",
            preview: "ha",
          },
        }),
        streamEvent({
          eventId: "run-sync:event:1:model.output.delta:2",
          sequence: 2,
          type: "model.output.delta",
          delta: "ha",
          detail: {
            kind: "thinking",
            preview: "ha",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.content, "haha");
});

test("syncConversationPreviewsForRunningJobs skips queued and terminal jobs while updating active jobs", () => {
  const { conversations, job } = startedConversationJob();
  const terminal = { ...job, runId: "run-terminal", status: "completed" as const };
  const queued = { ...job, runId: "run-queued", status: "pending" as const };

  job.status = "running";
  syncConversationPreviewsForRunningJobs({
    conversations,
    jobs: [terminal, queued, job],
    createResponse: (candidate) => response({
      status: candidate.status,
      transcriptEvents: [
        streamEvent({
          type: "tool.requested",
          summary: "正在读取文件：README.md。",
          detail: {
            kind: "tool",
            preview: "目标：README.md",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "正在执行动作");
  assert.equal(assistant?.content, "目标：README.md");
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
  assert.equal(assistant?.title, "运行失败");
  assert.equal(assistant?.status, "failed");
  assert.equal(assistant?.content.includes("错误信息：HTTP 401"), true);
  assert.equal(assistant?.content.includes("HTTP 401"), true);
  assert.equal(assistant?.content.includes(secret), false);
});

test("syncConversationTurnForJob preserves existing assistant output when failing", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          type: "model.output.delta",
          delta: "已经输出的内容。",
          detail: {
            kind: "thinking",
            preview: "已经输出的内容。",
          },
        }),
      ],
    }),
  });

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "failed",
      error: {
        code: "provider_stream_parse_failed",
        message: "OpenAI-compatible provider stream response could not be parsed.",
      },
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "运行失败");
  assert.equal(assistant?.status, "failed");
  assert.equal(assistant?.content.includes("已经输出的内容。"), true);
  assert.equal(assistant?.content.includes("错误信息：OpenAI-compatible provider stream response could not be parsed."), true);
});

test("syncConversationTurnForJob appends failure marker even when previous output mentions the error", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "running";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          type: "model.output.delta",
          delta: "我正在解释为什么模型连接失败这个现象会出现。",
          detail: {
            kind: "thinking",
            preview: "我正在解释为什么模型连接失败这个现象会出现。",
          },
        }),
      ],
    }),
  });

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "failed",
      error: {
        code: "provider_failed",
        message: "模型连接失败",
      },
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.content.includes("我正在解释为什么模型连接失败这个现象会出现。"), true);
  assert.equal(assistant?.content.includes("\n\n错误信息：模型连接失败"), true);
});

test("syncConversationTurnForJob keeps streamed output on failure even before preview sync", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "failed",
      error: {
        code: "provider_failed",
        message: "上游模型连接中断。",
      },
      transcriptEvents: [
        streamEvent({
          type: "model.output.delta",
          delta: "第一段已经显示。",
          detail: {
            kind: "thinking",
            preview: "第一段已经显示。",
          },
        }),
        streamEvent({
          sequence: 2,
          type: "model.output.delta",
          delta: "第二段还没来得及同步。",
          detail: {
            kind: "thinking",
            preview: "第二段还没来得及同步。",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "运行失败");
  assert.equal(assistant?.status, "failed");
  assert.equal(assistant?.content.includes("第一段已经显示。第二段还没来得及同步。"), true);
  assert.equal(assistant?.content.includes("错误信息：上游模型连接中断。"), true);
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
  readonly eventId?: string;
  readonly sequence?: number;
  readonly type?: PanelRunStreamEvent["type"];
  readonly summary?: string;
  readonly delta?: string;
  readonly detail: NonNullable<PanelRunStreamEvent["detail"]>;
}): PanelRunStreamEvent {
  return {
    eventId: input.eventId ?? `event-sync-${input.sequence ?? 1}`,
    runId: "run-sync",
    sequence: input.sequence ?? 1,
    type: input.type ?? "run.failed",
    createdAt: "2026-01-01T00:00:01.000Z",
    summary: input.summary,
    delta: input.delta,
    detail: input.detail,
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: [],
  };
}
