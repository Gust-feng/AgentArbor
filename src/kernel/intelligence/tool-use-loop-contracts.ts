import type { ArborMessage } from "../../domain/common.js";
import type {
  IntelligenceChannel,
  ModelMessage,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type {
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
  readonly allowedTools?: readonly string[];
  readonly blockedToolNames?: readonly string[];
  readonly approvedConfirmationIds?: readonly string[];
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

export type ToolUseLoopResult = {
  readonly finalOutput: ModelResponse;
  readonly toolCalls: readonly ToolCallResult[];
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
