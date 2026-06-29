import type { ArborMessage } from "../../domain/common.js";
import type { IntelligenceChannel } from "../../domain/intelligence/contracts.js";
import type {
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolExecutor,
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

function stringArrayOrUndefined(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      result.push(item);
    }
  }
  return result.length > 0 ? result : undefined;
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
  description: "同时调用多个子 Agent 并行执行不同任务，全部完成后返回汇总结果。",
  modelContract: {
    purpose: "并行调用多个子 Agent 执行独立任务，提高效率并获取多方视角。",
    whenToUse: [
      "有多个独立任务可以并行执行时",
      "需要多方专家协作时",
      "需要对比不同方案时",
    ],
    whenNotToUse: [
      "任务之间有依赖关系时",
      "只有一个任务时",
    ],
    inputNotes: [
      "tasks: 任务数组，每个任务必须有 sub_agent_name 和 task，可选 context。",
      "max_concurrency: 可选，最大并发数，默认为 3。",
    ],
    outputNotes: [
      "results: 每个子 Agent 的执行结果数组。",
      "summary: 整体执行摘要。",
      "stats: 统计信息（总数、成功数、失败数、总耗时）。",
    ],
    examples: [
      {
        title: "并行调用多个专家",
        input: {
          tasks: [
            { sub_agent_name: "frontend-expert", task: "审查前端代码" },
            { sub_agent_name: "backend-expert", task: "审查后端代码" },
          ],
          max_concurrency: 2,
        },
      },
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
      description: "允许使用的工具列表，不写则继承全部。",
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
      "allowed_tools: 可选，限制子 Agent 可使用的工具列表。",
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

function createCallSubAgentExecutor(deps: SubAgentToolDependencies): ToolExecutor {
  return {
    definition: callSubAgentToolDefinition,
    execute: async (input, context) => {
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

      const result = await runSubAgent({
        subAgent,
        task,
        context: ctx,
        parentRunId: context.goalId,
        conversationId: context.traceId,
        toolBroker: deps.toolBroker,
        channel: deps.channel,
        abortSignal: context.abortSignal,
        eventLog: deps.eventLog,
      });

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

function createCallSubAgentsExecutor(deps: SubAgentToolDependencies): ToolExecutor {
  return {
    definition: callSubAgentsToolDefinition,
    execute: async (input, context) => {
      const record = asRecord(input);
      const tasks = tasksArrayOrThrow(record.tasks);
      const maxConcurrency = Math.min(10, positiveInteger(record.max_concurrency) ?? 3);

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

      const results: Array<{
        readonly index: number;
        readonly sub_agent_name: string;
        readonly task: string;
        readonly result: SubAgentRunnerResult;
      }> = [];

      async function runBatch(batch: readonly CallSubAgentsTaskInput[]): Promise<void> {
        const batchResults = await Promise.all(
          batch.map(async (taskItem) => {
            const subAgent = subAgents.get(taskItem.sub_agent_name.toLowerCase())!;
            const result = await runSubAgent({
              subAgent,
              task: taskItem.task,
              context: taskItem.context,
              parentRunId: context.goalId,
              conversationId: context.traceId,
              toolBroker: deps.toolBroker,
              channel: deps.channel,
              abortSignal: context.abortSignal,
              eventLog: deps.eventLog,
            });
            return {
              index: tasks.indexOf(taskItem),
              sub_agent_name: subAgent.name,
              task: taskItem.task,
              result,
            };
          })
        );
        results.push(...batchResults);
      }

      for (let i = 0; i < tasks.length; i += maxConcurrency) {
        if (context.abortSignal?.aborted === true) {
          break;
        }
        const batch = tasks.slice(i, i + maxConcurrency);
        await runBatch(batch);
      }

      results.sort((a, b) => a.index - b.index);

      const completedCount = results.filter((r) => r.result.status === "completed").length;
      const failedCount = results.filter((r) => r.result.status === "failed").length;
      const cancelledCount = results.filter((r) => r.result.status === "cancelled").length;
      const totalDurationMs = Date.now() - startTime;

      const batchResults = results.map((r) => {
        const subAgent = subAgents.get(r.sub_agent_name.toLowerCase())!;
        return {
          subAgentId: subAgent.id,
          subAgentName: r.sub_agent_name,
          status: r.result.status,
          summary: r.result.summary,
          durationMs: r.result.durationMs,
        };
      });

      deps.eventLog?.append(
        createSubAgentBatchCompletedMessage({
          traceId: context.traceId,
          runId: context.goalId,
          batchId,
          results: batchResults,
          successCount: completedCount,
          failedCount: failedCount,
          totalDurationMs,
          timestamp: nowIso(),
        })
      );

      const resultOutputs = results.map((r) => ({
        index: r.index,
        sub_agent_name: r.sub_agent_name,
        task: r.task,
        ...buildSubAgentResultOutput(r.result),
      }));

      const summary = `并行执行 ${tasks.length} 个子 Agent 任务：${completedCount} 成功，${failedCount} 失败，${cancelledCount} 取消，总耗时 ${totalDurationMs}ms`;

      return {
        action: "call_sub_agents",
        status: failedCount > 0 ? "partial_failure" : "completed",
        summary,
        result: {
          results: resultOutputs,
          stats: {
            total: tasks.length,
            completed: completedCount,
            failed: failedCount,
            cancelled: cancelledCount,
            total_duration_ms: totalDurationMs,
            max_concurrency: maxConcurrency,
          },
        },
      };
    },
  };
}

function createSpawnSubAgentExecutor(deps: SubAgentToolDependencies): ToolExecutor {
  return {
    definition: spawnSubAgentToolDefinition,
    execute: async (input, context) => {
      const record = asRecord(input);
      const role = stringOrFallback(record.role, "");
      const systemPrompt = stringOrFallback(record.system_prompt, "");
      const task = stringOrFallback(record.task, "");
      const allowedTools = stringArrayOrUndefined(record.allowed_tools);
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
        whenToUse: [],
        whenNotToUse: [],
        allowedTools: allowedTools ?? [],
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

      const result = await runSubAgent({
        subAgent: spawnedSubAgent,
        task,
        context: ctx,
        parentRunId: context.goalId,
        conversationId: context.traceId,
        toolBroker: deps.toolBroker,
        channel: deps.channel,
        abortSignal: context.abortSignal,
        eventLog: deps.eventLog,
      });

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
  const executors: ToolExecutor[] = [
    createCallSubAgentExecutor(deps),
    createCallSubAgentsExecutor(deps),
  ];

  if (deps.includeSpawnTool === true) {
    executors.push(createSpawnSubAgentExecutor(deps));
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
