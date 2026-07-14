import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import type { PanelRunJob } from "./run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-read-model/run/panel-run-stream-contracts.js";
import { InMemoryProcessRegistry } from "../runtime-guard/index.js";
import { createRunCapabilityPlan } from "../model-capability-registry.js";
import { createMinimalRuntime } from "../runtime.js";
import {
  createLiveBasicAgentWorkViewReadModel,
  createPersistedBasicAgentReplay,
} from "./basic-agent-read-models.js";
import { createBasicAgentRunViewReadModel } from "./basic-agent-run-view.js";

test("persisted basic replay rejects incomplete Ordinary snapshots before projecting events", () => {
  const snapshot = runtimeSnapshot();

  assert.throws(
    () => createPersistedBasicAgentReplay({
      ...snapshot,
      run: {
        ...snapshot.run,
        capabilitySnapshot: undefined,
      },
    }),
    /run\.capabilitySnapshot/,
  );
});

test("basic agent run view for live runs exposes the job birth agent definition ref consistently", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const jobAgentDefinitionRef = agentRef("job-birth-agent", "Job Birth Agent");
  const run = basicRun(runAgentDefinitionRef);
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
    },
    runJobs: {
      get: () => basicJob(jobAgentDefinitionRef),
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.notEqual(view, undefined);
  assert.notDeepEqual(runAgentDefinitionRef, jobAgentDefinitionRef);
  assert.deepEqual(view?.run.agentDefinitionRef, jobAgentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, jobAgentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, view?.run.agentDefinitionRef);
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-live");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(view === undefined ? false : "workSession" in view, false);
});

test("basic agent run view prefers completed live run facts over stale job facts", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "completed" as const,
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "completed" as const,
        capabilityResolution: capabilityResolution("snapshot-stale-job", ["stale"]),
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-completed", ["read"]),
          ordinary: {
            answer: {
              content: "完成回答。",
              modelCallRefs: ["model-call-completed"],
              toolCallRefs: ["tool-call-read"],
              evidenceRefs: [],
            },
          },
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-completed",
              goalSummary: "完成运行",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "completed" as const,
              finalAnswer: "完成回答。",
              modelCallRefs: ["model-call-completed"],
              toolCallRefs: ["tool-call-read"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "已回答。",
              observationPanelRole: "开发者详情展示运行事件。",
            },
          },
        },
      }),
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.detail.status, "completed");
  assert.equal(view?.detail.canvas?.kind, "desktop_agent_canvas");
  assert.equal(view?.detail.canvas?.agent.status, "completed");
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-completed");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.notEqual(view?.capabilityResolution?.snapshotId, "snapshot-stale-job");
  assert.equal(view?.workView.answer?.content, "完成回答。");
  assert.equal(view === undefined ? false : "result" in view, false);
});

test("basic agent run view exposes failed live desktop canvas from the backend result", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "failed" as const,
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "failed" as const,
        capabilityResolution: capabilityResolution("snapshot-stale-job", ["stale"]),
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-stale-completed", ["stale-completed"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-stale-completed",
              goalSummary: "旧确认视图",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "confirmation_needed" as const,
              modelCallRefs: ["model-call-stale"],
              toolCallRefs: ["tool-call-stale"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "这是旧的确认投影，不应覆盖失败终态。",
              observationPanelRole: "开发者详情展示运行事件。",
            },
          },
        },
        failed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-failed", ["read"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-failed",
              goalSummary: "失败运行",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "failed" as const,
              failureMessage: "模型调用失败。",
              modelCallRefs: ["model-call-failed"],
              toolCallRefs: [],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "",
              observationPanelRole: "开发者详情展示运行事件。",
            },
          },
          error: {
            code: "desktop_agent_failed",
            message: "模型调用失败。",
          },
        },
      }),
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.detail.status, "failed");
  assert.equal(view?.detail.error?.code, "desktop_agent_failed");
  assert.equal(view?.detail.canvas?.kind, "desktop_agent_canvas");
  assert.equal(view?.detail.canvas?.taskSoil.taskSoilId, "task-soil-failed");
  assert.equal(view?.detail.canvas?.agent.status, "failed");
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-failed");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.equal(view?.workView.stage, "failed");
  assert.equal(view?.workView.stage, "failed");
  assert.equal(view === undefined ? false : "workSession" in view, false);
});

test("basic agent run view exposes cancelled live desktop canvas from the backend result", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "cancelled" as const,
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "cancelled" as const,
        capabilityResolution: capabilityResolution("snapshot-stale-job", ["stale"]),
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-stale-completed", ["stale-completed"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-stale-completed",
              goalSummary: "旧确认视图",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "confirmation_needed" as const,
              modelCallRefs: ["model-call-stale"],
              toolCallRefs: ["tool-call-stale"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "这是旧的确认投影，不应覆盖取消终态。",
              observationPanelRole: "开发者详情展示运行事件。",
            },
          },
        },
        cancelled: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-cancelled", ["read"]),
          reason: {
            code: "user_cancelled",
            message: "用户取消了运行。",
          },
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-cancelled",
              goalSummary: "取消运行",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "stopped" as const,
              modelCallRefs: ["model-call-cancelled"],
              toolCallRefs: ["tool-call-read"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "普通 Agent 运行已由用户取消，当前只展示取消前的运行投影。",
              observationPanelRole: "开发者详情展示运行事件。",
            },
          },
        },
      }),
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.detail.status, "cancelled");
  assert.equal(view?.detail.error?.code, "user_cancelled");
  assert.equal(view?.detail.canvas?.kind, "desktop_agent_canvas");
  assert.equal(view?.detail.canvas?.taskSoil.taskSoilId, "task-soil-cancelled");
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-cancelled");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.notEqual(view?.capabilityResolution?.snapshotId, "snapshot-stale-job");
});

test("basic agent live work view builds transcript nodes from stored backend stream events", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "approval_needed" as const,
  };
  const syncedConfirmationEvent: PanelRunStreamEvent = {
    eventId: "run-live:event:2:confirmation.needed",
    runId: run.runId,
    sequence: 2,
    type: "confirmation.needed",
    createdAt: "2026-06-06T00:00:02.000Z",
    agentLabel: "待处理",
    summary: "需要确认：编辑 Z:\\AgentArbor\\README.md",
    status: "running",
    sourceRefs: ["confirmation:confirmation-live"],
    modelCallRefs: [],
    toolCallRefs: ["tool-call-edit"],
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "approval_needed" as const,
        streamEvents: [syncedConfirmationEvent],
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-live", ["search"]),
          ordinary: {
            pendingConfirmation: {
              confirmationId: "confirmation-live",
              title: "需要你判断",
              actionSummary: "是否编辑 README.md？",
              consequence: "会写入工作区文件。",
              affectedResources: ["README.md"],
              riskLevel: "medium",
              resumeAvailability: "live",
              requestedAt: "2026-06-06T00:00:02.000Z",
              sourceRefs: ["confirmation:confirmation-live"],
            },
          },
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-confirmation",
              goalSummary: "等待你判断",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "confirmation_needed" as const,
              pendingConfirmation: {
                confirmationId: "confirmation-live",
                title: "需要你判断",
                question: "是否编辑 README.md？",
                consequence: "会写入工作区文件。",
                riskLevel: "medium",
                modelCallRefs: [],
                toolCallRefs: ["tool-call-edit"],
                sourceRefs: ["confirmation:confirmation-live"],
              },
              modelCallRefs: [],
              toolCallRefs: ["tool-call-edit"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "桌面助手等待你判断后继续。",
              observationPanelRole: "开发者详情展示运行事件。",
            },
          },
        },
      }),
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.run.status, "approval_needed");
  assert.equal(view?.workView.stage, "awaiting_approval");
  assert.equal(view?.workView.pendingConfirmation?.confirmationId, "confirmation-live");
  assert.equal(view?.workView.pendingConfirmation?.actionSummary, "是否编辑 README.md？");
  assert.equal(view?.workView.pendingConfirmation?.actionSummary.includes("会写入工作区文件"), false);
  assert.equal(view?.workView.transcriptNodes.some((node) => node.kind === "confirmation"), true);
  assert.equal(view?.detail.transcript?.events?.some((event) => event.type === "confirmation.needed"), true);
});

test("basic agent run view exposes live runtime guard facts as a read-only detail summary", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = basicRun(runAgentDefinitionRef);
  const registry = new InMemoryProcessRegistry({ now: () => "2026-06-16T00:00:00.000Z" });
  registry.register({
    processId: "process-live-dev-server",
    runId: run.runId,
    toolCallId: "tool-call-shell",
    pid: 5173,
    kind: "background",
    owned: true,
    commandLine: "pnpm dev -- --port 5173",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-16T00:00:00.000Z",
    status: "running",
    logRef: "command-log://run-live/tool-call-shell",
    logPath: "C:\\Temp\\agentarbor-command-logs\\dev.log",
    ports: [
      {
        port: 5173,
        host: "127.0.0.1",
        requestedAt: "2026-06-16T00:00:01.000Z",
        status: "ready",
        ready: true,
      },
    ],
  });
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
    },
    runJobs: {
      get: () => basicJob(runAgentDefinitionRef),
    },
    processRegistry: registry,
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, run.runId, 0);

  assert.equal(view?.detail.runtimeSummary?.kind, "panel_runtime_visibility_summary");
  assert.equal(view?.detail.runtimeSummary?.totalCount, 1);
  assert.equal(view?.detail.runtimeSummary?.processes[0]?.status, "running");
  assert.equal(view?.detail.runtimeSummary?.processes[0]?.pid, 5173);
  assert.equal(view?.detail.runtimeSummary?.processes[0]?.ports[0]?.ready, true);
  assert.equal(view?.detail.runtimeSummary?.processes[0]?.logRef, "command-log://run-live/tool-call-shell");
  assert.equal(view?.detail.runtimeSummary?.processes[0]?.logPath, "C:\\Temp\\agentarbor-command-logs\\dev.log");
  assert.equal(view?.workView.answer?.content.includes("command-log://"), undefined);
});

test("basic agent run view for persisted runs restores from the run snapshot without current config readers", async () => {
  const snapshot: RuntimeRunSnapshot = {
    ...runtimeSnapshot(),
    events: [
      runtimeEvent(1, "sub_agent.completed", "Sub-agent completed execution.", [
        { kind: "sub_agent_run", id: "sub-run-restored" },
      ]),
    ],
    subAgentRuns: [{
      parentRunId: "run-restored",
      parentToolCallId: "tool-call-sub-agent",
      subRunId: "sub-run-restored",
      subAgentId: "restored-helper",
      subAgentName: "Restored Helper",
      task: "复盘历史运行",
      status: "completed",
      startedAt: "2026-06-06T00:00:02.000Z",
      completedAt: "2026-06-06T00:00:03.000Z",
      durationMs: 1000,
      modelRounds: 1,
      toolCalls: 0,
      summary: "历史子 Agent 结果",
      fullOutput: "历史子 Agent 完整输出",
      modelExchanges: [],
      toolTraces: [],
    }],
  };
  const runtime = {
    runExecutor: {
      get: () => undefined,
      replayEvents: () => undefined,
    },
    runJobs: {
      get: () => undefined,
    },
    runtimeDatabase: {
      getRun: async () => snapshot,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-restored", 0);

  assert.notEqual(view, undefined);
  assert.equal(view?.run.runId, "run-restored");
  assert.equal(view?.run.status, "completed");
  assert.deepEqual(view?.run.agentDefinitionRef, snapshot.run.agentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, snapshot.run.agentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, view?.run.agentDefinitionRef);
  assert.deepEqual(view?.capabilityResolution, snapshot.run.capabilityResolution);
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-restored");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.equal(view?.workView.subAgentRuns?.[0]?.subRunId, "sub-run-restored");
  assert.equal(view?.workView.subAgentRuns?.[0]?.fullOutput, "历史子 Agent 完整输出");
  assert.equal(view?.workView.transcriptNodes?.some((node) => node.kind === "sub_agent" && node.subAgentRunId === "sub-run-restored"), true);
  assert.equal(view?.detail.restoredResult?.summary, "历史运行摘要");
  assert.equal(view?.detail.restoredResult?.title, "已完成");
  assert.equal(view === undefined ? false : "result" in view, false);
  assert.equal(view?.replay.events.some((event) => event.type === "sub_agent.completed"), true);
  const replayedSubAgentEvent = view?.replay.events.find((event) => event.type === "sub_agent.completed");
  assert.equal(replayedSubAgentEvent?.detail?.subAgentRunId, "sub-run-restored");
  assert.equal(replayedSubAgentEvent?.detail?.subAgentName, "Restored Helper");
  assert.equal(
    replayedSubAgentEvent?.refs.some((ref) => ref.kind === "sub_agent_run" && ref.id === "sub-run-restored"),
    true,
  );
  assert.equal(view?.replay.events.some((event) => event.type === "final.result"), true);
  assert.equal(view?.detail.transcript?.events?.some((event) => event.type === "sub_agent.completed"), true);
  assert.equal(view?.detail.transcript?.transcriptNodes?.some((node) => node.kind === "sub_agent" && node.subAgentRunId === "sub-run-restored"), true);
  assert.equal(view?.detail.transcript?.events?.some((event) => event.type === "final.result"), true);
  assert.equal(view === undefined ? false : "workSession" in view, false);
  assert.equal(JSON.stringify(view?.agentDefinitionRef).includes("systemPrompt"), false);
  assert.equal(JSON.stringify(view).includes("FULL PRIVATE SKILL BODY"), false);
});

test("basic agent run view restores full persisted ordinary answers", async () => {
  const fullAnswer = [
    "完整历史回答第一行。",
    "",
    "```ts",
    "export const preserved = true;",
    "```",
  ].join("\n");
  const snapshot: RuntimeRunSnapshot = {
    ...runtimeSnapshot(),
    run: {
      ...runtimeSnapshot().run,
      resultSummary: "短摘要",
      resultAnswer: fullAnswer,
    },
  };
  const runtime = {
    runExecutor: {
      get: () => undefined,
      replayEvents: () => undefined,
    },
    runJobs: {
      get: () => undefined,
    },
    runtimeDatabase: {
      getRun: async () => snapshot,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-restored", 0);

  assert.equal(view?.detail.restoredResult?.summary, "短摘要");
  assert.equal(view?.detail.restoredResult?.content, fullAnswer);
  assert.equal(view?.workView.answer?.content, fullAnswer);
  assert.equal(view?.workView.answer?.content.includes("```ts\nexport const preserved = true;\n```"), true);
});

test("live basic agent work view exposes sub-agent run traces", () => {
  const agentDefinitionRef = agentRef("live-agent", "Live Agent");
  const job = {
    ...basicJob(agentDefinitionRef),
    runtime: createMinimalRuntime(),
  };
  job.runtime.subAgentRunTraceStore.upsert({
    parentRunId: job.runId,
    parentToolCallId: "tool-call-sub-agent",
    subRunId: "sub-run-live",
    subAgentId: "live-helper",
    subAgentName: "Live Helper",
    task: "live task",
    status: "completed",
    startedAt: "2026-06-06T00:00:01.000Z",
    completedAt: "2026-06-06T00:00:02.000Z",
    durationMs: 1000,
    modelRounds: 1,
    toolCalls: 0,
    summary: "live result",
    fullOutput: "live full result",
    modelExchanges: [],
    toolTraces: [],
  });
  const view = createLiveBasicAgentWorkViewReadModel({
    job,
    run: basicRun(agentDefinitionRef),
    events: basicReplay(job.runId).events,
    streamEvents: [],
  });

  assert.equal(view.subAgentRuns?.[0]?.subRunId, "sub-run-live");
  assert.equal(view.subAgentRuns?.[0]?.fullOutput, "live full result");
});

test("basic agent panel read-model restores pending confirmations after refresh", async () => {
  const base = runtimeSnapshot();
  const snapshot: RuntimeRunSnapshot = {
    ...base,
    run: {
      ...base.run,
      status: "approval_needed",
      resultTitle: "待处理",
      resultSummary: "删除文件：old.txt",
    },
    confirmations: [
      {
        confirmationId: "confirmation-refresh",
        runId: base.run.runId,
        conversationId: base.run.conversationId,
        status: "pending",
        title: "删除文件",
        actionSummary: "删除文件：old.txt",
        affectedResources: ["old.txt"],
        riskLevel: "high",
        resumeAvailability: "lost_after_restart",
        requestedAt: "2026-06-06T00:00:05.000Z",
        sourceRefs: ["tool:tool-delete-old"],
        eventRefs: ["confirmation:confirmation-refresh"],
      },
    ],
  };
  const runtime = {
    runExecutor: {
      get: () => undefined,
      replayEvents: () => undefined,
    },
    runJobs: {
      get: () => undefined,
    },
    runtimeDatabase: {
      getRun: async () => snapshot,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-restored", 0);

  assert.equal(view?.run.status, "approval_needed");
  assert.equal(view?.workView.stage, "awaiting_approval");
  assert.equal(view?.workView.pendingConfirmation?.confirmationId, "confirmation-refresh");
  assert.equal(view?.workView.pendingConfirmation?.resumeAvailability, "lost_after_restart");
  assert.deepEqual(view?.workView.pendingConfirmation?.sourceRefs, ["tool:tool-delete-old"]);
  assert.equal(view?.workView.transcriptNodes?.some((node) => node.kind === "confirmation"), true);
  assert.equal(view?.detail.status, "approval_needed");
  assert.equal(view?.detail.transcript?.events?.some((event) => event.type === "confirmation.needed"), true);
  assert.equal(view?.replay.events.some((event) => event.type === "confirmation.needed"), true);
});

test("terminal persisted runs ignore stale pending confirmations", async () => {
  const base = runtimeSnapshot();
  for (const status of ["failed", "cancelled"] as const) {
    const snapshot: RuntimeRunSnapshot = {
      ...base,
      run: {
        ...base.run,
        status,
      },
      confirmations: [{
        confirmationId: `confirmation-${status}`,
        runId: base.run.runId,
        conversationId: base.run.conversationId,
        status: "pending",
        title: "过期确认",
        actionSummary: "不应继续展示",
        affectedResources: ["old.txt"],
        riskLevel: "high",
        requestedAt: "2026-06-06T00:00:05.000Z",
        eventRefs: [`confirmation:confirmation-${status}`],
      }],
    };
    const runtime = {
      runExecutor: {
        get: () => undefined,
        replayEvents: () => undefined,
      },
      runJobs: {
        get: () => undefined,
      },
      runtimeDatabase: {
        getRun: async () => snapshot,
      },
    } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

    const view = await createBasicAgentRunViewReadModel(runtime, base.run.runId, 0);

    assert.equal(view?.workView.pendingConfirmation, undefined);
    assert.equal(view?.workView.transcriptNodes?.some((node) => node.kind === "confirmation"), false);
    assert.equal(view?.replay.events.some((event) => event.type === "confirmation.needed"), false);
  }
});

test("basic agent run view does not invent restored result titles", async () => {
  const base = runtimeSnapshot();
  const snapshot: RuntimeRunSnapshot = {
    ...base,
    run: {
      ...base.run,
      resultTitle: undefined,
      resultSummary: "只有历史摘要",
    },
  };
  const runtime = {
    runExecutor: {
      get: () => undefined,
      replayEvents: () => undefined,
    },
    runJobs: {
      get: () => undefined,
    },
    runtimeDatabase: {
      getRun: async () => snapshot,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-restored", 0);

  assert.equal(view?.detail.restoredResult?.title, "");
  assert.equal(view?.detail.restoredResult?.summary, "只有历史摘要");
  assert.equal(JSON.stringify(view).includes("上次结果"), false);
});

function basicRun(agentDefinitionRef: RunAgentDefinitionRef): BasicAgentRun {
  return {
    runId: "run-live",
    conversationId: "conversation-live",
    title: "正在处理",
    goalSummary: "测试 live run view",
    status: "running",
    runMode: "agent",
    agentDefinitionRef,
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:01.000Z",
    eventCursor: {
      lastSequence: 1,
      eventCount: 1,
    },
  };
}

function basicReplay(runId: string): {
  readonly events: readonly RunEvent[];
  readonly cursor: { readonly runId: string; readonly lastSequence: number; readonly eventCount: number };
} {
  return {
    events: [
      {
        id: `${runId}:event:1`,
        runId,
        sequence: 1,
        type: "run.started",
        title: "任务已开始",
        summary: "开始处理。",
        status: "running",
        timestamp: "2026-06-06T00:00:01.000Z",
        refs: [],
        visibility: "compact",
      },
    ],
    cursor: {
      runId,
      lastSequence: 1,
      eventCount: 1,
    },
  };
}

function basicJob(agentDefinitionRef: RunAgentDefinitionRef): PanelRunJob {
  return {
    runId: "run-live",
    runKind: "desktop",
    runMode: "agent",
    goal: "测试 live run view",
    aiMode: "fake",
    conversationId: "conversation-live",
    agentDefinitionRef,
    createdAt: "2026-06-06T00:00:00.000Z",
    status: "running",
    updatedAt: "2026-06-06T00:00:01.000Z",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilityResolution: capabilityResolution("snapshot-live", ["search"]),
    streamEvents: [],
    confirmationDecisions: [],
  };
}

function agentRef(agentId: string, agentDisplayName: string): RunAgentDefinitionRef {
  return {
    agentId,
    agentDisplayName,
    promptRef: `prompt:${agentId}:v1`,
    promptVersion: "1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: `${agentId}:ordinary-visible-tools:v1`,
  };
}

function runtimeSnapshot(): RuntimeRunSnapshot {
  return {
    run: {
      runId: "run-restored",
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status: "completed",
      goalSummary: "恢复历史运行",
      aiMode: "fake",
      conversationId: "conversation-restored",
      traceId: "trace-restored",
      appHome: "C:\\AgentArbor\\app",
      runHome: "C:\\AgentArbor\\runtime\\runs\\run-restored",
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:10.000Z",
      completedAt: "2026-06-06T00:00:10.000Z",
      resultTitle: "已完成",
      resultSummary: "历史运行摘要",
      agentDefinitionRef: {
        agentId: "restored-basic-agent",
        agentDisplayName: "Restored Basic Agent",
        promptRef: "prompt:restored-basic-agent:v1",
        promptVersion: "1",
        outputContractId: "desktop.agent_response.v1",
        toolVisibilityProfileId: "restored-basic-agent:ordinary-visible-tools:v1",
      },
      capabilitySnapshot: capabilitySnapshot(),
      capabilityResolution: capabilityResolution("snapshot-restored", ["read"]),
      informationAccess: informationAccess(),
    },
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
    subAgentRuns: [],
  };
}

function runtimeEvent(
  sequence: number,
  type: RuntimeRunSnapshot["events"][number]["type"],
  summary: string,
  refs: RuntimeRunSnapshot["events"][number]["refs"] = [],
): RuntimeRunSnapshot["events"][number] {
  return {
    eventId: `run-restored:event:${sequence}`,
    runId: "run-restored",
    sequence,
    type,
    summary,
    scope: "runtime",
    severity: "info",
    progress: {
      status: "completed",
      label: type,
    },
    refs,
    traceId: "trace-restored",
    intent: type.replaceAll(".", "_"),
    createdAt: `2026-06-06T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    recordedAt: `2026-06-06T00:00:${String(sequence).padStart(2, "0")}.000Z`,
  };
}

function capabilityResolution(snapshotId: string, allowedTools: readonly string[]): RunCapabilityResolution {
  const snapshot = {
    ...capabilitySnapshot(),
    snapshotId,
  };
  const warnings: readonly string[] = [];
  return {
    resolutionId: `capability-resolution-${snapshotId}`,
    snapshotId,
    runMode: "agent",
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    capabilityPlan: createRunCapabilityPlan({
      profile: snapshot.activeModel,
      modelCapabilities: snapshot.modelCapabilities,
      allowedTools,
      warnings,
    }),
    allowedTools,
    toolExposures: allowedTools.map((name) => ({
      name,
      displayName: name === "read" ? "Read" : "Search",
      enabled: true,
      modelVisible: true,
      scopes: ["desktop-basic"],
      availability: "available",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
      reason: "可用。",
    })),
    enabledSkills: [],
    mcpDrafts: [],
    warnings,
    createdAt: "2026-06-06T00:00:00.000Z",
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-restored",
    createdAt: "2026-06-06T00:00:00.000Z",
    activeModel: modelConfig(),
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
    },
    toolCatalog: { scope: "desktop-basic", tools: [], allowedTools: [] },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\AgentArbor",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    securitySummary: "Frozen safe capability facts.",
    warnings: [],
  };
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    defaultAiMode: "fake",
    profileId: "snapshot-profile",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://snapshot.example.test",
    model: "snapshot-model",
    secretRef: "secret://snapshot/model",
    secretConfigured: false,
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web", "codebase"],
    web: {
      provider: "tavily",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret://snapshot/tavily",
      secretConfigured: false,
      status: "ready",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub",
      packages: "stub",
      github: "readonly_stub",
      run_memory: "stub",
    },
  };
}
