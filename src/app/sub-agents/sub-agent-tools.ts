import type { ArborMessage } from "../../domain/common.js";
import type { ConfirmationRequest } from "../../domain/basic-agent/index.js";
import type { IntelligenceChannel } from "../../domain/intelligence/contracts.js";
import type {
  ToolCallResult,
  ToolConfirmationPolicy,
  ToolContinuation,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolExecutor,
  ToolExecutorResult,
  ToolInputSchema,
} from "../../domain/tools/contracts.js";
import type { SubAgentRunTraceReader, SubAgentRunTraceSink } from "../../domain/sub-agents/contracts.js";
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
  readonly traceReader?: SubAgentRunTraceReader;
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
  readonly instructions: string;
  readonly task: string;
  readonly allowed_tools?: readonly string[];
  readonly context?: string;
};

type ReadSubAgentOutputInput = {
  readonly sub_run_id: string;
  readonly start_char?: number;
  readonly max_chars?: number;
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

const READ_SUB_AGENT_OUTPUT_DEFAULT_CHARS = 100_000;
const READ_SUB_AGENT_OUTPUT_MAX_CHARS = 120_000;

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

function optionalStringArray(value: unknown, fieldName: string): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${fieldName} must be an array of non-empty strings.`);
    }
    return item.trim();
  });
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const int = Math.floor(value);
  return int >= 1 ? int : undefined;
}

function nonNegativeIntegerOrDefault(value: unknown, fieldName: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  const int = Math.floor(value);
  if (int < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return int;
}

function boundedPositiveIntegerOrDefault(value: unknown, fieldName: string, fallback: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  const int = Math.floor(value);
  if (int < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return Math.min(int, max);
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
  const outputRef = subAgentOutputRef(result);
  const continuation = result.fullOutput === undefined
    ? undefined
    : subAgentOutputContinuation(result.runId, 0);
  return {
    status: result.status,
    summary: result.summary,
    full_output: result.fullOutput,
    full_output_chars: result.fullOutput?.length,
    full_output_ref: outputRef,
    continuation,
    tool_calls: result.toolCalls,
    model_rounds: result.modelRounds,
    duration_ms: result.durationMs,
    run_id: result.runId,
    error: result.error,
  };
}

function subAgentOutputRef(result: SubAgentRunnerResult): string | undefined {
  return result.runId !== undefined && result.fullOutput !== undefined
    ? `sub-agent-output:${result.runId}`
    : undefined;
}

function subAgentOutputContinuation(
  runId: string | undefined,
  startChar: number,
  maxChars = READ_SUB_AGENT_OUTPUT_DEFAULT_CHARS
): ToolContinuation | undefined {
  if (runId === undefined) {
    return undefined;
  }
  return {
    ref: `sub-agent-output:${runId}`,
    nextInput: {
      sub_run_id: runId,
      start_char: startChar,
      max_chars: maxChars,
    } satisfies ReadSubAgentOutputInput,
    note: "Use read_sub_agent_output with nextInput to read this sub-agent output by character range.",
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
      "full_output_ref/continuation: 当输出过长或需要精确续读时，用 continuation.nextInput 调用 read_sub_agent_output。",
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
      "full_output_ref/continuation: 每个 results 条目都可给出 read_sub_agent_output 续读输入。",
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
    instructions: {
      type: "string",
      description: "定制的行为指令，定义子 Agent 的职责、边界和输出要求。",
    },
    task: {
      type: "string",
      description: "要执行的任务描述。",
    },
    allowed_tools: {
      type: "array",
      description: "可选工具收敛声明；实际执行取父 run 工具权限与该声明的交集，不能扩张权限。",
      items: {
        type: "string",
      },
    },
    context: {
      type: "string",
      description: "额外的上下文信息，可选。",
    },
  },
  required: ["role", "instructions", "task"],
  additionalProperties: false,
};

const readSubAgentOutputInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    sub_run_id: {
      type: "string",
      description: "要读取输出的子 Agent run id。",
    },
    start_char: {
      type: "number",
      description: "从完整输出的第几个字符开始读取，默认 0。",
    },
    max_chars: {
      type: "number",
      description: `最多读取的字符数，默认 ${READ_SUB_AGENT_OUTPUT_DEFAULT_CHARS}，上限 ${READ_SUB_AGENT_OUTPUT_MAX_CHARS}。`,
    },
  },
  required: ["sub_run_id"],
  additionalProperties: false,
};

const spawnSubAgentToolDefinition: ToolDefinition = {
  name: "spawn_sub_agent",
  description: "动态创建一个定制的子 Agent 并执行任务。当预置专家不满足需求时使用。",
  modelContract: {
    purpose: "动态创建一个定制化的子 Agent，根据需要定义其角色、行为指令和可用工具。",
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
      "instructions: 行为指令，定义子 Agent 的职责、边界和输出要求。",
      "task: 需要子 Agent 完成的具体任务。",
      "allowed_tools: 可选，声明此临时子 Agent 允许使用的工具名；实际执行取父 run 工具权限与该声明的交集，不能扩张权限。",
      "context: 可选，额外的上下文信息。",
    ],
    outputNotes: [
      "status: 执行状态，completed/failed/cancelled。",
      "summary: 轻量展示状态，不作为完整结果正文。",
      "full_output: 子 Agent 的完整输出内容；需要引用结果时优先使用该字段。",
      "full_output_ref/continuation: 当输出过长或需要精确续读时，用 continuation.nextInput 调用 read_sub_agent_output。",
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
          instructions: "你是一名数据库迁移专家，擅长将 SQL Server 数据库迁移到 PostgreSQL。",
          task: "分析当前数据库 schema 并制定迁移计划",
          allowed_tools: ["read_file", "list_dir", "grep_files"],
        },
      },
    ],
    runtimeHints: [
      { label: "available sub-agents", value: "code-expert, doc-expert, research-expert, review-expert, test-expert" },
      { label: "allowed_tools", value: "optional restriction; effective tools are parent allowed tools intersect declared names" },
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

const readSubAgentOutputToolDefinition: ToolDefinition = {
  name: "read_sub_agent_output",
  description: "按字符范围读取本轮子 Agent 的完整输出。当子 Agent 结果过长或需要精确续读时使用。",
  modelContract: {
    purpose: "读取当前父 run 内某个子 Agent run 的完整输出片段，作为 call_sub_agent/call_sub_agents/spawn_sub_agent 长输出的续读工具。",
    whenToUse: [
      "子 Agent 工具结果提示 full_output 被截断或给出 continuation/nextInput 时",
      "需要重新读取某个子 Agent 输出的指定字符范围时",
      "需要引用子 Agent 长输出中的后续证据时",
    ],
    whenNotToUse: [
      "还没有调用过子 Agent 时",
      "只需要调用新的专家子 Agent 时",
      "要读取普通文件、命令日志或网页内容时",
    ],
    inputNotes: [
      "sub_run_id: 子 Agent 结果中的 run_id，或 continuation.nextInput.sub_run_id。",
      "start_char: 从 0 开始的字符偏移；使用 continuation.nextInput.start_char 可以继续读取。",
      `max_chars: 可选读取窗口，默认 ${READ_SUB_AGENT_OUTPUT_DEFAULT_CHARS}，运行时会限制到 ${READ_SUB_AGENT_OUTPUT_MAX_CHARS} 以内。`,
    ],
    outputNotes: [
      "content: 本次读取到的完整输出片段。",
      "start_char/end_char/total_chars: 当前片段范围和完整输出长度。",
      "has_more_after: 为 true 时继续使用 continuation.nextInput 读取后续片段。",
      "continuation: 可直接用于下一次 read_sub_agent_output 的续读输入。",
    ],
    examples: [
      {
        title: "继续读取子 Agent 输出",
        input: {
          sub_run_id: "sub-agent-run_abc123",
          start_char: 100000,
          max_chars: 100000,
        },
      },
    ],
    runtimeHints: [
      { label: "scope", value: "Only reads sub-agent outputs that belong to the current parent run." },
      { label: "side effects", value: "read-only" },
    ],
  },
  metadata: {
    category: "other",
    riskLevel: "low",
    operationType: "read-only",
    requiresConfirmation: false,
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 1200,
      omitRawOutput: true,
    },
  },
  inputSchema: readSubAgentOutputInputSchema,
};

export function getSubAgentToolDefinitions(
  options: SubAgentToolDefinitionsOptions = {},
): readonly ToolDefinition[] {
  const definitions: ToolDefinition[] = [
    callSubAgentToolDefinition,
    callSubAgentsToolDefinition,
    readSubAgentOutputToolDefinition,
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

function createReadSubAgentOutputExecutor(deps: SubAgentToolRuntimeDependencies): ToolExecutor {
  return {
    definition: readSubAgentOutputToolDefinition,
    execute: async (input, context) => {
      const traceReader = deps.traceReader;
      if (traceReader === undefined) {
        throw new Error("read_sub_agent_output is unavailable because this run has no sub-agent trace reader.");
      }
      const record = asRecord(input);
      const subRunId = stringOrFallback(record.sub_run_id, "").trim();
      if (subRunId.length === 0) {
        throw new Error("sub_run_id is required.");
      }
      const trace = traceReader.get(subRunId);
      if (trace === undefined) {
        throw new Error(`Sub-agent output not found: ${subRunId}`);
      }
      if (trace.parentRunId !== context.goalId) {
        throw new Error(`Sub-agent output does not belong to the current run: ${subRunId}`);
      }
      if (trace.fullOutput === undefined) {
        throw new Error(`Sub-agent output has no readable full_output: ${subRunId}`);
      }

      const startChar = nonNegativeIntegerOrDefault(record.start_char, "start_char", 0);
      if (startChar > trace.fullOutput.length) {
        throw new Error(`start_char exceeds sub-agent output length: ${startChar} > ${trace.fullOutput.length}`);
      }
      const maxChars = boundedPositiveIntegerOrDefault(
        record.max_chars,
        "max_chars",
        READ_SUB_AGENT_OUTPUT_DEFAULT_CHARS,
        READ_SUB_AGENT_OUTPUT_MAX_CHARS
      );
      const endChar = Math.min(trace.fullOutput.length, startChar + maxChars);
      const content = trace.fullOutput.slice(startChar, endChar);
      const hasMoreAfter = endChar < trace.fullOutput.length;
      const continuation = hasMoreAfter
        ? subAgentOutputContinuation(subRunId, endChar, maxChars)
        : undefined;
      const summary = hasMoreAfter
        ? `读取子 Agent 输出 ${startChar}-${endChar} / ${trace.fullOutput.length} 字，仍有后续内容。`
        : `读取子 Agent 输出 ${startChar}-${endChar} / ${trace.fullOutput.length} 字，已到末尾。`;
      const result = {
        sub_run_id: subRunId,
        sub_agent_id: trace.subAgentId,
        sub_agent_name: trace.subAgentName,
        status: trace.status,
        summary: trace.summary,
        start_char: startChar,
        end_char: endChar,
        chars_returned: content.length,
        total_chars: trace.fullOutput.length,
        has_more_after: hasMoreAfter,
        content,
        continuation,
      };
      return {
        action: "read_sub_agent_output",
        status: "completed",
        summary,
        result,
        truncated: hasMoreAfter,
        canonicalResult: {
          content: [{ type: "text", text: content }],
          structuredContent: {
            sub_run_id: subRunId,
            sub_agent_id: trace.subAgentId,
            sub_agent_name: trace.subAgentName,
            status: trace.status,
            start_char: startChar,
            end_char: endChar,
            chars_returned: content.length,
            total_chars: trace.fullOutput.length,
            has_more_after: hasMoreAfter,
            continuation,
          },
          truncation: hasMoreAfter
            ? {
              truncated: true,
              reason: "sub_agent_output_window",
              omittedChars: trace.fullOutput.length - endChar,
              continuation,
            }
            : undefined,
          continuation,
        },
      };
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
      const instructions = stringOrFallback(record.instructions, stringOrFallback(record.system_prompt, ""));
      const task = stringOrFallback(record.task, "");
      const allowedTools = optionalStringArray(record.allowed_tools, "allowed_tools");
      const ctx = optionalString(record.context);

      if (role.length === 0) {
        throw new Error("role is required.");
      }
      if (instructions.length === 0) {
        throw new Error("instructions is required.");
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
        inlineSystemPrompt: instructions,
        whenToUse: [],
        whenNotToUse: [],
        allowedTools,
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
    traceReader: deps.traceReader ?? traceReaderFromSink(deps.traceSink),
    pendingApprovals: new SubAgentPendingApprovalStore(),
  };
  const executors: ToolExecutor[] = [
    createCallSubAgentExecutor(runtimeDeps),
    createCallSubAgentsExecutor(runtimeDeps),
    createReadSubAgentOutputExecutor(runtimeDeps),
  ];

  if (deps.includeSpawnTool === true) {
    executors.push(createSpawnSubAgentExecutor(runtimeDeps));
  }

  return executors;
}

function traceReaderFromSink(traceSink: SubAgentRunTraceSink | undefined): SubAgentRunTraceReader | undefined {
  const maybeReader = traceSink as { readonly get?: unknown } | undefined;
  const get = maybeReader?.get;
  return typeof get === "function"
    ? { get: (subRunId: string) => get.call(traceSink, subRunId) as ReturnType<SubAgentRunTraceReader["get"]> }
    : undefined;
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
    traceSink: options.traceSink,
    traceReader: options.traceReader,
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
