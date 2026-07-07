
import type { ModelMessage, ModelUsage } from "../intelligence/contracts.js";
import type {
  ToolCallRequest,
  ToolDisplayProjection,
  ToolErrorFacts,
  ToolResultEnvelope,
} from "../tools/contracts.js";

export type SubAgentSourceKind = "builtin" | "project" | "user" | "plugin" | "custom";

export type SubAgentDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly sourceKind: SubAgentSourceKind;
  readonly sourceRootId: string;
  readonly sourcePrecedence: number;
  readonly enabled: boolean;
  readonly allowedTools?: readonly string[];
  readonly model?: string;
  readonly maxSteps?: number;
  readonly sourcePath?: string;
  readonly version?: string;
  readonly category?: string;
  readonly whenToUse?: readonly string[];
  readonly whenNotToUse?: readonly string[];
  readonly contentHash?: string;
  readonly bodyHash?: string;
};

export type SubAgentCallResult = {
  readonly status: "completed" | "failed" | "cancelled";
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly summary: string;
  readonly fullOutput?: string;
  readonly toolCalls?: number;
  readonly modelRounds?: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly errorDomain?: string;
  readonly runId?: string;
};

export type SubAgentBatchCallResult = {
  readonly results: readonly SubAgentCallResult[];
  readonly allCompleted: boolean;
  readonly successCount: number;
  readonly failedCount: number;
  readonly totalDurationMs?: number;
};

export type SubAgentRootDescriptor = {
  readonly rootPath: string;
  readonly sourceKind: SubAgentSourceKind;
  readonly sourceRootId: string;
  readonly precedence: number;
};

export type SubAgentRootInput = string | SubAgentRootDescriptor;

export type SubAgentDiscoveryOptions = {
  readonly roots: readonly SubAgentRootInput[];
};

export type SubAgentRunStatus = "completed" | "failed" | "approval_required" | "cancelled";

export type SubAgentModelExchange = {
  readonly requestId: string;
  readonly responseId?: string;
  readonly status: "requested" | "completed" | "failed" | "cancelled";
  readonly purpose?: string;
  readonly requestedAt: string;
  readonly completedAt?: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly string[];
  readonly textOutput?: string;
  readonly toolCalls: readonly ToolCallRequest[];
  readonly failureKind?: string;
  readonly failureMessage?: string;
  readonly retryable?: boolean;
  readonly finishReason?: string;
  readonly usage?: ModelUsage;
};

export type SubAgentToolTrace = {
  readonly callId: string;
  readonly toolName: string;
  readonly input?: unknown;
  readonly status: "requested" | "approval_required" | "completed" | "failed" | "cancelled";
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly confirmationId?: string;
  readonly outputSummary?: string;
  readonly display?: ToolDisplayProjection;
  readonly envelope?: ToolResultEnvelope;
  readonly error?: string;
  readonly errorFacts?: ToolErrorFacts;
};

export type SubAgentRunTrace = {
  readonly parentRunId?: string;
  readonly parentToolCallId?: string;
  readonly subRunId: string;
  readonly batchId?: string;
  readonly batchIndex?: number;
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly task: string;
  readonly context?: string;
  readonly status: SubAgentRunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs: number;
  readonly modelRounds: number;
  readonly toolCalls: number;
  readonly summary: string;
  readonly fullOutput?: string;
  readonly error?: string;
  readonly modelExchanges: readonly SubAgentModelExchange[];
  readonly toolTraces: readonly SubAgentToolTrace[];
};

export type SubAgentRunView = SubAgentRunTrace;

export type SubAgentRunTraceSink = {
  upsert(trace: SubAgentRunTrace): void;
};

export type SubAgentRunTraceReader = {
  get(subRunId: string): SubAgentRunTrace | undefined;
};
