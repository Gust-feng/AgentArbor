/**
 * Shared fixtures for DeepChildScheduler tests:
 *   1. startQueued 并发启动多个 child 且 onChildStarted 回调记录到多个 started 先于任何 completed；
 *   2. waitForProgress 等待任一终态并返回新终态材料列表（并发槽空闲时继续启动 pending）；
 *   3. cancelPendingAndRunning 后 pending 置 cancelled 且后续 startQueued 为 no-op；
 *   4. 单 child 抛错经 buildFailedChildExploration 降级为 failed task，不击穿（FR-SCH-04）；
 *   5. enqueue 复用 deriveDeepChildren 守数量上限（overflowCount 可观察）。
 *
 * 回调用 mock 注入验证调用顺序，不依赖 T2-1 runtime 装配（tasks.md T1-3 注）。
 */
import {
  blockChildAgentRun,
  failChildAgentRun,
  interruptChildAgentRun,
  type ChildAgentRun,
} from "../../domain/underground/agent-fabric.js";
import type { AgentTurnPendingApproval } from "../../kernel/intelligence/agent-turn-runtime.js";
import { resetIdsForTests } from "../../kernel/id.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepChildStatus,
  DeepChildTask,
} from "./contracts.js";
import { DeepTaskBoard } from "./deep-task-board.js";
import { DeepChildScheduler } from "./deep-child-scheduler.js";
import type {
  ContinueDeepChildFactory,
  ExploreDeepChildFactory,
} from "./deep-child-scheduler-contracts.js";
import type { ExploreDeepChildResult } from "./child-delegation.js";

export type SchedulerEvent =
  | { readonly kind: "started"; readonly childRunId: string }
  | { readonly kind: "terminal"; readonly childRunId: string; readonly status: DeepChildStatus }
  | {
      readonly kind: "instruction_queued";
      readonly childRunId: string;
      readonly instructionId: string;
      readonly queuedCount: number;
      readonly source: "manager" | "control_api";
      readonly hasRawInstruction: boolean;
    }
  | {
      readonly kind: "instruction_recorded";
      readonly childRunId: string;
      readonly instructionId: string;
      readonly source: "manager" | "control_api";
      readonly status: "queued" | "executed" | "cancelled";
      readonly instruction: string;
    };

/**
 * 构造一个可控的 exploreFactory：每次调用记录顺序并把 resolve/reject 控制权交给测试。
 * 测试在断言"started 先于 completed"后才触发 resolve，从而证明多个 child 已并发进入
 * running（而非串行 await 完成）。
 */
export function createDeferredFactory(specByChildRunId: Map<string, DeepChildSpec>): {
  readonly factory: ExploreDeepChildFactory;
  readonly callOrder: () => readonly string[];
  readonly resolveSuccess: (childRunId: string) => void;
  readonly resolveBlocked: (childRunId: string) => void;
  readonly resolveFailed: (childRunId: string) => void;
  readonly resolveInterrupted: (childRunId: string) => void;
  readonly resolveBlockedWithContinuation: (childRunId: string) => void;
  readonly reject: (childRunId: string, error: Error) => void;
} {
  const childRuns = new Map<string, ChildAgentRun>();
  const resolvers = new Map<string, (result: ExploreDeepChildResult) => void>();
  const rejecters = new Map<string, (error: Error) => void>();
  const callOrder: string[] = [];
  const factory: ExploreDeepChildFactory = (childRun) => {
    childRuns.set(childRun.childRunId, childRun);
    callOrder.push(childRun.childRunId);
    return new Promise<ExploreDeepChildResult>((resolve, reject) => {
      resolvers.set(childRun.childRunId, resolve);
      rejecters.set(childRun.childRunId, reject);
    });
  };
  const buildSuccess = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "completed",
      summary: `${childRunId} 探索完成`,
      findings: ["f"],
      evidenceRefs: ["e"],
      confidence: 0.8,
      uncertainty: "u",
    };
    return { summary, completedRun: childRun };
  };
  const buildBlocked = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "blocked",
      summary: `${childRunId} 等待确认`,
      findings: ["需要用户确认后继续"],
      evidenceRefs: ["call-needs-approval"],
      confidence: 0,
      uncertainty: "waiting for tool confirmation",
    };
    return {
      summary,
      completedRun: blockChildAgentRun({
        run: childRun,
        reason: "waiting for tool confirmation",
        evidenceRefs: ["call-needs-approval"],
        uncertainty: "waiting for tool confirmation",
        blockedAt: "2026-05-01T00:00:01.000Z",
      }),
    };
  };
  const buildBlockedWithContinuation = (childRunId: string): ExploreDeepChildResult => {
    const result = buildBlocked(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const pendingApproval = fakePendingApproval("confirm-call-needs-approval");
    const completedRun = blockChildAgentRun({
      run: result.completedRun,
      reason: result.completedRun.failureReason ?? "waiting for tool confirmation",
      evidenceRefs: result.completedRun.evidenceRefs,
      uncertainty: result.completedRun.uncertainty,
      pendingApproval: {
        confirmationId: pendingApproval.confirmationId,
        toolCallId: pendingApproval.toolLoop.pendingToolCall.callId,
        toolName: pendingApproval.toolLoop.pendingToolCall.toolName,
        title: "需要确认",
        actionSummary: "运行 search",
        affectedResources: ["search"],
        riskLevel: "medium",
        resumeAvailability: "live",
        requestedAt: "2026-05-01T00:00:00.000Z",
        sourceRefs: ["call-needs-approval"],
      },
      blockedAt: result.completedRun.completedAt ?? "2026-05-01T00:00:01.000Z",
    });
    return {
      ...result,
      completedRun,
      pendingContinuation: {
        childRunId,
        confirmationId: pendingApproval.confirmationId,
        childRun: completedRun,
        childSpec: spec,
        pendingApproval,
      },
    };
  };
  const buildFailed = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "failed",
      summary: `${childRunId} 输出材料不合约`,
      findings: [],
      evidenceRefs: [],
      confidence: 0,
      uncertainty: "invalid child material",
    };
    return {
      summary,
      completedRun: failChildAgentRun(
        childRun,
        "invalid child material",
        "2026-05-01T00:00:01.000Z",
        {
          modelRounds: 2,
          toolRounds: 1,
          toolCalls: [
            { callId: "call-search", toolName: "search", status: "completed" },
          ],
        },
      ),
    };
  };
  const buildInterrupted = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "interrupted",
      summary: `${childRunId} 子 Agent 中断`,
      findings: ["子 Agent 自身中断，需要父层审查后继续"],
      evidenceRefs: [],
      confidence: 0,
      uncertainty: "child interrupted before producing enough material",
    };
    return {
      summary,
      completedRun: interruptChildAgentRun(
        childRun,
        "child interrupted before producing enough material",
        "2026-05-01T00:00:01.000Z",
      ),
    };
  };
  return {
    factory,
    callOrder: () => callOrder,
    resolveSuccess: (childRunId) => resolvers.get(childRunId)?.(buildSuccess(childRunId)),
    resolveBlocked: (childRunId) => resolvers.get(childRunId)?.(buildBlocked(childRunId)),
    resolveBlockedWithContinuation: (childRunId) =>
      resolvers.get(childRunId)?.(buildBlockedWithContinuation(childRunId)),
    resolveFailed: (childRunId) => resolvers.get(childRunId)?.(buildFailed(childRunId)),
    resolveInterrupted: (childRunId) => resolvers.get(childRunId)?.(buildInterrupted(childRunId)),
    reject: (childRunId, error) => rejecters.get(childRunId)?.(error),
  };
}

export function sampleSpec(id: string): DeepChildSpec {
  return {
    specId: id,
    displayName: `${id} 角度`,
    role: id,
    objective: `${id} 目标`,
    allowedTools: ["search"],
    inputRefs: ["goal:1"],
  };
}

export function fakePendingApproval(confirmationId: string): AgentTurnPendingApproval {
  return {
    confirmationId,
    modelRequest: {
      requestId: "model-request-test",
      traceId: "trace-1",
      callerRef: { kind: "agent_run", id: "child-run" },
      purpose: "deep_child_material",
      inputRefs: [],
      sanitizedMessages: [{ role: "user", content: "continue" }],
      outputContract: {
        contractId: "deep.child_material.v1",
        outputKind: "evidence_suggestion",
        format: "json_object",
        requiredFields: [],
      },
      constraintRefs: [],
      budget: {},
      sensitivity: "internal",
      requestedAt: "2026-05-01T00:00:00.000Z",
    },
    toolLoop: {
      confirmationId,
      pendingToolCall: {
        callId: "call-needs-approval",
        toolName: "search",
        input: {},
      },
      pendingToolResult: {
        callId: "call-needs-approval",
        toolName: "search",
        input: {},
        output: undefined,
        status: "approval_required",
        durationMs: 0,
      },
      remainingToolCallsAfterApproval: [],
      messagesBeforeToolCall: [{ role: "user", content: "continue" }],
      assistantMessage: {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "call-needs-approval", toolName: "search", input: {} }],
      },
      completedToolResults: [],
      toolCallsBeforeApproval: [],
      modelRounds: 1,
      rounds: 0,
      requestId: "model-request-resume",
    },
    policy: {
      allowModel: true,
      allowedTools: ["search"],
      fallback: "disabled",
      callerAgentId: "deep-child",
      traceId: "trace-1",
      goalId: "goal-1",
      purpose: "deep_child_material",
      outputContract: {
        contractId: "deep.child_material.v1",
        outputKind: "evidence_suggestion",
        format: "json_object",
        requiredFields: [],
      },
      sensitivity: "internal",
      budget: {},
    },
  };
}

export type Harness = {
  readonly scheduler: DeepChildScheduler;
  readonly events: SchedulerEvent[];
  readonly tasks: readonly DeepChildTask[];
  readonly resolveSuccess: (childRunId: string) => void;
  readonly resolveBlocked: (childRunId: string) => void;
  readonly resolveFailed: (childRunId: string) => void;
  readonly resolveInterrupted: (childRunId: string) => void;
  readonly resolveBlockedWithContinuation: (childRunId: string) => void;
  readonly reject: (childRunId: string, error: Error) => void;
  readonly callOrder: () => readonly string[];
  readonly childRunIdBySpec: (specId: string) => string;
};

export function setupHarness(opts: {
  readonly specs: readonly DeepChildSpec[];
  readonly maxConcurrency: number;
  readonly maxChildren?: number;
  readonly continueFactory?: ContinueDeepChildFactory;
}): Harness {
  resetIdsForTests();
  const specByChildRunId = new Map<string, DeepChildSpec>();
  const events: SchedulerEvent[] = [];
  const board = new DeepTaskBoard({ runId: "run-1" });
  const controller = createDeferredFactory(specByChildRunId);
  const scheduler = new DeepChildScheduler({
    board,
    exploreFactory: controller.factory,
    continueFactory: opts.continueFactory,
    maxConcurrency: opts.maxConcurrency,
    maxChildren: opts.maxChildren,
    callbacks: {
      onChildStarted: (task) => {
        events.push({ kind: "started", childRunId: task.childRunId });
      },
      onChildTerminal: (task) => {
        events.push({ kind: "terminal", childRunId: task.childRunId, status: task.status });
      },
      onChildInstructionQueued: (task, queued) => {
        events.push({
          kind: "instruction_queued",
          childRunId: task.childRunId,
          instructionId: queued.instructionId,
          queuedCount: queued.queuedCount,
          source: queued.source,
          hasRawInstruction: Object.prototype.hasOwnProperty.call(queued, "instruction"),
        });
      },
      onChildInstructionRecorded: (instruction) => {
        events.push({
          kind: "instruction_recorded",
          childRunId: instruction.childRunId,
          instructionId: instruction.instructionId,
          source: instruction.source,
          status: instruction.status,
          instruction: instruction.instruction,
        });
      },
    },
  });
  const result = scheduler.enqueue({
    specs: opts.specs,
    parentAgentId: "deep-runtime-manager",
    goalId: "goal-1",
    traceId: "trace-1",
  });
  for (const task of result.tasks) {
    specByChildRunId.set(task.childRunId, task.spec);
  }
  const childRunIdBySpec = (specId: string): string => {
    const task = result.tasks.find((t) => t.spec.specId === specId);
    if (task === undefined) {
      throw new Error(`no task for spec ${specId}`);
    }
    return task.childRunId;
  };
  return {
    scheduler,
    events,
    tasks: result.tasks,
    resolveSuccess: controller.resolveSuccess,
    resolveBlocked: controller.resolveBlocked,
    resolveFailed: controller.resolveFailed,
    resolveInterrupted: controller.resolveInterrupted,
    resolveBlockedWithContinuation: controller.resolveBlockedWithContinuation,
    reject: controller.reject,
    callOrder: controller.callOrder,
    childRunIdBySpec,
  };
}
