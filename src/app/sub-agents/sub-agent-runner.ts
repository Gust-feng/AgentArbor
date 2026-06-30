import type { ArborMessage } from "../../domain/common.js";
import type { IntelligenceChannel, ModelMessage, ModelOutputContract } from "../../domain/intelligence/contracts.js";
import type { ToolConfirmationPolicy, ToolExecutionBroker } from "../../domain/tools/contracts.js";
import type {
  AgentTurnPendingApproval,
  AgentTurnPolicy,
  AgentTurnRuntimeResult,
} from "../../kernel/intelligence/agent-turn-runtime.js";
import { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { createId, nowIso } from "../../kernel/id.js";
import {
  createSubAgentCompletedMessage,
  createSubAgentStartedMessage,
} from "./sub-agent-events.js";
import type { SubAgentDefinition } from "./sub-agent-loader.js";
import { loadSubAgentBody } from "./sub-agent-loader.js";

const SUB_AGENT_OUTPUT_CONTRACT_ID = "sub_agent.free_text.v1";
const DEFAULT_MAX_STEPS = 30;
const SUMMARY_MAX_CHARS = 500;
const SUB_AGENT_TOOL_NAMES = new Set(["call_sub_agent", "call_sub_agents", "spawn_sub_agent"]);

export type SubAgentRunnerInput = {
  readonly subAgent: SubAgentDefinition;
  readonly task: string;
  readonly context?: string;
  readonly parentRunId?: string;
  readonly conversationId?: string;
  readonly toolBroker: ToolExecutionBroker;
  readonly channel: IntelligenceChannel;
  readonly allowedTools: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly publishToolEvent?: (message: ArborMessage) => void;
  readonly pendingApproval?: AgentTurnPendingApproval;
  readonly approvedConfirmationIds?: readonly string[];
  readonly policyOverrides?: Partial<AgentTurnPolicy>;
  readonly abortSignal?: AbortSignal;
  readonly eventLog?: { append: (message: ArborMessage) => void };
};

export type SubAgentRunnerResult = {
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly summary: string;
  readonly fullOutput?: string;
  readonly toolCalls: number;
  readonly modelRounds: number;
  readonly durationMs: number;
  readonly runId?: string;
  readonly error?: string;
  readonly pendingApproval?: AgentTurnPendingApproval;
};

export async function runSubAgent(input: SubAgentRunnerInput): Promise<SubAgentRunnerResult> {
  const startTime = Date.now();
  const runId = input.pendingApproval?.policy.goalId ?? createId("sub-agent-run");
  const traceId = input.conversationId ?? input.pendingApproval?.policy.traceId ?? runId;

  input.eventLog?.append(
    createSubAgentStartedMessage({
      traceId,
      runId: input.parentRunId ?? traceId,
      subRunId: runId,
      subAgentId: input.subAgent.id,
      subAgentName: input.subAgent.name,
      task: input.task,
      parentRunId: input.parentRunId,
      timestamp: nowIso(),
    })
  );

  let result: SubAgentRunnerResult;

  try {
    const systemPrompt = await buildSubAgentSystemPrompt(input.subAgent, input.task, input.context);
    const messages: readonly ModelMessage[] = [
      {
        role: "system",
        ref: `sub-agent:system:${input.subAgent.id}`,
        content: systemPrompt,
      },
    ];

    const policy = buildSubAgentPolicy({
      subAgent: input.subAgent,
      traceId,
      runId,
      allowedTools: input.allowedTools,
      confirmationPolicy: input.confirmationPolicy,
      overrides: input.policyOverrides,
    });

    const turnRuntime = new AgentTurnRuntime({
      intelligenceChannel: input.channel,
      toolCenter: input.toolBroker,
      publishToolEvent: input.publishToolEvent,
    });

    const callerRef = {
      kind: "agent_run" as const,
      id: runId,
      label: `sub_agent:${input.subAgent.id}`,
    };

    const turn = input.pendingApproval === undefined
      ? await turnRuntime.executeAutonomous({
          policy,
          callerRef,
          inputRefs: [],
          sanitizedMessages: messages,
          constraintRefs: [],
          toolChoice: "auto",
          requestedAt: nowIso(),
          abortSignal: input.abortSignal,
        })
      : await turnRuntime.resumeAutonomous({
          pendingApproval: input.pendingApproval,
          approvedConfirmationIds: input.approvedConfirmationIds ?? [],
          abortSignal: input.abortSignal,
        });

    result = buildResultFromTurn({
      turn,
      runId,
      startTime,
      subAgentId: input.subAgent.id,
    });
  } catch (error) {
    result = {
      status: "failed",
      summary: `子 Agent 执行异常: ${errorMessage(error)}`,
      toolCalls: 0,
      modelRounds: 0,
      durationMs: Date.now() - startTime,
      runId,
      error: errorMessage(error),
    };
  }

  input.eventLog?.append(
    createSubAgentCompletedMessage({
      traceId,
      runId: input.parentRunId ?? traceId,
      subRunId: runId,
      subAgentId: input.subAgent.id,
      subAgentName: input.subAgent.name,
      status: result.status,
      summary: result.summary,
      toolCalls: result.toolCalls,
      modelRounds: result.modelRounds,
      durationMs: result.durationMs,
      timestamp: nowIso(),
    })
  );

  return result;
}

async function buildSubAgentSystemPrompt(
  subAgent: SubAgentDefinition,
  task: string,
  context?: string,
): Promise<string> {
  const body = subAgent.inlineSystemPrompt ?? await loadSubAgentBody(subAgent).catch(() => "");
  const basePrompt = body.trim().length > 0 ? body : subAgent.description;

  const sections: string[] = [];

  sections.push(basePrompt);
  sections.push("");
  sections.push(`你是「${subAgent.name}」专家，正在被主 Agent 调用执行子任务。`);
  sections.push(`你的角色是: ${subAgent.description}`);
  sections.push("");
  sections.push("## 任务描述");
  sections.push(task.trim());

  if (context !== undefined && context.trim().length > 0) {
    sections.push("");
    sections.push("## 额外上下文");
    sections.push(context.trim());
  }

  sections.push("");
  sections.push("## 执行要求");
  sections.push("1. 专注完成上述子任务，不要超出范围");
  sections.push("2. 可以使用分配给你的工具来获取信息和执行操作");
  sections.push("3. 在最终回复中提供清晰、完整的结果");
  sections.push("4. 如果遇到无法解决的问题，如实说明原因");

  return sections.join("\n");
}

function buildSubAgentPolicy(input: {
  readonly subAgent: SubAgentDefinition;
  readonly traceId: string;
  readonly runId: string;
  readonly allowedTools: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly overrides?: Partial<AgentTurnPolicy>;
}): AgentTurnPolicy {
  const allowedTools = [...new Set(input.allowedTools)]
    .filter((toolName) => !SUB_AGENT_TOOL_NAMES.has(toolName));

  const maxSteps = normalizeOptionalRoundLimit(input.subAgent.maxSteps) ?? DEFAULT_MAX_STEPS;

  const basePolicy: AgentTurnPolicy = {
    allowModel: true,
    allowedTools,
    maxModelRounds: maxSteps,
    maxToolRounds: maxSteps,
    confirmationPolicy: input.confirmationPolicy,
    fallback: "disabled",
    callerAgentId: `sub-agent:${input.subAgent.id}`,
    traceId: input.traceId,
    goalId: input.runId,
    purpose: "desktop_agent",
    outputContract: freeTextOutputContract(),
    sensitivity: "internal",
    budget: {},
  };

  return {
    ...basePolicy,
    ...(input.overrides ?? {}),
  };
}

function freeTextOutputContract(): ModelOutputContract {
  return {
    contractId: SUB_AGENT_OUTPUT_CONTRACT_ID,
    outputKind: "explanation",
    format: "text",
  };
}

function buildResultFromTurn(input: {
  readonly turn: AgentTurnRuntimeResult;
  readonly runId: string;
  readonly startTime: number;
  readonly subAgentId: string;
}): SubAgentRunnerResult {
  const durationMs = Date.now() - input.startTime;
  const toolCalls = input.turn.toolCalls.length;
  const modelRounds = input.turn.modelRounds;

  const fullOutput = extractTextOutput(input.turn);
  const summary = generateSummary(fullOutput, input.turn);

  if (input.turn.status === "cancelled" || input.turn.stoppedReason === "cancelled") {
    return {
      status: "cancelled",
      summary: summary || "子 Agent 执行已取消",
      fullOutput,
      toolCalls,
      modelRounds,
      durationMs,
      runId: input.runId,
    };
  }

  if (input.turn.status === "approval_required") {
    return {
      status: "approval_required",
      summary: summary || "子 Agent 需要工具确认才能继续",
      fullOutput,
      toolCalls,
      modelRounds,
      durationMs,
      runId: input.runId,
      pendingApproval: input.turn.pendingApproval,
    };
  }

  if (isFailedTurn(input.turn)) {
    const error = extractError(input.turn);
    return {
      status: "failed",
      summary: summary || `子 Agent 执行失败: ${error}`,
      fullOutput,
      toolCalls,
      modelRounds,
      durationMs,
      runId: input.runId,
      error,
    };
  }

  return {
    status: "completed",
    summary,
    fullOutput,
    toolCalls,
    modelRounds,
    durationMs,
    runId: input.runId,
  };
}

function isFailedTurn(turn: AgentTurnRuntimeResult): boolean {
  if (turn.status === "failed") {
    return true;
  }
  if (turn.status === "approval_required") {
    return false;
  }
  if (turn.status === "paused") {
    return true;
  }
  if (turn.status === "completed" && turn.finalOutput?.status === "failed") {
    return true;
  }
  return false;
}

function extractTextOutput(turn: AgentTurnRuntimeResult): string | undefined {
  const output = turn.finalOutput;
  if (output === undefined) {
    return undefined;
  }
  if (output.textOutput !== undefined) {
    return output.textOutput;
  }
  if (output.assistantMessage?.content !== undefined) {
    return output.assistantMessage.content;
  }
  return undefined;
}

function generateSummary(fullOutput: string | undefined, turn: AgentTurnRuntimeResult): string {
  if (fullOutput !== undefined && fullOutput.trim().length > 0) {
    const trimmed = fullOutput.trim();
    if (trimmed.length <= SUMMARY_MAX_CHARS) {
      return trimmed;
    }
    return `${trimmed.slice(0, SUMMARY_MAX_CHARS)}...`;
  }

  if (turn.status === "cancelled" || turn.stoppedReason === "cancelled") {
    return "子 Agent 执行已取消";
  }

  if (turn.stoppedReason === "out_of_fuel") {
    return "子 Agent 达到最大步数限制，未能完成任务";
  }

  if (turn.stoppedReason === "context_overflow") {
    return "子 Agent 上下文溢出，未能完成任务";
  }

  if (turn.stoppedReason === "model_failed") {
    return "子 Agent 模型调用失败";
  }

  if (turn.stoppedReason === "runtime_error") {
    return "子 Agent 运行时错误";
  }

  if (turn.status === "approval_required") {
    return "子 Agent 需要工具确认才能继续";
  }

  return "子 Agent 执行完毕";
}

function extractError(turn: AgentTurnRuntimeResult): string {
  const output = turn.finalOutput;
  if (output?.failure?.message !== undefined) {
    return output.failure.message;
  }
  if (turn.stoppedReason === "out_of_fuel") {
    return "达到最大步数限制";
  }
  if (turn.stoppedReason === "context_overflow") {
    return "上下文溢出";
  }
  if (turn.stoppedReason === "model_failed") {
    return "模型调用失败";
  }
  if (turn.stoppedReason === "runtime_error") {
    return "运行时错误";
  }
  if (turn.status === "approval_required") {
    return "需要工具确认";
  }
  return `未知错误 (status=${turn.status}, reason=${turn.stoppedReason})`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function normalizeOptionalRoundLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}
