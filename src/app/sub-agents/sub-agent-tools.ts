import type { ArborMessage } from "../../domain/common.js";
import type { ConfirmationRequest } from "../../domain/basic-agent/index.js";
import type { IntelligenceChannel } from "../../domain/intelligence/contracts.js";
import type {
  ToolCallResult,
  ToolConfirmationPolicy,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolExecutor,
  ToolExecutorResult,
  ToolInputSchema,
} from "../../domain/tools/contracts.js";
import type { SubAgentRunTraceSink } from "../../domain/sub-agents/contracts.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { ToolRegistry, ToolRegistryScope } from "../basic-agent-runtime/tool-registry.js";
import {
  createSubAgentBatchCompletedMessage,
  createSubAgentBatchStartedMessage,
} from "./sub-agent-events.js";
import { runSubAgent, type SubAgentRunnerResult } from "./sub-agent-runner.js";
import type { SubAgentDefinition, SubAgentSourceKind } from "./sub-agent-loader.js";
import type { SubAgentRegistry } from "./sub-agent-registry.js";

type SubAgentToolDependencies = {
  readonly subAgentRegistry: SubAgentRegistry;
  readonly channel: IntelligenceChannel;
  readonly toolBroker: ToolExecutionBroker;
  readonly allowedTools: () => readonly string[];
  readonly confirmationPolicy?: () => ToolConfirmationPolicy | undefined;
  readonly publishToolEvent?: (message: ArborMessage) => void;
  readonly traceSink?: SubAgentRunTraceSink;
  readonly eventLog?: { append: (message: ArborMessage) => void };
};

type SubAgentToolDefinitionsOptions = {
  readonly includeSpawnTool?: boolean;
};

type SubAgentToolsOptions = SubAgentToolDependencies & SubAgentToolDefinitionsOptions;

type CallSubAgentInput = {
  readonly sub_agent_name: string;
  readonly task: string;
  readonly context?: string;
};

type CallSubAgentsTaskInput = {
  readonly sub_agent_name: string;
  readonly task: string;
  readonly context?: string;
};

type CallSubAgentsInput = {
  readonly tasks: readonly CallSubAgentsTaskInput[];
  readonly max_concurrency?: number;
};

type SpawnSubAgentInput = {
  readonly role: string;
  readonly system_prompt: string;
  readonly task: string;
  readonly allowed_tools?: readonly string[];
  readonly context?: string;
};

type SubAgentToolRuntimeDependencies = SubAgentToolDependencies & {
  readonly pendingApprovals: SubAgentPendingApprovalStore;
};

type PendingBatchState = {
  readonly batchId: string;
  readonly startTime: number;
  readonly maxConcurrency: number;
  readonly pendingIndex: number;
  readonly completedResults: readonly BatchSubAgentResult[];
  readonly remainingTasks: readonly CallSubAgentsTaskInput[];
  readonly deferredApprovals: readonly PendingBatchApproval[];
};

type PendingSubAgentContinuation = {
  readonly subAgent: SubAgentDefinition;
  readonly task: string;
  readonly context?: string;
  readonly pendingApproval: NonNullable<SubAgentRunnerResult["pendingApproval"]>;
  readonly parentToolCallId?: string;
  readonly batchId?: string;
  readonly batchIndex?: number;
  readonly batch?: PendingBatchState;
};

type BatchSubAgentResult = {
  readonly index: number;
  readonly sub_agent_id: string;
  readonly sub_agent_name: string;
  readonly task: string;
  readonly result: SubAgentRunnerResult;
};

type BatchApprovalPause = {
  readonly subAgent: SubAgentDefinition;
  readonly task: CallSubAgentsTaskInput;
  readonly batchResult: BatchSubAgentResult;
  readonly pendingApproval: NonNullable<SubAgentRunnerResult["pendingApproval"]>;
};

type PendingBatchApproval = {
  readonly subAgent: SubAgentDefinition;
  readonly task: string;
  readonly context?: string;
  readonly batchIndex: number;
  readonly batchResult: BatchSubAgentResult;
  readonly pendingApproval: NonNullable<SubAgentRunnerResult["pendingApproval"]>;
};

type BatchExecutionOutcome = {
  readonly results: readonly BatchSubAgentResult[];
  readonly approvalPauses: readonly BatchApprovalPause[];
  readonly startedCount: number;
};

type BatchStats = {
  readonly completedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly approvalRequiredCount: number;
  readonly notStartedCount: number;
};

class SubAgentPendingApprovalStore {
  private readonly continuations = new Map<string, PendingSubAgentContinuation>();

  remember(context: ToolExecutionContext, continuation: PendingSubAgentContinuation): void {
    const key = pendingContinuationKey(context);
    if (key !== undefined) {
      this.continuations.set(key, continuation);
    }
  }

  approved(context: ToolExecutionContext): PendingSubAgentContinuation | undefined {
    const key = pendingContinuationKey(context);
    if (key === undefined) {
      return undefined;
    }
    const continuation = this.continuations.get(key);
    if (continuation === undefined) {
      return undefined;
    }
    return context.approvedConfirmationIds?.includes(continuation.pendingApproval.confirmationId) === true
      ? continuation
      : undefined;
  }

  forget(context: ToolExecutionContext): void {
    const key = pendingContinuationKey(context);
    if (key !== undefined) {
      this.continuations.delete(key);
    }
  }
}

function asRecord(input: unknown): Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null ? (input as Readonly<Record<string, unknown>>) : {};
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const int = Math.floor(value);
  return int >= 1 ? int : undefined;
}

function tasksArrayOrThrow(value: unknown): readonly CallSubAgentsTaskInput[] {
  if (!Array.isArray(value)) {
    throw new Error("tasks must be an array.");
  }
  const tasks: CallSubAgentsTaskInput[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const subAgentName = stringOrFallback(record.sub_agent_name, "");
    const task = stringOrFallback(record.task, "");
    if (subAgentName.length === 0 || task.length === 0) {
      throw new Error("Each task must have sub_agent_name and task.");
    }
    tasks.push({
      sub_agent_name: subAgentName,
      task,
      context: optionalString(record.context),
    });
  }
  if (tasks.length === 0) {
    throw new Error("tasks must not be empty.");
  }
  return tasks;
}

function buildSubAgentResultOutput(result: SubAgentRunnerResult) {
  return {
    status: result.status,
    summary: result.summary,
    full_output: result.fullOutput,
    tool_calls: result.toolCalls,
    model_rounds: result.modelRounds,
    duration_ms: result.durationMs,
    run_id: result.runId,
    error: result.error,
  };
}

function parentRunOptions(deps: SubAgentToolDependencies, context: ToolExecutionContext) {
  return {
    allowedTools: deps.allowedTools(),
    confirmationPolicy: context.confirmationPolicy ?? deps.confirmationPolicy?.(),
    publishToolEvent: deps.publishToolEvent,
  };
}

async function executeSubAgentContinuation(input: {
  readonly deps: SubAgentToolRuntimeDependencies;
  readonly continuation: PendingSubAgentContinuation;
  readonly context: ToolExecutionContext;
}): Promise<SubAgentRunnerResult> {
  const parentOptions = parentRunOptions(input.deps, input.context);
  return runSubAgent({
    subAgent: input.continuation.subAgent,
    task: input.continuation.task,
    context: input.continuation.context,
    parentRunId: input.context.goalId,
    parentToolCallId: input.continuation.parentToolCallId ?? input.context.toolCallId,
    batchId: input.continuation.batchId ?? input.continuation.batch?.batchId,
    batchIndex: input.continuation.batchIndex ?? input.continuation.batch?.pendingIndex,
    conversationId: input.context.traceId,
    toolBroker: input.deps.toolBroker,
    channel: input.deps.channel,
    allowedTools: parentOptions.allowedTools,
    confirmationPolicy: parentOptions.confirmationPolicy,
    publishToolEvent: parentOptions.publishToolEvent,
    traceSink: input.deps.traceSink,
    pendingApproval: input.continuation.pendingApproval,
    approvedConfirmationIds: input.context.approvedConfirmationIds ?? [],
    abortSignal: input.context.abortSignal,
    eventLog: input.deps.eventLog,
  });
}

async function executeSubAgentFromStart(input: {
  readonly deps: SubAgentToolRuntimeDependencies;
  readonly subAgent: SubAgentDefinition;
  readonly task: string;
  readonly context?: string;
  readonly batchId?: string;
  readonly batchIndex?: number;
  readonly toolContext: ToolExecutionContext;
}): Promise<SubAgentRunnerResult> {
  const parentOptions = parentRunOptions(input.deps, input.toolContext);
  return runSubAgent({
    subAgent: input.subAgent,
    task: input.task,
    context: input.context,
    parentRunId: input.toolContext.goalId,
    parentToolCallId: input.toolContext.toolCallId,
    batchId: input.batchId,
    batchIndex: input.batchIndex,
    conversationId: input.toolContext.traceId,
    toolBroker: input.deps.toolBroker,
    channel: input.deps.channel,
    allowedTools: parentOptions.allowedTools,
    confirmationPolicy: parentOptions.confirmationPolicy,
    publishToolEvent: parentOptions.publishToolEvent,
    traceSink: input.deps.traceSink,
    abortSignal: input.toolContext.abortSignal,
    eventLog: input.deps.eventLog,
  });
}

function toolExecutorResult(result: ToolCallResult): ToolExecutorResult {
  return {
    kind: "tool_call_result",
    result,
  };
}

function approvalRequiredExecutorResult(input: {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly context: ToolExecutionContext;
  readonly result: SubAgentRunnerResult;
}): ToolExecutorResult {
  const pendingApproval = input.result.pendingApproval;
  const confirmationRequest =
    pendingApproval === undefined ? undefined : confirmationRequestFromPending(input.result, pendingApproval);
  return toolExecutorResult({
    callId: input.context.toolCallId ?? createId("sub-agent-tool-call"),
    toolName: input.toolName,
    input: input.toolInput,
    output: buildSubAgentResultOutput(input.result),
    status: "approval_required",
    error: input.result.summary,
    durationMs: input.result.durationMs,
    confirmationRequest,
    projection: {
      uiSummary: input.result.summary,
      diagnosticRef: `sub-agent:${input.result.runId ?? "approval-required"}`,
      display: {
        kind: "generic_tool_summary",
        action: input.toolName,
        summary: input.result.summary,
      },
      truncated: false,
      redacted: false,
    },
  });
}

function confirmationRequestFromPending(
  result: SubAgentRunnerResult,
  pendingApproval: NonNullable<SubAgentRunnerResult["pendingApproval"]>
): ConfirmationRequest {
  if (pendingApproval.toolLoop.confirmationRequest !== undefined) {
    return pendingApproval.toolLoop.confirmationRequest;
  }
  const pendingToolCall = pendingApproval.toolLoop.pendingToolCall;
  return {
    confirmationId: pendingApproval.confirmationId,
    runId: pendingToolCall.callId,
    conversationId: pendingApproval.policy.traceId,
    title: "需要确认",
    actionSummary: result.summary,
    affectedResources: [],
    riskLevel: "medium",
    resumeAvailability: "live",
    requestedAt: nowIso(),
    sourceRefs: [`tool:${pendingToolCall.callId}`],
  };
}

function pendingContinuationKey(context: ToolExecutionContext): string | undefined {
  if (context.toolCallId === undefined) {
    return undefined;
  }
  return `${context.traceId}:${context.goalId}:${context.toolCallId}`;
}

function toBatchEventResults(
  results: readonly BatchSubAgentResult[],
  subAgents: ReadonlyMap<string, SubAgentDefinition>
): readonly {
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly status: SubAgentRunnerResult["status"];
  readonly summary: string;
  readonly durationMs?: number;
}[] {
  return results.map((r) => {
    const subAgent = subAgents.get(r.sub_agent_name.toLowerCase());
    return {
      subAgentId: r.sub_agent_id ?? subAgent?.id ?? r.sub_agent_name,
      subAgentName: r.sub_agent_name,
      status: r.result.status,
      summary: r.result.summary,
      durationMs: r.result.durationMs,
    };
  });
}

function buildBatchToolOutput(input: {
  readonly tasks: readonly CallSubAgentsTaskInput[];
  readonly results: readonly BatchSubAgentResult[];
  readonly maxConcurrency: number;
  readonly totalDurationMs: number;
  readonly interruptedForApproval?: boolean;
}) {
  const results = [...input.results].sort((a, b) => a.index - b.index);
  const stats = batchStats(input.tasks, results);
  const resultOutputs = results.map((r) => ({
    index: r.index,
    sub_agent_id: r.sub_agent_id,
    sub_agent_name: r.sub_agent_name,
    task: r.task,
    ...buildSubAgentResultOutput(r.result),
  }));
  const summary =
    `执行 ${input.tasks.length} 个子 Agent 任务：${stats.completedCount} 成功，${stats.failedCount} 失败，` +
    `${stats.cancelledCount} 取消，${stats.approvalRequiredCount} 等待确认，${stats.notStartedCount} 未启动，` +
    `总耗时 ${input.totalDurationMs}ms`;

  return {
    action: "call_sub_agents",
    status: stats.failedCount > 0 || stats.cancelledCount > 0 || stats.approvalRequiredCount > 0 || stats.notStartedCount > 0
      ? "partial_failure"
      : "completed",
    summary,
    result: {
      results: resultOutputs,
      stats: {
        total: input.tasks.length,
        completed: stats.completedCount,
        failed: stats.failedCount,
        cancelled: stats.cancelledCount,
        approval_required: stats.approvalRequiredCount,
        not_started: stats.notStartedCount,
        total_duration_ms: input.totalDurationMs,
        max_concurrency: input.maxConcurrency,
        interrupted_for_approval: input.interruptedForApproval,
      },
    },
  };
}

function batchStats(
  tasks: readonly CallSubAgentsTaskInput[],
  results: readonly BatchSubAgentResult[]
): BatchStats {
  return {
    completedCount: results.filter((r) => r.result.status === "completed").length,
    failedCount: results.filter((r) => r.result.status === "failed").length,
    cancelledCount: results.filter((r) => r.result.status === "cancelled").length,
    approvalRequiredCount: results.filter((r) => r.result.status === "approval_required").length,
    notStartedCount: Math.max(0, tasks.length - results.length),
  };
}

function sortBatchResults(results: readonly BatchSubAgentResult[]): readonly BatchSubAgentResult[] {
  return [...results].sort((a, b) => a.index - b.index);
}

function sortBatchApprovals(approvals: readonly BatchApprovalPause[]): readonly BatchApprovalPause[] {
  return [...approvals].sort((a, b) => a.batchResult.index - b.batchResult.index);
}

function pendingApprovalFromPause(pause: BatchApprovalPause): PendingBatchApproval {
  return {
    subAgent: pause.subAgent,
    task: pause.task.task,
    context: pause.task.context,
    batchIndex: pause.batchResult.index,
    batchResult: pause.batchResult,
    pendingApproval: pause.pendingApproval,
  };
}

async function executeSubAgentBatch(input: {
  readonly deps: SubAgentToolRuntimeDependencies;
  readonly tasks: readonly CallSubAgentsTaskInput[];
  readonly subAgents: ReadonlyMap<string, SubAgentDefinition>;
  readonly batchId: string;
  readonly maxConcurrency: number;
  readonly toolContext: ToolExecutionContext;
}): Promise<BatchExecutionOutcome> {
  const results: BatchSubAgentResult[] = [];
  const approvalPauses: BatchApprovalPause[] = [];
  let nextIndex = 0;
  let activeCount = 0;
  let settled = false;

  return new Promise<BatchExecutionOutcome>((resolve, reject) => {
    const finishIfIdle = () => {
      if (settled || activeCount > 0) {
        return;
      }
      if (
        nextIndex >= input.tasks.length ||
        approvalPauses.length > 0 ||
        input.toolContext.abortSignal?.aborted === true
      ) {
        settled = true;
        resolve({
          results: sortBatchResults(results),
          approvalPauses: sortBatchApprovals(approvalPauses),
          startedCount: nextIndex,
        });
      }
    };

    const launchMore = () => {
      if (settled) {
        return;
      }
      while (
        activeCount < input.maxConcurrency &&
        nextIndex < input.tasks.length &&
        approvalPauses.length === 0 &&
        input.toolContext.abortSignal?.aborted !== true
      ) {
        const index = nextIndex;
        nextIndex += 1;
        activeCount += 1;
        const taskItem = input.tasks[index]!;
        const subAgent = input.subAgents.get(taskItem.sub_agent_name.toLowerCase())!;
        void executeSubAgentFromStart({
          deps: input.deps,
          subAgent,
          task: taskItem.task,
          context: taskItem.context,
          batchId: input.batchId,
          batchIndex: index,
          toolContext: input.toolContext,
        }).then(
          (result) => {
            const batchResult: BatchSubAgentResult = {
              index,
              sub_agent_id: subAgent.id,
              sub_agent_name: subAgent.name,
              task: taskItem.task,
              result,
            };
            results.push(batchResult);
            if (result.status === "approval_required" && result.pendingApproval !== undefined) {
              approvalPauses.push({
                subAgent,
                task: taskItem,
                batchResult,
                pendingApproval: result.pendingApproval,
              });
            }
          },
          (error) => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          }
        ).finally(() => {
          activeCount -= 1;
          if (!settled) {
            launchMore();
          }
        });
      }
      finishIfIdle();
    };

    launchMore();
  });
}

const callSubAgentInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    sub_agent_name: {
      type: "string",
      description: "子 Agent 的名称，不区分大小写。",
    },
    task: {
      type: "string",
      description: "要执行的任务描述。",
    },
    context: {
      type: "string",
      description: "额外的上下文信息，可选。",
    },
  },
  required: ["sub_agent_name", "task"],
  additionalProperties: false,
};

const callSubAgentToolDefinition: ToolDefinition = {
  name: "call_sub_agent",
  description: "调用一个子 Agent 执行任务。当你需要专门领域的专家帮助时使用。",
  modelContract: {
    purpose: "调用一个已注册的子 Agent 来执行特定领域的任务，获取专家级帮助。",
    whenToUse: [
      "需要专门领域专家帮助时",
      "复杂任务需要分解执行时",
      "需要独立验证结果时",
    ],
    whenNotToUse: [
      "简单任务可以直接完成时",
      "只需要查询信息不需要独立执行时",
    ],
    inputNotes: [
      "sub_agent_name: 要调用的子 Agent 名称，不区分大小写。",
      "task: 清晰描述需要子 Agent 完成的任务。",
      "context: 可选，提供额外的背景信息帮助子 Agent 理解任务。",
    ],
    outputNotes: [
      "status: 执行状态，completed/failed/cancelled。",
      "summary: 轻量展示状态，不作为完整结果正文。",
      "full_output: 子 Agent 的完整输出内容；需要引用结果时优先使用该字段。",
      "tool_calls: 子 Agent 调用工具的次数。",
      "model_rounds: 模型交互轮数。",
      "duration_ms: 执行耗时（毫秒）。",
      "error: 失败时的错误信息。",
    ],
    examples: [
      {
        title: "调用代码审查专家",
        input: {
          sub_agent_name: "code-reviewer",
          task: "审查 src/app 目录下的代码质量",
          context: "这是一个 TypeScript 项目",
        },
      },
    ],
    runtimeHints: [
      { label: "available sub-agents", value: "code-expert, doc-expert, research-expert, review-expert, test-expert" },
      { label: "name matching", value: "case-insensitive" },
    ],
  },
  metadata: {
    category: "other",
    riskLevel: "medium",
    operationType: "read-write",
    requiresConfirmation: false,
    visibleResultPolicy: {
      userVisible: "summary-only",
      maxPreviewChars: 1200,
      omitRawOutput: true,
    },
  },
  inputSchema: callSubAgentInputSchema,
};

const callSubAgentsInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      description: "任务数组，每个元素包含 sub_agent_name、task 和可选的 context。",
      items: {
        type: "object",
        properties: {
          sub_agent_name: {
            type: "string",
            description: "子 Agent 的名称。",
          },
          task: {
            type: "string",
            description: "任务描述。",
          },
          context: {
            type: "string",
            description: "额外上下文，可选。",
          },
        },
        required: ["sub_agent_name", "task"],
      },
    },
    max_concurrency: {
      type: "number",
      description: "最大并发数，默认 3。",
    },
  },
  required: ["tasks"],
  additionalProperties: false,
};

const callSubAgentsToolDefinition: ToolDefinition = {
  name: "call_sub_agents",
  description: "调用多个子 Agent 执行不同任务，全部完成或遇到确认暂停后返回汇总结果。",
  modelContract: {
    purpose: "调用多个子 Agent 执行独立任务，获取多方视角。",
    whenToUse: [
      "有多个独立任务需要交给不同专家处理时",
      "需要多方专家协作时",
      "需要对比不同方案时",
    ],
    whenNotToUse: [
      "任务之间有依赖关系时",
      "只有一个任务时",
    ],
    inputNotes: [
      "tasks: 任务数组，每个任务必须有 sub_agent_name 和 task，可选 context。",
      "max_concurrency: 可选并发上限；遇到确认时不再启动未开始的任务，已启动任务会先收束。",
    ],
    outputNotes: [
      "results: 每个子 Agent 的执行结果数组。",
      "summary: 批次轻量展示状态，不作为各子 Agent 的完整结果正文。",
      "full_output: 每个 results 条目中的子 Agent 完整输出；需要引用结果时优先使用该字段。",
      "stats: 统计信息（总数、成功数、失败数、总耗时）。",
    ],
    examples: [
      {
        title: "调用多个专家",
        input: {
          tasks: [
            { sub_agent_name: "frontend-expert", task: "审查前端代码" },
            { sub_agent_name: "backend-expert", task: "审查后端代码" },
          ],
          max_concurrency: 2,
        },
      },
    ],
    runtimeHints: [
      { label: "available sub-agents", value: "code-expert, doc-expert, research-expert, review-expert, test-expert" },
      { label: "default max_concurrency", value: "3" },
      { label: "confirmation behavior", value: "stop unstarted tasks when a sub-agent asks for tool approval" },
    ],
  },
  metadata: {
    category: "other",
    riskLevel: "medium",
    operationType: "read-write",
    requiresConfirmation: false,
    visibleResultPolicy: {
      userVisible: "summary-only",
      maxPreviewChars: 1600,
      omitRawOutput: true,
    },
  },
  inputSchema: callSubAgentsInputSchema,
};

const spawnSubAgentInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    role: {
      type: "string",
      description: "角色描述，比如\"数据库迁移专家\"。",
    },
    system_prompt: {
      type: "string",
      description: "定制的 system prompt，定义子 Agent 的行为和能力。",
    },
    task: {
      type: "string",
      description: "要执行的任务描述。",
    },
    allowed_tools: {
      type: "array",
      description: "未来字段；当前暂时忽略，实际执行继承父 run 工具权限。",
      items: {
        type: "string",
      },
    },
    context: {
      type: "string",
      description: "额外的上下文信息，可选。",
    },
  },
  required: ["role", "system_prompt", "task"],
  additionalProperties: false,
};

const spawnSubAgentToolDefinition: ToolDefinition = {
  name: "spawn_sub_agent",
  description: "动态创建一个定制的子 Agent 并执行任务。当预置专家不满足需求时使用。",
  modelContract: {
    purpose: "动态派生一个定制化的子 Agent，根据需要定义其角色、系统提示和可用工具。",
    whenToUse: [
      "预置子 Agent 不能满足需求时",
      "需要特定角色的专家时",
      "任务需要特殊定制时",
    ],
    whenNotToUse: [
      "已有合适的预置子 Agent 时",
      "简单任务不需要定制时",
    ],
    inputNotes: [
      "role: 子 Agent 的角色名称和描述。",
      "system_prompt: 完整的系统提示，定义子 Agent 的行为规范。",
      "task: 需要子 Agent 完成的具体任务。",
      "allowed_tools: 未来字段，当前暂时忽略；实际执行继承父 run 工具权限。",
      "context: 可选，额外的上下文信息。",
    ],
    outputNotes: [
      "status: 执行状态，completed/failed/cancelled。",
      "summary: 轻量展示状态，不作为完整结果正文。",
      "full_output: 子 Agent 的完整输出内容；需要引用结果时优先使用该字段。",
      "tool_calls: 子 Agent 调用工具的次数。",
      "model_rounds: 模型交互轮数。",
      "duration_ms: 执行耗时（毫秒）。",
      "error: 失败时的错误信息。",
    ],
    examples: [
      {
        title: "创建数据库迁移专家",
        input: {
          role: "数据库迁移专家",
          system_prompt: "你是一名数据库迁移专家，擅长将 SQL Server 数据库迁移到 PostgreSQL。",
          task: "分析当前数据库 schema 并制定迁移计划",
          allowed_tools: ["read_file", "list_dir", "grep_files"],
        },
      },
    ],
    runtimeHints: [
      { label: "available sub-agents", value: "code-expert, doc-expert, research-expert, review-expert, test-expert" },
      { label: "allowed_tools", value: "currently ignored; sub-agent inherits parent run tools" },
    ],
  },
  metadata: {
    category: "other",
    riskLevel: "medium",
    operationType: "read-write",
    requiresConfirmation: false,
    visibleResultPolicy: {
      userVisible: "summary-only",
      maxPreviewChars: 1200,
      omitRawOutput: true,
    },
  },
  inputSchema: spawnSubAgentInputSchema,
};

export function getSubAgentToolDefinitions(
  options: SubAgentToolDefinitionsOptions = {},
): readonly ToolDefinition[] {
  const definitions: ToolDefinition[] = [
    callSubAgentToolDefinition,
    callSubAgentsToolDefinition,
  ];

  if (options.includeSpawnTool === true) {
    definitions.push(spawnSubAgentToolDefinition);
  }

  return definitions;
}

function createCallSubAgentExecutor(deps: SubAgentToolRuntimeDependencies): ToolExecutor {
  return {
    definition: callSubAgentToolDefinition,
    execute: async (input, context) => {
      const approvedContinuation = deps.pendingApprovals.approved(context);
      if (approvedContinuation !== undefined) {
        const result = await executeSubAgentContinuation({
          deps,
          continuation: approvedContinuation,
          context,
        });
        if (result.status === "approval_required" && result.pendingApproval !== undefined) {
          deps.pendingApprovals.remember(context, {
            ...approvedContinuation,
            pendingApproval: result.pendingApproval,
          });
          return approvalRequiredExecutorResult({
            toolName: callSubAgentToolDefinition.name,
            toolInput: input,
            context,
            result,
          });
        }
        deps.pendingApprovals.forget(context);
        return {
          action: "call_sub_agent",
          status: result.status,
          sub_agent_name: approvedContinuation.subAgent.name,
          sub_agent_id: approvedContinuation.subAgent.id,
          summary: result.summary,
          result: buildSubAgentResultOutput(result),
        };
      }

      const record = asRecord(input);
      const subAgentName = stringOrFallback(record.sub_agent_name, "");
      const task = stringOrFallback(record.task, "");
      const ctx = optionalString(record.context);

      if (subAgentName.length === 0) {
        throw new Error("sub_agent_name is required.");
      }
      if (task.length === 0) {
        throw new Error("task is required.");
      }

      const subAgent = await deps.subAgentRegistry.getByName(subAgentName);
      if (subAgent === undefined) {
        throw new Error(`Sub-agent not found: ${subAgentName}`);
      }
      if (!subAgent.enabled) {
        throw new Error(`Sub-agent is disabled: ${subAgentName}`);
      }

      const result = await executeSubAgentFromStart({
          deps,
          subAgent,
          task,
          context: ctx,
          toolContext: context,
      });
      if (result.status === "approval_required" && result.pendingApproval !== undefined) {
        deps.pendingApprovals.remember(context, {
          subAgent,
          task,
          context: ctx,
          pendingApproval: result.pendingApproval,
        });
        return approvalRequiredExecutorResult({
          toolName: callSubAgentToolDefinition.name,
          toolInput: input,
          context,
          result,
        });
      }

      return {
        action: "call_sub_agent",
        status: result.status,
        sub_agent_name: subAgent.name,
        sub_agent_id: subAgent.id,
        summary: result.summary,
        result: buildSubAgentResultOutput(result),
      };
    },
  };
}

function createCallSubAgentsExecutor(deps: SubAgentToolRuntimeDependencies): ToolExecutor {
  return {
    definition: callSubAgentsToolDefinition,
    execute: async (input, context) => {
      const record = asRecord(input);
      const tasks = tasksArrayOrThrow(record.tasks);
      const maxConcurrency = Math.min(10, positiveInteger(record.max_concurrency) ?? 3);

      const approvedContinuation = deps.pendingApprovals.approved(context);
      if (approvedContinuation !== undefined) {
        const result = await executeSubAgentContinuation({
          deps,
          continuation: approvedContinuation,
          context,
        });
        if (result.status === "approval_required" && result.pendingApproval !== undefined) {
          deps.pendingApprovals.remember(context, {
            ...approvedContinuation,
            pendingApproval: result.pendingApproval,
          });
          return approvalRequiredExecutorResult({
            toolName: callSubAgentsToolDefinition.name,
            toolInput: input,
            context,
            result,
          });
        }
        deps.pendingApprovals.forget(context);
        const completedResults = approvedContinuation.batch?.completedResults ?? [];
        const resumedResult: BatchSubAgentResult = {
          index: approvedContinuation.batch?.pendingIndex ?? completedResults.length,
          sub_agent_id: approvedContinuation.subAgent.id,
          sub_agent_name: approvedContinuation.subAgent.name,
          task: approvedContinuation.task,
          result,
        };
        const results = sortBatchResults([...completedResults, resumedResult]);
        const totalDurationMs = Date.now() - (approvedContinuation.batch?.startTime ?? Date.now());
        const subAgents = new Map<string, SubAgentDefinition>([
          [approvedContinuation.subAgent.name.toLowerCase(), approvedContinuation.subAgent],
        ]);
        const deferredApprovals = approvedContinuation.batch?.deferredApprovals ?? [];
        const nextDeferredApproval = deferredApprovals[0];
        if (approvedContinuation.batch !== undefined && nextDeferredApproval !== undefined) {
          subAgents.set(nextDeferredApproval.subAgent.name.toLowerCase(), nextDeferredApproval.subAgent);
          const waitingResults = sortBatchResults([...results, nextDeferredApproval.batchResult]);
          const waitingStats = batchStats(tasks, waitingResults);
          deps.pendingApprovals.remember(context, {
            subAgent: nextDeferredApproval.subAgent,
            task: nextDeferredApproval.task,
            context: nextDeferredApproval.context,
            pendingApproval: nextDeferredApproval.pendingApproval,
            parentToolCallId: context.toolCallId,
            batchId: approvedContinuation.batch.batchId,
            batchIndex: nextDeferredApproval.batchIndex,
            batch: {
              ...approvedContinuation.batch,
              pendingIndex: nextDeferredApproval.batchIndex,
              completedResults: results,
              deferredApprovals: deferredApprovals.slice(1),
            },
          });
          deps.eventLog?.append(
            createSubAgentBatchCompletedMessage({
              traceId: context.traceId,
              runId: context.goalId,
              batchId: approvedContinuation.batch.batchId,
              results: toBatchEventResults(waitingResults, subAgents),
              successCount: waitingStats.completedCount,
              failedCount: waitingStats.failedCount,
              cancelledCount: waitingStats.cancelledCount,
              approvalRequiredCount: waitingStats.approvalRequiredCount,
              notStartedCount: waitingStats.notStartedCount,
              totalDurationMs,
              timestamp: nowIso(),
            })
          );
          return approvalRequiredExecutorResult({
            toolName: callSubAgentsToolDefinition.name,
            toolInput: input,
            context,
            result: nextDeferredApproval.batchResult.result,
          });
        }
        const stats = batchStats(tasks, results);
        if (approvedContinuation.batch !== undefined) {
          deps.eventLog?.append(
            createSubAgentBatchCompletedMessage({
              traceId: context.traceId,
              runId: context.goalId,
              batchId: approvedContinuation.batch.batchId,
              results: toBatchEventResults(results, subAgents),
              successCount: stats.completedCount,
              failedCount: stats.failedCount,
              cancelledCount: stats.cancelledCount,
              approvalRequiredCount: stats.approvalRequiredCount,
              notStartedCount: stats.notStartedCount,
              totalDurationMs,
              timestamp: nowIso(),
            })
          );
        }
        return buildBatchToolOutput({
          tasks,
          results,
          maxConcurrency: approvedContinuation.batch?.maxConcurrency ?? maxConcurrency,
          totalDurationMs,
          interruptedForApproval: approvedContinuation.batch?.remainingTasks.length === 0 ? undefined : true,
        });
      }

      const subAgents: Map<string, SubAgentDefinition> = new Map();
      for (const task of tasks) {
        if (!subAgents.has(task.sub_agent_name.toLowerCase())) {
          const subAgent = await deps.subAgentRegistry.getByName(task.sub_agent_name);
          if (subAgent === undefined) {
            throw new Error(`Sub-agent not found: ${task.sub_agent_name}`);
          }
          if (!subAgent.enabled) {
            throw new Error(`Sub-agent is disabled: ${task.sub_agent_name}`);
          }
          subAgents.set(task.sub_agent_name.toLowerCase(), subAgent);
        }
      }

      const batchId = createId("sub-agent-batch");
      const startTime = Date.now();

      const batchTasks = tasks.map((taskItem) => {
        const subAgent = subAgents.get(taskItem.sub_agent_name.toLowerCase())!;
        return {
          subAgentId: subAgent.id,
          subAgentName: subAgent.name,
          task: taskItem.task,
        };
      });

      deps.eventLog?.append(
        createSubAgentBatchStartedMessage({
          traceId: context.traceId,
          runId: context.goalId,
          batchId,
          tasks: batchTasks,
          totalCount: tasks.length,
          maxConcurrency,
          timestamp: nowIso(),
        })
      );

      const outcome = await executeSubAgentBatch({
        deps,
        tasks,
        subAgents,
        batchId,
        maxConcurrency,
        toolContext: context,
      });
      const results = sortBatchResults(outcome.results);

      if (outcome.approvalPauses.length > 0) {
        const [firstPause, ...deferredPauses] = outcome.approvalPauses;
        const completedResults = sortBatchResults(
          results.filter((result) => result.result.status !== "approval_required")
        );
        const pausedResults = sortBatchResults([
          ...completedResults,
          ...outcome.approvalPauses.map((pause) => pause.batchResult),
        ]);
        const stats = batchStats(tasks, pausedResults);
        deps.eventLog?.append(
          createSubAgentBatchCompletedMessage({
            traceId: context.traceId,
            runId: context.goalId,
            batchId,
            results: toBatchEventResults(pausedResults, subAgents),
            successCount: stats.completedCount,
            failedCount: stats.failedCount,
            cancelledCount: stats.cancelledCount,
            approvalRequiredCount: stats.approvalRequiredCount,
            notStartedCount: stats.notStartedCount,
            totalDurationMs: Date.now() - startTime,
            timestamp: nowIso(),
          })
        );
        deps.pendingApprovals.remember(context, {
          subAgent: firstPause.subAgent,
          task: firstPause.task.task,
          context: firstPause.task.context,
          pendingApproval: firstPause.pendingApproval,
          parentToolCallId: context.toolCallId,
          batchId,
          batchIndex: firstPause.batchResult.index,
          batch: {
            batchId,
            startTime,
            maxConcurrency,
            pendingIndex: firstPause.batchResult.index,
            completedResults,
            remainingTasks: tasks.slice(outcome.startedCount),
            deferredApprovals: deferredPauses.map(pendingApprovalFromPause),
          },
        });
        return approvalRequiredExecutorResult({
          toolName: callSubAgentsToolDefinition.name,
          toolInput: input,
          context,
          result: firstPause.batchResult.result,
        });
      }

      const stats = batchStats(tasks, results);
      const totalDurationMs = Date.now() - startTime;

      deps.eventLog?.append(
        createSubAgentBatchCompletedMessage({
          traceId: context.traceId,
          runId: context.goalId,
          batchId,
          results: toBatchEventResults(results, subAgents),
          successCount: stats.completedCount,
          failedCount: stats.failedCount,
          cancelledCount: stats.cancelledCount,
          approvalRequiredCount: stats.approvalRequiredCount,
          notStartedCount: stats.notStartedCount,
          totalDurationMs,
          timestamp: nowIso(),
        })
      );

      return buildBatchToolOutput({
        tasks,
        results,
        maxConcurrency,
        totalDurationMs,
      });
    },
  };
}

function createSpawnSubAgentExecutor(deps: SubAgentToolRuntimeDependencies): ToolExecutor {
  return {
    definition: spawnSubAgentToolDefinition,
    execute: async (input, context) => {
      const approvedContinuation = deps.pendingApprovals.approved(context);
      if (approvedContinuation !== undefined) {
        const result = await executeSubAgentContinuation({
          deps,
          continuation: approvedContinuation,
          context,
        });
        if (result.status === "approval_required" && result.pendingApproval !== undefined) {
          deps.pendingApprovals.remember(context, {
            ...approvedContinuation,
            pendingApproval: result.pendingApproval,
          });
          return approvalRequiredExecutorResult({
            toolName: spawnSubAgentToolDefinition.name,
            toolInput: input,
            context,
            result,
          });
        }
        deps.pendingApprovals.forget(context);
        return {
          action: "spawn_sub_agent",
          status: result.status,
          spawned_role: approvedContinuation.subAgent.name,
          spawned_id: approvedContinuation.subAgent.id,
          summary: result.summary,
          result: buildSubAgentResultOutput(result),
        };
      }

      const record = asRecord(input);
      const role = stringOrFallback(record.role, "");
      const systemPrompt = stringOrFallback(record.system_prompt, "");
      const task = stringOrFallback(record.task, "");
      const ctx = optionalString(record.context);

      if (role.length === 0) {
        throw new Error("role is required.");
      }
      if (systemPrompt.length === 0) {
        throw new Error("system_prompt is required.");
      }
      if (task.length === 0) {
        throw new Error("task is required.");
      }

      const tempId = `spawned-${createId("temp")}`;
      const sourceKind: SubAgentSourceKind = "custom";

      const spawnedSubAgent: SubAgentDefinition = {
        id: tempId,
        name: role,
        description: role,
        enabled: true,
        sourcePath: "",
        inlineSystemPrompt: systemPrompt,
        whenToUse: [],
        whenNotToUse: [],
        allowedTools: [],
        sourceKind,
        sourceRootId: "spawned",
        sourcePrecedence: 999,
        sourceRootPath: "",
        packageName: role,
        packagePath: "",
        contentHash: "",
        bodyHash: "",
        metadataHash: "",
      };

      const result = await executeSubAgentFromStart({
          deps,
          subAgent: spawnedSubAgent,
          task,
          context: ctx,
        toolContext: context,
      });
      if (result.status === "approval_required" && result.pendingApproval !== undefined) {
        deps.pendingApprovals.remember(context, {
          subAgent: spawnedSubAgent,
          task,
          context: ctx,
          pendingApproval: result.pendingApproval,
        });
        return approvalRequiredExecutorResult({
          toolName: spawnSubAgentToolDefinition.name,
          toolInput: input,
          context,
          result,
        });
      }

      return {
        action: "spawn_sub_agent",
        status: result.status,
        spawned_role: role,
        spawned_id: tempId,
        summary: result.summary,
        result: buildSubAgentResultOutput(result),
      };
    },
  };
}

export function createSubAgentToolExecutors(
  deps: SubAgentToolDependencies & SubAgentToolDefinitionsOptions,
): readonly ToolExecutor[] {
  const runtimeDeps: SubAgentToolRuntimeDependencies = {
    ...deps,
    pendingApprovals: new SubAgentPendingApprovalStore(),
  };
  const executors: ToolExecutor[] = [
    createCallSubAgentExecutor(runtimeDeps),
    createCallSubAgentsExecutor(runtimeDeps),
  ];

  if (deps.includeSpawnTool === true) {
    executors.push(createSpawnSubAgentExecutor(runtimeDeps));
  }

  return executors;
}

export function registerSubAgentTools(
  registry: ToolRegistry,
  options: SubAgentToolsOptions,
  scopes: readonly ToolRegistryScope[] = ["desktop-basic"],
): void {
  const deps: SubAgentToolDependencies = {
    subAgentRegistry: options.subAgentRegistry,
    channel: options.channel,
    toolBroker: options.toolBroker,
    allowedTools: options.allowedTools,
    confirmationPolicy: options.confirmationPolicy,
    publishToolEvent: options.publishToolEvent,
    eventLog: options.eventLog,
  };

  const tools = createSubAgentToolExecutors({
    ...deps,
    includeSpawnTool: options.includeSpawnTool,
  });

  for (const tool of tools) {
    registry.register({
      executor: tool,
      scopes,
      enabledByDefault: true,
    });
  }
}

export type { SubAgentToolsOptions, SubAgentToolDefinitionsOptions };
