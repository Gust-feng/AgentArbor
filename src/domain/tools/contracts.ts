export type ToolInputSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
};

export type ToolCategory = "research" | "workspace" | "filesystem" | "terminal" | "web" | "mcp" | "other";

export type ToolRiskLevel = "low" | "medium" | "high";

export type ToolOperationType =
  | "read-only"
  | "read-write"
  | "execute"
  | "external-submit";

export type ToolVisibleResultPolicy = {
  readonly userVisible: "summary-only" | "safe-preview" | "hidden";
  readonly maxPreviewChars: number;
  readonly omitRawOutput: boolean;
};

export type ToolDefinitionMetadata = {
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly operationType: ToolOperationType;
  readonly requiresConfirmation: boolean;
  readonly visibleResultPolicy: ToolVisibleResultPolicy;
};

export type ToolSafeProjection = {
  readonly agentContent?: unknown;
  readonly uiSummary?: string;
  readonly diagnosticRef?: string;
  readonly truncated?: boolean;
  readonly redacted?: boolean;
};

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly metadata?: ToolDefinitionMetadata;
};

export type ToolCallRequest = {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
};

export type ToolCallResult = {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly error?: string;
  readonly durationMs: number;
  readonly projection?: ToolSafeProjection;
  readonly confirmationRequest?: ConfirmationRequest;
};

export type ToolExecutionContext = {
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly abortSignal?: AbortSignal;
};

export type ToolPermissionCheck = {
  readonly callerAgentId: string;
  readonly allowedTools?: readonly string[];
  readonly approvedConfirmationIds?: readonly string[];
};

export type SandboxOperation =
  | "read"
  | "list"
  | "search"
  | "write"
  | "edit"
  | "execute";

export type SandboxPolicyRequest = {
  readonly operation: SandboxOperation;
  readonly workspaceRoot: string;
  readonly relativePath?: string;
  readonly bytes?: number;
  readonly command?: string;
  readonly args?: readonly string[];
};

export type SandboxPolicyDecision =
  | {
      readonly allowed: true;
    }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly reason: string;
    };

export interface SandboxPolicy {
  check(request: SandboxPolicyRequest): SandboxPolicyDecision;
}

export interface ToolExecutor {
  readonly definition: ToolDefinition;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface ToolExecutionBroker {
  list(): ToolDefinition[];
  has(name: string): boolean;
  execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission?: ToolPermissionCheck
  ): Promise<ToolCallResult>;
  resetCallCount(): void;
  getCallCount(): number;
}
import type { ConfirmationRequest } from "../basic-agent/index.js";
