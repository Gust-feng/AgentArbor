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
};

type PendingSubAgentContinuation = {
  readonly subAgent: SubAgentDefinition;
  readonly task: string;
  readonly context?: string;
  readonly pendingApproval: NonNullable<SubAgentRunnerResult["pendingApproval"]>;
  readonly batch?: PendingBatchState;
};

type BatchSubAgentResult = {
  readonly index: number;
  readonly sub_agent_name: string;
  readonly task: string;
  readonly result: SubAgentRunnerResult;
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
    conversationId: input.context.traceId,
    toolBroker: input.deps.toolBroker,
    channel: input.deps.channel,
    allowedTools: parentOptions.allowedTools,
    confirmationPolicy: parentOptions.confirmationPolicy,
    publishToolEvent: parentOptions.publishToolEvent,
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
  readonly toolContext: ToolExecutionContext;
}): Promise<SubAgentRunnerResult> {
  const parentOptions = parentRunOptions(input.deps, input.toolContext);
  return runSubAgent({
    subAgent: input.subAgent,
    task: input.task,
    context: input.context,
    parentRunId: input.toolContext.goalId,
    conversationId: input.toolContext.traceId,
    toolBroker: input.deps.toolBroker,
    channel: input.deps.channel,
    allowedTools: parentOptions.allowedTools,
    confirmationPolicy: parentOptions.confirmationPolicy,
    publishToolEvent: parentOptions.publishToolEvent,
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
      subAgentId: subAgent?.id ?? r.sub_agent_name,
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
  const completedCount = results.filter((r) => r.result.status === "completed").length;
  const failedCount = results.filter((r) => r.result.status === "failed").length;
  const cancelledCount = results.filter((r) => r.result.status === "cancelled").length;
  const pendingCount = results.filter((r) => r.result.status === "approval_required").length;
  const notStartedCount = Math.max(0, input.tasks.length - results.length);
  const resultOutputs = results.map((r) => ({
    index: r.index,
    sub_agent_name: r.sub_agent_name,
    task: r.task,
    ...buildSubAgentResultOutput(r.result),
  }));
  const summary =
    `执行 ${input.tasks.length} 个子 Agent 任务：${completedCount} 成功，${failedCount} 失败，` +
    `${cancelledCount} 取消，${pendingCount} 等待确认，${notStartedCount} 未启动，` +
    `总耗时 ${input.totalDurationMs}ms`;

  return {
    action: "call_sub_agents",
    status: failedCount > 0 || cancelledCount > 0 || pendingCount > 0 || notStartedCount > 0
      ? "partial_failure"
      : "completed",
    summary,
    result: {
      results: resultOutputs,
      stats: {
        total: input.tasks.length,
        completed: completedCount,
        failed: failedCount,
        cancelled: cancelledCount,
        approval_required: pendingCount,
        not_started: notStartedCount,
        total_duration_ms: input.totalDurationMs,
        max_concurrency: input.maxConcurrency,
        interrupted_for_approval: input.interruptedForApproval,
      },
    },
  };
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
      "summary: 执行结果摘要。",
      "full_output: 完整的输出内容。",
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
      "max_concurrency: 可选，未来并发上限；当前实现遇到确认时采用保守调度。",
    ],
    outputNotes: [
      "results: 每个子 Agent 的执行结果数组。",
      "summary: 整体执行摘要。",
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
      "summary: 执行结果摘要。",
      "full_output: 完整的输出内容。",
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
          sub_agent_name: approvedContinuation.subAgent.name,
          task: approvedContinuation.task,
          result,
        };
        const results = [...completedResults, resumedResult];
        const totalDurationMs = Date.now() - (approvedContinuation.batch?.startTime ?? Date.now());
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

      const results: BatchSubAgentResult[] = [];

      for (let i = 0; i < tasks.length; i += 1) {
        if (context.abortSignal?.aborted === true) {
          break;
        }
        const taskItem = tasks[i]!;
        const subAgent = subAgents.get(taskItem.sub_agent_name.toLowerCase())!;
        const result = await executeSubAgentFromStart({
          deps,
          subAgent,
          task: taskItem.task,
          context: taskItem.context,
          toolContext: context,
        });
        if (result.status === "approval_required" && result.pendingApproval !== undefined) {
          const completedCount = results.filter((r) => r.result.status === "completed").length;
          const failedCount = results.filter((r) => r.result.status === "failed").length;
          deps.eventLog?.append(
            createSubAgentBatchCompletedMessage({
              traceId: context.traceId,
              runId: context.goalId,
              batchId,
              results: toBatchEventResults(results, subAgents),
              successCount: completedCount,
              failedCount,
              totalDurationMs: Date.now() - startTime,
              timestamp: nowIso(),
            })
          );
          deps.pendingApprovals.remember(context, {
            subAgent,
            task: taskItem.task,
            context: taskItem.context,
            pendingApproval: result.pendingApproval,
            batch: {
              batchId,
              startTime,
              maxConcurrency,
              pendingIndex: i,
              completedResults: results,
              remainingTasks: tasks.slice(i + 1),
            },
          });
          return approvalRequiredExecutorResult({
            toolName: callSubAgentsToolDefinition.name,
            toolInput: input,
            context,
            result,
          });
        }
        results.push({
          index: i,
          sub_agent_name: subAgent.name,
          task: taskItem.task,
          result,
        });
      }

      results.sort((a, b) => a.index - b.index);

      const completedCount = results.filter((r) => r.result.status === "completed").length;
      const failedCount = results.filter((r) => r.result.status === "failed").length;
      const cancelledCount = results.filter((r) => r.result.status === "cancelled").length;
      const totalDurationMs = Date.now() - startTime;

      deps.eventLog?.append(
        createSubAgentBatchCompletedMessage({
          traceId: context.traceId,
          runId: context.goalId,
          batchId,
          results: toBatchEventResults(results, subAgents),
          successCount: completedCount,
          failedCount: failedCount,
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
