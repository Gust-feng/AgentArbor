import type { ArborMessage } from "../../domain/common.js";
import type {
  IntelligenceChannel,
  ModelMessage,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type {
  ToolConfirmationPolicy,
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
} from "../../domain/tools/index.js";

export type ToolUseLoopOptions = {
  readonly intelligenceChannel: IntelligenceChannel;
  readonly toolCenter: ToolExecutionBroker;
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly allowedTools: readonly string[];
  readonly blockedToolNames?: readonly string[];
  readonly approvedConfirmationIds?: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly publishToolEvent?: (message: ArborMessage) => void;
  readonly maintainContext?: ToolUseLoopContextMaintainer;
  readonly abortSignal?: AbortSignal;
};

export type ToolUseLoopContextMaintainer = (input: {
  readonly initialRequest: ModelRequest;
  readonly requestId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
}) => Promise<ToolUseLoopContextMaintenanceResult>;

export type ToolUseLoopContextMaintenanceResult =
  | {
      readonly status: "unchanged";
    }
  | {
      readonly status: "compacted";
      readonly messages: readonly ModelMessage[];
    }
  | {
      readonly status: "failed";
      readonly message: string;
      readonly requestId?: string;
      readonly responseId?: string;
      readonly retryable?: boolean;
    };

export type ToolUseLoopPendingApproval = {
  readonly confirmationId: string;
  readonly pendingToolCall: ToolCallRequest;
  readonly confirmationRequest?: NonNullable<ToolCallResult["confirmationRequest"]>;
  readonly remainingToolCallsAfterApproval: readonly ToolCallRequest[];
  readonly messagesBeforeToolCall: readonly ModelMessage[];
  readonly assistantMessage: ModelMessage;
  readonly completedToolResults: readonly ToolCallResult[];
  readonly toolCallsBeforeApproval: readonly ToolCallResult[];
  readonly modelRounds: number;
  readonly rounds: number;
  readonly requestId: string;
};

export type ToolUseLoopConfirmationDecision = {
  readonly confirmationId: string;
  readonly decision: "deny" | "guidance";
  readonly guidance?: string;
};

export type ToolUseLoopModelResponseTrace = {
  readonly requestId: string;
  readonly responseId?: string;
  readonly status: ModelResponse["status"];
  readonly text?: string;
  readonly reasoningSummary?: string;
  readonly toolCallIds: readonly string[];
  readonly finishReason?: ModelResponse["finishReason"];
  readonly completedAt: string;
};

export type ToolUseLoopResult = {
  readonly finalOutput: ModelResponse;
  readonly toolCalls: readonly ToolCallResult[];
  readonly modelResponses: readonly ToolUseLoopModelResponseTrace[];
  /**
   * Last model-visible conversation state that can continue the same loop.
   * It includes completed assistant tool-call messages and tool result messages,
   * but does not append failed provider responses.
   */
  readonly contextMessages?: readonly ModelMessage[];
  readonly modelRounds: number;
  readonly rounds: number;
  readonly stoppedReason:
    | "completed"
    | "no_tool_calls"
    | "out_of_fuel"
    | "context_overflow"
    | "approval_required"
    | "cancelled"
    | "error";
  readonly pendingApproval?: ToolUseLoopPendingApproval;
};
