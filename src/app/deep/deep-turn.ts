/**
 * DeepRuntime 模型 turn 执行助手（deep 一期，ADR-0025）。
 *
 * 为 DeepRunExecutor（manager 决策/直接回答/父层综合）提供统一的 AgentTurnRuntime
 * 执行入口。child 探索已收口到 DeepChildAgentRunner，避免复用本 helper 的固定
 * manager turn 预算。吸收 cognitive-work-session-runtime.ts 的 executeRequiredTurn
 * 形态作为设计输入，但本文件是 deep 正式实现，不 import legacy 模块。
 *
 * AI-first 边界：fallback 固定 "disabled"——模型不可用或 turn 失败时直接抛错，
 * 不 fallback 伪装成已完成判断（需求 A3）。调用方据此做业务决策（拒绝 run / 标记 child 失败）。
 */
import type { IntelligenceChannel, ModelOutputContract } from "../../domain/intelligence/contracts.js";
import type { ObservationRef } from "../../domain/observation/contracts.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import { AgentTurnRuntime, type AgentTurnRuntimeResult } from "../../kernel/intelligence/agent-turn-runtime.js";
import type { DeepTurnMessage } from "./deep-model-io.js";

export type ExecuteDeepTurnInput = {
  readonly turnRuntime: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly callerAgentId: string;
  readonly callerRef: ObservationRef;
  readonly purpose:
    | "deep_intake"
    | "deep_decision"
    | "deep_direct_answer"
    | "deep_synthesis";
  readonly outputContract: ModelOutputContract;
  readonly inputRefs: readonly ObservationRef[];
  readonly messages: readonly DeepTurnMessage[];
  readonly allowedTools: readonly string[];
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
  readonly confirmationPolicy?: ToolConfirmationPolicy;
};

/**
 * 执行一次 deep 模型 turn。fallback 固定 disabled；turn 非 completed 时抛错。
 * 抛错信息标注 purpose 与 contractId，便于调用方定位失败语义。
 */
export async function executeDeepTurn(input: ExecuteDeepTurnInput): Promise<AgentTurnRuntimeResult> {
  const result = await input.turnRuntime.execute({
    policy: {
      allowModel: true,
      allowedTools: input.allowedTools,
      maxModelRounds: input.maxModelRounds,
      maxToolRounds: input.maxToolRounds,
      confirmationPolicy: input.confirmationPolicy,
      fallback: "disabled",
      callerAgentId: input.callerAgentId,
      traceId: input.traceId,
      goalId: input.goalId,
      purpose: input.purpose,
      outputContract: input.outputContract,
      sensitivity: "internal",
      budget: {
        maxOutputTokens: 1600,
        maxLatencyMs: 60_000,
      },
    },
    callerRef: input.callerRef,
    inputRefs: input.inputRefs,
    sanitizedMessages: input.messages,
    constraintRefs: [],
  });
  if (result.status !== "completed" || result.finalOutput?.status !== "completed") {
    throw new Error(
      `Deep model turn failed: ${input.purpose} / ${input.outputContract.contractId} (status=${result.status})`,
    );
  }
  return result;
}

/**
 * 构造一个 deep AgentTurnRuntime（复用 AgentTurnRuntime，不另起循环实现）。
 * 复用 IntelligenceChannel（模型接入）与可选 ToolExecutionBroker（ToolCenter/确认门）。
 */
export function createDeepTurnRuntime(input: {
  readonly intelligenceChannel: IntelligenceChannel;
  readonly toolCenter?: import("../../domain/tools/contracts.js").ToolExecutionBroker;
  readonly publishToolEvent?: (message: unknown) => void;
}): AgentTurnRuntime {
  return new AgentTurnRuntime({
    intelligenceChannel: input.intelligenceChannel,
    toolCenter: input.toolCenter,
    publishToolEvent: input.publishToolEvent,
  });
}
