import test from "node:test";
import assert from "node:assert/strict";
import { PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import type { PanelRunJob } from "./run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-read-model/run/panel-run-stream-contracts.js";
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
          observationPanelRole: "展示运行投影。",
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

test("syncConversationTurnForJob records fake runs as the actual fake response model", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "completed",
      modelCalls: [
        {
          requestId: "model-call-fake",
          status: "completed",
          providerKind: "fake",
          protocolKind: "openai_compatible_chat_completions",
          model: "fake-deterministic-model",
          candidateRefs: [],
          eventRefs: [],
        },
      ],
      canvas: {
        kind: "desktop_agent_canvas",
        taskSoil: taskSoilCanvas(),
        agent: {
          status: "completed",
          answer: {
            answer: "fake 运行完成。",
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
          resultWhyReasonable: "基于 fake 模型输出。",
          observationPanelRole: "展示运行投影。",
        },
      },
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.deepEqual(assistant?.responseModel, {
    profileId: "fake",
    label: "Fake",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: undefined,
    model: "fake-deterministic-model",
  });
});

test("syncConversationTurnForJob keeps long desktop answers intact", () => {
  const { conversations, job } = startedConversationJob();
  const longAnswer = `开头\n${"普通桌面 agent 线性会话回答。".repeat(220)}\n结尾`;

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
            answer: longAnswer,
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
          observationPanelRole: "展示运行投影。",
        },
      },
    }),
  });

  const conversation = conversations.getReadModel(job.conversationId ?? "");
  const assistant = conversation?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.content, longAnswer);
  assert.equal(assistant?.content.endsWith("结尾"), true);
});

test("syncConversationTurnForJob does not complete without visible canvas output", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "completed",
    }),
  });

  const conversation = conversations.getReadModel(job.conversationId ?? "");
  const assistant = conversation?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content, "");
  assert.equal(assistant?.status, "failed");
  assert.equal(JSON.stringify(assistant).includes("结果已生成"), false);
  assert.equal(JSON.stringify(assistant).includes("结果已经整理完成"), false);
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
            confirmationId: "confirmation-delete",
            title: "需要你判断",
            question: "是否删除文件？",
            consequence: "会移除工作区文件。",
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
          resultWhyReasonable: "等待你判断后继续。",
          observationPanelRole: "展示运行投影。",
        },
      },
    }),
  });

  const conversation = conversations.getReadModel(job.conversationId ?? "");
  const assistant = conversation?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "待处理");
  assert.equal(assistant?.content.includes("是否删除文件？"), true);
  assert.equal(assistant?.content.includes("会移除工作区文件。"), false);
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
            title: "需要你判断",
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
          resultWhyReasonable: "等待你判断后继续。",
          observationPanelRole: "展示运行投影。",
        },
      },
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "待处理");
  assert.equal(assistant?.content, "删除文件：C:\\repo\\old.txt");
});

test("syncConversationTurnForJob keeps needs-input turns as empty user-action shells", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({ status: "needs_input" }),
  });

  const summary = conversations.list().find((item) => item.conversationId === job.conversationId);
  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "需要补充");
  assert.equal(assistant?.content, "");
  assert.equal(assistant?.content.includes("已收到补充指导"), false);
  assert.equal(assistant?.content.includes("已收到补充要求"), false);
  assert.equal(assistant?.status, "needs_input");
  assert.equal(summary?.status, "needs_input");
  assert.equal(summary?.requiresUserAction, true);
  assert.equal(summary?.currentAction, "");
  assert.equal(summary?.nextStep, "");
});

test("syncConversationTurnForJob keeps queued turns as empty waiting shells", () => {
  const { conversations, job } = startedConversationJob();

  job.status = "pending";
  syncConversationTurnForJob({
    conversations,
    job,
    response: response({ status: "pending" }),
  });

  const summary = conversations.list().find((item) => item.conversationId === job.conversationId);
  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content, "");
  assert.equal(assistant?.status, "pending");
  assert.equal(summary?.status, "running");
  assert.equal(JSON.stringify(assistant).includes("等待前一个任务完成"), false);
});

test("syncConversationTurnForJob keeps blocked turns visible as user-action summaries", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "blocked",
      error: {
        code: "context_overflow",
        message: "上下文超过预算，需要补充方向后继续。",
      },
    }),
  });

  const summary = conversations.list().find((item) => item.conversationId === job.conversationId);
  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "需要处理");
  assert.equal(assistant?.status, "blocked");
  assert.equal(summary?.status, "blocked");
  assert.equal(summary?.requiresUserAction, true);
  assert.equal(summary?.currentAction.includes("上下文超过预算"), true);
});

test("syncConversationTurnForJob keeps blocked fallback concise", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "blocked",
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "需要处理");
  assert.equal(assistant?.status, "blocked");
  assert.equal(assistant?.content, "这次操作无法原地继续。你可以发送新消息，让我基于当前上下文继续。");
  assert.equal(JSON.stringify(assistant).includes("无法继续原操作"), false);
});

test("syncConversationTurnForJob preserves partial model output on blocked turns", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "blocked",
      error: {
        code: "out_of_fuel",
        message: "达到轮次边界，需要继续。",
      },
      transcriptEvents: [
        streamEvent({
          type: "model.output.delta",
          delta: "我已经定位到失败测试，还没完成修改。",
          detail: {
            kind: "thinking",
            preview: "我已经定位到失败测试，还没完成修改。",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "需要处理");
  assert.equal(assistant?.status, "blocked");
  assert.equal(assistant?.content.includes("我已经定位到失败测试"), true);
  assert.equal(assistant?.content.includes("停止原因：达到轮次边界，需要继续。"), true);
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
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content.includes("正在整理可见回答"), true);
  assert.equal(assistant?.content.includes("启动占位"), false);
  assert.equal(assistant?.content.includes(secret), true);
  assert.equal(assistant?.status, "running");
  assert.equal(summary?.status, "running");
  assert.equal(summary?.currentAction.includes("正在整理可见回答"), true);
  assert.equal(summary?.currentAction.includes(secret), true);
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
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content, "Now let me demonstrate.");
});

test("syncConversationTurnForJob suppresses pre-tool model output after confirmation resumes", () => {
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
          delta: "很好，探索已经开始！让我继续展示更多能力。",
          detail: {
            kind: "thinking",
            preview: "很好，探索已经开始！让我继续展示更多能力。",
          },
          modelCallRefs: ["model-before-tool"],
        }),
        streamEvent({
          sequence: 2,
          type: "tool.requested",
          summary: "运行命令：dir",
          detail: {
            kind: "tool",
            action: "运行命令",
            preview: "运行命令：dir",
          },
          toolCallRefs: ["call-dir"],
        }),
        streamEvent({
          sequence: 3,
          type: "confirmation.needed",
          summary: "运行命令：dir",
          detail: {
            kind: "confirmation",
            preview: "运行命令：dir",
          },
          toolCallRefs: ["call-dir"],
        }),
        streamEvent({
          sequence: 4,
          type: "user_approval.received",
          summary: "已继续。",
          detail: {
            kind: "confirmation",
            preview: "已继续。",
          },
        }),
        streamEvent({
          sequence: 5,
          type: "run.resumed",
          summary: "继续执行。",
          detail: {
            kind: "work",
            preview: "继续执行。",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content.includes("探索已经开始"), false);
  assert.equal(assistant?.content, "");
});

test("syncConversationTurnForJob suppresses previous model output while context compaction is running", () => {
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
          delta: "这段旧输出不应在压缩中继续显示。",
          detail: {
            kind: "thinking",
            preview: "这段旧输出不应在压缩中继续显示。",
          },
          modelCallRefs: ["model-before-compaction"],
        }),
        streamEvent({
          sequence: 2,
          type: "context.compaction.requested",
          summary: "正在压缩较早上下文…",
          detail: {
            kind: "thinking",
            preview: "正在压缩较早上下文…",
          },
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content.includes("旧输出"), false);
  assert.equal(assistant?.content, "");
});

test("syncConversationTurnForJob waits for post-tool model output before showing a new answer", () => {
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
          delta: "我先运行命令看一下。",
          detail: {
            kind: "thinking",
            preview: "我先运行命令看一下。",
          },
          modelCallRefs: ["model-before-tool"],
        }),
        streamEvent({
          sequence: 2,
          type: "tool.requested",
          summary: "运行命令：dir",
          detail: {
            kind: "tool",
            action: "运行命令",
            preview: "运行命令：dir",
          },
          toolCallRefs: ["call-dir"],
        }),
        streamEvent({
          sequence: 3,
          type: "tool.completed",
          summary: "dir · exit 0",
          detail: {
            kind: "tool",
            action: "运行命令",
            preview: "dir · exit 0",
          },
          toolCallRefs: ["call-dir"],
        }),
      ],
    }),
  });

  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content.includes("我先运行命令"), false);
  assert.equal(assistant?.content, "");

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "running",
      transcriptEvents: [
        streamEvent({
          sequence: 1,
          type: "model.output.delta",
          delta: "我先运行命令看一下。",
          detail: {
            kind: "thinking",
            preview: "我先运行命令看一下。",
          },
          modelCallRefs: ["model-before-tool"],
        }),
        streamEvent({
          sequence: 2,
          type: "tool.requested",
          summary: "运行命令：dir",
          detail: {
            kind: "tool",
            action: "运行命令",
            preview: "运行命令：dir",
          },
          toolCallRefs: ["call-dir"],
        }),
        streamEvent({
          sequence: 3,
          type: "tool.completed",
          summary: "dir · exit 0",
          detail: {
            kind: "tool",
            action: "运行命令",
            preview: "dir · exit 0",
          },
          toolCallRefs: ["call-dir"],
        }),
        streamEvent({
          sequence: 4,
          type: "model.output.delta",
          delta: "命令结果显示当前目录可以读取。",
          detail: {
            kind: "thinking",
            preview: "命令结果显示当前目录可以读取。",
          },
          modelCallRefs: ["model-after-tool"],
        }),
      ],
    }),
  });

  const updated = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(updated?.title, "");
  assert.equal(updated?.content, "命令结果显示当前目录可以读取。");
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
  assert.equal(assistant?.title, "");
  assert.equal(assistant?.content, "");
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
  assert.equal(assistant?.title, "未完成");
  assert.equal(assistant?.status, "failed");
  assert.equal(assistant?.content.includes("错误信息：HTTP 401"), true);
  assert.equal(assistant?.content.includes("HTTP 401"), true);
  assert.equal(assistant?.content.includes(secret), true);
});

test("syncConversationTurnForJob does not complete failed turns with forged answer canvas", () => {
  const { conversations, job } = startedConversationJob();

  syncConversationTurnForJob({
    conversations,
    job,
    response: response({
      status: "failed",
      error: {
        code: "provider_failed",
        message: "模型服务中断，没有形成最终回答。",
      },
      canvas: {
        kind: "desktop_agent_canvas",
        taskSoil: taskSoilCanvas(),
        agent: {
          status: "completed",
          answer: {
            answer: "这段内容看起来像最终回答，但失败状态不能被包装成完成。",
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
          resultWhyReasonable: "伪造的完成说明不应覆盖失败终态。",
          observationPanelRole: "展示运行投影。",
        },
      },
    }),
  });

  const summary = conversations.list().find((item) => item.conversationId === job.conversationId);
  const assistant = conversations.getReadModel(job.conversationId ?? "")?.turns.find((turn) => turn.role === "assistant");
  assert.equal(assistant?.title, "未完成");
  assert.equal(assistant?.status, "failed");
  assert.equal(summary?.status, "failed");
  assert.equal(assistant?.content.includes("看起来像最终回答"), false);
  assert.equal(assistant?.content.includes("错误信息：模型服务中断，没有形成最终回答。"), true);
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
  assert.equal(assistant?.title, "未完成");
  assert.equal(assistant?.status, "failed");
  assert.equal(assistant?.content.includes("已经输出的内容。"), true);
  assert.equal(assistant?.content.includes("错误信息：模型服务的流式返回格式不兼容"), true);
  assert.equal(assistant?.content.includes("OpenAI-compatible provider stream response could not be parsed"), false);
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
  assert.equal(assistant?.title, "未完成");
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
  readonly modelCalls?: PanelConversationSyncRunResponse["transcript"]["modelCalls"];
}): PanelConversationSyncRunResponse {
  return {
    status: input.status,
    config: config(),
    error: input.error,
    canvas: input.canvas,
    transcript: {
      events: input.transcriptEvents ?? [],
      modelCalls: input.modelCalls ?? [
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
  readonly status?: PanelRunStreamEvent["status"];
  readonly summary?: string;
  readonly delta?: string;
  readonly detail: NonNullable<PanelRunStreamEvent["detail"]>;
  readonly modelCallRefs?: readonly string[];
  readonly toolCallRefs?: readonly string[];
}): PanelRunStreamEvent {
  return {
    eventId: input.eventId ?? `event-sync-${input.sequence ?? 1}`,
    runId: "run-sync",
    sequence: input.sequence ?? 1,
    type: input.type ?? "run.failed",
    createdAt: "2026-01-01T00:00:01.000Z",
    summary: input.summary,
    delta: input.delta,
    status: input.status,
    detail: input.detail,
    sourceRefs: [],
    modelCallRefs: input.modelCallRefs ?? [],
    toolCallRefs: input.toolCallRefs ?? [],
  };
}
