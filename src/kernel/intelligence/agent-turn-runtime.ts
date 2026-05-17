import type { ArborMessage } from "../../domain/common.js";
import type {
  IntelligenceChannel,
  ModelBudget,
  ModelMessage,
  ModelOutputContract,
  ModelPurpose,
  ModelRequest,
  ModelResponse,
  ModelToolChoice,
} from "../../domain/intelligence/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import type { ConstraintRef } from "../../domain/constraints.js";
import { createId, nowIso } from "../id.js";
import {
  executeToolUseLoop,
  resumeToolUseLoopFromApproval,
  type ToolUseLoopPendingApproval,
  type ToolUseLoopResult,
} from "./tool-use-loop.js";

export type AgentTurnFallbackBehavior = "deterministic" | "disabled";

export type AgentTurnPolicy = {
  readonly allowModel: boolean;
  readonly allowedTools?: readonly string[];
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly fallback: AgentTurnFallbackBehavior;
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly purpose: ModelPurpose;
  readonly outputContract: ModelOutputContract;
  readonly sensitivity: ModelRequest["sensitivity"];
  readonly budget: ModelBudget;
};

export type AgentTurnRuntimeInput = {
  readonly policy: AgentTurnPolicy;
  readonly callerRef: ModelRequest["callerRef"];
  readonly inputRefs: readonly ObservationRef[];
  readonly sanitizedMessages: readonly ModelMessage[];
  readonly constraintRefs: readonly ConstraintRef[];
  readonly requestId?: string;
  readonly toolChoice?: ModelToolChoice;
  readonly requestedAt?: string;
  readonly abortSignal?: AbortSignal;
};

export type AgentTurnPendingApproval = {
  readonly confirmationId: string;
  readonly modelRequest: ModelRequest;
  readonly toolLoop: ToolUseLoopPendingApproval;
  readonly policy: AgentTurnPolicy;
};

export type AgentTurnResumeInput = {
  readonly pendingApproval: AgentTurnPendingApproval;
  readonly approvedConfirmationIds: readonly string[];
  readonly abortSignal?: AbortSignal;
};

export type AgentTurnRuntimeResult = {
  readonly status: "completed" | "failed" | "disabled" | "approval_required" | "cancelled" | "paused";
  readonly stoppedReason:
    | "completed"
    | "no_tool_calls"
    | "model_disabled"
    | "out_of_fuel"
    | "model_failed"
    | "approval_required"
    | "cancelled"
    | "runtime_error";
  readonly fallback: AgentTurnFallbackBehavior;
  readonly modelRequestId?: string;
  readonly modelResponseId?: string;
  readonly finalOutput?: ModelResponse;
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly toolRounds: number;
  readonly pendingApproval?: AgentTurnPendingApproval;
};

export type AgentTurnRuntimeOptions = {
  readonly intelligenceChannel: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
  readonly publishToolEvent?: (message: ArborMessage) => void;
};

export class AgentTurnRuntime {
  constructor(private readonly options: AgentTurnRuntimeOptions) {}

  async executeAutonomous(input: AgentTurnRuntimeInput): Promise<AgentTurnRuntimeResult> {
    return this.executeCore(input, {
      blockedToolNames: ORDINARY_AGENT_INTERNAL_TOOL_NAMES,
      exposeNonFinalOutput: false,
      enforceRoundLimits: false,
    });
  }

  async execute(input: AgentTurnRuntimeInput): Promise<AgentTurnRuntimeResult> {
    return this.executeCore(input, {
      blockedToolNames: [],
      exposeNonFinalOutput: true,
      enforceRoundLimits: true,
    });
  }

  private async executeCore(input: AgentTurnRuntimeInput, semantics: AgentTurnRuntimeSemantics): Promise<AgentTurnRuntimeResult> {
    const requestId = input.requestId ?? createId("model-request");
    const policy = normalizePolicy(input.policy);
    if (!policy.allowModel) {
      return {
        status: "disabled",
        stoppedReason: "model_disabled",
        fallback: policy.fallback,
        modelRequestId: requestId,
        toolCalls: [],
        modelRounds: 0,
        toolRounds: 0,
      };
    }

    if (semantics.enforceRoundLimits && policy.maxModelRounds !== undefined && policy.maxModelRounds <= 0) {
      return {
        status: "paused",
        stoppedReason: "out_of_fuel",
        fallback: policy.fallback,
        modelRequestId: requestId,
        toolCalls: [],
        modelRounds: 0,
        toolRounds: 0,
      };
    }

    try {
      const modelRequest = createModelRequest({ input, policy, requestId });
      const loop = await executeToolUseLoop(
        {
          intelligenceChannel: this.options.intelligenceChannel,
          toolCenter: this.options.toolCenter ?? NO_TOOL_BROKER,
          callerAgentId: policy.callerAgentId,
          traceId: policy.traceId,
          goalId: policy.goalId,
          maxModelRounds: semantics.enforceRoundLimits ? policy.maxModelRounds : undefined,
          maxToolRounds: semantics.enforceRoundLimits ? policy.maxToolRounds : undefined,
          allowedTools: policy.allowedTools,
          blockedToolNames: semantics.blockedToolNames,
          publishToolEvent: this.options.publishToolEvent,
          abortSignal: input.abortSignal,
        },
        modelRequest
      );
      return toAgentTurnRuntimeResult(policy, loop, modelRequest, semantics);
    } catch {
      return {
        status: "failed",
        stoppedReason: "runtime_error",
        fallback: policy.fallback,
        modelRequestId: requestId,
        toolCalls: [],
        modelRounds: 0,
        toolRounds: 0,
      };
    }
  }

  async resumeAutonomous(input: AgentTurnResumeInput): Promise<AgentTurnRuntimeResult> {
    return this.resumeCore(input, {
      blockedToolNames: ORDINARY_AGENT_INTERNAL_TOOL_NAMES,
      exposeNonFinalOutput: false,
      enforceRoundLimits: false,
    });
  }

  async resume(input: AgentTurnResumeInput): Promise<AgentTurnRuntimeResult> {
    return this.resumeCore(input, {
      blockedToolNames: [],
      exposeNonFinalOutput: true,
      enforceRoundLimits: true,
    });
  }

  private async resumeCore(input: AgentTurnResumeInput, semantics: AgentTurnRuntimeSemantics): Promise<AgentTurnRuntimeResult> {
    const policy = normalizePolicy(input.pendingApproval.policy);
    try {
      const loop = await resumeToolUseLoopFromApproval(
        {
          intelligenceChannel: this.options.intelligenceChannel,
          toolCenter: this.options.toolCenter ?? NO_TOOL_BROKER,
          callerAgentId: policy.callerAgentId,
          traceId: policy.traceId,
          goalId: policy.goalId,
          maxModelRounds: semantics.enforceRoundLimits ? policy.maxModelRounds : undefined,
          maxToolRounds: semantics.enforceRoundLimits ? policy.maxToolRounds : undefined,
          allowedTools: policy.allowedTools,
          blockedToolNames: semantics.blockedToolNames,
          approvedConfirmationIds: input.approvedConfirmationIds,
          publishToolEvent: this.options.publishToolEvent,
          abortSignal: input.abortSignal,
        },
        input.pendingApproval.modelRequest,
        input.pendingApproval.toolLoop
      );
      return toAgentTurnRuntimeResult(policy, loop, input.pendingApproval.modelRequest, semantics);
    } catch {
      return {
        status: "failed",
        stoppedReason: "runtime_error",
        fallback: policy.fallback,
        modelRequestId: input.pendingApproval.modelRequest.requestId,
        toolCalls: [],
        modelRounds: 0,
        toolRounds: 0,
      };
    }
  }
}

type AgentTurnRuntimeSemantics = {
  readonly blockedToolNames: readonly string[];
  readonly exposeNonFinalOutput: boolean;
  readonly enforceRoundLimits: boolean;
};

function createModelRequest(input: {
  readonly input: AgentTurnRuntimeInput;
  readonly policy: AgentTurnPolicy;
  readonly requestId: string;
}): ModelRequest {
  return {
    requestId: input.requestId,
    traceId: input.policy.traceId,
    callerRef: input.input.callerRef,
    purpose: input.policy.purpose,
    inputRefs: [...input.input.inputRefs],
    sanitizedMessages: input.input.sanitizedMessages.map(cloneModelMessage),
    outputContract: input.policy.outputContract,
    constraintRefs: input.input.constraintRefs.map((ref) => ({ ...ref })),
    budget: { ...input.policy.budget },
    sensitivity: input.policy.sensitivity,
    toolChoice: input.input.toolChoice,
    requestedAt: input.input.requestedAt ?? nowIso(),
  };
}

function toAgentTurnRuntimeResult(
  policy: AgentTurnPolicy,
  loop: ToolUseLoopResult,
  modelRequest: ModelRequest,
  semantics: AgentTurnRuntimeSemantics
): AgentTurnRuntimeResult {
  const stoppedReason = mapStoppedReason(loop);
  const status = stoppedReason === "completed" || stoppedReason === "no_tool_calls"
    ? "completed"
    : stoppedReason === "cancelled"
      ? "cancelled"
      : stoppedReason === "approval_required"
        ? "approval_required"
        : stoppedReason === "out_of_fuel"
          ? "paused"
          : "failed";
  const shouldExposeOutput = semantics.exposeNonFinalOutput || status === "completed" || status === "failed";
  return {
    status,
    stoppedReason,
    fallback: policy.fallback,
    modelRequestId: shouldExposeOutput ? loop.finalOutput.requestId : modelRequest.requestId,
    modelResponseId: shouldExposeOutput ? loop.finalOutput.responseId : undefined,
    finalOutput: shouldExposeOutput ? loop.finalOutput : undefined,
    toolCalls: loop.toolCalls,
    modelRounds: loop.modelRounds,
    toolRounds: loop.rounds,
    pendingApproval: loop.pendingApproval === undefined
      ? undefined
      : {
          confirmationId: loop.pendingApproval.confirmationId,
          modelRequest,
          toolLoop: loop.pendingApproval,
          policy,
        },
  };
}

function mapStoppedReason(loop: ToolUseLoopResult): AgentTurnRuntimeResult["stoppedReason"] {
  if (loop.stoppedReason === "out_of_fuel") {
    return "out_of_fuel";
  }
  if (loop.stoppedReason === "error") {
    return "model_failed";
  }
  return loop.stoppedReason;
}

function normalizePolicy(policy: AgentTurnPolicy): AgentTurnPolicy {
  return {
    ...policy,
    allowedTools: [...(policy.allowedTools ?? [])],
    maxModelRounds: normalizeOptionalRoundLimit(policy.maxModelRounds),
    maxToolRounds: normalizeOptionalRoundLimit(policy.maxToolRounds),
    budget: { ...policy.budget },
  };
}

function normalizeOptionalRoundLimit(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.floor(value);
}

function cloneModelMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    protocolExtensions:
      message.protocolExtensions === undefined ? undefined : globalThis.structuredClone(message.protocolExtensions),
    toolCalls: message.toolCalls?.map((toolCall) => ({
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      input: globalThis.structuredClone(toolCall.input),
    })),
  };
}

const NO_TOOL_BROKER: ToolExecutionBroker = {
  list(): ToolDefinition[] {
    return [];
  },
  has(): boolean {
    return false;
  },
  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission?: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: undefined,
      status: "failed",
      error: `Tool is not registered: ${request.toolName}`,
      durationMs: 0,
    };
  },
  resetCallCount(): void {},
  getCallCount(): number {
    return 0;
  },
};

const ORDINARY_AGENT_INTERNAL_TOOL_NAMES = ["finish_task"];
